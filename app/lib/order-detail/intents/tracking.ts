/**
 * Tracking numbers and shipping. "Ship order" is the only way an Order reaches
 * Shipped, and it requires a tracking number unless explicitly overridden.
 */
import { json } from "@remix-run/node";
import { badRequest, ok, type IntentTable } from "~/lib/route-actions/core";
import type { OrderCtx } from "../context";
import type { OrderDeps } from "../ports";
import { parseTrackingChanges, type TrackingChanges } from "../tracking-form";

type Ctx = OrderCtx<Pick<OrderDeps, "orders" | "tracking">>;

/** Deletes first, then edits, then additions, so ids stay valid. */
async function applyTrackingChanges(ctx: Ctx, changes: TrackingChanges): Promise<void> {
  const orderId = ctx.order.id;
  const actor = ctx.actor;
  if (changes.deletedIds.length > 0) {
    await ctx.deps.tracking.remove(orderId, changes.deletedIds, actor);
  }
  if (changes.updated.length > 0) {
    await ctx.deps.tracking.update(orderId, changes.updated, actor);
  }
  if (changes.added.length > 0) {
    await ctx.deps.tracking.add(orderId, changes.added, actor);
  }
}

const failure = (error: unknown, fallback: string) =>
  json({ error: error instanceof Error ? error.message : fallback }, { status: 400 });

export const trackingIntents: IntentTable<Ctx> = {
  async manageTrackingNumbers(ctx, formData) {
    if (ctx.order.status === "Archived") {
      return badRequest("Archived orders cannot be updated");
    }
    try {
      await applyTrackingChanges(ctx, parseTrackingChanges(formData));
      return ok();
    } catch (error) {
      return failure(error, "Failed to update tracking numbers");
    }
  },

  async shipOrder(ctx, formData) {
    if (ctx.order.status === "Archived") {
      return badRequest("Archived orders cannot be shipped");
    }
    if (ctx.order.status !== "In_Inspection") {
      return badRequest("Only orders in inspection can be moved to shipped");
    }

    try {
      const changes = parseTrackingChanges(formData);
      const skipTrackingOverride = formData.get("skipTrackingOverride") === "true";

      if (
        !skipTrackingOverride &&
        !(await ctx.deps.tracking.willHaveAfterChanges(
          ctx.order.id,
          changes.deletedIds,
          changes.updated,
          changes.added,
        ))
      ) {
        return badRequest(
          "Add at least one tracking number before shipping this order, or use the override.",
        );
      }

      await applyTrackingChanges(ctx, changes);
      await ctx.deps.orders.update(ctx.order.id, { status: "Shipped" }, ctx.actor);
      return ok();
    } catch (error) {
      return failure(error, "Failed to ship order");
    }
  },
};
