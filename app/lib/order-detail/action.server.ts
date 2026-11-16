import { json, type ActionFunctionArgs } from "@remix-run/node";
import { requireAuth, withAuthHeaders } from "~/lib/auth.server";
import { getOrderByNumberWithAttachments } from "~/lib/orders";
import { tryPartAssetAdminAction } from "~/lib/part-asset-admin.server";
import { readFormData } from "~/lib/route-actions/request.server";
import { runOrderIntent } from "./action";
import { createOrderDeps } from "./deps.server";

/** Remix `action` for `/orders/:orderId` (the param is the order number). */
export async function handleOrderAction({ request, params }: ActionFunctionArgs) {
  const { user, userDetails, headers } = await requireAuth(request);
  const respond = (response: Response) => withAuthHeaders(response, headers);

  if (!params.orderId) {
    return respond(json({ error: "Order number is required" }, { status: 400 }));
  }
  const order = await getOrderByNumberWithAttachments(params.orderId);
  if (!order) {
    return respond(json({ error: "Order not found" }, { status: 404 }));
  }

  const parsed = await readFormData(request);
  if (!parsed.ok) return respond(parsed.response);
  const { formData, multipart } = parsed;

  // A multipart post with no intent is a plain attachment upload.
  const intent = formData.get("intent") ?? (multipart ? "uploadAttachment" : null);

  const response = await runOrderIntent({
    order,
    auth: { user, userDetails },
    formData,
    intent,
    deps: createOrderDeps(),
    // Auth headers are applied once, below, so hand the admin helper none.
    partAssetAdmin: (fd) =>
      tryPartAssetAdminAction(
        fd,
        { type: "order", orderId: order.id, customerId: order.customerId },
        { user: { id: user.id }, userDetails, headers: new Headers() },
      ),
  });
  return respond(response);
}
