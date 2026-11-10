import { describe, expect, it, vi } from "vitest";
import type { IntentTable } from "~/lib/route-actions/core";
import type { QuoteCtx } from "../context";
import type { QuoteLineRow } from "../ports";
import { locationOf, makeQuoteCtx, runIntent } from "../test-support";
import { lineItemIntents } from "./line-items";

const run = (ctx: QuoteCtx, intent: string, fields: Record<string, string | Blob> = {}) =>
  runIntent(lineItemIntents as IntentTable<QuoteCtx>, ctx, intent, fields);

const line = (over: Partial<QuoteLineRow> = {}): QuoteLineRow => ({
  id: 5,
  quoteId: 7,
  quotePartId: null,
  quantity: 2,
  unitPrice: "50.00",
  totalPrice: "100.00",
  ...over,
});

const file = (name: string, type = "application/octet-stream", body = "x") =>
  new File([body], name, { type });

const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

describe("addLineItem (standalone)", () => {
  const fields = { name: "Setup fee", quantity: "1", unitPrice: "40", description: "d" };

  it("creates the line, recalculates totals and returns to the quote", async () => {
    const ctx = makeQuoteCtx();
    const res = await run(ctx, "addLineItem", fields);

    expect(ctx.deps.lineItems.create).toHaveBeenCalledWith(
      7,
      {
        quotePartId: undefined,
        name: "Setup fee",
        quantity: 1,
        unitPrice: 40,
        description: "d",
        notes: undefined,
      },
      ctx.actor,
    );
    expect(ctx.deps.quotes.recalculateTotals).toHaveBeenCalledWith(7);
    expect(locationOf(res)).toBe("/quotes/7");
    expect(ctx.deps.parts.createFromCad).not.toHaveBeenCalled();
  });

  it("promotes an RFQ to Draft", async () => {
    const ctx = makeQuoteCtx({ quote: { status: "RFQ" } });
    await run(ctx, "addLineItem", fields);
    expect(ctx.deps.quotes.update).toHaveBeenCalledWith(7, { status: "Draft" }, ctx.actor);
  });

  it("requires name, quantity and price", async () => {
    for (const missing of ["name", "quantity", "unitPrice"]) {
      const ctx = makeQuoteCtx();
      const res = await run(ctx, "addLineItem", { ...fields, [missing]: "" });
      expect(res.status).toBe(400);
      expect(await res.json()).toEqual({ error: "Missing required fields" });
    }
  });

  it("rejects a bad quantity", async () => {
    const ctx = makeQuoteCtx();
    const res = await run(ctx, "addLineItem", { ...fields, quantity: "0" });
    expect(await res.json()).toEqual({ error: "Invalid quantity" });
    expect(ctx.deps.lineItems.create).not.toHaveBeenCalled();
  });

  it("resolves a percent discount against every existing line", async () => {
    const ctx = makeQuoteCtx();
    vi.mocked(ctx.deps.lineItems.list).mockResolvedValue([
      line({ id: 1, quantity: 1, unitPrice: "300.00", totalPrice: "300.00" }),
    ]);
    await run(ctx, "addLineItem", { ...fields, unitPrice: "10%" });
    expect(ctx.deps.lineItems.list).toHaveBeenCalledWith(7, "all");
    expect(ctx.deps.lineItems.create).toHaveBeenCalledWith(
      7,
      expect.objectContaining({ unitPrice: -30 }),
      ctx.actor,
    );
  });

  it("reports an unexpected failure as 500", async () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    const ctx = makeQuoteCtx();
    vi.mocked(ctx.deps.lineItems.create).mockRejectedValue(new Error("db"));
    const res = await run(ctx, "addLineItem", fields);
    expect(res.status).toBe(500);
    expect(await res.json()).toEqual({ error: "Failed to add line item" });
    spy.mockRestore();
  });
});

