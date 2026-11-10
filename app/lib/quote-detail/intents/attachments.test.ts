import { describe, expect, it, vi } from "vitest";
import type { IntentTable } from "~/lib/route-actions/core";
import type { QuoteAuth, QuoteCtx } from "../context";
import { locationOf, makeQuoteCtx, oversizedFile, runIntent, testAuth } from "../test-support";
import { attachmentIntents } from "./attachments";

const run = (ctx: QuoteCtx, intent: string, fields: Record<string, string | Blob> = {}) =>
  runIntent(attachmentIntents as IntentTable<QuoteCtx>, ctx, intent, fields);

const asRole = (role: string): QuoteAuth =>
  ({ ...testAuth, userDetails: { ...testAuth.userDetails, role } }) as QuoteAuth;

describe("uploadAttachment", () => {
  const pdf = new File(["%PDF"], "po.pdf", { type: "application/pdf" });

  it("stores the file, records it and links it to the quote", async () => {
    const ctx = makeQuoteCtx();
    const res = await run(ctx, "uploadAttachment", { file: pdf });

    expect(ctx.deps.files.upload).toHaveBeenCalledWith(
      expect.objectContaining({
        key: "quotes/7/po.pdf",
        contentType: "application/pdf",
        fileName: "po.pdf",
      }),
    );
    expect(ctx.deps.attachments.create).toHaveBeenCalledWith(
      expect.objectContaining({ s3Key: "quotes/7/po.pdf", source: "user_upload" }),
      ctx.actor,
    );
    expect(ctx.deps.attachments.linkToQuote).toHaveBeenCalledWith(7, "att-1");
    expect(locationOf(res)).toBe("/quotes/7");
  });

  it("answers with JSON for fetcher uploads", async () => {
    const ctx = makeQuoteCtx();
    const res = await run(ctx, "uploadAttachment", { file: pdf, _noRedirect: "1" });
    expect(await res.json()).toEqual({ success: true, attachmentId: "att-1" });
  });

  it("requires a file within the size limit", async () => {
    const ctx = makeQuoteCtx();
    expect((await run(ctx, "uploadAttachment")).status).toBe(400);
    const res = await run(ctx, "uploadAttachment", { file: oversizedFile() });
    expect(await res.json()).toEqual({ error: "File size exceeds 10MB limit" });
    expect(ctx.deps.files.upload).not.toHaveBeenCalled();
  });

  it("reports storage failures as 500", async () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    const ctx = makeQuoteCtx();
    vi.mocked(ctx.deps.files.upload).mockRejectedValue(new Error("s3"));
    const res = await run(ctx, "uploadAttachment", { file: pdf });
    expect(res.status).toBe(500);
    expect(await res.json()).toEqual({ error: "Failed to upload file" });
    spy.mockRestore();
  });
});

describe("deleteAttachment", () => {
  const stored = { id: "att-9", s3Key: "quotes/7/x.pdf", isProtected: false };

  it("requires an attachment id", async () => {
    expect((await run(makeQuoteCtx(), "deleteAttachment")).status).toBe(400);
  });

  it("is a no-op redirect when the attachment is already gone", async () => {
    const ctx = makeQuoteCtx();
    const res = await run(ctx, "deleteAttachment", { attachmentId: "att-9" });
    expect(locationOf(res)).toBe("/quotes/7");
    expect(ctx.deps.files.delete).not.toHaveBeenCalled();
  });

  it("unlinks, deletes the file and the record", async () => {
    const ctx = makeQuoteCtx();
    vi.mocked(ctx.deps.attachments.get).mockResolvedValue(stored);
    vi.mocked(ctx.deps.attachments.findOnQuote).mockResolvedValue(stored);

    const res = await run(ctx, "deleteAttachment", { attachmentId: "att-9" });

    expect(ctx.deps.attachments.unlinkFromQuote).toHaveBeenCalledWith(7, "att-9");
    expect(ctx.deps.files.delete).toHaveBeenCalledWith("quotes/7/x.pdf");
    expect(ctx.deps.attachments.delete).toHaveBeenCalledWith("att-9", {
      ...ctx.actor,
      canDeleteProtected: false,
    });
    expect(locationOf(res)).toBe("/quotes/7");
  });

  it("404s when the attachment belongs to another quote", async () => {
    const ctx = makeQuoteCtx();
    vi.mocked(ctx.deps.attachments.get).mockResolvedValue(stored);
    const res = await run(ctx, "deleteAttachment", { attachmentId: "att-9" });
    expect(res.status).toBe(404);
    expect(ctx.deps.files.delete).not.toHaveBeenCalled();
  });

  it("protects protected attachments from ordinary users", async () => {
    const ctx = makeQuoteCtx();
    vi.mocked(ctx.deps.attachments.get).mockResolvedValue({ ...stored, isProtected: true });
    const res = await run(ctx, "deleteAttachment", { attachmentId: "att-9" });
    expect(res.status).toBe(403);
    expect(ctx.deps.attachments.unlinkFromQuote).not.toHaveBeenCalled();
  });

  it.each(["Admin", "Dev"])("lets %s delete protected attachments", async (role) => {
    const ctx = makeQuoteCtx({ auth: asRole(role) });
    const protectedAtt = { ...stored, isProtected: true };
    vi.mocked(ctx.deps.attachments.get).mockResolvedValue(protectedAtt);
    vi.mocked(ctx.deps.attachments.findOnQuote).mockResolvedValue(protectedAtt);
    const res = await run(ctx, "deleteAttachment", { attachmentId: "att-9" });
    expect(res.status).toBe(302);
    expect(ctx.deps.attachments.findOnQuote).toHaveBeenCalledWith("att-9", 7, true);
    expect(ctx.deps.attachments.delete).toHaveBeenCalled();
  });
});
