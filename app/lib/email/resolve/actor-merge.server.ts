import type { EmailEnqueueAuth } from "~/lib/email/handlers/quote-send-email.server";

/** Derive a readable name from email local-part when profile name is absent. */
function displayNameFallbackFromEmail(email: string): string {
  const local = email.includes("@") ? email.split("@")[0]!.trim() : email.trim();
  if (!local) {
    return "User";
  }
  return local.replace(/[._+-]+/g, " ").replace(/\s+/g, " ").trim() || "User";
}

export type ActorMergeSource = {
  email: string;
  /** Profile display name, if any */
  name: string | null | undefined;
};

/**
 * Resolved {{userName}} / {{userEmail}} for outbound email and UI interpolation.
 * `userName` is the staff sender, never the customer.
 */
export function buildActorMergeMap(source: ActorMergeSource): Record<string, string> {
  const email = source.email.trim();
  const trimmedName = source.name?.trim();
  const userEmail = email || "-";
  const userName =
    trimmedName ||
    (email ? displayNameFallbackFromEmail(email) : "User");

  return { userName, userEmail };
}

export function resolveActorMergeTokens(
  auth: EmailEnqueueAuth,
): Record<string, string> {
  const email =
    auth.userDetails.email?.trim() || auth.user.email?.trim() || "";
  return buildActorMergeMap({ email, name: auth.userDetails.name });
}
