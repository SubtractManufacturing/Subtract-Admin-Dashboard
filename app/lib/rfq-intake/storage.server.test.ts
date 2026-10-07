import {
  GetObjectCommand,
  HeadObjectCommand,
  ListObjectsV2Command,
  S3Client,
} from "@aws-sdk/client-s3";
import { HttpResponse, type HttpRequest } from "@smithy/protocol-http";
import { Readable } from "node:stream";
import { describe, expect, it } from "vitest";

import { MAX_SERVER_SIDE_COPY_BYTES } from "./copy-strategy";
import { createAwsRfqStorage } from "./storage.server";

const INTAKE_BUCKET = "wp-intake";
const APP_BUCKET = "erp-app";
const SESSION = "018f0f7d-9f65-7eb4-bf9c-0fca82a87a10";
const INTAKE_KEY = `intake/${SESSION}/parts/upload_model.step`;
const CANONICAL_KEY = "quote-parts/part-1/source/model.step";

type RecordedRequest = {
  method: string;
  path: string;
  headers: Record<string, string>;
};

/** A real S3 client whose HTTP layer is replaced by a recorder, so SDK behaviour (e.g. Upload) is genuine. */
function recordingS3Client(respond: (request: RecordedRequest) => HttpResponse) {
  const requests: RecordedRequest[] = [];
  const client = new S3Client({
    region: "us-east-1",
    endpoint: "http://s3.test",
    forcePathStyle: true,
    credentials: { accessKeyId: "test", secretAccessKey: "test" },
    requestChecksumCalculation: "WHEN_REQUIRED",
    responseChecksumValidation: "WHEN_REQUIRED",
    requestHandler: {
      async handle(request: HttpRequest) {
        const recorded = {
          method: request.method,
          path: decodeURIComponent(request.path),
          headers: request.headers,
        };
        requests.push(recorded);
        return { response: respond(recorded) };
      },
      updateHttpClientConfig() {},
      httpHandlerConfigs: () => ({}),
    },
  });
  return { client, requests };
}

function ok(headers: Record<string, string> = {}, body = "") {
  return new HttpResponse({ statusCode: 200, headers, body: Readable.from(body) });
}

/** Intake side is a send-level fake: only head/get are needed for copy tests. */
function fakeIntakeClient(sourceSize: number) {
  const sent: Array<{ name: string; input: Record<string, unknown> }> = [];
  const client = {
    config: {},
    async send(command: { constructor: { name: string }; input: Record<string, unknown> }) {
      sent.push({ name: command.constructor.name, input: command.input });
      if (command instanceof HeadObjectCommand) {
        return { ContentLength: sourceSize, ContentType: "application/step", ETag: "e" };
      }
      if (command instanceof GetObjectCommand) {
        return {
          Body: Readable.from(Buffer.from("STEP")),
          ContentType: "application/step",
          Metadata: { originalfilename: "model.step" },
        };
      }
      if (command instanceof ListObjectsV2Command) {
        return sent.filter((entry) => entry.name === ListObjectsV2Command.name).length === 1
          ? { Contents: [{ Key: `intake/${SESSION}/meta/receipt.json`, Size: 1 }] }
          : { Contents: [] };
      }
      return {};
    },
  } as unknown as S3Client;
  return { client, sent };
}

function setup(options: { sameAccount: boolean; sourceSize?: number }) {
  const intake = fakeIntakeClient(options.sourceSize ?? 4);
  const app = recordingS3Client((request) =>
    request.method === "HEAD"
      ? ok({ "content-length": "9", "content-type": "application/step", etag: '"e"' })
      : request.headers["x-amz-copy-source"]
        ? ok({}, "<CopyObjectResult><ETag>&quot;e&quot;</ETag></CopyObjectResult>")
        : ok({ etag: '"e"' }),
  );
  const strategies: string[] = [];
  const storage = createAwsRfqStorage({
    intake: { client: intake.client, bucket: INTAKE_BUCKET },
    app: { client: app.client, bucket: APP_BUCKET },
    sameAccount: options.sameAccount,
    onCopyStrategy: (strategy) => strategies.push(strategy),
  });
  return { storage, intake, app, strategies };
}

