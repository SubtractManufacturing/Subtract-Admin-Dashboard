import { describe, expect, it, vi } from "vitest";
import type { IntentTable } from "~/lib/route-actions/core";
import type { OrderCtx } from "../context";
import type { OrderLineRow } from "../ports";
import { makeOrderCtx, runIntent } from "../test-support";
import { lineItemIntents } from "./line-items";

const run = (ctx: OrderCtx, intent: string, fields: Record<string, string | Blob> = {}) =>
  runIntent(lineItemIntents as IntentTable<OrderCtx>, ctx, intent, fields);

const line = (over: Partial<OrderLineRow> = {}): OrderLineRow => ({
  id: 5,
  orderId: 12,
  partId: null,
  quantity: 2,
  unitPrice: "50.00",
  ...over,
});

const fields = { name: "Setup", description: "d", quantity: "3", unitPrice: "10", notes: "n" };

describe("createLineItem", () => {
  it("creates the line with a two-decimal unit price", async () => {
    const ctx = makeOrderCtx();
    vi.mocked(ctx.deps.lineItems.create).mockResolvedValue({ id: 9 });
    const res = await run(ctx, "createLineItem", fields);
    expect(ctx.deps.lineItems.create).toHaveBeenCalledWith(
      {
        orderId: 12,
        name: "Setup",
        description: "d",
        quantity: 3,
        unitPrice: "10.00",
        partId: null,
        notes: "n",
      },
      ctx.actor,
    );
    expect(await res.json()).toEqual({ lineItem: { id: 9 } });
  });

  it("requires name, quantity and price", async () => {
    for (const missing of ["name", "quantity", "unitPrice"]) {
      const res = await run(makeOrderCtx(), "createLineItem", { ...fields, [missing]: "" });
      expect(await res.json()).toEqual({ error: "Missing required fields" });
    }
  });

  it("treats a blank partId as no part, and keeps a real one", async () => {
    const ctx = makeOrderCtx();
    await run(ctx, "createLineItem", { ...fields, partId: "  " });
    expect(vi.mocked(ctx.deps.lineItems.create).mock.calls[0][0].partId).toBeNull();
    await run(ctx, "createLineItem", { ...fields, partId: "part-7" });
    expect(vi.mocked(ctx.deps.lineItems.create).mock.calls[1][0].partId).toBe("part-7");
  });

  it("sizes a percent discount from the existing lines", async () => {
    const ctx = makeOrderCtx();
    vi.mocked(ctx.deps.lineItems.list).mockResolvedValue([
      line({ id: 1, quantity: 1, unitPrice: "200.00" }),
    ]);
    await run(ctx, "createLineItem", { ...fields, quantity: "1", unitPrice: "25%" });
    expect(vi.mocked(ctx.deps.lineItems.create).mock.calls[0][0].unitPrice).toBe("-50.00");
  });

  it("rejects a percent discount on a part-linked line", async () => {
    const ctx = makeOrderCtx();
    const res = await run(ctx, "createLineItem", { ...fields, partId: "p1", unitPrice: "10%" });
    expect(res.status).toBe(400);
    expect(ctx.deps.lineItems.create).not.toHaveBeenCalled();
  });

  it("surfaces a domain failure as 400", async () => {
    const ctx = makeOrderCtx();
    vi.mocked(ctx.deps.lineItems.create).mockRejectedValue(new Error("Order is locked"));
    const res = await run(ctx, "createLineItem", fields);
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "Order is locked" });
  });
});

describe("createLineItemWithUpload", () => {
  const upload = {
    ...fields,
    file: new File(["step"], "my part.step"),
    material: "6061",
    finish: "anodized",
    partNotes: "careful",
    drawingCount: "1",
    drawing_0: new File(["%PDF"], "d.pdf", { type: "application/pdf" }),
  };

  it("stores the model, creates the part, attaches drawings, then adds the line", async () => {
    const ctx = makeOrderCtx();
    vi.mocked(ctx.deps.parts.create).mockResolvedValue({ id: "part-9" });

    await run(ctx, "createLineItemWithUpload", upload);

    expect(vi.mocked(ctx.deps.files.upload).mock.calls[0][0].key).toMatch(/^parts\/\d+-my-part\.step$/);
    expect(ctx.deps.parts.create).toHaveBeenCalledWith(
      expect.objectContaining({
        customerId: 3,
        partName: "Setup",
        notes: "careful",
        material: "6061",
        tolerance: null,
        finishing: "anodized",
      }),
      ctx.actor,
    );
    expect(ctx.deps.parts.linkDrawing).toHaveBeenCalledWith("part-9", "drawing-att-1");
    expect(ctx.deps.lineItems.create).toHaveBeenCalledWith(
      expect.objectContaining({ orderId: 12, partId: "part-9", unitPrice: "10.00" }),
      ctx.actor,
    );
  });

  it("needs a file and a customer on the order", async () => {
    const noFile = { ...upload } as Record<string, string | Blob>;
    delete noFile.file;
    expect((await run(makeOrderCtx(), "createLineItemWithUpload", noFile)).status).toBe(400);
    const orphan = makeOrderCtx({ order: { customerId: null } as never });
    expect((await run(orphan, "createLineItemWithUpload", upload)).status).toBe(400);
  });

  it("validates the price before storing anything", async () => {
    const ctx = makeOrderCtx();
    const res = await run(ctx, "createLineItemWithUpload", { ...upload, unitPrice: "10%" });
    expect(res.status).toBe(400);
    expect(ctx.deps.files.upload).not.toHaveBeenCalled();
    expect(ctx.deps.parts.create).not.toHaveBeenCalled();
  });

  it("reports storage failures as 500", async () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    const ctx = makeOrderCtx();
    vi.mocked(ctx.deps.files.upload).mockRejectedValue(new Error("s3"));
    const res = await run(ctx, "createLineItemWithUpload", upload);
    expect(res.status).toBe(500);
    expect(await res.json()).toEqual({ error: "Failed to create line item with uploaded part" });
    spy.mockRestore();
  });
});

