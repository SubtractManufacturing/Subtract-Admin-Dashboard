import { LoaderFunctionArgs, ActionFunctionArgs, json, redirect } from "@remix-run/node";
import { Outlet, useLoaderData, useLocation } from "@remix-run/react";
import { requireAuth, withAuthHeaders, canUsePartAssetAdmin } from "~/lib/auth.server";
import { createServerClient } from "~/lib/supabase";
import { getAppConfig } from "~/lib/config.server";
import { canUserAccessAdminConsole, shouldShowEventsInNav, shouldShowVersionInHeader } from "~/lib/featureFlags";
import Sidebar from "~/components/Sidebar";
import MobileHeader from "~/components/MobileHeader";
import { SidebarProvider, useSidebar } from "~/contexts/SidebarContext";

export async function loader({ request }: LoaderFunctionArgs) {
  const { user, userDetails, headers } = await requireAuth(request);
  const appConfig = getAppConfig();
  
  const [showEventsLink, showVersionInHeader, showAdminConsole] = await Promise.all([
    shouldShowEventsInNav(),
    shouldShowVersionInHeader(),
    canUserAccessAdminConsole(userDetails.role),
  ]);
  
  return withAuthHeaders(
    json({ 
      user, 
      userDetails, 
      appConfig,
      showEventsLink,
      showVersionInHeader,
      showAdminConsole,
      canUsePartAssetAdmin: canUsePartAssetAdmin(userDetails.role),
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
  const { user, userDetails, appConfig, showEventsLink, showVersionInHeader, showAdminConsole } = useLoaderData<typeof loader>();
  const { isExpanded } = useSidebar();
  const location = useLocation();
  const isAdminArea = location.pathname.startsWith("/admin");

  if (isAdminArea) {
    return <Outlet />;
  }
  
  return (
    <div className="flex min-h-screen">
      <Sidebar
        userName={userDetails?.name || user.email}
        userEmail={user.email}
        userInitials={userDetails?.name?.charAt(0).toUpperCase() || user.email?.charAt(0).toUpperCase()}
        version={appConfig.version}
        showVersion={showVersionInHeader}
        showEventsLink={showEventsLink}
        showAdminConsole={showAdminConsole}
      />
      <main className={`flex-1 transition-all duration-300 ml-0 ${isExpanded ? "md:ml-64" : "md:ml-20"}`}>
        <MobileHeader />
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