describe("RFQ storage bucket routing", () => {
  it("copies server-side from the intake bucket into the app bucket within one account", async () => {
    const { storage, intake, app, strategies } = setup({ sameAccount: true });

    await storage.canonical.copyFromIntake(INTAKE_KEY, CANONICAL_KEY);

    expect(strategies).toEqual(["server_side"]);
    expect(app.requests).toHaveLength(1);
    expect(app.requests[0]).toMatchObject({
      method: "PUT",
      path: `/${APP_BUCKET}/${CANONICAL_KEY}`,
    });
    expect(app.requests[0].headers["x-amz-copy-source"]).toBe(`${INTAKE_BUCKET}/${INTAKE_KEY}`);
    // Nothing is downloaded through the worker.
    expect(intake.sent.map((entry) => entry.name)).toEqual([HeadObjectCommand.name]);
  });

  it("streams from the intake bucket into the app bucket across accounts", async () => {
    const { storage, intake, app, strategies } = setup({ sameAccount: false });

    await storage.canonical.copyFromIntake(INTAKE_KEY, CANONICAL_KEY);

    expect(strategies).toEqual(["stream"]);
    expect(intake.sent.find((entry) => entry.name === GetObjectCommand.name)?.input).toMatchObject({
      Bucket: INTAKE_BUCKET,
      Key: INTAKE_KEY,
    });
    expect(app.requests).toHaveLength(1);
    expect(app.requests[0]).toMatchObject({
      method: "PUT",
      path: `/${APP_BUCKET}/${CANONICAL_KEY}`,
    });
    expect(app.requests[0].headers["x-amz-copy-source"]).toBeUndefined();
    expect(app.requests[0].headers["content-type"]).toBe("application/step");
    expect(app.requests[0].headers["x-amz-meta-originalfilename"]).toBe("model.step");
  });

  it("streams objects too large for a single CopyObject even within one account", async () => {
    const { storage, app, strategies } = setup({
      sameAccount: true,
      sourceSize: MAX_SERVER_SIDE_COPY_BYTES + 1,
    });

    await storage.canonical.copyFromIntake(INTAKE_KEY, CANONICAL_KEY);

    expect(strategies).toEqual(["stream"]);
    expect(app.requests.some((request) => "x-amz-copy-source" in request.headers)).toBe(false);
  });

  it("fails clearly when the intake object is missing", async () => {
    const intake = {
      config: {},
      async send() {
        throw Object.assign(new Error("Not Found"), { $metadata: { httpStatusCode: 404 } });
      },
    } as unknown as S3Client;
    const app = recordingS3Client(() => ok());
    const { canonical } = createAwsRfqStorage({
      intake: { client: intake, bucket: INTAKE_BUCKET },
      app: { client: app.client, bucket: APP_BUCKET },
      sameAccount: true,
    });

    await expect(canonical.copyFromIntake(INTAKE_KEY, CANONICAL_KEY)).rejects.toThrow(
      /Intake object is missing/,
    );
    expect(app.requests).toHaveLength(0);
  });

  it("deletes only in the intake bucket and heads canonical objects only in the app bucket", async () => {
    const { storage, intake, app } = setup({ sameAccount: false });

    await storage.intake.deletePrefix(`intake/${SESSION}/`);
    await expect(storage.canonical.head(CANONICAL_KEY)).resolves.toMatchObject({ size: 9 });

    const deletes = intake.sent.filter((entry) => entry.name === "DeleteObjectsCommand");
    expect(deletes).toHaveLength(1);
    expect(deletes[0].input).toMatchObject({ Bucket: INTAKE_BUCKET });
    expect(app.requests).toHaveLength(1);
    expect(app.requests[0]).toMatchObject({
      method: "HEAD",
      path: `/${APP_BUCKET}/${CANONICAL_KEY}`,
    });
  });
});