describe("addLineItem with a part upload", () => {
  const base = { name: "Bracket", quantity: "3", unitPrice: "25", material: "6061" };

  it("stores a CAD file, creates the part, starts conversion and attaches drawings", async () => {
    const ctx = makeQuoteCtx();
    vi.mocked(ctx.deps.parts.createFromCad).mockResolvedValue({ id: "qp-9", partName: "Bracket" });

    const fd = {
      ...base,
      file: file("my bracket.STEP"),
      drawingCount: "1",
      drawing_0: file("dwg.pdf", "application/pdf"),
    };
    const res = await run(ctx, "addLineItem", fd);

    expect(ctx.deps.files.upload).toHaveBeenCalledWith(
      expect.objectContaining({
        key: "quote-parts/uuid-1/source/my-bracket.STEP",
        fileName: "my-bracket.STEP",
      }),
    );
    expect(ctx.deps.parts.createFromCad).toHaveBeenCalledWith(
      expect.objectContaining({
        quoteId: 7,
        partNumber: "QP-TEST-0001",
        partName: "Bracket",
        material: "6061",
        partFileUrl: "quote-parts/uuid-1/source/my-bracket.STEP",
      }),
    );
    expect(ctx.deps.parts.startMeshConversion).toHaveBeenCalledWith(
      "qp-9",
      "quote-parts/uuid-1/source/my-bracket.STEP",
    );
    expect(ctx.deps.drawingUploads.attachments.create).toHaveBeenCalledWith(
      expect.objectContaining({ fileName: "dwg.pdf", source: "user_upload" }),
    );
    expect(ctx.deps.parts.linkDrawing).toHaveBeenCalledWith("qp-9", "drawing-att-1");
    expect(ctx.deps.lineItems.create).toHaveBeenCalledWith(
      7,
      expect.objectContaining({ quotePartId: "qp-9", quantity: 3, unitPrice: 25 }),
      ctx.actor,
    );
    expect(locationOf(res)).toBe("/quotes/7");
  });

  it("records an event, but still succeeds, when conversion cannot start", async () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    const ctx = makeQuoteCtx();
    vi.mocked(ctx.deps.parts.createFromCad).mockResolvedValue({ id: "qp-9", partName: "Bracket" });
    vi.mocked(ctx.deps.parts.startMeshConversion).mockRejectedValue(new Error("queue down"));

    const res = await run(ctx, "addLineItem", { ...base, file: file("a.step") });
    await flush();

    expect(res.status).toBe(302);
    expect(ctx.deps.events.create).toHaveBeenCalledWith(
      expect.objectContaining({
        eventType: "mesh_conversion_failed",
        title: "Mesh Conversion Failed",
        description: "Failed to trigger mesh conversion for part Bracket",
        metadata: { quotePartId: "qp-9", error: "queue down" },
      }),
    );
    spy.mockRestore();
  });

  it("makes a drawing-only part from a PDF, with the drawing in slot 0 and extras after", async () => {
    const ctx = makeQuoteCtx();
    vi.mocked(ctx.deps.parts.createDrawingOnly).mockResolvedValue({ id: "qp-2" });
    vi.mocked(ctx.deps.drawingUploads.attachments.create)
      .mockResolvedValueOnce({ id: "a-primary" })
      .mockResolvedValueOnce({ id: "a-extra" });

    await run(ctx, "addLineItem", {
      ...base,
      file: file("plan.pdf", "application/pdf"),
      drawingCount: "1",
      drawing_0: file("detail.png", "image/png"),
    });

    expect(ctx.deps.parts.createFromCad).not.toHaveBeenCalled();
    expect(ctx.deps.parts.startMeshConversion).not.toHaveBeenCalled();
    const uploadedKeys = vi
      .mocked(ctx.deps.drawingUploads.storage.upload)
      .mock.calls.map(([arg]) => arg.key.replace(/\/\d{10,}-/, "/<ts>-"));
    expect(uploadedKeys).toEqual(
      expect.arrayContaining([
        "quote-parts/qp-2/drawings/<ts>-0-plan.pdf",
        "quote-parts/qp-2/drawings/<ts>-1-detail.png",
      ]),
    );
    expect(ctx.deps.parts.linkDrawing).toHaveBeenCalledWith("qp-2", "a-primary");
    expect(ctx.deps.parts.linkDrawing).toHaveBeenCalledWith("qp-2", "a-extra");
    expect(ctx.deps.parts.ensureDrawingOnlyAssets).toHaveBeenCalledWith("qp-2", {
      buffer: expect.any(Buffer),
      fileName: "plan.pdf",
    });
  });

  it("rejects an unsupported file before creating anything", async () => {
    const ctx = makeQuoteCtx();
    const res = await run(ctx, "addLineItem", { ...base, file: file("notes.txt") });
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "Unsupported file type for line item upload" });
    expect(ctx.deps.parts.createFromCad).not.toHaveBeenCalled();
    expect(ctx.deps.files.upload).not.toHaveBeenCalled();
  });

  it("validates quantity and price before storing the file", async () => {
    const ctx = makeQuoteCtx();
    const badQty = await run(ctx, "addLineItem", { ...base, quantity: "-1", file: file("a.step") });
    expect(badQty.status).toBe(400);
    const percent = await run(ctx, "addLineItem", { ...base, unitPrice: "10%", file: file("a.step") });
    expect(await percent.json()).toEqual({
      error: "Percentage entry is not available on part-linked line items",
    });
    expect(ctx.deps.files.upload).not.toHaveBeenCalled();
    expect(ctx.deps.parts.createFromCad).not.toHaveBeenCalled();
  });
});

