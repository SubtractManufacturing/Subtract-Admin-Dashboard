import { describe, expect, it } from "vitest";
import { downloadAccess } from "./downloads";

describe("downloadAccess", () => {
  it.each([
    ["attachment", "download.attachment", "attachment"],
    ["part", "download.part", "part"],
    ["quote-part", "download.quote-part", "quote-part"],
    ["quote", "download.quote", "quote"],
    ["mesh", "download.mesh", "part"],
  ])("maps %s to %s", (type, action, resourceType) => {
    expect(downloadAccess(type, "42")).toEqual({
      action,
      resource: { type: resourceType, id: "42" },
    });
  });

  it("maps bulk exports to export actions without a resource id", () => {
    expect(downloadAccess("export-customers", "")).toEqual({
      action: "export.customers",
    });
    expect(downloadAccess("export-vendors", "")).toEqual({
      action: "export.vendors",
    });
  });

  it("returns null for an unknown download type", () => {
    expect(downloadAccess("passwd", "1")).toBeNull();
    expect(downloadAccess("constructor", "1")).toBeNull();
  });
});
