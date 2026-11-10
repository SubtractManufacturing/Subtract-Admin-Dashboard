import { describe, expect, it, vi } from "vitest";
import { addBusinessDays } from "~/lib/business-days";
import type { IntentTable } from "~/lib/route-actions/core";
import type { QuoteCtx } from "../context";
import { locationOf, makeQuoteCtx, runIntent } from "../test-support";
import { documentIntents, emailIntents, priceCalculationIntents } from "./documents-email";
import { partIntents } from "./parts";

const runIn =
  (table: object) =>
  (ctx: QuoteCtx, intent: string, fields: Record<string, string | Blob> = {}) =>
    runIntent(table as IntentTable<QuoteCtx>, ctx, intent, fields);

const runPart = runIn(partIntents);
const runDoc = runIn(documentIntents);
const runEmail = runIn(emailIntents);
const runPrice = runIn(priceCalculationIntents);

const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

const quotePart = {
  id: "qp-1",
  partName: "Bracket",
  partFileUrl: "quote-parts/x/source/a.step",
  specifications: null,
  material: "6061",
  tolerance: null,
  finish: null,
};

describe("updateQuotePartAttributes", () => {
  it("requires a part and 404s for an unknown one", async () => {
    const ctx = makeQuoteCtx();
    expect((await runPart(ctx, "updateQuotePartAttributes")).status).toBe(400);
    expect((await runPart(ctx, "updateQuotePartAttributes", { quotePartId: "nope" })).status).toBe(404);
  });

  it("saves normalised values and logs one event per changed field", async () => {
    const ctx = makeQuoteCtx();
    vi.mocked(ctx.deps.parts.find).mockResolvedValue(quotePart);

    const res = await runPart(ctx, "updateQuotePartAttributes", {
      quotePartId: "qp-1",
      material: " 7075 ",
      tolerance: "",
      finish: "anodized",
    });

    expect(ctx.deps.parts.updateAttributes).toHaveBeenCalledWith("qp-1", {
      material: "7075",
      tolerance: null,
      finish: "anodized",
    });
    const events = vi.mocked(ctx.deps.events.create).mock.calls.map(([e]) => e);
    expect(events.map((e) => e.eventType)).toEqual([
      "quote_part_material_changed",
      "quote_part_finish_changed",
    ]);
    expect(events[0]).toMatchObject({
      entityType: "quote",
      entityId: "7",
      description: "Bracket changed to 7075",
      metadata: expect.objectContaining({ quotePartId: "qp-1", quoteNumber: "25Q00007", oldValue: "6061" }),
    });
    expect(await res.json()).toEqual({ success: true });
  });

  it("logs nothing when values are unchanged", async () => {
    const ctx = makeQuoteCtx();
    vi.mocked(ctx.deps.parts.find).mockResolvedValue(quotePart);
    await runPart(ctx, "updateQuotePartAttributes", { quotePartId: "qp-1", material: "6061" });
    expect(ctx.deps.events.create).not.toHaveBeenCalled();
  });
});

describe("regenerateMesh", () => {
  it("needs a part id and an existing part", async () => {
    const ctx = makeQuoteCtx();
    expect((await runPart(ctx, "regenerateMesh")).status).toBe(400);
    expect((await runPart(ctx, "regenerateMesh", { partId: "x" })).status).toBe(404);
  });

  it("refuses placeholder previews, which are managed in Settings", async () => {
    const ctx = makeQuoteCtx();
    vi.mocked(ctx.deps.parts.find).mockResolvedValue(quotePart);
    vi.mocked(ctx.deps.parts.usesPlaceholderCad).mockReturnValue(true);
    const res = await runPart(ctx, "regenerateMesh", { partId: "qp-1" });
    expect(res.status).toBe(400);
    expect(ctx.deps.parts.resetMeshConversion).not.toHaveBeenCalled();
  });

  it("refuses a part with no source file", async () => {
    const ctx = makeQuoteCtx();
    vi.mocked(ctx.deps.parts.find).mockResolvedValue({ ...quotePart, partFileUrl: null });
    const res = await runPart(ctx, "regenerateMesh", { partId: "qp-1" });
    expect(await res.json()).toEqual({ error: "No source file available for conversion" });
  });

  it("resets status then starts conversion", async () => {
    const ctx = makeQuoteCtx();
    vi.mocked(ctx.deps.parts.find).mockResolvedValue(quotePart);
    const res = await runPart(ctx, "regenerateMesh", { partId: "qp-1" });
    expect(ctx.deps.parts.resetMeshConversion).toHaveBeenCalledWith("qp-1");
    expect(ctx.deps.parts.startMeshConversion).toHaveBeenCalledWith("qp-1", quotePart.partFileUrl);
    expect(await res.json()).toEqual({ success: true });
  });

  it("answers success but logs an event when conversion cannot start", async () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    const ctx = makeQuoteCtx();
    vi.mocked(ctx.deps.parts.find).mockResolvedValue(quotePart);
    vi.mocked(ctx.deps.parts.startMeshConversion).mockRejectedValue(new Error("down"));
    const res = await runPart(ctx, "regenerateMesh", { partId: "qp-1" });
    await flush();
    expect(res.status).toBe(200);
    expect(ctx.deps.events.create).toHaveBeenCalledWith(
      expect.objectContaining({
        title: "Mesh Regeneration Failed",
        description: "Failed to regenerate mesh for part Bracket",
      }),
    );
    spy.mockRestore();
  });
});