describe("promoteLineItemToQuotePart", () => {
  const fields = { name: "Bracket", quantity: "2", unitPrice: "12.5", lineItemId: "5" };

  it("needs a line item id", async () => {
    const ctx = makeQuoteCtx();
    const res = await run(ctx, "promoteLineItemToQuotePart", { ...fields, lineItemId: "" });
    expect(await res.json()).toEqual({ error: "Line item ID is required" });
  });

  it("404s for a line on another quote", async () => {
    const ctx = makeQuoteCtx();
    vi.mocked(ctx.deps.lineItems.find).mockResolvedValue(line({ quoteId: 99 }));
    const res = await run(ctx, "promoteLineItemToQuotePart", { ...fields, file: file("a.step") });
    expect(res.status).toBe(404);
  });

  it("refuses a line that already has a part", async () => {
    const ctx = makeQuoteCtx();
    vi.mocked(ctx.deps.lineItems.find).mockResolvedValue(line({ quotePartId: "qp-1" }));
    const res = await run(ctx, "promoteLineItemToQuotePart", { ...fields, file: file("a.step") });
    expect(await res.json()).toEqual({ error: "This line item already has an attached part" });
  });

  it("requires a file", async () => {
    const ctx = makeQuoteCtx();
    vi.mocked(ctx.deps.lineItems.find).mockResolvedValue(line());
    const res = await run(ctx, "promoteLineItemToQuotePart", fields);
    expect(res.status).toBe(400);
    expect(ctx.deps.parts.createFromCad).not.toHaveBeenCalled();
  });

  it("links the new part to the existing line and logs it", async () => {
    const ctx = makeQuoteCtx();
    vi.mocked(ctx.deps.lineItems.find).mockResolvedValue(line());
    vi.mocked(ctx.deps.parts.createFromCad).mockResolvedValue({ id: "qp-3", partName: "Bracket" });

    const res = await run(ctx, "promoteLineItemToQuotePart", { ...fields, file: file("a.step") });

    expect(ctx.deps.lineItems.linkToPart).toHaveBeenCalledWith(5, {
      quotePartId: "qp-3",
      name: "Bracket",
      description: null,
      notes: null,
      quantity: 2,
      unitPrice: "12.50",
      totalPrice: "25.00",
    });
    expect(ctx.deps.lineItems.create).not.toHaveBeenCalled();
    expect(ctx.deps.events.create).toHaveBeenCalledWith(
      expect.objectContaining({
        eventType: "quote_line_item_updated",
        title: "Line Item Linked to Part",
        metadata: { lineItemId: 5, quotePartId: "qp-3" },
      }),
    );
    expect(locationOf(res)).toBe("/quotes/7");
  });
});

