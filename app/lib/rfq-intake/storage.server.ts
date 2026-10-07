import {
  CopyObjectCommand,
  DeleteObjectsCommand,
  GetObjectCommand,
  HeadObjectCommand,
  ListObjectsV2Command,
  type S3Client,
} from "@aws-sdk/client-s3";
import { Upload } from "@aws-sdk/lib-storage";
import type { Readable } from "node:stream";

import { getEnv, requireEnv } from "../env.server";
import { getAppS3Identity, getS3Client } from "../s3.server";
import { chooseCopyStrategy, sharesStorageAccount } from "./copy-strategy";
import { getIntakeS3Client, getIntakeS3Config } from "./intake-s3.server";
import { parseReceiptKey } from "./keys";
import type { RfqCanonicalStorage, RfqIntakeStorage, StoredObject } from "./types";

/** Application bucket: canonical Quote files, archives, and attachment rows. */
function appBucket() {
  return getEnv("S3_BUCKET") || "subtract-attachments";
}

export function getRfqStorageBucket(): string {
  return appBucket();
}

function metadata(input: {
  key?: string;
  size?: number;
  contentType?: string;
  etag?: string;
  lastModified?: Date;
}): StoredObject {
  if (!input.key) throw new Error("S3 returned an object without a key");
  return {
    key: input.key,
    size: input.size ?? 0,
    contentType: input.contentType ?? null,
    etag: input.etag ?? null,
    lastModified: input.lastModified ?? null,
  };
}

function assertDeletableIntakePrefix(prefix: string) {
  const receiptKey = `${prefix}meta/receipt.json`;
  const parsed = parseReceiptKey(receiptKey);
  if (!parsed || prefix !== `intake/${parsed.sessionId}/`) {
    throw new Error("Refusing to delete an unvalidated intake prefix");
  }
}

type BucketConnection = { client: S3Client; bucket: string };

async function headObject(
  { client, bucket }: BucketConnection,
  key: string,
): Promise<StoredObject | null> {
  try {
    const response = await client.send(
      new HeadObjectCommand({ Bucket: bucket, Key: key }),
    );
    return metadata({
      key,
      size: response.ContentLength,
      contentType: response.ContentType,
      etag: response.ETag,
      lastModified: response.LastModified,
    });
  } catch (error) {
    const status = (error as { $metadata?: { httpStatusCode?: number } }).$metadata
      ?.httpStatusCode;
    if (status === 404) return null;
    throw error;
  }
}

async function listObjects(
  { client, bucket }: BucketConnection,
  prefix: string,
  cursor?: string,
) {
  const response = await client.send(
    new ListObjectsV2Command({
      Bucket: bucket,
      Prefix: prefix,
      ContinuationToken: cursor,
      MaxKeys: getEnv("RFQ_S3_LIST_PAGE_SIZE")
        ? Number(getEnv("RFQ_S3_LIST_PAGE_SIZE"))
        : undefined,
    }),
  );
  return {
    objects: (response.Contents ?? []).map((object) =>
      metadata({
        key: object.Key,
        size: object.Size,
        etag: object.ETag,
        lastModified: object.LastModified,
      }),
    ),
    nextCursor: response.IsTruncated ? response.NextContinuationToken ?? null : null,
  };
}

async function readObject({ client, bucket }: BucketConnection, key: string) {
  const response = await client.send(new GetObjectCommand({ Bucket: bucket, Key: key }));
  if (!response.Body) throw new Error(`S3 returned no body for ${key}`);
  return response.Body as Readable;
}

export type AwsRfqStorageInput = {
  intake: BucketConnection;
  app: BucketConnection;
  /** True when one set of credentials can read the intake bucket and write the app bucket. */
  sameAccount: boolean;
  onCopyStrategy?: (strategy: "server_side" | "stream") => void;
};

