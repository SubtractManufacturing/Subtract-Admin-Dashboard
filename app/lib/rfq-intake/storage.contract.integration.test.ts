/**
 * S3 adapter contract, run only against a disposable emulator (S3Mock in CI), with
 * one bucket standing in for WordPress intake and another for the application.
 * See RFQ_STORAGE_TEST_* in .env.example. Without them this file fails to load,
 * before any S3 client exists.
 */
import {
  CreateBucketCommand,
  DeleteObjectsCommand,
  ListObjectsV2Command,
  PutObjectCommand,
} from "@aws-sdk/client-s3";
import { Readable } from "node:stream";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { createS3Client } from "../s3.server";
import { createAwsRfqStorage } from "./storage.server";
import { resolveIsolatedStorageConfig } from "./test-support/isolated-storage-env";

const isolated = resolveIsolatedStorageConfig();
const s3 = createS3Client({
  endpoint: isolated.endpoint,
  region: isolated.region,
  accessKeyId: isolated.accessKeyId,
  secretAccessKey: isolated.secretAccessKey,
});

const APP_BUCKET = isolated.appBucket;
const INTAKE_BUCKET = isolated.intakeBucket;
const SESSION = "018f0f7d-9f65-7eb4-bf9c-0fca82a87a99";
const PREFIX = `intake/${SESSION}/`;
const CANONICAL_PREFIX = `contract-test/${SESSION}/`;

async function ensureBucket(bucket: string) {
  try {
    await s3.send(new CreateBucketCommand({ Bucket: bucket }));
  } catch (error) {
    const name = (error as { name?: string }).name;
    if (name !== "BucketAlreadyOwnedByYou" && name !== "BucketAlreadyExists") throw error;
  }
}

async function deleteAll(bucket: string, prefix: string) {
  const listed = await s3.send(
    new ListObjectsV2Command({ Bucket: bucket, Prefix: prefix }),
  );
  if (!listed.Contents?.length) return;
  await s3.send(
    new DeleteObjectsCommand({
      Bucket: bucket,
      Delete: { Objects: listed.Contents.map(({ Key }) => ({ Key })) },
    }),
  );
}

function storageFor(sameAccount: boolean, strategies: string[]) {
  return createAwsRfqStorage({
    intake: { client: s3, bucket: INTAKE_BUCKET },
    app: { client: s3, bucket: APP_BUCKET },
    sameAccount,
    onCopyStrategy: (strategy) => strategies.push(strategy),
  });
}

describe("AWS RFQ storage adapter contract", () => {
  beforeAll(async () => {
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
      await s3.send(
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
      await s3.send(
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
    }, 15_000);

    it("fails clearly when the intake object is missing", async () => {
      const { canonical } = storageFor(sameAccount, []);
      await expect(
        canonical.copyFromIntake(`${PREFIX}parts/absent.step`, `${CANONICAL_PREFIX}absent.step`),
      ).rejects.toThrow(/Intake object is missing/);
    });
  });
});
