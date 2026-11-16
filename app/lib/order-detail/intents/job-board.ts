/**
 * Job Board intents: post an Order to the Discord Job Board, mark it as sent
 * without posting, and assign a shop (which edits the post to name the Vendor).
 */
import { json, redirect } from "@remix-run/node";
import type { JobBoardSentMessageRecord } from "~/lib/job-board/types";
import { badRequest, type IntentTable } from "~/lib/route-actions/core";
import { orderHref, type OrderCtx } from "../context";
import type { OrderDeps } from "../ports";

type Ctx = OrderCtx<Pick<OrderDeps, "orders" | "jobBoard">>;

/** Failure shape the Job Board modal reads (it resumes from `failedMessageIndex`). */
const postFailure = (error: string) =>
  json(
    {
      intent: "postJobBoard",
      ok: false as const,
      error,
      failedGroup: "text",
      failedMessageIndex: 0,
      sentMessages: [],
    },
    { status: 400 },
  );

export const jobBoardIntents: IntentTable<Ctx> = {
  async postJobBoard(ctx, formData) {
    const eligibility = await ctx.deps.jobBoard.assertEligibleForPost(ctx.order.id);
    if (!eligibility.ok) return postFailure(eligibility.error);

    const { webhookUrl } = await ctx.deps.jobBoard.settings();
    if (!webhookUrl) return postFailure("Job Board webhook is not configured");

    let selectedAttachmentIds: string[];
    let priorSentMessages: JobBoardSentMessageRecord[];
    try {
      selectedAttachmentIds = JSON.parse(String(formData.get("selectedAttachmentIds") ?? "[]"));
      priorSentMessages = JSON.parse(String(formData.get("priorSentMessages") ?? "[]"));
    } catch {
      return badRequest("Invalid Job Board form payload");
    }
    const startAt = Number(formData.get("startAtMessageIndex") ?? 0);

    const orderInput = await ctx.deps.jobBoard.loadOrderInput(ctx.order.id);
    if (!orderInput) return badRequest("Could not load order for Job Board");

    const result = await ctx.deps.jobBoard.sendPost({
      orderId: ctx.order.id,
      orderInput,
      webhookUrl,
      postText: String(formData.get("postText") ?? ""),
      selectedAttachmentIds,
      startAtMessageIndex: Number.isFinite(startAt) ? startAt : 0,
      priorSentMessages,
      actor: ctx.actor,
    });

    if (result.ok) {
      return json({ intent: "postJobBoard", ok: true as const, sentMessages: result.sentMessages });
    }
    return json({
      intent: "postJobBoard",
      ok: false as const,
      error: result.error,
      failedGroup: result.failedGroup,
      failedMessageIndex: result.failedMessageIndex,
      sentMessages: result.sentMessages,
    });
  },

  async markJobBoardAsSent(ctx) {
    const eligibility = await ctx.deps.jobBoard.assertEligible(ctx.order.id);
    if (!eligibility.ok) {
      return json(
        { intent: "markJobBoardAsSent", ok: false as const, error: eligibility.error },
        { status: 400 },
      );
    }

    await ctx.deps.jobBoard.markAsSent({
      orderId: ctx.order.id,
      orderNumber: ctx.order.orderNumber,
      actor: ctx.actor,
    });
    return json({ intent: "markJobBoardAsSent", ok: true as const });
  },

  async assignShop(ctx, formData) {
    const raw = formData.get("vendorId");
    if (!raw) return badRequest("Please select a vendor");
    if (ctx.order.status !== "Waiting_For_Shop_Selection") {
      return badRequest(
        "Assign Shop is only available while the order is Waiting for Shop Selection",
      );
    }
    const vendorId = parseInt(String(raw), 10);
    if (Number.isNaN(vendorId)) return badRequest("Invalid vendor ID");

    await ctx.deps.orders.update(
      ctx.order.id,
      { vendorId, status: "In_Production" },
      ctx.actor,
    );

    // A failed Discord edit must not undo the assignment; surface it as a warning.
    const { webhookUrl } = await ctx.deps.jobBoard.settings();
    const claim = await ctx.deps.jobBoard.updateClaim({
      orderId: ctx.order.id,
      vendorId,
      webhookUrl,
    });
    if (!claim.ok) {
      return redirect(
        `${orderHref(ctx.order)}?jobBoardClaimWarning=${encodeURIComponent(claim.warning)}`,
      );
    }
    return redirect(orderHref(ctx.order));
  },
};
