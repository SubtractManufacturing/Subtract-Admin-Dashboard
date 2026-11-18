import { createServerClient } from "./supabase.server";
import { redirect } from "@remix-run/node";
import { syncStaffUser } from "./users";
import { assertAuthorized } from "./authorization/authorize";
import { resolveStaffActor, STAFF_GATE_MESSAGES } from "./authorization/staff-gate";

/**
 * Resolves the signed-in Supabase identity to a staff actor, or null with the
 * reason it was refused. A session proves identity only; staff status needs an
 * active `public.users` row (see {@link resolveStaffActor}).
 */
async function resolveStaffSession(request: Request) {
  const { supabase, headers } = createServerClient(request);

  // Use getUser() for security - it validates the session with Supabase
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) return { supabase, headers, user: null, gate: null } as const;

  const gate = await resolveStaffActor(
    {
      id: user.id,
      email: user.email,
      name: user.user_metadata?.name ?? null,
    },
    { syncStaffUser },
  );

  return { supabase, headers, user, gate } as const;
}

/**
 * Staff gate for every internal (`_protected`) loader and action. Requires a
 * valid session AND an active internal staff record, then checks the
 * `app.access` action through the authorization seam. Unknown Supabase users
 * are signed out and sent to login; they are never auto-provisioned.
 */
export async function requireStaff(request: Request) {
  const { supabase, headers, user, gate } = await resolveStaffSession(request);

  if (!user || !gate) {
    // Preserve the current URL for redirect after login, but validate it
    const url = new URL(request.url);
    const redirectTo = url.pathname + url.search;
    throw redirect(`/login?next=${encodeURIComponent(redirectTo)}`, { headers });
  }

  if (!gate.ok) {
    await supabase.auth.signOut();
    throw redirect(
      `/login?error=${encodeURIComponent(STAFF_GATE_MESSAGES[gate.reason])}`,
      { headers },
    );
  }

  const { actor } = gate;
  assertAuthorized(actor, "app.access");

  // Build userDetails from Supabase auth metadata
  const userDetails = {
    id: user.id,
    email: user.email || "",
    name: user.user_metadata?.name || null,
    role: actor.role,
    createdAt: new Date(user.created_at),
  };

  return { user, userDetails, actor, supabase, headers };
}

/** @deprecated Every caller is an internal route; prefer {@link requireStaff}. */
export const requireAuth = requireStaff;

export async function getOptionalAuth(request: Request) {
  const { supabase, headers, user, gate } = await resolveStaffSession(request);

  if (!user || !gate) {
    return { user: null, userDetails: null, supabase, headers };
  }

  if (!gate.ok) {
    await supabase.auth.signOut();
    return { user: null, userDetails: null, supabase, headers };
  }

  const userDetails = {
    id: user.id,
    email: user.email || "",
    name: user.user_metadata?.name || null,
    role: gate.actor.role,
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
