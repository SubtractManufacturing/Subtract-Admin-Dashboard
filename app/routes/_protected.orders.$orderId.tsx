import { json, type ActionFunctionArgs, type LoaderFunctionArgs } from "@remix-run/node";
import OrderDetailPage from "~/components/orders/OrderDetailPage";
import { requireAuth, withAuthHeaders } from "~/lib/auth.server";
import { handleOrderAction } from "~/lib/order-detail/action.server";
import { loadOrderDetail } from "~/lib/order-detail/loader";
import { createOrderLoaderDeps } from "~/lib/order-detail/loader.server";

// Thin by design: what loads, what each action does and what renders all live
// behind seams. See docs/architecture-map.md ("Detail routes").

export async function loader({ request, params }: LoaderFunctionArgs) {
  const { user, userDetails, headers } = await requireAuth(request);
  const data = await loadOrderDetail(
    { orderNumber: params.orderId, user, userDetails },
    createOrderLoaderDeps(),
  );
  return withAuthHeaders(json(data), headers);
}

export async function action(args: ActionFunctionArgs) {
  return handleOrderAction(args);
}

export default function OrderDetailRoute() {
  return <OrderDetailPage />;
}
