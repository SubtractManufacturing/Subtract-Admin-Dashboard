import { describe, expect, it } from "vitest";

import {
  jobBoardDiscordFileName,
  stripStorageBasenamePrefix,
} from "./file-names";

describe("job board file names", () => {
  it("strips timestamp and random prefix from storage basenames", () => {
    expect(
      stripStorageBasenamePrefix(
        "1773942319843-26b6dd0f1694d361-Xometry_Mill_Test_Part.step",
      ),
    ).toBe("Xometry_Mill_Test_Part.step");
  });

  it("prefers a clean preferred file name over the S3 key", () => {
    expect(
      jobBoardDiscordFileName(
        "parts/abc/1773942319843-26b6dd0f1694d361-Xometry_Mill_Test_Part.step",
        "Xometry_Mill_Test_Part.step",
      ),
    ).toBe("Xometry_Mill_Test_Part.step");
  });

  it("derives from the S3 key when the preferred name is also prefixed", () => {
    expect(
      jobBoardDiscordFileName(
        "parts/abc/1773942319843-26b6dd0f1694d361-Xometry_Mill_Test_Part.step",
        "1773942319843-26b6dd0f1694d361-Xometry_Mill_Test_Part.step",
      ),
    ).toBe("Xometry_Mill_Test_Part.step");
  });
});
