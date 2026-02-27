import { LoaderFunctionArgs, ActionFunctionArgs, json, redirect } from "@remix-run/node";
import { Outlet, useLoaderData, useNavigate } from "@remix-run/react";
import { requireAuth, withAuthHeaders } from "~/lib/auth.server";
import { createServerClient } from "~/lib/supabase";
import { getAppConfig } from "~/lib/config.server";
import { shouldShowEventsInNav, shouldShowVersionInHeader, shouldShowEmailsInNav } from "~/lib/featureFlags";
import { getCategoryCounts } from "~/lib/emails";
import Sidebar from "~/components/Sidebar";
import MobileHeader from "~/components/MobileHeader";
import { SidebarProvider, useSidebar } from "~/contexts/SidebarContext";
import { useCallback } from "react";

export async function loader({ request }: LoaderFunctionArgs) {
  const { user, userDetails, headers } = await requireAuth(request);
  const appConfig = getAppConfig();
  
  const [showEventsLink, showVersionInHeader, showEmailsLink, emailCategoryCounts] = await Promise.all([
    shouldShowEventsInNav(),
    shouldShowVersionInHeader(),
    shouldShowEmailsInNav(),
    getCategoryCounts(user?.id),
  ]);
  
  return withAuthHeaders(
    json({ 
      user, 
      userDetails, 
      appConfig,
      showEventsLink,
      showVersionInHeader,
      showEmailsLink,
      emailCategoryCounts,
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
  const { user, userDetails, appConfig, showEventsLink, showVersionInHeader, showEmailsLink, emailCategoryCounts } = useLoaderData<typeof loader>();
  const { isExpanded } = useSidebar();
  const navigate = useNavigate();
  
  // Handle compose email - navigate to emails page with compose param
  const handleComposeEmail = useCallback(() => {
    navigate("/emails?compose=true");
  }, [navigate]);
  
  return (
    <div className="flex min-h-screen">
      <Sidebar
        userName={userDetails?.name || user.email}
        userEmail={user.email}
        userInitials={userDetails?.name?.charAt(0).toUpperCase() || user.email?.charAt(0).toUpperCase()}
        version={appConfig.version}
        showVersion={showVersionInHeader}
        showEventsLink={showEventsLink}
        showEmailsLink={showEmailsLink}
        emailCategoryCounts={emailCategoryCounts}
        onComposeEmail={handleComposeEmail}
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