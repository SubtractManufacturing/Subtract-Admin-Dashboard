import { describe, expect, it, vi } from "vitest";
import type { IntentTable } from "~/lib/route-actions/core";
import type { OrderAuth, OrderCtx } from "../context";
import { locationOf, makeOrderCtx, oversizedFile, runIntent, testAuth } from "../test-support";
import { attachmentIntents } from "./attachments";
import { partIntents } from "./parts";

const runIn =
  (table: object) =>
  (ctx: OrderCtx, intent: string, fields: Record<string, string | Blob> = {}) =>
    runIntent(table as IntentTable<OrderCtx>, ctx, intent, fields);
const runPart = runIn(partIntents);
const runAtt = runIn(attachmentIntents);

const asRole = (role: string): OrderAuth =>
  ({ ...testAuth, userDetails: { ...testAuth.userDetails, role } }) as OrderAuth;

const part = {
  id: "p1",
  partName: "Bracket",
  partFileUrl: "parts/1-a.step",
  material: "6061",
  tolerance: null,
  finishing: null,
};

describe("updatePartAttributes", () => {
  it("requires an existing part", async () => {
    const ctx = makeOrderCtx();
    expect((await runPart(ctx, "updatePartAttributes")).status).toBe(400);
    expect((await runPart(ctx, "updatePartAttributes", { partId: "p1" })).status).toBe(404);
  });

  it("saves normalised values and logs one part event per changed field", async () => {
    const ctx = makeOrderCtx();
    vi.mocked(ctx.deps.parts.find).mockResolvedValue(part);

    await runPart(ctx, "updatePartAttributes", {
      partId: "p1",
      material: "6061",
      tolerance: " ±0.01 ",
      finishing: "",
    });

    expect(ctx.deps.parts.updateAttributes).toHaveBeenCalledWith("p1", {
      material: "6061",
      tolerance: "±0.01",
      finishing: null,
    });
    const events = vi.mocked(ctx.deps.events.create).mock.calls.map(([e]) => e);
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      entityType: "part",
      entityId: "p1",
      eventType: "part_tolerance_changed",
      title: "Part Tolerance Changed",
      description: "Bracket changed to ±0.01",
      metadata: expect.objectContaining({ orderId: 12, orderNumber: "26Z00012", field: "tolerance" }),
    });
  });
});

describe("regenerateMesh", () => {
  it("needs a part with a source file, and resets nothing otherwise", async () => {
    const ctx = makeOrderCtx();
    expect((await runPart(ctx, "regenerateMesh")).status).toBe(400);
    const res = await runPart(ctx, "regenerateMesh", { partId: "p1" });
    expect(await res.json()).toEqual({ error: "No source file available for conversion" });
    expect(ctx.deps.parts.resetMeshConversion).not.toHaveBeenCalled();
  });

  it("resets status and starts conversion", async () => {
    const ctx = makeOrderCtx();
    vi.mocked(ctx.deps.parts.find).mockResolvedValue(part);
    const res = await runPart(ctx, "regenerateMesh", { partId: "p1" });
    expect(ctx.deps.parts.resetMeshConversion).toHaveBeenCalledWith("p1");
    expect(ctx.deps.parts.startMeshConversion).toHaveBeenCalledWith("p1", "parts/1-a.step");
    expect(await res.json()).toEqual({ success: true });
  });

  it("does not fail the request when conversion cannot start", async () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    const ctx = makeOrderCtx();
    vi.mocked(ctx.deps.parts.find).mockResolvedValue(part);
    vi.mocked(ctx.deps.parts.startMeshConversion).mockRejectedValue(new Error("down"));
    const res = await runPart(ctx, "regenerateMesh", { partId: "p1" });
    await new Promise((r) => setTimeout(r, 0));
    expect(res.status).toBe(200);
    expect(spy).toHaveBeenCalled();
    spy.mockRestore();
  });
});

