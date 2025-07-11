import { json, LoaderFunctionArgs } from "@remix-run/node";
import { useLoaderData } from "@remix-run/react";
import { requireAuth, withAuthHeaders } from "~/lib/auth.server";

import Navbar from "~/components/Navbar";
import SearchHeader from "~/components/SearchHeader";

export async function loader({ request }: LoaderFunctionArgs) {
  const { user, userDetails, headers } = await requireAuth(request);
  
  return withAuthHeaders(
    json({ user, userDetails }),
    headers
  );
}

export default function Quotes() {
  const { user, userDetails } = useLoaderData<typeof loader>();
  
  return (
    <div>
      <Navbar 
        userName={userDetails?.name || user.email} 
        userEmail={user.email}
        userInitials={userDetails?.name?.charAt(0).toUpperCase() || user.email.charAt(0).toUpperCase()}
      />
      <div className="max-w-[1920px] mx-auto">
        <SearchHeader breadcrumbs="Dashboard / Action Items" />

        <div className="px-10 py-8">
        <h2 className="text-2xl font-semibold text-gray-900 dark:text-gray-100 transition-colors duration-150 mb-5">Items that require Input</h2>
        <div className="bg-white dark:bg-gray-800 p-10 rounded-lg border border-gray-300 dark:border-gray-600 text-center">
          <h3 className="text-xl font-semibold text-gray-700 dark:text-gray-300 mt-0 mb-4">Coming Soon</h3>
          <p className="text-gray-600 dark:text-gray-400 mb-2">This system is under development</p>
          <p className="text-gray-600 dark:text-gray-400">Please use the Orders section for now to manage orders.</p>
        </div>
        </div>
      </div>
    </div>
  );
}
