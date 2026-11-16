/**
 * Order lifecycle intents: status, header info, vendor, NDA flag, restore and
 * duplicate. Moving to Shipped is not here; it requires tracking (see tracking.ts).
 */
import { redirect } from "@remix-run/node";
import { resolveOrderDeliveryFromForm } from "~/lib/order-delivery";
import type { OrderInput } from "~/lib/orders";
import { badRequest, ok, type IntentTable } from "~/lib/route-actions/core";
import { redirectToOrder, type OrderCtx } from "../context";
import type { OrderDeps } from "../ports";

type Ctx = OrderCtx<Pick<OrderDeps, "orders">>;

type OrderStatus = NonNullable<OrderInput["status"]>;

const ORDER_STATUSES: readonly OrderStatus[] = [
  "Pending",
  "Waiting_For_Shop_Selection",
  "In_Production",
  "In_Inspection",
  "Shipped",
  "Delivered",
  "Completed",
  "Cancelled",
  "Archived",
];

export const lifecycleIntents: IntentTable<Ctx> = {
  async updateStatus(ctx, formData) {
    const status = formData.get("status");
    if (typeof status !== "string" || !status) return badRequest("Missing status");
    if (status === "Shipped") {
      return badRequest("Use the ship order action to move orders to Shipped status");
    }
    if (!ORDER_STATUSES.includes(status as OrderStatus)) {
      return badRequest("Invalid status");
    }

    await ctx.deps.orders.update(ctx.order.id, { status: status as OrderStatus }, ctx.actor);
    return redirectToOrder(ctx.order);
  },

  async updateOrderInfo(ctx, formData) {
    const deliveryDate = formData.get("deliveryDate") as string | null;
    const leadTime = formData.get("leadTime") as string | null;
    const vendorPay = formData.get("vendorPay") as string | null;
    const poNumberRaw = formData.get("poNumber");

    const updates: Partial<OrderInput> = {};
    const delivery = resolveOrderDeliveryFromForm({
      deliveryDateStr: deliveryDate,
      leadTimeStr: leadTime,
      placedAt: ctx.order.createdAt,
    });
    if (delivery !== undefined) {
      updates.deliveryDate = delivery.deliveryDate;
      updates.leadTime = delivery.leadTime;
    } else if (leadTime) {
      updates.leadTime = parseInt(leadTime, 10);
    }
    if (vendorPay) updates.vendorPay = vendorPay;
    if (poNumberRaw !== null) {
      updates.poNumber = String(poNumberRaw).trim() || null;
    }

    await ctx.deps.orders.update(ctx.order.id, updates, ctx.actor);
    return redirectToOrder(ctx.order);
  },

  async updateNdaRequired(ctx, formData) {
    await ctx.deps.orders.update(
      ctx.order.id,
      { ndaRequired: formData.get("ndaRequired") === "true" },
      ctx.actor,
    );
    return ok();
  },

  async updateVendor(ctx, formData) {
    const raw = formData.get("vendorId");
    const vendorId = raw ? parseInt(String(raw), 10) : null;
    if (vendorId !== null && Number.isNaN(vendorId)) return badRequest("Invalid vendor ID");

    // Null removes the vendor.
    await ctx.deps.orders.update(ctx.order.id, { vendorId }, ctx.actor);
    return redirectToOrder(ctx.order);
  },

  async restoreOrder(ctx) {
    await ctx.deps.orders.restore(ctx.order.id, ctx.actor);
    return redirectToOrder(ctx.order);
  },

  async duplicateOrder(ctx) {
    const result = await ctx.deps.orders.duplicate(ctx.order.id, ctx.actor);
    if (result.success && result.orderNumber) {
      return redirect(`/orders/${result.orderNumber}`);
    }
    return badRequest(result.error || "Failed to duplicate order");
  },
};