describe("drawings", () => {
  it("addDrawingToExistingPart uploads each drawing and links it to the part", async () => {
    const ctx = makeQuoteCtx();
    const res = await runPart(ctx, "addDrawingToExistingPart", {
      quotePartId: "qp-1",
      drawingCount: "2",
      drawing_0: new File(["a"], "a.pdf", { type: "application/pdf" }),
      drawing_1: new File(["b"], "b.png", { type: "image/png" }),
    });
    expect(ctx.deps.parts.linkDrawing).toHaveBeenCalledTimes(2);
    expect(ctx.deps.parts.linkDrawing).toHaveBeenCalledWith("qp-1", "drawing-att-1");
    expect(locationOf(res)).toBe("/quotes/7");
  });

  it("addDrawingToExistingPart needs a part and at least one drawing", async () => {
    const ctx = makeQuoteCtx();
    expect((await runPart(ctx, "addDrawingToExistingPart", { quotePartId: "qp-1" })).status).toBe(400);
    expect(
      (await runPart(ctx, "addDrawingToExistingPart", { drawingCount: "1", drawing_0: new File(["a"], "a.pdf") }))
        .status,
    ).toBe(400);
  });

  it("deleteDrawing unlinks, then removes the file and record", async () => {
    const ctx = makeQuoteCtx();
    vi.mocked(ctx.deps.attachments.get).mockResolvedValue({ id: "d1", s3Key: "k/d1.pdf" });
    const res = await runPart(ctx, "deleteDrawing", { drawingId: "d1", quotePartId: "qp-1" });
    expect(ctx.deps.parts.unlinkDrawing).toHaveBeenCalledWith("d1");
    expect(ctx.deps.files.delete).toHaveBeenCalledWith("k/d1.pdf");
    expect(ctx.deps.attachments.delete).toHaveBeenCalledWith("d1", ctx.actor);
    expect(locationOf(res)).toBe("/quotes/7");
  });

  it("deleteDrawing tolerates a missing attachment record", async () => {
    const ctx = makeQuoteCtx();
    await runPart(ctx, "deleteDrawing", { drawingId: "d1", quotePartId: "qp-1" });
    expect(ctx.deps.files.delete).not.toHaveBeenCalled();
  });
});

describe("PDF documents", () => {
  it.each([
    ["generateQuote", "Quote-25Q00007.pdf", "quote"],
    ["generateInvoice", "Invoice-25Q00007.pdf", "invoice"],
  ] as const)("%s names the file and kind", async (intent, filename, documentKind) => {
    const ctx = makeQuoteCtx();
    const res = await runDoc(ctx, intent, { htmlContent: "<p>x</p>" });
    expect(ctx.deps.documents.generateDocumentPdf).toHaveBeenCalledWith(
      expect.objectContaining({ entityType: "quote", entityId: 7, filename, documentKind }),
    );
    expect(await res.json()).toMatchObject({ success: true, filename });
  });

  it("requires HTML", async () => {
    const res = await runDoc(makeQuoteCtx(), "generateQuote");
    expect(res.status).toBe(400);
  });
});

