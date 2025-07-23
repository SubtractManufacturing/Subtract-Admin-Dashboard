import { json, LoaderFunctionArgs } from "@remix-run/node";
import { useLoaderData } from "@remix-run/react";
import { getVendor } from "~/lib/vendors";
import { requireAuth, withAuthHeaders } from "~/lib/auth.server";
import Navbar from "~/components/Navbar";
import SearchHeader from "~/components/SearchHeader";

export async function loader({ request, params }: LoaderFunctionArgs) {
  const { user, userDetails, headers } = await requireAuth(request);
  
  const vendorId = params.vendorId;
  if (!vendorId) {
    throw new Response("Vendor ID is required", { status: 400 });
  }

  const vendor = await getVendor(parseInt(vendorId));
  if (!vendor) {
    throw new Response("Vendor not found", { status: 404 });
  }

  return withAuthHeaders(
    json({ vendor, user, userDetails }),
    headers
  );
}

export default function VendorDetails() {
  const { vendor, user, userDetails } = useLoaderData<typeof loader>();

  return (
    <div>
      <Navbar 
        userName={userDetails?.name || user.email} 
        userEmail={user.email}
        userInitials={userDetails?.name?.charAt(0).toUpperCase() || user.email.charAt(0).toUpperCase()}
      />
      <div className="max-w-[1920px] mx-auto">
        <SearchHeader breadcrumbs={[
          { label: "Dashboard", href: "/" },
          { label: "Vendors", href: "/vendors" },
          { label: vendor.displayName }
        ]} />
      </div>
    </div>
  );
}