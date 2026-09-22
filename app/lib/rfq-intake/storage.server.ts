import {
  CopyObjectCommand,
  DeleteObjectsCommand,
  GetObjectCommand,
  HeadObjectCommand,
  ListObjectsV2Command,
} from "@aws-sdk/client-s3";
import { Upload } from "@aws-sdk/lib-storage";
import type { Readable } from "node:stream";

import { getEnv, requireEnv } from "../env.server";
import { getS3Client } from "../s3.server";
import { parseReceiptKey } from "./keys";
import type { RfqStorage, StoredObject } from "./types";

function bucket() {
  return getEnv("S3_BUCKET") || "subtract-attachments";
}

export function getRfqStorageBucket(): string {
  return bucket();
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

export const awsRfqStorage: RfqStorage = {
  async list(prefix, cursor) {
    const response = await getS3Client().send(
      new ListObjectsV2Command({
        Bucket: bucket(),
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
  },

  async head(key) {
    try {
      const response = await getS3Client().send(
        new HeadObjectCommand({ Bucket: bucket(), Key: key }),
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
  },

  async read(key) {
    const response = await getS3Client().send(
      new GetObjectCommand({ Bucket: bucket(), Key: key }),
    );
    if (!response.Body) throw new Error(`S3 returned no body for ${key}`);
    return response.Body as Readable;
  },

  async readJson(key) {
    const stream = await this.read(key);
    const chunks: Buffer[] = [];
    for await (const chunk of stream) chunks.push(Buffer.from(chunk));
    return JSON.parse(Buffer.concat(chunks).toString("utf8"));
  },

  async copy(sourceKey, destinationKey) {
    await getS3Client().send(
      new CopyObjectCommand({
        Bucket: bucket(),
        CopySource: encodeURIComponent(`${bucket()}/${sourceKey}`).replace(/%2F/g, "/"),
        Key: destinationKey,
      }),
    );
  },

  async uploadStream(key, body, contentType) {
    await new Upload({
      client: getS3Client(),
      params: { Bucket: bucket(), Key: key, Body: body, ContentType: contentType },
      queueSize: 2,
      partSize: 5 * 1024 * 1024,
      leavePartsOnError: false,
    }).done();
    const uploaded = await this.head(key);
    if (!uploaded) throw new Error(`Could not verify uploaded object: ${key}`);
    return uploaded;
  },

  async deletePrefix(prefix) {
    assertDeletableIntakePrefix(prefix);
    let deletedObjectCount: number;
    do {
      // Always request the first page. Continuation tokens can skip keys after the
      // preceding page is deleted because the underlying listing has changed.
      const page = await this.list(prefix);
      deletedObjectCount = page.objects.length;
      if (page.objects.length > 0) {
        const response = await getS3Client().send(
          new DeleteObjectsCommand({
            Bucket: bucket(),
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

export function isRfqIntakeEnabled(): boolean {
  return getEnv("RFQ_INTAKE_ENABLED") === "true";
}

export function getRfqWebhookSecret(): string {
  return requireEnv("RFQ_WEBHOOK_SECRET");
}
