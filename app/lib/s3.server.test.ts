import { describe, expect, it } from "vitest";
import { sanitizeS3MetadataFileName } from "./s3.server";

describe("sanitizeS3MetadataFileName", () => {
  it("normalizes filenames before they are included in signed S3 metadata", () => {
    expect(
      sanitizeS3MetadataFileName(
        "TC 16280 Part Locating Fixture Insert PMAG 30 SquareBack 8.5.2025.STEP",
      ),
    ).toBe(
      "TC-16280-Part-Locating-Fixture-Insert-PMAG-30-SquareBack-8.5.2025.STEP",
    );
    expect(sanitizeS3MetadataFileName("part   revision.step")).toBe(
      "part-revision.step",
    );
    expect(sanitizeS3MetadataFileName("bracket—final.step")).toBe(
      "bracketfinal.step",
    );
    expect(sanitizeS3MetadataFileName("零件.step")).toBe(".step");
    expect(sanitizeS3MetadataFileName("零件")).toBe("file");
  });
});
