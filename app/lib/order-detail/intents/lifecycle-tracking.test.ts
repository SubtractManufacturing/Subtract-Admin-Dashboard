import { describe, expect, it, vi } from "vitest";
import type { IntentTable } from "~/lib/route-actions/core";
import type { OrderCtx } from "../context";
import { locationOf, makeOrderCtx, runIntent } from "../test-support";
import { lifecycleIntents } from "./lifecycle";
import { trackingIntents } from "./tracking";

const runIn =
  (table: object) =>
  (ctx: OrderCtx, intent: string, fields: Record<string, string | Blob> = {}) =>
    runIntent(table as IntentTable<OrderCtx>, ctx, intent, fields);
const runLife = runIn(lifecycleIntents);
const runTrack = runIn(trackingIntents);

describe("updateStatus", () => {
  it("requires a status and a valid one", async () => {
    const ctx = makeOrderCtx();
    expect(await (await runLife(ctx, "updateStatus")).json()).toEqual({ error: "Missing status" });
    expect((await runLife(ctx, "updateStatus", { status: "Bogus" })).status).toBe(400);
    expect(ctx.deps.orders.update).not.toHaveBeenCalled();
  });

  it("never ships directly", async () => {
    const ctx = makeOrderCtx();
    const res = await runLife(ctx, "updateStatus", { status: "Shipped" });
    expect(res.status).toBe(400);
    expect((await res.json()).error).toMatch(/ship order action/);
    expect(ctx.deps.orders.update).not.toHaveBeenCalled();
  });

  it.each(["Pending", "Waiting_For_Shop_Selection", "In_Production", "In_Inspection", "Delivered", "Completed", "Cancelled", "Archived"])(
    "moves to %s and returns to the order",
    async (status) => {
      const ctx = makeOrderCtx();
      const res = await runLife(ctx, "updateStatus", { status });
      expect(ctx.deps.orders.update).toHaveBeenCalledWith(12, { status }, ctx.actor);
      expect(locationOf(res)).toBe("/orders/26Z00012");
    },
  );
});

describe("updateOrderInfo", () => {
  it("saves vendor pay and trims the PO number", async () => {
    const ctx = makeOrderCtx();
    await runLife(ctx, "updateOrderInfo", { vendorPay: "250", poNumber: "  PO-9 " });
    expect(ctx.deps.orders.update).toHaveBeenCalledWith(
      12,
      { vendorPay: "250", poNumber: "PO-9" },
      ctx.actor,
    );
  });

  it("clears the PO number when posted blank, leaves it alone when absent", async () => {
    const ctx = makeOrderCtx();
    await runLife(ctx, "updateOrderInfo", { poNumber: "   " });
    expect(vi.mocked(ctx.deps.orders.update).mock.calls[0][1]).toEqual({ poNumber: null });

    await runLife(ctx, "updateOrderInfo", { vendorPay: "5" });
    expect(vi.mocked(ctx.deps.orders.update).mock.calls[1][1]).toEqual({ vendorPay: "5" });
  });

  it("falls back to a plain lead time when no delivery date resolves", async () => {
    const ctx = makeOrderCtx();
    await runLife(ctx, "updateOrderInfo", { leadTime: "14" });
    const [, updates] = vi.mocked(ctx.deps.orders.update).mock.calls[0];
    expect(updates).toMatchObject({ leadTime: 14 });
  });
});

describe("other lifecycle intents", () => {
  it("updateNdaRequired toggles the flag", async () => {
    const ctx = makeOrderCtx();
    expect(await (await runLife(ctx, "updateNdaRequired", { ndaRequired: "true" })).json()).toEqual({
      success: true,
    });
    expect(ctx.deps.orders.update).toHaveBeenCalledWith(12, { ndaRequired: true }, ctx.actor);
  });

  it("updateVendor sets or clears the vendor", async () => {
    const ctx = makeOrderCtx();
    await runLife(ctx, "updateVendor", { vendorId: "4" });
    expect(ctx.deps.orders.update).toHaveBeenLastCalledWith(12, { vendorId: 4 }, ctx.actor);
    await runLife(ctx, "updateVendor", { vendorId: "" });
    expect(ctx.deps.orders.update).toHaveBeenLastCalledWith(12, { vendorId: null }, ctx.actor);
    expect((await runLife(ctx, "updateVendor", { vendorId: "x" })).status).toBe(400);
  });

  it("restoreOrder restores and returns", async () => {
    const ctx = makeOrderCtx();
    const res = await runLife(ctx, "restoreOrder");
    expect(ctx.deps.orders.restore).toHaveBeenCalledWith(12, ctx.actor);
    expect(locationOf(res)).toBe("/orders/26Z00012");
  });

  it("duplicateOrder goes to the copy, or reports failure", async () => {
    const ctx = makeOrderCtx();
    expect(locationOf(await runLife(ctx, "duplicateOrder"))).toBe("/orders/26Z00013");
    vi.mocked(ctx.deps.orders.duplicate).mockResolvedValue({ success: false, error: "nope" });
    const res = await runLife(ctx, "duplicateOrder");
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "nope" });
  });
});