describe("addDrawingToPart", () => {
  const drawings = {
    partId: "p1",
    drawingCount: "2",
    drawing_0: new File(["a"], "a.pdf", { type: "application/pdf" }),
    drawing_1: new File(["b"], "b.png", { type: "image/png" }),
  };

  it("uploads, links and records an audit event", async () => {
    const ctx = makeOrderCtx();
    const res = await runPart(ctx, "addDrawingToPart", drawings);
    expect(ctx.deps.parts.linkDrawing).toHaveBeenCalledTimes(2);
    expect(ctx.deps.events.create).toHaveBeenCalledWith(
      expect.objectContaining({
        entityType: "order",
        entityId: "12",
        eventType: "part_drawing_added",
        description: "Added 2 technical drawing(s) to part",
        metadata: { partId: "p1", drawingCount: 2 },
      }),
    );
    expect(await res.json()).toEqual({ success: true, message: "Drawings uploaded successfully" });
  });

  it("requires a part and at least one drawing", async () => {
    const ctx = makeOrderCtx();
    expect((await runPart(ctx, "addDrawingToPart", { partId: "p1" })).status).toBe(400);
    expect((await runPart(ctx, "addDrawingToPart", { ...drawings, partId: "" })).status).toBe(400);
  });

  it("rejects an oversized drawing before uploading any", async () => {
    const ctx = makeOrderCtx();
    const res = await runPart(ctx, "addDrawingToPart", {
      ...drawings,
      drawing_1: oversizedFile("huge.pdf", 12 * 1024 * 1024),
    });
    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe('File "huge.pdf" exceeds 10MB limit (12.00MB)');
    expect(ctx.deps.drawingUploads.storage.upload).not.toHaveBeenCalled();
  });

  it("reports an upload failure as 500", async () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    const ctx = makeOrderCtx();
    vi.mocked(ctx.deps.drawingUploads.storage.upload).mockRejectedValue(new Error("s3"));
    const res = await runPart(ctx, "addDrawingToPart", drawings);
    expect(res.status).toBe(500);
    expect(await res.json()).toEqual({ error: "Failed to upload drawings" });
    spy.mockRestore();
  });
});

describe("deleteDrawingFromPart", () => {
  const stored = { id: "d1", s3Key: "k/d1.pdf", thumbnailS3Key: "k/d1.pdf.thumb.png", fileName: "d1.pdf" };

  it("requires both ids and an existing drawing", async () => {
    const ctx = makeOrderCtx();
    expect((await runPart(ctx, "deleteDrawingFromPart", { drawingId: "d1" })).status).toBe(400);
    expect((await runPart(ctx, "deleteDrawingFromPart", { drawingId: "d1", partId: "p1" })).status).toBe(404);
    expect(ctx.deps.parts.unlinkDrawing).not.toHaveBeenCalled();
  });

  it("removes link, record and both files, then logs the deletion", async () => {
    const ctx = makeOrderCtx();
    vi.mocked(ctx.deps.attachments.get).mockResolvedValue(stored);
    const res = await runPart(ctx, "deleteDrawingFromPart", { drawingId: "d1", partId: "p1" });

    expect(ctx.deps.parts.unlinkDrawing).toHaveBeenCalledWith("d1");
    expect(ctx.deps.attachments.removeRecord).toHaveBeenCalledWith("d1");
    expect(vi.mocked(ctx.deps.files.delete).mock.calls.map(([k]) => k)).toEqual([
      "k/d1.pdf",
      "k/d1.pdf.thumb.png",
    ]);
    expect(ctx.deps.events.create).toHaveBeenCalledWith(
      expect.objectContaining({
        eventType: "part_drawing_deleted",
        metadata: { partId: "p1", drawingId: "d1", fileName: "d1.pdf" },
      }),
    );
    expect(await res.json()).toEqual({ success: true, message: "Drawing deleted successfully" });
  });

  it("still succeeds when storage cleanup fails after the records are gone", async () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    const ctx = makeOrderCtx();
    vi.mocked(ctx.deps.attachments.get).mockResolvedValue(stored);
    vi.mocked(ctx.deps.files.delete).mockRejectedValue(new Error("s3"));
    const res = await runPart(ctx, "deleteDrawingFromPart", { drawingId: "d1", partId: "p1" });
    expect(res.status).toBe(200);
    expect(ctx.deps.events.create).toHaveBeenCalled();
    spy.mockRestore();
  });
});