describe("email", () => {
  it("emailPreview and emailQueue are scoped to this quote's send context", async () => {
    const ctx = makeQuoteCtx();
    await runEmail(ctx, "emailPreview");
    expect(ctx.deps.email.preview).toHaveBeenCalledWith(
      expect.objectContaining({
        auth: ctx.auth,
        expected: { contextKey: "quote_send", entityId: "7" },
      }),
    );
    await runEmail(ctx, "emailQueue");
    expect(ctx.deps.email.queue).toHaveBeenCalledWith(
      expect.objectContaining({
        expected: { contextKey: "quote_send", entityType: "quote", entityId: "7" },
      }),
    );
  });

  describe("sendQuoteReceivedEmail", () => {
    it("is blocked when outbound email is disabled", async () => {
      const ctx = makeQuoteCtx();
      vi.mocked(ctx.deps.email.outboundEnabled).mockResolvedValue(false);
      const res = await runEmail(ctx, "sendQuoteReceivedEmail", { idempotencyKey: "k" });
      expect(res.status).toBe(403);
      expect(ctx.deps.email.enqueueQuoteReceived).not.toHaveBeenCalled();
    });

    it("needs an idempotency key", async () => {
      const res = await runEmail(makeQuoteCtx(), "sendQuoteReceivedEmail", { idempotencyKey: "  " });
      expect(res.status).toBe(400);
    });

    it("enqueues and reports delivery", async () => {
      const ctx = makeQuoteCtx();
      const res = await runEmail(ctx, "sendQuoteReceivedEmail", { idempotencyKey: " key-1 " });
      expect(ctx.deps.email.enqueueQuoteReceived).toHaveBeenCalledWith({
        auth: ctx.auth,
        quoteId: 7,
        idempotencyKey: "key-1",
      });
      expect(await res.json()).toEqual({ success: true, delivery: "queued" });
    });

    it("passes through the enqueue error and status", async () => {
      const ctx = makeQuoteCtx();
      vi.mocked(ctx.deps.email.enqueueQuoteReceived).mockResolvedValue({
        ok: false,
        status: 409,
        error: "Already sent",
      } as never);
      const res = await runEmail(ctx, "sendQuoteReceivedEmail", { idempotencyKey: "k" });
      expect(res.status).toBe(409);
      expect(await res.json()).toEqual({ error: "Already sent" });
    });
  });
});

describe("savePriceCalculation", () => {
  const calc = { partId: "qp-1", leadTimeOption: "standard" };

  it("requires valid calculation data", async () => {
    const ctx = makeQuoteCtx();
    expect((await runPrice(ctx, "savePriceCalculation")).status).toBe(400);
    expect((await runPrice(ctx, "savePriceCalculation", { calculationData: "{oops" })).status).toBe(400);
    expect(ctx.deps.quotes.savePriceCalculation).not.toHaveBeenCalled();
  });

  it("saves the calculation and seeds lead time when the quote has none", async () => {
    const ctx = makeQuoteCtx();
    const today = new Date("2026-03-02T00:00:00");
    vi.mocked(ctx.deps.clock.today).mockReturnValue(today);

    await runPrice(ctx, "savePriceCalculation", { calculationData: JSON.stringify(calc) });

    expect(ctx.deps.quotes.savePriceCalculation).toHaveBeenCalledWith(calc, "u1");
    const [, updates] = vi.mocked(ctx.deps.quotes.update).mock.calls[0];
    expect(updates).toEqual({
      leadTimeBusinessDaysMin: expect.any(Number),
      leadTimeBusinessDaysMax: expect.any(Number),
      estimatedDeliveryDateStart: addBusinessDays(today, updates.leadTimeBusinessDaysMin as number),
      estimatedDeliveryDateEnd: addBusinessDays(today, updates.leadTimeBusinessDaysMax as number),
    });
  });

  it("keeps an existing lead time", async () => {
    const ctx = makeQuoteCtx({ quote: { leadTimeBusinessDaysMin: 5, leadTimeBusinessDaysMax: 8 } });
    await runPrice(ctx, "savePriceCalculation", { calculationData: JSON.stringify(calc) });
    expect(ctx.deps.quotes.update).not.toHaveBeenCalled();
  });
});