export function createAwsRfqStorage(input: AwsRfqStorageInput): {
  intake: RfqIntakeStorage;
  canonical: RfqCanonicalStorage;
} {
  const { intake: intakeConnection, app: appConnection } = input;

  const intake: RfqIntakeStorage = {
    list: (prefix, cursor) => listObjects(intakeConnection, prefix, cursor),
    head: (key) => headObject(intakeConnection, key),
    read: (key) => readObject(intakeConnection, key),

    async readJson(key) {
      const stream = await readObject(intakeConnection, key);
      const chunks: Buffer[] = [];
      for await (const chunk of stream) chunks.push(Buffer.from(chunk));
      return JSON.parse(Buffer.concat(chunks).toString("utf8"));
    },

    async deletePrefix(prefix) {
      assertDeletableIntakePrefix(prefix);
      let deletedObjectCount: number;
      do {
        // Always request the first page. Continuation tokens can skip keys after the
        // preceding page is deleted because the underlying listing has changed.
        const page = await listObjects(intakeConnection, prefix);
        deletedObjectCount = page.objects.length;
        if (page.objects.length > 0) {
          const response = await intakeConnection.client.send(
            new DeleteObjectsCommand({
              Bucket: intakeConnection.bucket,
              Delete: {
                Quiet: true,
                Objects: page.objects.map(({ key }) => ({ Key: key })),
              },
            }),
          );
          if (response.Errors?.length) {
            throw new Error(
              `S3 prefix deletion failed for ${response.Errors.map((item) => item.Key).join(", ")}`,
            );
          }
        }
      } while (deletedObjectCount > 0);
    },
  };

  async function streamCopy(intakeKey: string, canonicalKey: string) {
    const response = await intakeConnection.client.send(
      new GetObjectCommand({ Bucket: intakeConnection.bucket, Key: intakeKey }),
    );
    if (!response.Body) throw new Error(`S3 returned no body for ${intakeKey}`);
    const body = response.Body as Readable;
    try {
      await new Upload({
        client: appConnection.client,
        params: {
          Bucket: appConnection.bucket,
          Key: canonicalKey,
          Body: body,
          ContentType: response.ContentType,
          Metadata: response.Metadata,
        },
        queueSize: 2,
        partSize: 16 * 1024 * 1024,
        leavePartsOnError: false,
      }).done();
    } finally {
      // Release the intake connection if the upload failed before draining it.
      body.destroy();
    }
  }

  const canonical: RfqCanonicalStorage = {
    head: (key) => headObject(appConnection, key),

    async uploadStream(key, body, contentType) {
      await new Upload({
        client: appConnection.client,
        params: {
          Bucket: appConnection.bucket,
          Key: key,
          Body: body,
          ContentType: contentType,
        },
        queueSize: 2,
        partSize: 5 * 1024 * 1024,
        leavePartsOnError: false,
      }).done();
      const uploaded = await headObject(appConnection, key);
      if (!uploaded) throw new Error(`Could not verify uploaded object: ${key}`);
      return uploaded;
    },

    async copyFromIntake(intakeKey, canonicalKey) {
      const source = await headObject(intakeConnection, intakeKey);
      if (!source) throw new Error(`Intake object is missing: ${intakeKey}`);
      const strategy = chooseCopyStrategy({
        sameAccount: input.sameAccount,
        sizeBytes: source.size,
      });
      input.onCopyStrategy?.(strategy);

      if (strategy === "server_side") {
        await appConnection.client.send(
          new CopyObjectCommand({
            Bucket: appConnection.bucket,
            CopySource: encodeURIComponent(`${intakeConnection.bucket}/${intakeKey}`).replace(
              /%2F/g,
              "/",
            ),
            Key: canonicalKey,
          }),
        );
        return;
      }
      await streamCopy(intakeKey, canonicalKey);
    },
  };

  return { intake, canonical };
}

let defaultStorage: ReturnType<typeof createAwsRfqStorage> | null = null;

/**
 * Builds the production adapters from env on first use so importing this module
 * never requires INTAKE_S3_* while RFQ intake is disabled.
 */
function getDefaultStorage() {
  if (!defaultStorage) {
    const intakeConfig = getIntakeS3Config();
    const sameAccount = sharesStorageAccount(getAppS3Identity(), {
      endpoint: intakeConfig.endpoint,
      region: intakeConfig.region,
      accessKeyId: intakeConfig.accessKeyId,
    });
    const loggedStrategies = new Set<string>();
    defaultStorage = createAwsRfqStorage({
      intake: { client: getIntakeS3Client(), bucket: intakeConfig.bucket },
      app: { client: getS3Client(), bucket: appBucket() },
      sameAccount,
      onCopyStrategy(strategy) {
        if (loggedStrategies.has(strategy)) return;
        loggedStrategies.add(strategy);
        console.log(
          `[RFQ Intake] ${JSON.stringify({ event: "copy_strategy", strategy, sameAccount })}`,
        );
      },
    });
  }
  return defaultStorage;
}

export const awsRfqIntakeStorage: RfqIntakeStorage = {
  list: (prefix, cursor) => getDefaultStorage().intake.list(prefix, cursor),
  head: (key) => getDefaultStorage().intake.head(key),
  read: (key) => getDefaultStorage().intake.read(key),
  readJson: (key) => getDefaultStorage().intake.readJson(key),
  deletePrefix: (prefix) => getDefaultStorage().intake.deletePrefix(prefix),
};

export const awsRfqCanonicalStorage: RfqCanonicalStorage = {
  head: (key) => getDefaultStorage().canonical.head(key),
  uploadStream: (key, body, contentType) =>
    getDefaultStorage().canonical.uploadStream(key, body, contentType),
  copyFromIntake: (intakeKey, canonicalKey) =>
    getDefaultStorage().canonical.copyFromIntake(intakeKey, canonicalKey),
};

export function isRfqIntakeEnabled(): boolean {
  return getEnv("RFQ_INTAKE_ENABLED") === "true";
}

export function getRfqWebhookSecret(): string {
  return requireEnv("RFQ_WEBHOOK_SECRET");
}
