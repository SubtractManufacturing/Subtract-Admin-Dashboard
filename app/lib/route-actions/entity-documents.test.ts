import { describe, expect, it, vi } from "vitest";
import {
  DOCUMENT_URL_TTL_SECONDS,
  generateEntityDocument,
  type DocumentGenerationDeps,
} from "./entity-documents";

function fakeDeps(overrides: Partial<DocumentGenerationDeps> = {}) {
  const deps: DocumentGenerationDeps = {
    generateDocumentPdf: vi.fn(async () => ({ attachmentId: "att-1" })),
    findAttachmentKey: vi.fn(async () => "orders/1/PO.pdf"),
    signDownloadUrl: vi.fn(async (key: string) => `https://signed.test/${key}`),
    ...overrides,
  };
  return deps;
}

const base = {
  entityType: "order" as const,
  entityId: 12,
  filename: "PO-25Z00001.pdf",
  documentKind: "purchase_order" as const,
  actor: { userId: "u1", userEmail: "ops@example.com" },
};

describe("generateEntityDocument", () => {
  it("returns a signed URL for the generated document", async () => {
    const deps = fakeDeps();
    const res = await generateEntityDocument(deps, { ...base, htmlContent: "<p>hi</p>" });

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      success: true,
      downloadUrl: "https://signed.test/orders/1/PO.pdf",
      attachmentId: "att-1",
      filename: "PO-25Z00001.pdf",
    });
    expect(deps.generateDocumentPdf).toHaveBeenCalledWith({
      entityType: "order",
      entityId: 12,
      htmlContent: "<p>hi</p>",
      filename: "PO-25Z00001.pdf",
      documentKind: "purchase_order",
      userId: "u1",
      userEmail: "ops@example.com",
    });
    expect(deps.signDownloadUrl).toHaveBeenCalledWith(
      "orders/1/PO.pdf",
      DOCUMENT_URL_TTL_SECONDS,
    );
  });

  it("rejects missing HTML without generating anything", async () => {
    const deps = fakeDeps();
    for (const htmlContent of [null, ""]) {
      const res = await generateEntityDocument(deps, { ...base, htmlContent });
      expect(res.status).toBe(400);
      expect(await res.json()).toEqual({ error: "Missing HTML content" });
    }
    expect(deps.generateDocumentPdf).not.toHaveBeenCalled();
  });

  it("reports generator failures as 500 with the message", async () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    const deps = fakeDeps({
      generateDocumentPdf: vi.fn(async () => {
        throw new Error("chromium crashed");
      }),
    });
    const res = await generateEntityDocument(deps, { ...base, htmlContent: "<p/>" });
    expect(res.status).toBe(500);
    expect(await res.json()).toEqual({ error: "chromium crashed" });
    spy.mockRestore();
  });

  it("fails when the attachment record cannot be found", async () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    const deps = fakeDeps({ findAttachmentKey: vi.fn(async () => null) });
    const res = await generateEntityDocument(deps, { ...base, htmlContent: "<p/>" });
    expect(res.status).toBe(500);
    expect(await res.json()).toEqual({ error: "Failed to create attachment" });
    expect(deps.signDownloadUrl).not.toHaveBeenCalled();
    spy.mockRestore();
  });

  it("uses a generic message for non-Error throws", async () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    const deps = fakeDeps({
      signDownloadUrl: vi.fn(async () => {
        throw "nope";
      }),
    });
    const res = await generateEntityDocument(deps, { ...base, htmlContent: "<p/>" });
    expect(await res.json()).toEqual({ error: "Failed to generate PDF" });
    spy.mockRestore();
  });
});