describe("updateLineItem", () => {
  it("validates the id and ownership", async () => {
    const ctx = makeQuoteCtx();
    expect((await run(ctx, "updateLineItem")).status).toBe(400);
    expect((await run(ctx, "updateLineItem", { lineItemId: "x" })).status).toBe(400);
    expect((await run(ctx, "updateLineItem", { lineItemId: "5" })).status).toBe(404);
    vi.mocked(ctx.deps.lineItems.find).mockResolvedValue(line({ quoteId: 99 }));
    expect((await run(ctx, "updateLineItem", { lineItemId: "5" })).status).toBe(404);
    expect(ctx.deps.lineItems.update).not.toHaveBeenCalled();
  });

  it("applies the parsed change and returns the new totals", async () => {
    const ctx = makeQuoteCtx();
    vi.mocked(ctx.deps.lineItems.find).mockResolvedValue(line());
    vi.mocked(ctx.deps.quotes.recalculateTotals).mockResolvedValue({ subtotal: 90, total: 90 });

    const res = await run(ctx, "updateLineItem", { lineItemId: "5", quantity: "3", unitPrice: "30" });

    expect(ctx.deps.lineItems.update).toHaveBeenCalledWith(
      5,
      { quantity: 3, unitPrice: 30 },
      ctx.actor,
    );
    expect(await res.json()).toEqual({ success: true, totals: { subtotal: 90, total: 90 } });
  });

  it("excludes the edited line when sizing a percent discount", async () => {
    const ctx = makeQuoteCtx();
    vi.mocked(ctx.deps.lineItems.find).mockResolvedValue(line({ id: 5, quantity: 1 }));
    vi.mocked(ctx.deps.lineItems.list).mockResolvedValue([
      line({ id: 5, quantity: 1, unitPrice: "-10.00", totalPrice: "-10.00" }),
      line({ id: 6, quantity: 1, unitPrice: "200.00", totalPrice: "200.00" }),
    ]);
    await run(ctx, "updateLineItem", { lineItemId: "5", unitPrice: "50%" });
    expect(ctx.deps.lineItems.list).toHaveBeenCalledWith(7, "active");
    expect(ctx.deps.lineItems.update).toHaveBeenCalledWith(5, { unitPrice: -100 }, ctx.actor);
  });

  it("returns a pricing error without writing", async () => {
    const ctx = makeQuoteCtx();
    vi.mocked(ctx.deps.lineItems.find).mockResolvedValue(line({ quotePartId: "qp-1" }));
    const res = await run(ctx, "updateLineItem", { lineItemId: "5", unitPrice: "10%" });
    expect(res.status).toBe(400);
    expect(ctx.deps.lineItems.update).not.toHaveBeenCalled();
  });
});

describe("archiveLineItem / restoreLineItem", () => {
  it("archives and returns to the quote", async () => {
    const ctx = makeQuoteCtx();
    const res = await run(ctx, "archiveLineItem", { lineItemId: "5" });
    expect(ctx.deps.lineItems.archive).toHaveBeenCalledWith(5, 7, ctx.actor);
    expect(locationOf(res)).toBe("/quotes/7");
  });

  it("restores and returns to the quote", async () => {
    const ctx = makeQuoteCtx();
    const res = await run(ctx, "restoreLineItem", { lineItemId: "5" });
    expect(ctx.deps.lineItems.restore).toHaveBeenCalledWith(5, 7, ctx.actor);
    expect(locationOf(res)).toBe("/quotes/7");
  });

  it("needs a line item id", async () => {
    const ctx = makeQuoteCtx();
    expect((await run(ctx, "archiveLineItem")).status).toBe(400);
    expect((await run(ctx, "restoreLineItem")).status).toBe(400);
  });

  it("rejects a non-numeric line item id with 400 before touching the port", async () => {
    const ctx = makeQuoteCtx();
    expect((await run(ctx, "archiveLineItem", { lineItemId: "abc" })).status).toBe(400);
    expect((await run(ctx, "restoreLineItem", { lineItemId: "abc" })).status).toBe(400);
    expect(ctx.deps.lineItems.archive).not.toHaveBeenCalled();
    expect(ctx.deps.lineItems.restore).not.toHaveBeenCalled();
  });

  it("surfaces the domain error message with a 500", async () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    const ctx = makeQuoteCtx();
    vi.mocked(ctx.deps.lineItems.archive).mockRejectedValue(new Error("Line item not found"));
    const res = await run(ctx, "archiveLineItem", { lineItemId: "5" });
    expect(res.status).toBe(500);
    expect(await res.json()).toEqual({ error: "Line item not found" });
    spy.mockRestore();
  });
});
