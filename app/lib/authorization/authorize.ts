/**
 * Authorization seam: `authorize(actor, action, resource?)`.
 *
 * Interface: pure and synchronous, deny-by-default. An action must be in the
 * registry, the actor must be one the policy knows, and (when given) the
 * resource must be the type the action targets. Anything else is a denial with
 * a machine-readable reason.
 *
 * Today the policy is backed by the three global staff roles. Later phases
 * (permission registry, groups, relationship checks) replace the body of
 * {@link authorize} without changing its callers.
 */
import type { UserRole } from "~/lib/db/schema";

export type Actor =
  | {
      kind: "staff";
      userId: string;
      email: string;
      name: string | null;
      role: UserRole;
    }
  /**
   * Placeholder for portal users. No external account exists yet, so nothing
   * grants an external actor anything; it is here to keep the model honest.
   */
  | { kind: "external"; userId: string };

export type ResourceType = "attachment" | "part" | "quote-part" | "quote";

export type Resource = { type: ResourceType; id?: string | number };

const ALL_STAFF: readonly UserRole[] = ["User", "Admin", "Dev"];
const ELEVATED_STAFF: readonly UserRole[] = ["Admin", "Dev"];

type ActionPolicy = {
  /** Global staff roles that may perform the action. */
  roles: readonly UserRole[];
  /** When present, any resource supplied must be of this type. */
  resourceType?: ResourceType;
};

const POLICY = {
  "app.access": { roles: ALL_STAFF },
  "download.attachment": { roles: ALL_STAFF, resourceType: "attachment" },
  "download.part": { roles: ALL_STAFF, resourceType: "part" },
  "download.quote-part": { roles: ALL_STAFF, resourceType: "quote-part" },
  "download.quote": { roles: ALL_STAFF, resourceType: "quote" },
  "download.mesh": { roles: ALL_STAFF, resourceType: "part" },
  "export.customers": { roles: ELEVATED_STAFF },
  "export.vendors": { roles: ELEVATED_STAFF },
} as const satisfies Record<string, ActionPolicy>;

export type Action = keyof typeof POLICY;

export const ACTIONS = Object.keys(POLICY) as Action[];

export type DenyReason =
  | "unknown_action"
  | "not_staff"
  | "role_not_permitted"
  | "resource_mismatch";

export type Decision = { allowed: true } | { allowed: false; reason: DenyReason };

const deny = (reason: DenyReason): Decision => ({ allowed: false, reason });

/**
 * `resource` is optional: omit it for a capability-only check ("may this actor
 * ever do X?"). When supplied it must be the type the action targets. Checks
 * that depend on the specific resource (ownership, assignment) arrive with the
 * relationship-aware engine and will read `resource.id`.
 */
export function authorize(
  actor: Actor,
  action: Action,
  resource?: Resource,
): Decision {
  if (!Object.prototype.hasOwnProperty.call(POLICY, action)) {
    return deny("unknown_action");
  }
  const policy: ActionPolicy = POLICY[action];

  if (actor?.kind !== "staff") return deny("not_staff");
  if (!policy.roles.includes(actor.role)) return deny("role_not_permitted");

  if (resource && resource.type !== policy.resourceType) {
    return deny("resource_mismatch");
  }

  return { allowed: true };
}

/** Throws a 403 `Response` (Remix convention) when the decision is a denial. */
export function assertAuthorized(
  actor: Actor,
  action: Action,
  resource?: Resource,
): void {
  const decision = authorize(actor, action, resource);
  if (!decision.allowed) {
    throw new Response("Forbidden", { status: 403 });
  }
}
