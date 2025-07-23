import { json, LoaderFunctionArgs } from "@remix-run/node";
import { useLoaderData } from "@remix-run/react";
import { getOrder } from "~/lib/orders";
import { requireAuth, withAuthHeaders } from "~/lib/auth.server";
import Navbar from "~/components/Navbar";
import SearchHeader from "~/components/SearchHeader";

export async function loader({ request, params }: LoaderFunctionArgs) {
  const { user, userDetails, headers } = await requireAuth(request);
  
  const orderId = params.orderId;
  if (!orderId) {
    throw new Response("Order ID is required", { status: 400 });
  }

  const order = await getOrder(parseInt(orderId));
  if (!order) {
    throw new Response("Order not found", { status: 404 });
  }

  return withAuthHeaders(
    json({ order, user, userDetails }),
    headers
  );
}

export default function OrderDetails() {
  const { order, user, userDetails } = useLoaderData<typeof loader>();

  return (
    <div>
      <Navbar 
        userName={userDetails?.name || user.email} 
        userEmail={user.email}
        userInitials={userDetails?.name?.charAt(0).toUpperCase() || user.email.charAt(0).toUpperCase()}
      />
      <div className="max-w-[1920px] mx-auto">
        <SearchHeader breadcrumbs={`Orders / ${order.orderNumber}`} />
      </div>
    </div>
  );
}