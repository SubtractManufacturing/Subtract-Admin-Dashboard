import { json, LoaderFunctionArgs } from "@remix-run/node";
import { useLoaderData } from "@remix-run/react";
import { getVendor } from "~/lib/vendors";
import { requireAuth, withAuthHeaders } from "~/lib/auth.server";
import Navbar from "~/components/Navbar";
import SearchHeader from "~/components/SearchHeader";
import { cardStyles } from "~/utils/tw-styles";

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

        <div className="px-10 py-8">
          {/* Vendor Info Card */}
          <div className={cardStyles.container}>
            <h2 className="text-2xl font-semibold text-gray-900 mb-6">Vendor Information</h2>
            <dl className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <div>
                <dt className="text-sm font-medium text-gray-500">Display Name</dt>
                <dd className="mt-1 text-sm text-gray-900">{vendor.displayName}</dd>
              </div>
              {vendor.companyName && (
                <div>
                  <dt className="text-sm font-medium text-gray-500">Company Name</dt>
                  <dd className="mt-1 text-sm text-gray-900">{vendor.companyName}</dd>
                </div>
              )}
              {vendor.contactName && (
                <div>
                  <dt className="text-sm font-medium text-gray-500">Contact Name</dt>
                  <dd className="mt-1 text-sm text-gray-900">{vendor.contactName}</dd>
                </div>
              )}
              {vendor.email && (
                <div>
                  <dt className="text-sm font-medium text-gray-500">Email</dt>
                  <dd className="mt-1 text-sm text-gray-900">{vendor.email}</dd>
                </div>
              )}
              {vendor.phone && (
                <div>
                  <dt className="text-sm font-medium text-gray-500">Phone</dt>
                  <dd className="mt-1 text-sm text-gray-900">{vendor.phone}</dd>
                </div>
              )}
              {vendor.address && (
                <div>
                  <dt className="text-sm font-medium text-gray-500">Address</dt>
                  <dd className="mt-1 text-sm text-gray-900">{vendor.address}</dd>
                </div>
              )}
              {vendor.discordId && (
                <div>
                  <dt className="text-sm font-medium text-gray-500">Discord ID</dt>
                  <dd className="mt-1 text-sm text-gray-900">{vendor.discordId}</dd>
                </div>
              )}
              {vendor.notes && (
                <div className="sm:col-span-2">
                  <dt className="text-sm font-medium text-gray-500">Notes</dt>
                  <dd className="mt-1 text-sm text-gray-900">{vendor.notes}</dd>
                </div>
              )}
            </dl>
          </div>
        </div>
      </div>
    </div>
  );
}