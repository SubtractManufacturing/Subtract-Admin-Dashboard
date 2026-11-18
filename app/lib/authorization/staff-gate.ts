/**
 * Staff gate: decides whether an authenticated Supabase identity is internal
 * staff. A Supabase session alone proves identity, not application access;
 * staff status requires an explicit, active `public.users` row.
 */
import type { User, UserRole } from "~/lib/db/schema";
import type { Actor } from "./authorize";

export type StaffRecord = {
  role: User["role"];
  status: User["status"];
  isArchived: boolean;
};

export type StaffGateDeps = {
  /**
   * Refreshes email/name on an existing user row (activating a pending
   * invite) and returns it. Returns null when no row exists. Must never
   * create one.
   */
  syncStaffUser: (
    userId: string,
    email: string,
    name: string | null,
  ) => Promise<StaffRecord | null>;
};

export type StaffGateDenial = "not_provisioned" | "disabled" | "archived";

export type StaffGateResult =
  | { ok: true; actor: Extract<Actor, { kind: "staff" }> }
  | { ok: false; reason: StaffGateDenial };

export type AuthIdentity = {
  id: string;
  email?: string | null;
  name?: string | null;
};

const STAFF_ROLES: readonly UserRole[] = ["User", "Admin", "Dev"];

export async function resolveStaffActor(
  identity: AuthIdentity,
  deps: StaffGateDeps,
): Promise<StaffGateResult> {
  const email = identity.email ?? "";
  const name = identity.name ?? null;

  const record = await deps.syncStaffUser(identity.id, email, name);
  if (!record) return { ok: false, reason: "not_provisioned" };
  if (record.isArchived) return { ok: false, reason: "archived" };
  if (record.status === "disabled") return { ok: false, reason: "disabled" };
  if (record.status !== "active") return { ok: false, reason: "not_provisioned" };
  if (!STAFF_ROLES.includes(record.role)) {
    return { ok: false, reason: "not_provisioned" };
  }

  return {
    ok: true,
    actor: {
      kind: "staff",
      userId: identity.id,
      email,
      name,
      role: record.role,
    },
  };
}
