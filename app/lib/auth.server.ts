import { createServerClient } from "./supabase";
import { redirect } from "@remix-run/node";
import { ensureUserExists } from "./users";

export async function requireAuth(request: Request) {
  const { supabase, headers } = createServerClient(request);
  
  // Use getUser() for security - it validates the session with Supabase
  const { data: { user } } = await supabase.auth.getUser();

  if (!user) {
    // Preserve the current URL for redirect after login, but validate it
    const url = new URL(request.url);
    const redirectTo = url.pathname + url.search;
    throw redirect(`/login?next=${encodeURIComponent(redirectTo)}`, { headers });
  }

  // Ensure user exists in public.users table and get role/status
  const userState = await ensureUserExists(
    user.id,
    user.email || '',
    user.user_metadata?.name || null
  );

  if (userState.isArchived || userState.status === "disabled") {
    await supabase.auth.signOut();
    throw redirect(
      "/login?error=Account+disabled.+Contact+your+administrator.",
      { headers }
    );
  }
  
  // Build userDetails from Supabase auth metadata
  const userDetails = {
    id: user.id,
    email: user.email || '',
    name: user.user_metadata?.name || null,
    role: userState.role,
    createdAt: new Date(user.created_at),
  };

  return { 
    user,
    userDetails,
    supabase, 
    headers 
  };
}

export async function getOptionalAuth(request: Request) {
  const { supabase, headers } = createServerClient(request);
  
  // Use getUser() instead of getSession() for security
  const { data: { user } } = await supabase.auth.getUser();
  
  if (!user) {
    return { user: null, userDetails: null, supabase, headers };
  }

  const userState = await ensureUserExists(
    user.id,
    user.email || '',
    user.user_metadata?.name || null
  );

  if (userState.isArchived || userState.status === "disabled") {
    await supabase.auth.signOut();
    return { user: null, userDetails: null, supabase, headers };
  }
  
  const userDetails = {
    id: user.id,
    email: user.email || '',
    name: user.user_metadata?.name || null,
    role: userState.role || "User",
    createdAt: new Date(user.created_at),
  };

  return { user, userDetails, supabase, headers };
}

/** Part asset admin flyout: mesh / CAD history / drawings — Admin and Dev only, no feature flags */
export function canUsePartAssetAdmin(role?: string | null): boolean {
  return role === "Admin" || role === "Dev";
}

// Helper to merge response headers with auth headers
export function withAuthHeaders(response: Response, headers: Headers): Response {
  headers.forEach((value, key) => {
    response.headers.append(key, value);
  });
  return response;
}