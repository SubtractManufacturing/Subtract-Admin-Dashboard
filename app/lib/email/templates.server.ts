import { db } from "../db";
import {
  emailSettings,
  emailIdentities,
  emailTemplates,
} from "../db/schema";
import { eq, and } from "drizzle-orm";
import {
  isRegisteredEmailLayoutSlug,
  type TemplateSlug,
} from "~/emails/registry";
import type { EmailContextKey } from "./email-context-registry";

export async function getEmailSettings() {
  const settings = await db.select().from(emailSettings);
  const map = new Map<string, string>();
  for (const s of settings) {
    if (s.value !== null) {
      map.set(s.key, s.value);
    }
  }
  return {
    outboundDelayMinutes: parseInt(map.get("outbound_delay_minutes") || "0", 10) || 0,
    recipientOverride: map.get("recipient_override") || null,
    defaultSignature: map.get("default_signature") || "",
    defaultFooter: map.get("default_footer") || "",
  };
}

export type ResolvedEmailTemplate = {
  template: typeof emailTemplates.$inferSelect;
  identity: typeof emailIdentities.$inferSelect;
  layoutSlug: TemplateSlug;
};

/**
 * Resolve which DB template + identity to use for an app context.
 * email_templates(context_key) -> email_identities
 */
export async function resolveEmailTemplateForContext(
  contextKey: EmailContextKey
): Promise<ResolvedEmailTemplate | null> {
  const [row] = await db
    .select({
      template: emailTemplates,
      identity: emailIdentities,
    })
    .from(emailTemplates)
    .innerJoin(
      emailIdentities,
      eq(emailTemplates.emailIdentityId, emailIdentities.id)
    )
    .where(
      and(
        eq(emailTemplates.contextKey, contextKey),
        eq(emailTemplates.isArchived, false),
        eq(emailIdentities.isArchived, false)
      )
    )
    .limit(1);

  if (!row) return null;

  const layoutSlug = row.template.layoutSlug;
  if (!isRegisteredEmailLayoutSlug(layoutSlug)) {
    console.error(
      `[email] Template ${row.template.slug} has unknown layout_slug: ${layoutSlug}`
    );
    return null;
  }

  return {
    template: row.template,
    identity: row.identity,
    layoutSlug,
  };
}

export async function findConflictingTemplateForContextKey(
  contextKey: EmailContextKey,
  excludeTemplateId?: number
): Promise<{ id: number; name: string; slug: string } | null> {
  const rows = await db
    .select({
      id: emailTemplates.id,
      name: emailTemplates.name,
      slug: emailTemplates.slug,
    })
    .from(emailTemplates)
    .where(
      and(
        eq(emailTemplates.contextKey, contextKey),
        eq(emailTemplates.isArchived, false)
      )
    )
    .limit(5);

  const conflict = rows.find((r) => r.id !== excludeTemplateId);
  return conflict ?? null;
}

/** Lookup by unique template slug (admin / legacy) */
export async function getEmailTemplateWithIdentity(slug: string) {
  const [row] = await db
    .select({
      template: emailTemplates,
      identity: emailIdentities,
    })
    .from(emailTemplates)
    .innerJoin(emailIdentities, eq(emailTemplates.emailIdentityId, emailIdentities.id))
    .where(
      and(eq(emailTemplates.slug, slug), eq(emailTemplates.isArchived, false))
    )
    .limit(1);

  return row || null;
}
