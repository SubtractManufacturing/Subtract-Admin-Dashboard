import { LoaderFunctionArgs, ActionFunctionArgs, json, redirect } from "@remix-run/node";
import { Outlet, useLoaderData } from "@remix-run/react";
import { requireAuth, withAuthHeaders } from "~/lib/auth.server";
import { createServerClient } from "~/lib/supabase";
import { getAppConfig } from "~/lib/config.server";
import { shouldShowEventsInNav, shouldShowVersionInHeader } from "~/lib/featureFlags";
import Sidebar from "~/components/Sidebar";
import { SidebarProvider, useSidebar } from "~/contexts/SidebarContext";

export async function loader({ request }: LoaderFunctionArgs) {
  const { user, userDetails, headers } = await requireAuth(request);
  const appConfig = getAppConfig();
  
  const [showEventsLink, showVersionInHeader] = await Promise.all([
    shouldShowEventsInNav(),
    shouldShowVersionInHeader(),
  ]);
  
  return withAuthHeaders(
    json({ 
      user, 
      userDetails, 
      appConfig,
      showEventsLink,
      showVersionInHeader,
    }),
    headers
  );
}

export async function action({ request }: ActionFunctionArgs) {
  const { supabase, headers } = createServerClient(request);
  
  // Sign out the user
  await supabase.auth.signOut();
  
  return withAuthHeaders(redirect("/login"), headers);
}

function ProtectedLayoutContent() {
  const { user, userDetails, appConfig, showEventsLink, showVersionInHeader } = useLoaderData<typeof loader>();
  const { isExpanded } = useSidebar();
  
  return (
    <div className="flex min-h-screen">
      <Sidebar
        userName={userDetails?.name || user.email}
        userEmail={user.email}
        userInitials={userDetails?.name?.charAt(0).toUpperCase() || user.email?.charAt(0).toUpperCase()}
        version={appConfig.version}
        showVersion={showVersionInHeader}
        showEventsLink={showEventsLink}
      />
      <main className={`flex-1 transition-all duration-300 ${isExpanded ? "ml-64" : "ml-20"}`}>
        <Outlet />
      </main>
    </div>
  );
}

export default function ProtectedLayout() {
  return (
    <SidebarProvider>
      <ProtectedLayoutContent />
    </SidebarProvider>
  );
}