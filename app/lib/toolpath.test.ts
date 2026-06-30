import { describe, expect, it } from "vitest";
import { buildToolpathReportHref, isAllowedToolpathReportUrl } from "./toolpath";

describe("isAllowedToolpathReportUrl", () => {
  it("accepts valid Toolpath report URLs", () => {
    expect(
      isAllowedToolpathReportUrl("https://app.toolpath.com/parts/ldxwtu50/report"),
    ).toBe(true);
  });

  it("rejects non-Toolpath origins", () => {
    expect(
      isAllowedToolpathReportUrl("https://evil.example.com/parts/ldxwtu50/report"),
    ).toBe(false);
  });

  it("rejects malformed paths", () => {
    expect(
      isAllowedToolpathReportUrl("https://app.toolpath.com/parts/ldxwtu50"),
    ).toBe(false);
  });
});

describe("buildToolpathReportHref", () => {
  it("uses stored report URL when allowed", () => {
    expect(
      buildToolpathReportHref({
        toolpathReportUrl: "https://app.toolpath.com/parts/abc12345/report",
        toolpathPartId: "xyz98765",
      }),
    ).toBe("https://app.toolpath.com/parts/abc12345/report");
  });

  it("falls back to app route when stored URL is not allowed", () => {
    expect(
      buildToolpathReportHref({
        toolpathReportUrl: "https://evil.example.com/parts/abc12345/report",
        toolpathPartId: "xyz98765",
      }),
    ).toBe("/toolpath/report/xyz98765");
  });
});
