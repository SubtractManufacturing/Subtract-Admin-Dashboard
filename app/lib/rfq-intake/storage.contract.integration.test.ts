/**
 * S3 adapter contract. CI and local runs point these tests at disposable Adobe S3Mock,
 * with one bucket standing in for WordPress intake and another for the application.
 */
import {
  CreateBucketCommand,
  DeleteObjectsCommand,
  ListObjectsV2Command,
  PutObjectCommand,
} from "@aws-sdk/client-s3";
import { Readable } from "node:stream";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { getS3Client } from "../s3.server";
import { createAwsRfqStorage } from "./storage.server";

const APP_BUCKET = process.env.S3_BUCKET || "rfq-contract";
const INTAKE_BUCKET = process.env.INTAKE_S3_BUCKET || "rfq-intake-contract";
const SESSION = "018f0f7d-9f65-7eb4-bf9c-0fca82a87a99";
const PREFIX = `intake/${SESSION}/`;
const CANONICAL_PREFIX = `contract-test/${SESSION}/`;

async function ensureBucket(bucket: string) {
  try {
    await getS3Client().send(new CreateBucketCommand({ Bucket: bucket }));
  } catch (error) {
    const name = (error as { name?: string }).name;
    if (name !== "BucketAlreadyOwnedByYou" && name !== "BucketAlreadyExists") throw error;
  }
}

async function deleteAll(bucket: string, prefix: string) {
  const listed = await getS3Client().send(
    new ListObjectsV2Command({ Bucket: bucket, Prefix: prefix }),
  );
  if (!listed.Contents?.length) return;
  await getS3Client().send(
    new DeleteObjectsCommand({
      Bucket: bucket,
      Delete: { Objects: listed.Contents.map(({ Key }) => ({ Key })) },
    }),
  );
}

function storageFor(sameAccount: boolean, strategies: string[]) {
  const client = getS3Client();
  return createAwsRfqStorage({
    intake: { client, bucket: INTAKE_BUCKET },
    app: { client, bucket: APP_BUCKET },
    sameAccount,
    onCopyStrategy: (strategy) => strategies.push(strategy),
  });
}

describe("AWS RFQ storage adapter contract", () => {
  beforeAll(async () => {
    if (!process.env.S3_ENDPOINT) {
      throw new Error("S3_ENDPOINT must point to disposable S3Mock for this integration test");
    }
    expect(INTAKE_BUCKET).not.toBe(APP_BUCKET);
    await ensureBucket(APP_BUCKET);
    await ensureBucket(INTAKE_BUCKET);
  });

  afterAll(async () => {
    await deleteAll(INTAKE_BUCKET, PREFIX);
    await deleteAll(APP_BUCKET, CANONICAL_PREFIX);
  });

  it("supports intake pagination, metadata, and guarded deletion", async () => {
    const { intake } = storageFor(true, []);
    for (const [key, body] of [
      [`${PREFIX}meta/receipt.json`, "receipt"],
      [`${PREFIX}meta/manifest.json`, "manifest"],
      [`${PREFIX}parts/model.step`, "model"],
    ]) {
      await getS3Client().send(
        new PutObjectCommand({
          Bucket: INTAKE_BUCKET,
          Key: key,
          Body: body,
          ContentType: "text/plain",
        }),
      );
    }

    const first = await intake.list(PREFIX);
    expect(first.objects).toHaveLength(2);
    expect(first.nextCursor).toBeTruthy();
    const second = await intake.list(PREFIX, first.nextCursor!);
    expect(second.objects).toHaveLength(1);

    await expect(intake.head(`${PREFIX}parts/model.step`)).resolves.toMatchObject({
      size: 5,
      contentType: "text/plain",
    });
    await expect(intake.readJson(`${PREFIX}meta/missing.json`)).rejects.toThrow();

    await expect(intake.deletePrefix("intake/")).rejects.toThrow(/Refusing/);
    await intake.deletePrefix(PREFIX);
    expect((await intake.list(PREFIX)).objects).toHaveLength(0);
  });

  it("uploads multipart archives to the application bucket and supports overwrite", async () => {
    const { intake, canonical } = storageFor(true, []);
    const key = `${CANONICAL_PREFIX}archive.zip`;
    const largeBody = Buffer.alloc(6 * 1024 * 1024, 7);

    await canonical.uploadStream(key, Readable.from(largeBody), "application/zip");
    expect((await canonical.head(key))?.size).toBe(largeBody.length);
    await canonical.uploadStream(key, Readable.from(Buffer.from("replacement")), "application/zip");
    expect((await canonical.head(key))?.size).toBe(11);

    // The application bucket write is invisible to the intake side.
    expect(await intake.head(key)).toBeNull();
  });

  describe.each([
    ["server-side copy (same account)", true, "server_side"],
    ["streamed copy (different account or provider)", false, "stream"],
  ] as const)("%s", (_label, sameAccount, expectedStrategy) => {
    it("copies intake objects into the application bucket without touching the source", async () => {
      const strategies: string[] = [];
      const { intake, canonical } = storageFor(sameAccount, strategies);
      const sourceKey = `${PREFIX}parts/${expectedStrategy}.step`;
      const destinationKey = `${CANONICAL_PREFIX}${expectedStrategy}/model.step`;
      // Larger than one 16 MiB streaming part so the multipart path is exercised.
      const body = Buffer.alloc(17 * 1024 * 1024, 3);
      await getS3Client().send(
        new PutObjectCommand({
          Bucket: INTAKE_BUCKET,
          Key: sourceKey,
          Body: body,
          ContentType: "application/step",
        }),
      );

      await canonical.copyFromIntake(sourceKey, destinationKey);

      expect(strategies).toEqual([expectedStrategy]);
      expect(await canonical.head(destinationKey)).toMatchObject({
        size: body.length,
        contentType: "application/step",
      });
      expect(await intake.head(sourceKey)).toMatchObject({ size: body.length });
      expect(await intake.head(destinationKey)).toBeNull();
    });

    it("fails clearly when the intake object is missing", async () => {
      const { canonical } = storageFor(sameAccount, []);
      await expect(
        canonical.copyFromIntake(`${PREFIX}parts/absent.step`, `${CANONICAL_PREFIX}absent.step`),
      ).rejects.toThrow(/Intake object is missing/);
    });
  });
});
