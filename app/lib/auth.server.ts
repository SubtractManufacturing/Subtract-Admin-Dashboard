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

  // Ensure user exists in public.users table and get their role
  const role = await ensureUserExists(
    user.id,
    user.email || '',
    user.user_metadata?.name || null
  );
  
  // Build userDetails from Supabase auth metadata
  const userDetails = {
    id: user.id,
    email: user.email || '',
    name: user.user_metadata?.name || null,
    role: role,
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
  
  // Build userDetails if user exists and ensure they're in the database
  const role = user ? await ensureUserExists(
    user.id,
    user.email || '',
    user.user_metadata?.name || null
  ) : null;
  
  const userDetails = user ? {
    id: user.id,
    email: user.email || '',
    name: user.user_metadata?.name || null,
    role: role || "User",
    createdAt: new Date(user.created_at),
  } : null;

  return { user, userDetails, supabase, headers };
}

// Helper to merge response headers with auth headers
export function withAuthHeaders(response: Response, headers: Headers): Response {
  headers.forEach((value, key) => {
    response.headers.append(key, value);
  });
  return response;
}