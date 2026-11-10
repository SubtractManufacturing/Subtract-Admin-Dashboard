import { describe, expect, it, vi } from "vitest";
import type { IntentTable } from "~/lib/route-actions/core";
import type { OrderCtx } from "../context";
import { locationOf, makeOrderCtx, runIntent } from "../test-support";
import { jobBoardIntents } from "./job-board";

const run = (ctx: OrderCtx, intent: string, fields: Record<string, string | Blob> = {}) =>
  runIntent(jobBoardIntents as IntentTable<OrderCtx>, ctx, intent, fields);

describe("postJobBoard", () => {
  const post = { postText: "Hello shops", selectedAttachmentIds: '["a1"]' };

  it("sends the post and reports the sent messages", async () => {
    const ctx = makeOrderCtx();
    vi.mocked(ctx.deps.jobBoard.sendPost).mockResolvedValue({
      ok: true,
      sentMessages: [{ id: "m1" } as never],
    });
    const res = await run(ctx, "postJobBoard", { ...post, startAtMessageIndex: "2", priorSentMessages: "[]" });

    expect(ctx.deps.jobBoard.sendPost).toHaveBeenCalledWith(
      expect.objectContaining({
        orderId: 12,
        webhookUrl: "https://discord.test/hook",
        postText: "Hello shops",
        selectedAttachmentIds: ["a1"],
        startAtMessageIndex: 2,
        priorSentMessages: [],
        actor: ctx.actor,
      }),
    );
    expect(await res.json()).toEqual({
      intent: "postJobBoard",
      ok: true,
      sentMessages: [{ id: "m1" }],
    });
  });

  it("treats a non-numeric start index as zero", async () => {
    const ctx = makeOrderCtx();
    await run(ctx, "postJobBoard", { ...post, startAtMessageIndex: "oops" });
    expect(vi.mocked(ctx.deps.jobBoard.sendPost).mock.calls[0][0].startAtMessageIndex).toBe(0);
  });

  it("returns a resumable failure when the order is not eligible", async () => {
    const ctx = makeOrderCtx();
    vi.mocked(ctx.deps.jobBoard.assertEligibleForPost).mockResolvedValue({
      ok: false,
      error: "Delivery date required",
    });
    const res = await run(ctx, "postJobBoard", post);
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({
      intent: "postJobBoard",
      ok: false,
      error: "Delivery date required",
      failedGroup: "text",
      failedMessageIndex: 0,
      sentMessages: [],
    });
    expect(ctx.deps.jobBoard.sendPost).not.toHaveBeenCalled();
  });

  it("requires a configured webhook", async () => {
    const ctx = makeOrderCtx();
    vi.mocked(ctx.deps.jobBoard.settings).mockResolvedValue({ webhookUrl: null });
    const res = await run(ctx, "postJobBoard", post);
    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe("Job Board webhook is not configured");
  });

  it("rejects malformed JSON fields", async () => {
    const ctx = makeOrderCtx();
    const res = await run(ctx, "postJobBoard", { ...post, selectedAttachmentIds: "{nope" });
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "Invalid Job Board form payload" });
  });

  it("fails when the order input cannot be loaded", async () => {
    const ctx = makeOrderCtx();
    vi.mocked(ctx.deps.jobBoard.loadOrderInput).mockResolvedValue(null);
    const res = await run(ctx, "postJobBoard", post);
    expect(await res.json()).toEqual({ error: "Could not load order for Job Board" });
  });

  it("passes a partial send failure through so the modal can resume", async () => {
    const ctx = makeOrderCtx();
    vi.mocked(ctx.deps.jobBoard.sendPost).mockResolvedValue({
      ok: false,
      error: "Discord 429",
      failedGroup: "cad",
      failedMessageIndex: 3,
      sentMessages: [{ id: "m1" } as never],
    });
    const res = await run(ctx, "postJobBoard", post);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      intent: "postJobBoard",
      ok: false,
      error: "Discord 429",
      failedGroup: "cad",
      failedMessageIndex: 3,
      sentMessages: [{ id: "m1" }],
    });
  });
});

describe("markJobBoardAsSent", () => {
  it("marks an eligible order", async () => {
    const ctx = makeOrderCtx();
    const res = await run(ctx, "markJobBoardAsSent");
    expect(ctx.deps.jobBoard.markAsSent).toHaveBeenCalledWith({
      orderId: 12,
      orderNumber: "26Z00012",
      actor: ctx.actor,
    });
    expect(await res.json()).toEqual({ intent: "markJobBoardAsSent", ok: true });
  });

  it("refuses an ineligible order", async () => {
    const ctx = makeOrderCtx();
    vi.mocked(ctx.deps.jobBoard.assertEligible).mockResolvedValue({ ok: false, error: "Not pending" });
    const res = await run(ctx, "markJobBoardAsSent");
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ intent: "markJobBoardAsSent", ok: false, error: "Not pending" });
    expect(ctx.deps.jobBoard.markAsSent).not.toHaveBeenCalled();
  });
});

describe("assignShop", () => {
  const waiting = { order: { status: "Waiting_For_Shop_Selection" } } as const;

  it("requires a vendor and the right status", async () => {
    const ctx = makeOrderCtx(waiting);
    expect((await run(ctx, "assignShop")).status).toBe(400);
    const wrongStatus = makeOrderCtx();
    const res = await run(wrongStatus, "assignShop", { vendorId: "4" });
    expect(res.status).toBe(400);
    expect(wrongStatus.deps.orders.update).not.toHaveBeenCalled();
  });

  it("assigns the vendor, starts production and updates the post", async () => {
    const ctx = makeOrderCtx(waiting);
    const res = await run(ctx, "assignShop", { vendorId: "4" });
    expect(ctx.deps.orders.update).toHaveBeenCalledWith(
      12,
      { vendorId: 4, status: "In_Production" },
      ctx.actor,
    );
    expect(ctx.deps.jobBoard.updateClaim).toHaveBeenCalledWith({
      orderId: 12,
      vendorId: 4,
      webhookUrl: "https://discord.test/hook",
    });
    expect(locationOf(res)).toBe("/orders/26Z00012");
  });

  it("keeps the assignment but warns when the Discord edit fails", async () => {
    const ctx = makeOrderCtx(waiting);
    vi.mocked(ctx.deps.jobBoard.updateClaim).mockResolvedValue({
      ok: false,
      warning: "Could not edit the post & more",
    });
    const res = await run(ctx, "assignShop", { vendorId: "4" });
    expect(ctx.deps.orders.update).toHaveBeenCalled();
    expect(locationOf(res)).toBe(
      "/orders/26Z00012?jobBoardClaimWarning=Could%20not%20edit%20the%20post%20%26%20more",
    );
  });
});