const tracking = (over: Record<string, unknown> = {}) => ({
  newTrackingEntries: JSON.stringify([{ trackingNumber: "1Z999", carrier: "ups" }]),
  deletedIds: JSON.stringify([5]),
  updatedTrackingEntries: JSON.stringify([{ id: 2, trackingNumber: "EDITED" }]),
  ...over,
});

describe("manageTrackingNumbers", () => {
  it("applies deletes, then edits, then additions", async () => {
    const ctx = makeOrderCtx();
    const calls: string[] = [];
    vi.mocked(ctx.deps.tracking.remove).mockImplementation(async () => void calls.push("remove"));
    vi.mocked(ctx.deps.tracking.update).mockImplementation(async () => void calls.push("update"));
    vi.mocked(ctx.deps.tracking.add).mockImplementation(async () => void calls.push("add"));

    const res = await runTrack(ctx, "manageTrackingNumbers", tracking());

    expect(calls).toEqual(["remove", "update", "add"]);
    expect(ctx.deps.tracking.remove).toHaveBeenCalledWith(12, [5], ctx.actor);
    expect(await res.json()).toEqual({ success: true });
  });

  it("skips untouched groups", async () => {
    const ctx = makeOrderCtx();
    await runTrack(ctx, "manageTrackingNumbers", {});
    expect(ctx.deps.tracking.remove).not.toHaveBeenCalled();
    expect(ctx.deps.tracking.update).not.toHaveBeenCalled();
    expect(ctx.deps.tracking.add).not.toHaveBeenCalled();
  });

  it("refuses archived orders", async () => {
    const ctx = makeOrderCtx({ order: { status: "Archived" } });
    const res = await runTrack(ctx, "manageTrackingNumbers", tracking());
    expect(res.status).toBe(400);
    expect(ctx.deps.tracking.add).not.toHaveBeenCalled();
  });

  it("answers 400 with the message for malformed input", async () => {
    const ctx = makeOrderCtx();
    const res = await runTrack(ctx, "manageTrackingNumbers", { deletedIds: JSON.stringify({}) });
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "deletedIds must be an array" });
  });
});

describe("shipOrder", () => {
  const inspection = { order: { status: "In_Inspection" } } as const;

  it("only ships orders that are in inspection", async () => {
    for (const status of ["Pending", "In_Production", "Shipped"]) {
      const ctx = makeOrderCtx({ order: { status } as never });
      const res = await runTrack(ctx, "shipOrder", tracking());
      expect(res.status).toBe(400);
      expect(ctx.deps.orders.update).not.toHaveBeenCalled();
    }
    const archived = makeOrderCtx({ order: { status: "Archived" } });
    expect((await runTrack(archived, "shipOrder")).status).toBe(400);
  });

  it("saves tracking, then moves the order to Shipped", async () => {
    const ctx = makeOrderCtx(inspection);
    const res = await runTrack(ctx, "shipOrder", tracking());
    expect(ctx.deps.tracking.add).toHaveBeenCalled();
    expect(ctx.deps.orders.update).toHaveBeenCalledWith(12, { status: "Shipped" }, ctx.actor);
    expect(await res.json()).toEqual({ success: true });
  });

  it("requires at least one tracking number after the changes", async () => {
    const ctx = makeOrderCtx(inspection);
    vi.mocked(ctx.deps.tracking.willHaveAfterChanges).mockResolvedValue(false);
    const res = await runTrack(ctx, "shipOrder", tracking());
    expect(res.status).toBe(400);
    expect((await res.json()).error).toMatch(/Add at least one tracking number/);
    expect(ctx.deps.tracking.add).not.toHaveBeenCalled();
    expect(ctx.deps.orders.update).not.toHaveBeenCalled();
  });

  it("asks the tracking port using the parsed changes", async () => {
    const ctx = makeOrderCtx(inspection);
    await runTrack(ctx, "shipOrder", tracking());
    expect(ctx.deps.tracking.willHaveAfterChanges).toHaveBeenCalledWith(
      12,
      [5],
      [{ id: 2, trackingNumber: "EDITED", carrier: null, carrierDetails: null }],
      [{ trackingNumber: "1Z999", carrier: "ups", carrierDetails: null }],
    );
  });

  it("ships without tracking when the override is set", async () => {
    const ctx = makeOrderCtx(inspection);
    vi.mocked(ctx.deps.tracking.willHaveAfterChanges).mockResolvedValue(false);
    const res = await runTrack(ctx, "shipOrder", { skipTrackingOverride: "true" });
    expect(ctx.deps.tracking.willHaveAfterChanges).not.toHaveBeenCalled();
    expect(ctx.deps.orders.update).toHaveBeenCalledWith(12, { status: "Shipped" }, ctx.actor);
    expect(res.status).toBe(200);
  });

  it("does not ship when saving tracking fails", async () => {
    const ctx = makeOrderCtx(inspection);
    vi.mocked(ctx.deps.tracking.add).mockRejectedValue(new Error("duplicate tracking number"));
    const res = await runTrack(ctx, "shipOrder", tracking());
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "duplicate tracking number" });
    expect(ctx.deps.orders.update).not.toHaveBeenCalled();
  });
});
