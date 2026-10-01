/**
 * S3 adapter contract. CI and local runs point these tests at disposable Adobe S3Mock.
 */
import { CreateBucketCommand, PutObjectCommand } from "@aws-sdk/client-s3";
import { Readable } from "node:stream";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { getS3Client } from "../s3.server";
import { awsRfqStorage } from "./storage.server";

const BUCKET = process.env.S3_BUCKET || "rfq-contract";
const SESSION = "018f0f7d-9f65-7eb4-bf9c-0fca82a87a99";
const PREFIX = `intake/${SESSION}/`;

describe("AWS RFQ storage adapter contract", () => {
  beforeAll(async () => {
    if (!process.env.S3_ENDPOINT) {
      throw new Error("S3_ENDPOINT must point to disposable S3Mock for this integration test");
    }
    try {
      await getS3Client().send(new CreateBucketCommand({ Bucket: BUCKET }));
    } catch (error) {
      const name = (error as { name?: string }).name;
      if (name !== "BucketAlreadyOwnedByYou" && name !== "BucketAlreadyExists") throw error;
    }
  });

  afterAll(async () => {
    await awsRfqStorage.deletePrefix(PREFIX).catch(() => undefined);
  });

  it("supports pagination, metadata, copy, multipart streams, overwrite, and guarded deletion", async () => {
    for (const [key, body] of [
      [`${PREFIX}meta/receipt.json`, "receipt"],
      [`${PREFIX}meta/manifest.json`, "manifest"],
      [`${PREFIX}parts/model.step`, "model"],
    ]) {
      await getS3Client().send(
        new PutObjectCommand({
          Bucket: BUCKET,
          Key: key,
          Body: body,
          ContentType: "text/plain",
        }),
      );
    }

    const first = await awsRfqStorage.list(PREFIX);
    expect(first.objects).toHaveLength(2);
    expect(first.nextCursor).toBeTruthy();
    const second = await awsRfqStorage.list(PREFIX, first.nextCursor!);
    expect(second.objects).toHaveLength(1);

    const source = await awsRfqStorage.head(`${PREFIX}parts/model.step`);
    expect(source).toMatchObject({ size: 5, contentType: "text/plain" });
    await awsRfqStorage.copy(
      `${PREFIX}parts/model.step`,
      `${PREFIX}parts/model-copy.step`,
    );
    expect((await awsRfqStorage.head(`${PREFIX}parts/model-copy.step`))?.size).toBe(5);

    const largeBody = Buffer.alloc(6 * 1024 * 1024, 7);
    await awsRfqStorage.uploadStream(
      `${PREFIX}archive.zip`,
      Readable.from(largeBody),
      "application/zip",
    );
    expect((await awsRfqStorage.head(`${PREFIX}archive.zip`))?.size).toBe(largeBody.length);
    await awsRfqStorage.uploadStream(
      `${PREFIX}archive.zip`,
      Readable.from(Buffer.from("replacement")),
      "application/zip",
    );
    expect((await awsRfqStorage.head(`${PREFIX}archive.zip`))?.size).toBe(11);

    await expect(awsRfqStorage.deletePrefix("intake/")).rejects.toThrow(/Refusing/);
    await awsRfqStorage.deletePrefix(PREFIX);
    expect((await awsRfqStorage.list(PREFIX)).objects).toHaveLength(0);
  });
});
