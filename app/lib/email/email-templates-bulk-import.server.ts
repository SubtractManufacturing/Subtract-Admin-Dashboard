import { and, eq } from "drizzle-orm";
import { db } from "~/lib/db";
import {
  emailIdentities,
  emailTemplates,
} from "~/lib/db/schema";
import {
  isEmailContextKey,
  type EmailContextKey,
} from "~/lib/email/email-context-registry";
import {
  isRegisteredEmailLayoutSlug,
  isSelectableEmailLayoutSlug,
  parseBodyCopyForLayout,
} from "~/emails/registry";

const SLUG_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

export type EmailTemplatesImportPayload = {
  schemaVersion?: number;
  exportedAt?: string;
  templates: unknown;
};

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

export type ImportEmailTemplatesResult =
  | { ok: true; importedCount: number }
  | { ok: false; error: string; status?: number };

/**
 * Validates and applies bulk template import (upsert by slug).
 */
export async function importEmailTemplatesFromPayload(
  payload: EmailTemplatesImportPayload,
  opts: {
    updatedBy: string;
    exampleEmailLayoutsEnabled: boolean;
  },
): Promise<ImportEmailTemplatesResult> {
  const version = payload.schemaVersion ?? 1;
  if (version !== 1) {
    return {
      ok: false,
      error: `Unsupported schemaVersion (expected 1, got ${String(version)}).`,
    };
  }

  if (!Array.isArray(payload.templates)) {
    return { ok: false, error: "Import file must include a templates array." };
  }

  const rows = payload.templates;
  if (rows.length === 0) {
    return { ok: true, importedCount: 0 };
  }

  const seenSlugs = new Set<string>();
  type ParsedRow = {
    slug: string;
    name: string;
    layoutSlug: string;
    contextKey: EmailContextKey | null;
    subjectTemplate: string;
    bodyCopy: Record<string, unknown>;
    emailIdentityId: number;
  };
  const parsed: ParsedRow[] = [];

  const [identityRows, allTemplateRows] = await Promise.all([
    db
      .select()
      .from(emailIdentities)
      .where(eq(emailIdentities.isArchived, false)),
    db
      .select({
        id: emailTemplates.id,
        slug: emailTemplates.slug,
        layoutSlug: emailTemplates.layoutSlug,
        contextKey: emailTemplates.contextKey,
        isArchived: emailTemplates.isArchived,
      })
      .from(emailTemplates),
  ]);

  const identityByEmail = new Map(
    identityRows.map((i) => [i.fromEmail.trim().toLowerCase(), i]),
  );
  /** Includes archived rows — slug is globally unique, so INSERT would fail if we ignored archived. */
  const rowBySlug = new Map(
    allTemplateRows.map((r) => [r.slug.trim().toLowerCase(), r]),
  );
  const activeRows = allTemplateRows.filter((r) => !r.isArchived);

  for (let i = 0; i < rows.length; i++) {
    const row = rows[i];
    if (!isPlainObject(row)) {
      return {
        ok: false,
        error: `Invalid template at index ${i}: expected an object.`,
      };
    }

    const slugRaw = row.slug;
    const nameRaw = row.name;
    const layoutSlugRaw = row.layoutSlug;
    const subjectRaw = row.subjectTemplate;
    const fromEmailRaw = row.fromEmail;
    const bodyCopyRaw = row.bodyCopy;
    const contextRaw = row.contextKey;

    if (typeof slugRaw !== "string" || typeof nameRaw !== "string") {
      return {
        ok: false,
        error: `Template at index ${i}: slug and name must be strings.`,
      };
    }

    const slug = slugRaw.trim().toLowerCase();
    if (!slug || !SLUG_RE.test(slug)) {
      return {
        ok: false,
        error: `Template "${slugRaw.trim() || "(empty)"}": invalid slug (use lowercase letters, numbers, and hyphens).`,
      };
    }

    if (seenSlugs.has(slug)) {
      return {
        ok: false,
        error: `Duplicate slug in import file: "${slug}".`,
      };
    }
    seenSlugs.add(slug);

    const name = nameRaw.trim();
    const subjectTemplate =
      typeof subjectRaw === "string" ? subjectRaw.trim() : "";
    if (!name || !subjectTemplate) {
      return {
        ok: false,
        error: `Template "${slug}": name and subjectTemplate are required.`,
      };
    }

    if (typeof layoutSlugRaw !== "string" || !layoutSlugRaw.trim()) {
      return {
        ok: false,
        error: `Template "${slug}": layoutSlug is required.`,
      };
    }
    const layoutSlug = layoutSlugRaw.trim();

    let contextKey: EmailContextKey | null = null;
    if (contextRaw !== undefined && contextRaw !== null) {
      if (typeof contextRaw !== "string") {
        return {
          ok: false,
          error: `Template "${slug}": contextKey must be a string or null.`,
        };
      }
      const trimmedCk = contextRaw.trim();
      if (trimmedCk) {
        if (!isEmailContextKey(trimmedCk)) {
          return {
            ok: false,
            error: `Template "${slug}": invalid context key.`,
          };
        }
        contextKey = trimmedCk;
      }
    }

    if (!isRegisteredEmailLayoutSlug(layoutSlug)) {
      return {
        ok: false,
        error: `Template "${slug}": unknown layout "${layoutSlug}".`,
      };
    }

    const existingRow = rowBySlug.get(slug);
    if (
      !isSelectableEmailLayoutSlug(
        layoutSlug,
        opts.exampleEmailLayoutsEnabled,
      ) &&
      (!existingRow || existingRow.layoutSlug !== layoutSlug)
    ) {
      return {
        ok: false,
        error: existingRow
          ? `Template "${slug}": layout "${layoutSlug}" is not available for this template.`
          : `Template "${slug}": layout "${layoutSlug}" is not available.`,
      };
    }

    if (typeof fromEmailRaw !== "string" || !fromEmailRaw.trim()) {
      return {
        ok: false,
        error: `Template "${slug}": fromEmail is required.`,
      };
    }
    const identity = identityByEmail.get(fromEmailRaw.trim().toLowerCase());
    if (!identity) {
      return {
        ok: false,
        error: `Template "${slug}": no active sender identity matches "${fromEmailRaw.trim()}".`,
      };
    }

    if (!isPlainObject(bodyCopyRaw)) {
      return {
        ok: false,
        error: `Template "${slug}": bodyCopy must be an object.`,
      };
    }

    const bodyParsed = parseBodyCopyForLayout(layoutSlug, bodyCopyRaw);
    if (!bodyParsed.ok) {
      const mergedErrors = { ...bodyParsed.errors };
      const message =
        mergedErrors._root ??
        Object.values(mergedErrors)[0] ??
        "Invalid template body fields.";
      return {
        ok: false,
        error: `Template "${slug}": ${message}`,
      };
    }

    parsed.push({
      slug,
      name,
      layoutSlug,
      contextKey,
      subjectTemplate,
      bodyCopy: bodyParsed.data as Record<string, unknown>,
      emailIdentityId: identity.id,
    });
  }

  const plannedContextBySlug = new Map<string, string | null>();
  for (const r of activeRows) {
    const ck = r.contextKey;
    plannedContextBySlug.set(
      r.slug.trim().toLowerCase(),
      ck && isEmailContextKey(ck) ? ck : null,
    );
  }
  for (const p of parsed) {
    plannedContextBySlug.set(p.slug, p.contextKey);
  }

  const contextKeyUsers = new Map<string, string>();
  for (const [s, ck] of plannedContextBySlug) {
    if (ck === null) continue;
    const other = contextKeyUsers.get(ck);
    if (other !== undefined && other !== s) {
      return {
        ok: false,
        error: `Context "${ck}" would be assigned to more than one template ("${other}" and "${s}").`,
      };
    }
    contextKeyUsers.set(ck, s);
  }

  parsed.sort((a, b) => a.slug.localeCompare(b.slug));

  try {
    await db.transaction(async (tx) => {
      for (const p of parsed) {
        const row = rowBySlug.get(p.slug);
        if (row && !row.isArchived) {
          await tx
            .update(emailTemplates)
            .set({
              name: p.name,
              layoutSlug: p.layoutSlug,
              contextKey: p.contextKey,
              emailIdentityId: p.emailIdentityId,
              subjectTemplate: p.subjectTemplate,
              bodyCopy: p.bodyCopy,
              updatedAt: new Date(),
              updatedBy: opts.updatedBy,
            })
            .where(
              and(
                eq(emailTemplates.id, row.id),
                eq(emailTemplates.isArchived, false),
              ),
            );
        } else if (row && row.isArchived) {
          await tx
            .update(emailTemplates)
            .set({
              name: p.name,
              layoutSlug: p.layoutSlug,
              contextKey: p.contextKey,
              emailIdentityId: p.emailIdentityId,
              subjectTemplate: p.subjectTemplate,
              bodyCopy: p.bodyCopy,
              isArchived: false,
              updatedAt: new Date(),
              updatedBy: opts.updatedBy,
            })
            .where(eq(emailTemplates.id, row.id));
        } else {
          await tx.insert(emailTemplates).values({
            slug: p.slug,
            name: p.name,
            layoutSlug: p.layoutSlug,
            contextKey: p.contextKey,
            emailIdentityId: p.emailIdentityId,
            subjectTemplate: p.subjectTemplate,
            bodyCopy: p.bodyCopy,
            updatedBy: opts.updatedBy,
          });
        }
      }
    });
  } catch (error) {
    const dbError = error as { code?: string };
    if (dbError.code === "23505") {
      return {
        ok: false,
        error:
          "Import failed: slug or context key conflict with existing data.",
      };
    }
    throw error;
  }

  return { ok: true, importedCount: parsed.length };
}

export function parseEmailTemplatesImportJson(
  text: string,
):
  | { ok: true; payload: EmailTemplatesImportPayload }
  | { ok: false; error: string } {
  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch {
    return { ok: false, error: "File is not valid JSON." };
  }
  if (!isPlainObject(data)) {
    return { ok: false, error: "Import file must be a JSON object." };
  }
  return {
    ok: true,
    payload: data as EmailTemplatesImportPayload,
  };
}
