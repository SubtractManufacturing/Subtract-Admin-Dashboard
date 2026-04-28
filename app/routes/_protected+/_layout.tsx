import { LoaderFunctionArgs, ActionFunctionArgs, json, redirect } from "@remix-run/node";
import { Outlet, useLoaderData, useLocation } from "@remix-run/react";
import { requireAuth, withAuthHeaders, canUsePartAssetAdmin } from "~/lib/auth.server";
import { createServerClient } from "~/lib/supabase";
import { getAppConfig } from "~/lib/config.server";
import { canUserAccessAdminConsole, shouldShowEventsInNav, shouldShowVersionInHeader, isOutboundEmailEnabled } from "~/lib/featureFlags";
import { getEmailSettings } from "~/lib/email/templates.server";
import {
  getSentEmailStatusCounts,
  outboundAttentionCountFromStatusCounts,
} from "~/lib/sent-emails.server";
import Sidebar from "~/components/Sidebar";
import MobileHeader from "~/components/MobileHeader";
import { SidebarProvider, useSidebar } from "~/contexts/SidebarContext";

export async function loader({ request }: LoaderFunctionArgs) {
  const { user, userDetails, headers } = await requireAuth(request);
  const appConfig = getAppConfig();
  
  const [showEventsLink, showVersionInHeader, showAdminConsole, showEmailNav] =
    await Promise.all([
      shouldShowEventsInNav(),
      shouldShowVersionInHeader(),
      canUserAccessAdminConsole(userDetails.role),
      isOutboundEmailEnabled(),
    ]);

  let emailAttentionCount = 0;
  if (showEmailNav) {
    const settings = await getEmailSettings();
    const maxAgeHours = settings.emailListMaxAgeHours;
    const minCreatedAt =
      maxAgeHours > 0
        ? new Date(Date.now() - maxAgeHours * 60 * 60 * 1000)
        : null;
    const counts = await getSentEmailStatusCounts(minCreatedAt);
    emailAttentionCount = outboundAttentionCountFromStatusCounts(counts);
  }

  return withAuthHeaders(
    json({
      user,
      userDetails,
      appConfig,
      showEventsLink,
      showVersionInHeader,
      showAdminConsole,
      showEmailNav,
      emailAttentionCount,
      canUsePartAssetAdmin: canUsePartAssetAdmin(userDetails.role),
    }),
    headers,
  );
}

export async function action({ request }: ActionFunctionArgs) {
  const { supabase, headers } = createServerClient(request);
  
  // Sign out the user
  await supabase.auth.signOut();
  
  return withAuthHeaders(redirect("/login"), headers);
}

function ProtectedLayoutContent() {
  const {
    user,
    userDetails,
    appConfig,
    showEventsLink,
    showVersionInHeader,
    showAdminConsole,
    showEmailNav,
    emailAttentionCount,
  } = useLoaderData<typeof loader>();
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
        showEmailNav={showEmailNav}
        emailAttentionCount={emailAttentionCount}
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
