import { PutObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

let s3: typeof import("./s3.server");

beforeAll(async () => {
  vi.resetModules();
  vi.stubEnv("S3_ACCESS_KEY_ID", "test-access-key");
  vi.stubEnv("S3_SECRET_ACCESS_KEY", "test-secret-key");
  vi.stubEnv("S3_BUCKET", "test-bucket");
  vi.stubEnv("S3_REGION", "us-east-1");
  vi.stubEnv("S3_ENDPOINT", "");
  s3 = await import("./s3.server");
});

afterAll(() => {
  vi.unstubAllEnvs();
});

describe("sanitizeS3MetadataFileName", () => {
  it("normalizes filenames before they are included in signed S3 metadata", () => {
    expect(
      s3.sanitizeS3MetadataFileName(
        "TC 16280 Part Locating Fixture Insert PMAG 30 SquareBack 8.5.2025.STEP",
      ),
    ).toBe(
      "TC-16280-Part-Locating-Fixture-Insert-PMAG-30-SquareBack-8.5.2025.STEP",
    );
    expect(s3.sanitizeS3MetadataFileName("part   revision.step")).toBe(
      "part-revision.step",
    );
    expect(s3.sanitizeS3MetadataFileName("bracket—final.step")).toBe(
      "bracketfinal.step",
    );
    expect(s3.sanitizeS3MetadataFileName("零件.step")).toBe(".step");
    expect(s3.sanitizeS3MetadataFileName("零件")).toBe("file");
    expect(s3.sanitizeS3MetadataFileName("   ")).toBe("file");
  });
});

describe("uploadFile", () => {
  it("uses the sanitized filename in signed metadata and returns the original", async () => {
    const send = vi
      .spyOn(S3Client.prototype, "send")
      .mockResolvedValueOnce({} as never);
    const originalFileName = "part   revision—final.step";

    const result = await s3.uploadFile({
      key: "quote-parts/part/source/file.step",
      buffer: Buffer.from("cad"),
      contentType: "application/octet-stream",
      fileName: originalFileName,
    });

    const command = send.mock.calls[0]?.[0];
    expect(command).toBeInstanceOf(PutObjectCommand);
    expect((command as PutObjectCommand).input.Metadata).toEqual({
      originalFileName: "part-revisionfinal.step",
    });
    expect(result.fileName).toBe(originalFileName);
  });
});