describe("updateLineItem", () => {
  const edit = { lineItemId: "5", name: "New", description: "d", quantity: "4", unitPrice: "12.5", notes: "" };

  it("validates required fields, existence and ownership", async () => {
    const ctx = makeOrderCtx();
    expect((await run(ctx, "updateLineItem", { ...edit, name: "" })).status).toBe(400);
    expect((await run(ctx, "updateLineItem", edit)).status).toBe(404);
    vi.mocked(ctx.deps.lineItems.find).mockResolvedValue(line({ orderId: 99 }));
    expect((await run(ctx, "updateLineItem", edit)).status).toBe(404);
  });

  it("updates in place, nulling empty notes and leaving the part alone", async () => {
    const ctx = makeOrderCtx();
    vi.mocked(ctx.deps.lineItems.find).mockResolvedValue(line());
    await run(ctx, "updateLineItem", edit);
    expect(ctx.deps.lineItems.update).toHaveBeenCalledWith(
      5,
      { name: "New", description: "d", quantity: 4, unitPrice: "12.50", notes: null },
      ctx.actor,
    );
  });

  it("changes the part only when partId is posted", async () => {
    const ctx = makeOrderCtx();
    vi.mocked(ctx.deps.lineItems.find).mockResolvedValue(line({ partId: "p1" }));
    await run(ctx, "updateLineItem", { ...edit, partId: "" });
    expect(vi.mocked(ctx.deps.lineItems.update).mock.calls[0][1]).toMatchObject({ partId: null });
  });

  it("uses the existing part link to decide whether percent discounts are allowed", async () => {
    const ctx = makeOrderCtx();
    vi.mocked(ctx.deps.lineItems.find).mockResolvedValue(line({ partId: "p1" }));
    const res = await run(ctx, "updateLineItem", { ...edit, unitPrice: "10%" });
    expect(res.status).toBe(400);
    expect(ctx.deps.lineItems.update).not.toHaveBeenCalled();
  });

  it("excludes the edited line when sizing a percent discount", async () => {
    const ctx = makeOrderCtx();
    vi.mocked(ctx.deps.lineItems.find).mockResolvedValue(line({ id: 5 }));
    vi.mocked(ctx.deps.lineItems.list).mockResolvedValue([
      line({ id: 5, quantity: 1, unitPrice: "-10.00" }),
      line({ id: 6, quantity: 1, unitPrice: "400.00" }),
    ]);
    await run(ctx, "updateLineItem", { ...edit, quantity: "1", unitPrice: "50%" });
    expect(vi.mocked(ctx.deps.lineItems.update).mock.calls[0][1]).toMatchObject({ unitPrice: "-200.00" });
  });
});

describe("notes, archive and restore", () => {
  it("updateLineItemNote writes only the note", async () => {
    const ctx = makeOrderCtx();
    await run(ctx, "updateLineItemNote", { lineItemId: "5", notes: "rush" });
    expect(ctx.deps.lineItems.update).toHaveBeenCalledWith(5, { notes: "rush" }, ctx.actor);
    await run(ctx, "updateLineItemNote", { lineItemId: "5", notes: "" });
    expect(ctx.deps.lineItems.update).toHaveBeenLastCalledWith(5, { notes: null }, ctx.actor);
    expect((await run(ctx, "updateLineItemNote")).status).toBe(400);
  });

  it("archives and restores scoped to this order", async () => {
    const ctx = makeOrderCtx();
    expect(await (await run(ctx, "archiveLineItem", { lineItemId: "5" })).json()).toEqual({ success: true });
    expect(ctx.deps.lineItems.archive).toHaveBeenCalledWith(5, 12, ctx.actor);
    expect(await (await run(ctx, "restoreLineItem", { lineItemId: "5" })).json()).toEqual({ success: true });
    expect(ctx.deps.lineItems.restore).toHaveBeenCalledWith(5, 12, ctx.actor);
  });

  it("needs an id and surfaces domain errors", async () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    const ctx = makeOrderCtx();
    expect((await run(ctx, "archiveLineItem")).status).toBe(400);
    expect((await run(ctx, "restoreLineItem")).status).toBe(400);
    vi.mocked(ctx.deps.lineItems.archive).mockRejectedValue(new Error("Line item not found"));
    const res = await run(ctx, "archiveLineItem", { lineItemId: "5" });
    expect(res.status).toBe(500);
    expect(await res.json()).toEqual({ error: "Line item not found" });
    spy.mockRestore();
  });
});