describe("uploadAttachment", () => {
  const pdf = new File(["%PDF"], "po.pdf", { type: "application/pdf" });

  it("stores, records and links the file", async () => {
    const ctx = makeOrderCtx();
    const res = await runAtt(ctx, "uploadAttachment", { file: pdf });
    expect(ctx.deps.files.upload).toHaveBeenCalledWith(
      expect.objectContaining({ key: "orders/12/po.pdf", fileName: "po.pdf" }),
    );
    expect(ctx.deps.attachments.linkToOrder).toHaveBeenCalledWith(12, "att-1", ctx.actor);
    expect(locationOf(res)).toBe("/orders/26Z00012");
  });

  it("answers JSON for fetcher uploads", async () => {
    const res = await runAtt(makeOrderCtx(), "uploadAttachment", { file: pdf, _noRedirect: "1" });
    expect(await res.json()).toEqual({ success: true, attachmentId: "att-1" });
  });

  it("requires a file within the size limit", async () => {
    const ctx = makeOrderCtx();
    expect(await (await runAtt(ctx, "uploadAttachment")).json()).toEqual({ error: "No file provided" });
    const big = await runAtt(ctx, "uploadAttachment", { file: oversizedFile() });
    expect(await big.json()).toEqual({ error: "File size exceeds 10MB limit" });
    expect(ctx.deps.files.upload).not.toHaveBeenCalled();
  });
});

describe("deleteAttachment", () => {
  const stored = { id: "a1", s3Key: "orders/12/x.pdf", isProtected: false };

  it("404s for an unknown attachment and one on another order", async () => {
    const ctx = makeOrderCtx();
    expect((await runAtt(ctx, "deleteAttachment")).status).toBe(400);
    expect((await runAtt(ctx, "deleteAttachment", { attachmentId: "a1" })).status).toBe(404);
    vi.mocked(ctx.deps.attachments.get).mockResolvedValue(stored);
    const res = await runAtt(ctx, "deleteAttachment", { attachmentId: "a1" });
    expect(await res.json()).toEqual({ error: "Attachment not found on this Order" });
  });

  it("unlinks, deletes the file, then the record", async () => {
    const ctx = makeOrderCtx();
    const calls: string[] = [];
    vi.mocked(ctx.deps.attachments.get).mockResolvedValue(stored);
    vi.mocked(ctx.deps.attachments.findOnOrder).mockResolvedValue(stored);
    vi.mocked(ctx.deps.attachments.unlinkFromOrder).mockImplementation(async () => void calls.push("unlink"));
    vi.mocked(ctx.deps.files.delete).mockImplementation(async () => void calls.push("file"));
    vi.mocked(ctx.deps.attachments.delete).mockImplementation(async () => void calls.push("record"));

    const res = await runAtt(ctx, "deleteAttachment", { attachmentId: "a1" });

    expect(calls).toEqual(["unlink", "file", "record"]);
    expect(locationOf(res)).toBe("/orders/26Z00012");
  });

  it("protects protected attachments from ordinary users", async () => {
    const ctx = makeOrderCtx();
    vi.mocked(ctx.deps.attachments.get).mockResolvedValue({ ...stored, isProtected: true });
    const res = await runAtt(ctx, "deleteAttachment", { attachmentId: "a1" });
    expect(res.status).toBe(403);
    expect(ctx.deps.attachments.unlinkFromOrder).not.toHaveBeenCalled();
  });

  it.each(["Admin", "Dev"])("lets %s delete protected attachments", async (role) => {
    const ctx = makeOrderCtx({ auth: asRole(role) });
    const protectedAtt = { ...stored, isProtected: true };
    vi.mocked(ctx.deps.attachments.get).mockResolvedValue(protectedAtt);
    vi.mocked(ctx.deps.attachments.findOnOrder).mockResolvedValue(protectedAtt);
    const res = await runAtt(ctx, "deleteAttachment", { attachmentId: "a1" });
    expect(res.status).toBe(302);
    expect(ctx.deps.attachments.findOnOrder).toHaveBeenCalledWith(
      "a1",
      12,
      expect.objectContaining({ canDeleteProtected: true }),
    );
  });
});

describe("downloadAttachment", () => {
  it("returns a signed URL", async () => {
    const ctx = makeOrderCtx();
    vi.mocked(ctx.deps.attachments.get).mockResolvedValue({ id: "a1", s3Key: "orders/12/x.pdf" });
    const res = await runAtt(ctx, "downloadAttachment", { attachmentId: "a1" });
    expect(await res.json()).toEqual({ downloadUrl: "https://signed.test/orders/12/x.pdf" });
  });

  it("validates the id and 404s when missing", async () => {
    const ctx = makeOrderCtx();
    expect((await runAtt(ctx, "downloadAttachment")).status).toBe(400);
    expect((await runAtt(ctx, "downloadAttachment", { attachmentId: "zz" })).status).toBe(404);
  });
});
