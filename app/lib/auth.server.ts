import { createServerClient } from "./supabase";
import { redirect } from "@remix-run/node";
import type { User } from "@supabase/supabase-js";

export async function requireAuth(request: Request) {
  const { supabase, headers } = createServerClient(request);
  
  // Use getUser() for security - it validates the session with Supabase
  const { data: { user }, error } = await supabase.auth.getUser();

  if (error || !user) {
    // Preserve the current URL for redirect after login, but validate it
    const url = new URL(request.url);
    const redirectTo = url.pathname + url.search;
    throw redirect(`/login?next=${encodeURIComponent(redirectTo)}`, { headers });
  }

  // Build userDetails from Supabase auth metadata
  const userDetails = {
    id: user.id,
    email: user.email || '',
    name: user.user_metadata?.name || null,
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
  const { data: { user }, error } = await supabase.auth.getUser();
  
  // Build userDetails if user exists
  const userDetails = user ? {
    id: user.id,
    email: user.email || '',
    name: user.user_metadata?.name || null,
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