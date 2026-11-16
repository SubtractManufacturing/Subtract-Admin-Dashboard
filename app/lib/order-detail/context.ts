import { redirect } from "@remix-run/node";
import type { getOrderByNumberWithAttachments } from "~/lib/orders";
import type { EmailEnqueueAuth } from "~/lib/email/handlers/quote-send-email.server";
import type { Actor } from "~/lib/route-actions/core";
import type { OrderDeps } from "./ports";

export type OrderEntity = NonNullable<
  Awaited<ReturnType<typeof getOrderByNumberWithAttachments>>
>;

/** Signed-in user, as the email handlers also expect it. */
export type OrderAuth = EmailEnqueueAuth;

/** What every Order intent handler receives. `D` narrows to the ports it needs. */
export type OrderCtx<D extends Partial<OrderDeps> = OrderDeps> = {
  order: OrderEntity;
  actor: Actor;
  auth: OrderAuth;
  entityRef: { type: "order"; id: string };
  deps: D;
};

export const orderHref = (order: { orderNumber: string }) => `/orders/${order.orderNumber}`;

export const redirectToOrder = (order: { orderNumber: string }) =>
  redirect(orderHref(order));

export const canDeleteProtectedAttachments = (auth: OrderAuth) =>
  auth.userDetails.role === "Admin" || auth.userDetails.role === "Dev";
