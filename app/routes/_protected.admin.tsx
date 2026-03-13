import { json, redirect, type LoaderFunctionArgs } from "@remix-run/node";
import { Outlet, useLoaderData } from "@remix-run/react";
import AdminSidebar from "~/components/admin/Sidebar";
import AdminSearchBar from "~/components/admin/SearchBar";
import { requireAuth, withAuthHeaders } from "~/lib/auth.server";
import { canUserAccessAdminConsole, isStripePaymentLinksEnabled } from "~/lib/featureFlags";

export async function loader({ request }: LoaderFunctionArgs) {
  const { user, userDetails, headers } = await requireAuth(request);

  const canAccessAdminConsole = await canUserAccessAdminConsole(userDetails.role);

  if (!canAccessAdminConsole) {
    return withAuthHeaders(redirect("/"), headers);
  }

  const stripeEnabled = await isStripePaymentLinksEnabled();

  return withAuthHeaders(json({ user, userDetails, stripeEnabled }), headers);
}

export default function AdminLayout() {
  const { stripeEnabled } = useLoaderData<typeof loader>();

  return (
    <div className="flex min-h-screen bg-gray-50 dark:bg-slate-900">
      <AdminSidebar stripeEnabled={stripeEnabled} />
      <div className="ml-64 flex flex-1 flex-col">
        <header className="sticky top-0 z-40 flex h-14 items-center border-b border-gray-200 bg-white/80 px-4 backdrop-blur-sm sm:px-6 lg:px-10 dark:border-slate-700 dark:bg-slate-900/80">
          <AdminSearchBar />
        </header>
        <main className="flex-1">
          <Outlet />
        </main>
      </div>
    </div>
  );
}
