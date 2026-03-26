import { useEffect, useState } from "react";
import {
  json,
  redirect,
  type ActionFunctionArgs,
  type LoaderFunctionArgs,
} from "@remix-run/node";
import { useFetcher, useLoaderData, useRevalidator } from "@remix-run/react";
import { and, desc, eq } from "drizzle-orm";
import { matchSorter } from "match-sorter";
import Button from "~/components/admin/Button";
import AdminPageHeader from "~/components/admin/PageHeader";
import { IconButton } from "~/components/shared/IconButton";
import Modal from "~/components/shared/Modal";
import { requireAuth, withAuthHeaders } from "~/lib/auth.server";
import { db } from "~/lib/db";
import {
  emailIdentities,
  emailSettings,
  emailTemplates,
  type EmailIdentity,
  type EmailTemplate,
} from "~/lib/db/schema";
import { DEFAULT_QUOTE_SEND_BODY_COPY } from "~/lib/email/default-quote-email-copy";
import {
  EMAIL_CONTEXTS,
  isEmailContextKey,
  type EmailContextKey,
} from "~/lib/email/email-context-registry";
import {
  getAllowedEmailDomains,
  isEmailDomainAllowed,
} from "~/lib/email/email-domains.server";
import { findConflictingTemplateForContextKey } from "~/lib/email/templates.server";
import { isOutboundEmailEnabled } from "~/lib/featureFlags";
import {
  isRegisteredEmailLayoutSlug,
  REGISTERED_EMAIL_LAYOUT_SLUGS,
} from "~/emails/registry";

const SLUG_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

type EmailSnippetRow = { key: string; value: string };

/** Snippet keys cannot use reserved operational setting names. */
const RESERVED_SNIPPET_KEYS = new Set([
  "outbound_delay_minutes",
  "recipient_override",
]);

/** Shown as non-blocking UI hint — per-send context overrides snippets with the same key. */
const SNIPPET_CONTEXT_COLLISION_KEYS = new Set([
  "quoteNumber",
  "customerName",
  "total",
  "paymentLinkUrl",
]);

const SNIPPET_KEY_RE = /^[a-zA-Z]\w*$/;

function textHasExactSnippetPlaceholder(text: string, key: string): boolean {
  return new RegExp(`\\{\\{${key}\\}\\}`).test(text);
}

function templatesReferencingSnippetKey(
  templateList: EmailTemplate[],
  key: string,
): EmailTemplate[] {
  return templateList.filter((t) => {
    if (textHasExactSnippetPlaceholder(t.subjectTemplate, key)) return true;
    const copy = t.bodyCopy as Record<string, unknown>;
    for (const v of Object.values(copy)) {
      if (typeof v === "string" && textHasExactSnippetPlaceholder(v, key))
        return true;
    }
    return false;
  });
}

function parseBodyCopyJson(raw: string): Record<string, string> | null {
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      return null;
    }
    const result: Record<string, string> = {};
    for (const [key, value] of Object.entries(
      parsed as Record<string, unknown>,
    )) {
      if (typeof value === "string") result[key] = value;
    }
    return result;
  } catch {
    return null;
  }
}

function normalizeContextKey(
  raw: FormDataEntryValue | null,
): EmailContextKey | null {
  const value = (raw as string | null)?.trim() ?? "";
  if (!value) return null;
  return isEmailContextKey(value) ? value : null;
}

function contextConflictMessage(conflict: { name: string; slug: string }) {
  return `This context is already assigned to "${conflict.name}" (${conflict.slug}). Remove it there first, or choose None.`;
}

export async function loader({ request }: LoaderFunctionArgs) {
  const { userDetails, headers } = await requireAuth(request);
  if (userDetails.role !== "Admin" && userDetails.role !== "Dev") {
    return withAuthHeaders(redirect("/"), headers);
  }

  if (!(await isOutboundEmailEnabled())) {
    return withAuthHeaders(redirect("/admin"), headers);
  }

  const [settingsRows, snippetsRows, identities, templates] =
    await Promise.all([
      db
        .select()
        .from(emailSettings)
        .where(eq(emailSettings.kind, "operational")),
      db
        .select()
        .from(emailSettings)
        .where(eq(emailSettings.kind, "merge")),
      db.select().from(emailIdentities).orderBy(desc(emailIdentities.id)),
      db
        .select()
        .from(emailTemplates)
        .where(eq(emailTemplates.isArchived, false)),
    ]);

  const settingsMap = new Map<string, string>();
  for (const row of settingsRows) {
    if (row.value !== null) settingsMap.set(row.key, row.value);
  }

  const snippets: EmailSnippetRow[] = snippetsRows.map((row) => ({
    key: row.key,
    value: row.value ?? "",
  }));

  return withAuthHeaders(
    json({
      settings: {
        outboundDelayMinutes: settingsMap.get("outbound_delay_minutes") || "0",
        recipientOverride: settingsMap.get("recipient_override") || "",
      },
      snippets,
      identities,
      templates,
      allowedDomains: getAllowedEmailDomains(),
    }),
    headers,
  );
}

export async function action({ request }: ActionFunctionArgs) {
  const { userDetails, headers } = await requireAuth(request);
  if (userDetails.role !== "Admin" && userDetails.role !== "Dev") {
    return withAuthHeaders(redirect("/"), headers);
  }
  if (!(await isOutboundEmailEnabled())) {
    return withAuthHeaders(redirect("/admin"), headers);
  }

  const updatedBy = userDetails.email ?? userDetails.name ?? "admin";
  const formData = await request.formData();
  const intent = formData.get("intent");

  if (intent === "saveSettings") {
    const delay = parseInt(
      (formData.get("outboundDelayMinutes") as string) ?? "0",
      10,
    );
    if (isNaN(delay) || delay < 0 || delay > 1440) {
      return withAuthHeaders(
        json(
          { error: "Delay must be between 0 and 1440 minutes." },
          { status: 400 },
        ),
        headers,
      );
    }

    const updates = [
      { key: "outbound_delay_minutes", value: String(delay) },
      {
        key: "recipient_override",
        value: ((formData.get("recipientOverride") as string) ?? "").trim(),
      },
    ];

    await Promise.all(
      updates.map((u) =>
        db
          .insert(emailSettings)
          .values({
            key: u.key,
            value: u.value,
            updatedBy,
            kind: "operational",
          })
          .onConflictDoUpdate({
            target: emailSettings.key,
            set: {
              value: u.value,
              updatedAt: new Date(),
              updatedBy,
              kind: "operational",
            },
          }),
      ),
    );
    return withAuthHeaders(json({ success: true }), headers);
  }

  if (intent === "createSnippet") {
    const key = ((formData.get("key") as string) ?? "").trim();
    const value = (formData.get("value") as string) ?? "";
    if (!SNIPPET_KEY_RE.test(key)) {
      return withAuthHeaders(
        json(
          {
            error:
              "Snippet name must start with a letter and contain only letters, numbers, or underscores.",
          },
          { status: 400 },
        ),
        headers,
      );
    }
    if (RESERVED_SNIPPET_KEYS.has(key)) {
      return withAuthHeaders(
        json({ error: "That snippet name is reserved." }, { status: 400 }),
        headers,
      );
    }
    try {
      await db.insert(emailSettings).values({
        key,
        value,
        updatedBy,
        kind: "merge",
      });
    } catch (err: unknown) {
      const code = (err as { code?: string }).code;
      if (code === "23505") {
        return withAuthHeaders(
          json(
            { error: "A snippet with this name already exists." },
            { status: 400 },
          ),
          headers,
        );
      }
      throw err;
    }
    return withAuthHeaders(json({ success: true }), headers);
  }

  if (intent === "updateSnippet") {
    const key = ((formData.get("key") as string) ?? "").trim();
    const value = (formData.get("value") as string) ?? "";
    if (!key) {
      return withAuthHeaders(
        json({ error: "Snippet name is required." }, { status: 400 }),
        headers,
      );
    }
    const updated = await db
      .update(emailSettings)
      .set({ value, updatedAt: new Date(), updatedBy })
      .where(
        and(eq(emailSettings.key, key), eq(emailSettings.kind, "merge")),
      )
      .returning({ id: emailSettings.id });
    if (updated.length === 0) {
      return withAuthHeaders(
        json({ error: "Snippet not found." }, { status: 404 }),
        headers,
      );
    }
    return withAuthHeaders(json({ success: true }), headers);
  }

  if (intent === "deleteSnippet") {
    const key = ((formData.get("key") as string) ?? "").trim();
    if (!key) {
      return withAuthHeaders(
        json({ error: "Snippet name is required." }, { status: 400 }),
        headers,
      );
    }
    const activeTemplates = await db
      .select()
      .from(emailTemplates)
      .where(eq(emailTemplates.isArchived, false));
    const referenced = templatesReferencingSnippetKey(activeTemplates, key);
    if (referenced.length > 0) {
      return withAuthHeaders(
        json(
          {
            error: `Cannot delete. Still referenced in: ${referenced.map((t) => t.name).join(", ")}. Remove {{${key}}} from those templates first.`,
          },
          { status: 400 },
        ),
        headers,
      );
    }
    await db
      .delete(emailSettings)
      .where(
        and(eq(emailSettings.key, key), eq(emailSettings.kind, "merge")),
      );
    return withAuthHeaders(json({ success: true }), headers);
  }

  if (intent === "createIdentity" || intent === "updateIdentity") {
    const id =
      intent === "updateIdentity"
        ? parseInt(formData.get("id") as string, 10)
        : null;
    const fromEmail = (formData.get("fromEmail") as string)
      ?.trim()
      .toLowerCase();
    const fromDisplayName =
      ((formData.get("fromDisplayName") as string) ?? "").trim() || null;
    const replyToEmail =
      ((formData.get("replyToEmail") as string) ?? "").trim() || null;

    if (!fromEmail) {
      return withAuthHeaders(
        json({ error: "From email is required." }, { status: 400 }),
        headers,
      );
    }
    if (!isEmailDomainAllowed(fromEmail)) {
      return withAuthHeaders(
        json(
          { error: "From email domain must be in EMAIL_DOMAIN allowlist." },
          { status: 400 },
        ),
        headers,
      );
    }
    if (replyToEmail && !isEmailDomainAllowed(replyToEmail)) {
      return withAuthHeaders(
        json(
          { error: "Reply-To domain must be in EMAIL_DOMAIN allowlist." },
          { status: 400 },
        ),
        headers,
      );
    }

    if (intent === "createIdentity") {
      const setDefault = formData.get("setDefault") === "on";
      await db.transaction(async (tx) => {
        if (setDefault) {
          await tx
            .update(emailIdentities)
            .set({ isDefault: false, updatedAt: new Date(), updatedBy })
            .where(eq(emailIdentities.isArchived, false));
        }
        await tx.insert(emailIdentities).values({
          fromEmail,
          fromDisplayName,
          replyToEmail,
          isDefault: setDefault,
          updatedBy,
        });
      });
    } else {
      if (!id || isNaN(id)) {
        return withAuthHeaders(
          json({ error: "Invalid identity." }, { status: 400 }),
          headers,
        );
      }
      await db
        .update(emailIdentities)
        .set({
          fromEmail,
          fromDisplayName,
          replyToEmail,
          updatedAt: new Date(),
          updatedBy,
        })
        .where(
          and(
            eq(emailIdentities.id, id),
            eq(emailIdentities.isArchived, false),
          ),
        );
    }
    return withAuthHeaders(json({ success: true }), headers);
  }

  if (intent === "setDefaultIdentity") {
    const id = parseInt(formData.get("id") as string, 10);
    if (isNaN(id)) {
      return withAuthHeaders(
        json({ error: "Invalid identity." }, { status: 400 }),
        headers,
      );
    }

    await db.transaction(async (tx) => {
      await tx
        .update(emailIdentities)
        .set({ isDefault: false, updatedAt: new Date(), updatedBy })
        .where(eq(emailIdentities.isArchived, false));
      await tx
        .update(emailIdentities)
        .set({ isDefault: true, updatedAt: new Date(), updatedBy })
        .where(
          and(
            eq(emailIdentities.id, id),
            eq(emailIdentities.isArchived, false),
          ),
        );
    });
    return withAuthHeaders(json({ success: true }), headers);
  }

  if (intent === "archiveIdentity") {
    const id = parseInt(formData.get("id") as string, 10);
    if (isNaN(id)) {
      return withAuthHeaders(
        json({ error: "Invalid identity." }, { status: 400 }),
        headers,
      );
    }

    const [inUse] = await db
      .select({ id: emailTemplates.id })
      .from(emailTemplates)
      .where(
        and(
          eq(emailTemplates.emailIdentityId, id),
          eq(emailTemplates.isArchived, false),
        ),
      )
      .limit(1);
    if (inUse) {
      return withAuthHeaders(
        json(
          {
            error:
              "Cannot archive this identity because active templates use it.",
          },
          { status: 400 },
        ),
        headers,
      );
    }

    await db
      .update(emailIdentities)
      .set({
        isArchived: true,
        isDefault: false,
        updatedAt: new Date(),
        updatedBy,
      })
      .where(eq(emailIdentities.id, id));
    return withAuthHeaders(json({ success: true }), headers);
  }

  if (intent === "createTemplate" || intent === "updateTemplate") {
    const id =
      intent === "updateTemplate"
        ? parseInt(formData.get("id") as string, 10)
        : null;
    const name = (formData.get("name") as string)?.trim();
    let slug = (formData.get("slug") as string)?.trim().toLowerCase();
    const layoutSlug = (formData.get("layoutSlug") as string)?.trim();
    const contextKeyRaw = formData.get("contextKey");
    const contextKey = normalizeContextKey(contextKeyRaw);
    const emailIdentityId = parseInt(
      formData.get("emailIdentityId") as string,
      10,
    );
    const subjectTemplate = (formData.get("subjectTemplate") as string)?.trim();
    const bodyCopyRaw = (formData.get("bodyCopyJson") as string) ?? "";

    if (intent === "createTemplate" && !slug && name) {
      slug = name
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, "-")
        .replace(/^-+|-+$/g, "");
    }

    if ((contextKeyRaw as string)?.trim() && !contextKey) {
      return withAuthHeaders(
        json({ error: "Invalid context key." }, { status: 400 }),
        headers,
      );
    }
    if (!name || !subjectTemplate) {
      return withAuthHeaders(
        json(
          { error: "Template name and subject are required." },
          { status: 400 },
        ),
        headers,
      );
    }
    if (!isRegisteredEmailLayoutSlug(layoutSlug)) {
      return withAuthHeaders(
        json({ error: "Invalid layout slug." }, { status: 400 }),
        headers,
      );
    }
    if (isNaN(emailIdentityId)) {
      return withAuthHeaders(
        json({ error: "Select a sender identity." }, { status: 400 }),
        headers,
      );
    }

    if (intent === "createTemplate") {
      if (!slug || !SLUG_RE.test(slug)) {
        return withAuthHeaders(
          json(
            {
              error:
                "Template name must contain at least one letter or number.",
            },
            { status: 400 },
          ),
          headers,
        );
      }
    } else if (!id || isNaN(id)) {
      return withAuthHeaders(
        json({ error: "Invalid template." }, { status: 400 }),
        headers,
      );
    }

    if (contextKey) {
      const conflict = await findConflictingTemplateForContextKey(
        contextKey,
        id ?? undefined,
      );
      if (conflict) {
        return withAuthHeaders(
          json({ error: contextConflictMessage(conflict) }, { status: 400 }),
          headers,
        );
      }
    }

    const [identity] = await db
      .select()
      .from(emailIdentities)
      .where(
        and(
          eq(emailIdentities.id, emailIdentityId),
          eq(emailIdentities.isArchived, false),
        ),
      )
      .limit(1);
    if (!identity) {
      return withAuthHeaders(
        json(
          { error: "Selected sender identity is invalid." },
          { status: 400 },
        ),
        headers,
      );
    }

    const bodyCopy =
      parseBodyCopyJson(bodyCopyRaw) ??
      (layoutSlug === "quote-send"
        ? { ...DEFAULT_QUOTE_SEND_BODY_COPY }
        : null);
    if (!bodyCopy || Object.keys(bodyCopy).length === 0) {
      return withAuthHeaders(
        json(
          {
            error:
              "Body copy must be a non-empty JSON object with string values.",
          },
          { status: 400 },
        ),
        headers,
      );
    }

    try {
      if (intent === "createTemplate") {
        await db.insert(emailTemplates).values({
          slug: slug!,
          name,
          layoutSlug,
          contextKey,
          emailIdentityId,
          subjectTemplate,
          bodyCopy,
          updatedBy,
        });
      } else {
        await db
          .update(emailTemplates)
          .set({
            name,
            layoutSlug,
            contextKey,
            emailIdentityId,
            subjectTemplate,
            bodyCopy,
            updatedAt: new Date(),
            updatedBy,
          })
          .where(
            and(
              eq(emailTemplates.id, id!),
              eq(emailTemplates.isArchived, false),
            ),
          );
      }
    } catch (error) {
      const dbError = error as { code?: string };
      if (dbError.code === "23505") {
        return withAuthHeaders(
          json(
            { error: "Slug or context key already exists." },
            { status: 400 },
          ),
          headers,
        );
      }
      throw error;
    }
    return withAuthHeaders(json({ success: true }), headers);
  }

  if (intent === "archiveTemplate") {
    const id = parseInt(formData.get("id") as string, 10);
    if (isNaN(id)) {
      return withAuthHeaders(
        json({ error: "Invalid template." }, { status: 400 }),
        headers,
      );
    }

    await db
      .update(emailTemplates)
      .set({
        isArchived: true,
        contextKey: null,
        updatedAt: new Date(),
        updatedBy,
      })
      .where(eq(emailTemplates.id, id));
    return withAuthHeaders(json({ success: true }), headers);
  }

  return withAuthHeaders(
    json({ error: "Invalid action." }, { status: 400 }),
    headers,
  );
}

export default function AdminEmail() {
  const { settings, snippets, identities, templates, allowedDomains } =
    useLoaderData<typeof loader>();
  const fetcher = useFetcher<{ success?: boolean; error?: string }>();
  const revalidator = useRevalidator();
  const isSaving = fetcher.state !== "idle";

  const [templateSearch, setTemplateSearch] = useState("");
  const [identityModalOpen, setIdentityModalOpen] = useState(false);
  const [editingIdentity, setEditingIdentity] = useState<EmailIdentity | null>(
    null,
  );
  const [snippetModalOpen, setSnippetModalOpen] = useState(false);
  const [editingSnippet, setEditingSnippet] = useState<{
    key: string;
    value: string;
  } | null>(null);
  const [templateModalOpen, setTemplateModalOpen] = useState(false);
  const [editingTemplate, setEditingTemplate] = useState<EmailTemplate | null>(
    null,
  );

  useEffect(() => {
    if (fetcher.state === "idle" && fetcher.data?.success) {
      revalidator.revalidate();
      setIdentityModalOpen(false);
      setEditingIdentity(null);
      setSnippetModalOpen(false);
      setEditingSnippet(null);
      setTemplateModalOpen(false);
      setEditingTemplate(null);
    }
  }, [fetcher.state, fetcher.data, revalidator]);

  const activeIdentities = identities.filter(
    (i: EmailIdentity) => !i.isArchived,
  );
  const filteredTemplates = templateSearch.trim()
    ? matchSorter(templates, templateSearch, {
        keys: ["name", "slug", "layoutSlug", "contextKey", "subjectTemplate"],
      })
    : templates;
  const defaultBodyCopyJson = JSON.stringify(
    DEFAULT_QUOTE_SEND_BODY_COPY,
    null,
    2,
  );

  const pencilIcon = (
    <svg
      className="w-[18px] h-[18px]"
      fill="none"
      stroke="currentColor"
      viewBox="0 0 24 24"
    >
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth={2}
        d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z"
      />
    </svg>
  );

  const trashIcon = (
    <svg
      className="w-[18px] h-[18px]"
      fill="none"
      stroke="currentColor"
      viewBox="0 0 24 24"
    >
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth={2}
        d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"
      />
    </svg>
  );

  const plusIcon = (
    <svg
      className="h-[18px] w-[18px]"
      fill="none"
      stroke="currentColor"
      viewBox="0 0 24 24"
      aria-hidden
    >
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth={2}
        d="M12 4v16m8-8H4"
      />
    </svg>
  );

  /** Distinct from primary app CTAs: outlined control for section “add” actions. */
  const addSectionIconButtonClass =
    "shrink-0 rounded-lg border border-gray-200 bg-white shadow-sm text-gray-700 hover:bg-gray-50 hover:border-gray-300 dark:border-slate-600 dark:bg-slate-900 dark:text-gray-200 dark:hover:bg-slate-800 dark:hover:border-slate-500";

  function handleArchiveIdentity(id: number) {
    if (!confirm("Are you sure you want to archive this sender identity?"))
      return;
    const formData = new FormData();
    formData.set("intent", "archiveIdentity");
    formData.set("id", String(id));
    fetcher.submit(formData, { method: "post" });
  }

  function handleSetDefault(id: number) {
    const formData = new FormData();
    formData.set("intent", "setDefaultIdentity");
    formData.set("id", String(id));
    fetcher.submit(formData, { method: "post" });
  }

  function handleArchiveTemplate(id: number) {
    if (!confirm("Are you sure you want to archive this template?")) return;
    const formData = new FormData();
    formData.set("intent", "archiveTemplate");
    formData.set("id", String(id));
    fetcher.submit(formData, { method: "post" });
  }

  const anyModalOpen =
    identityModalOpen || snippetModalOpen || templateModalOpen;

  function handleDeleteSnippet(key: string) {
    if (
      !confirm(
        `Delete snippet "${key}"? This cannot be undone if no templates reference {{${key}}}.`,
      )
    ) {
      return;
    }
    const formData = new FormData();
    formData.set("intent", "deleteSnippet");
    formData.set("key", key);
    fetcher.submit(formData, { method: "post" });
  }

  const inputClass =
    "w-full rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm text-gray-900 placeholder:text-gray-400 focus:border-gray-400 focus:outline-none focus:ring-1 focus:ring-gray-400 dark:border-slate-600 dark:bg-slate-900 dark:text-white dark:placeholder:text-gray-500 dark:focus:border-blue-500 dark:focus:ring-blue-500";

  const labelClass =
    "block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1.5";

  const helperClass = "mt-1 text-xs text-gray-400 dark:text-gray-500";

  const thClass =
    "px-4 py-3 text-xs font-semibold uppercase tracking-wider text-gray-500 dark:text-gray-400";

  const errorBanner = fetcher.data?.error ? (
    <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800 dark:border-red-900/50 dark:bg-red-950/40 dark:text-red-200">
      {fetcher.data.error}
    </div>
  ) : null;

  return (
    <div className="max-w-[1920px] mx-auto">
      <AdminPageHeader
        breadcrumbs={[{ label: "Admin", href: "/admin" }, { label: "Email" }]}
      />

      <div className="px-4 py-6 sm:px-6 lg:px-10 lg:py-8">
        <div className="mb-8">
          <h1 className="text-2xl font-semibold text-gray-900 dark:text-gray-100 transition-colors duration-150">
            Email Configuration
          </h1>
          <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">
            Configure global delivery settings, sender identities, and email
            templates.
          </p>
        </div>

        {!anyModalOpen && errorBanner && (
          <div className="mb-6">{errorBanner}</div>
        )}

        <div className="space-y-8">
          {/* ── Global Settings ── */}
          <div className="rounded-xl border border-gray-200 bg-white p-5 sm:p-6 dark:border-slate-700 dark:bg-slate-800">
            <div className="mb-5">
              <h2 className="text-lg font-semibold text-gray-900 dark:text-white">
                Global Settings
              </h2>
            </div>
            <fetcher.Form method="post" className="space-y-5">
              <input type="hidden" name="intent" value="saveSettings" />
              <div className="grid gap-5 sm:grid-cols-2">
                <div>
                  <label className={labelClass}>Outbound Delay (minutes)</label>
                  <input
                    type="number"
                    name="outboundDelayMinutes"
                    defaultValue={settings.outboundDelayMinutes}
                    min={0}
                    max={1440}
                    className={inputClass}
                  />
                  <p className={helperClass}>
                    Delay before emails are sent. 0 = immediate.
                  </p>
                </div>
                <div>
                  <label className={labelClass}>Recipient Override</label>
                  <input
                    type="email"
                    name="recipientOverride"
                    defaultValue={settings.recipientOverride}
                    placeholder="test@example.com"
                    className={inputClass}
                  />
                  <p className={helperClass}>
                    Routes all outbound email to this address instead. For
                    testing.
                  </p>
                </div>
              </div>
              <div className="flex justify-end border-t border-gray-200 pt-4 dark:border-gray-600">
                <Button type="submit" variant="primary" disabled={isSaving}>
                  {isSaving ? "Saving..." : "Save Settings"}
                </Button>
              </div>
            </fetcher.Form>
          </div>

          {/* ── Snippets (merge fields) ── */}
          <div className="rounded-xl border border-gray-200 bg-white p-5 sm:p-6 dark:border-slate-700 dark:bg-slate-800">
            <div className="mb-5 flex items-start justify-between gap-3">
              <div className="min-w-0 pr-2">
                <h2 className="text-lg font-semibold text-gray-900 dark:text-white">
                  Snippets
                </h2>
                <p className={helperClass}>
                  Short reusable pieces of text. Use{" "}
                  <code className="rounded bg-gray-100 px-1 text-xs dark:bg-slate-700">
                    {"{{snippetName}}"}
                  </code>{" "}
                  in any template subject or body.
                </p>
              </div>
              <IconButton
                type="button"
                icon={plusIcon}
                variant="default"
                className={addSectionIconButtonClass}
                title="Add snippet"
                aria-label="Add snippet"
                onClick={() => {
                  setEditingSnippet(null);
                  setSnippetModalOpen(true);
                }}
              />
            </div>

            {snippets.length === 0 ? (
              <p className="text-sm text-gray-500 dark:text-gray-400">
                No snippets yet. Add one for signatures, footers, or other
                reusable lines.
              </p>
            ) : (
              <div className="-mx-5 sm:-mx-6 overflow-x-auto">
                <table className="w-full text-left text-sm">
                  <thead>
                    <tr className="border-b border-gray-200 dark:border-gray-600">
                      <th className={`${thClass} pl-5 sm:pl-6`}>Name</th>
                      <th className={thClass}>Preview</th>
                      <th className={`${thClass} text-right pr-5 sm:pr-6`}>
                        Actions
                      </th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-100 dark:divide-gray-700">
                    {snippets.map((s: EmailSnippetRow) => (
                      <tr
                        key={s.key}
                        className="group transition-colors hover:bg-gray-50 dark:hover:bg-slate-700/40"
                      >
                        <td className="px-4 py-3 pl-5 sm:pl-6 font-mono text-sm font-medium text-gray-900 dark:text-gray-100">
                          {s.key}
                        </td>
                        <td className="max-w-md truncate px-4 py-3 text-gray-600 dark:text-gray-300">
                          {s.value || "(empty)"}
                        </td>
                        <td className="px-4 py-3 pr-5 sm:pr-6">
                          <div className="flex items-center justify-end gap-1">
                            <IconButton
                              icon={pencilIcon}
                              variant="default"
                              title="Edit snippet"
                              onClick={() => {
                                setEditingSnippet({
                                  key: s.key,
                                  value: s.value,
                                });
                                setSnippetModalOpen(true);
                              }}
                            />
                            <IconButton
                              icon={trashIcon}
                              variant="danger"
                              title="Delete snippet"
                              onClick={() => handleDeleteSnippet(s.key)}
                              disabled={isSaving}
                            />
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>

          {/* ── Sender Identities ── */}
          <div className="rounded-xl border border-gray-200 bg-white p-5 sm:p-6 dark:border-slate-700 dark:bg-slate-800">
            <div className="mb-5 flex items-start justify-between gap-3">
              <h2 className="min-w-0 pr-2 text-lg font-semibold text-gray-900 dark:text-white">
                Sender Identities
              </h2>
              <IconButton
                type="button"
                icon={plusIcon}
                variant="default"
                className={addSectionIconButtonClass}
                title="Add sender identity"
                aria-label="Add sender identity"
                onClick={() => {
                  setEditingIdentity(null);
                  setIdentityModalOpen(true);
                }}
              />
            </div>

            {allowedDomains.length > 0 && (
              <div className="mb-5 flex items-center gap-2 text-sm text-gray-500 dark:text-gray-400">
                <span className="font-medium">Allowed domains:</span>
                <div className="flex flex-wrap gap-1.5">
                  {allowedDomains.map((domain: string) => (
                    <span
                      key={domain}
                      className="inline-flex rounded-full bg-blue-50 px-2.5 py-0.5 text-xs font-medium text-blue-700 dark:bg-blue-900/30 dark:text-blue-300"
                    >
                      {domain}
                    </span>
                  ))}
                </div>
              </div>
            )}

            {activeIdentities.length === 0 ? (
              <div className="py-12 text-center">
                <p className="text-sm text-gray-500 dark:text-gray-400">
                  No sender identities configured yet.
                </p>
                <p className="mt-1 text-xs text-gray-400 dark:text-gray-500">
                  Add one to start sending emails.
                </p>
              </div>
            ) : (
              <div className="-mx-5 sm:-mx-6 overflow-x-auto">
                <table className="w-full text-left text-sm">
                  <thead>
                    <tr className="border-b border-gray-200 dark:border-gray-600">
                      <th className={`${thClass} pl-5 sm:pl-6`}>From Email</th>
                      <th className={thClass}>Display Name</th>
                      <th className={thClass}>Reply-To</th>
                      <th className={thClass}>Status</th>
                      <th className={`${thClass} text-right pr-5 sm:pr-6`}>
                        Actions
                      </th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-100 dark:divide-gray-700">
                    {activeIdentities.map((identity: EmailIdentity) => (
                      <tr
                        key={identity.id}
                        className="group transition-colors hover:bg-gray-50 dark:hover:bg-slate-700/40"
                      >
                        <td className="px-4 py-3 pl-5 sm:pl-6 font-medium text-gray-900 dark:text-gray-100">
                          {identity.fromEmail}
                        </td>
                        <td className="px-4 py-3 text-gray-600 dark:text-gray-300">
                          {identity.fromDisplayName || (
                            <span className="text-gray-300 dark:text-gray-600">
                              —
                            </span>
                          )}
                        </td>
                        <td className="px-4 py-3 text-gray-600 dark:text-gray-300">
                          {identity.replyToEmail || (
                            <span className="text-gray-300 dark:text-gray-600">
                              —
                            </span>
                          )}
                        </td>
                        <td className="px-4 py-3">
                          {identity.isDefault ? (
                            <span className="inline-flex rounded-full bg-green-50 px-2.5 py-0.5 text-xs font-semibold text-green-600 dark:bg-green-900/20 dark:text-green-400">
                              Default
                            </span>
                          ) : (
                            <button
                              type="button"
                              className="text-xs font-medium text-gray-500 hover:text-gray-900 dark:text-gray-400 dark:hover:text-gray-200"
                              onClick={() => handleSetDefault(identity.id)}
                              disabled={isSaving}
                            >
                              Set as default
                            </button>
                          )}
                        </td>
                        <td className="px-4 py-3 pr-5 sm:pr-6">
                          <div className="flex items-center justify-end gap-1">
                            <IconButton
                              icon={pencilIcon}
                              variant="default"
                              title="Edit identity"
                              onClick={() => {
                                setEditingIdentity(identity);
                                setIdentityModalOpen(true);
                              }}
                            />
                            <IconButton
                              icon={trashIcon}
                              variant="danger"
                              title="Archive identity"
                              onClick={() => handleArchiveIdentity(identity.id)}
                              disabled={isSaving}
                            />
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>

          {/* ── Email Templates ── */}
          <div className="rounded-xl border border-gray-200 bg-white p-5 sm:p-6 dark:border-slate-700 dark:bg-slate-800">
            <div className="mb-5 flex flex-col gap-3">
              <div className="flex items-start justify-between gap-3">
                <h2 className="min-w-0 pr-2 text-lg font-semibold text-gray-900 dark:text-white">
                  Email Templates
                </h2>
                <IconButton
                  type="button"
                  icon={plusIcon}
                  variant="default"
                  className={addSectionIconButtonClass}
                  title="Add email template"
                  aria-label="Add email template"
                  onClick={() => {
                    setEditingTemplate(null);
                    setTemplateModalOpen(true);
                  }}
                />
              </div>
              <div className="relative max-w-md">
                <svg
                  className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400 dark:text-gray-500"
                  fill="none"
                  stroke="currentColor"
                  viewBox="0 0 24 24"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z"
                  />
                </svg>
                <input
                  type="search"
                  value={templateSearch}
                  onChange={(e) => setTemplateSearch(e.target.value)}
                  placeholder="Search..."
                  className="w-full rounded-lg border border-gray-200 bg-white py-1.5 pl-9 pr-3 text-sm text-gray-900 placeholder-gray-400 outline-none transition-colors focus:border-gray-400 dark:border-slate-600 dark:bg-slate-800 dark:text-white dark:placeholder-gray-500 dark:focus:border-slate-500"
                />
              </div>
            </div>

            {filteredTemplates.length === 0 ? (
              <div className="py-12 text-center">
                <p className="text-sm text-gray-500 dark:text-gray-400">
                  {templateSearch.trim()
                    ? "No templates match your search."
                    : "No email templates configured yet."}
                </p>
                {!templateSearch.trim() && (
                  <p className="mt-1 text-xs text-gray-400 dark:text-gray-500">
                    Create a template to configure outbound email content.
                  </p>
                )}
              </div>
            ) : (
              <div className="-mx-5 sm:-mx-6 overflow-x-auto">
                <table className="w-full text-left text-sm">
                  <thead>
                    <tr className="border-b border-gray-200 dark:border-gray-600">
                      <th className={`${thClass} pl-5 sm:pl-6`}>Name</th>
                      <th className={thClass}>System ID</th>
                      <th className={thClass}>Layout</th>
                      <th className={thClass}>Context</th>
                      <th className={thClass}>Subject</th>
                      <th className={`${thClass} text-right pr-5 sm:pr-6`}>
                        Actions
                      </th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-100 dark:divide-gray-700">
                    {filteredTemplates.map((template: EmailTemplate) => (
                      <tr
                        key={template.id}
                        className="group transition-colors hover:bg-gray-50 dark:hover:bg-slate-700/40"
                      >
                        <td className="px-4 py-3 pl-5 sm:pl-6 font-medium text-gray-900 dark:text-gray-100">
                          {template.name}
                        </td>
                        <td className="px-4 py-3">
                          <code className="rounded bg-gray-100 px-1.5 py-0.5 text-xs text-gray-600 dark:bg-slate-700 dark:text-gray-300">
                            {template.slug}
                          </code>
                        </td>
                        <td className="px-4 py-3 text-gray-600 dark:text-gray-300">
                          {template.layoutSlug}
                        </td>
                        <td className="px-4 py-3">
                          {template.contextKey ? (
                            <span className="inline-flex rounded-full bg-purple-50 px-2.5 py-0.5 text-xs font-semibold text-purple-600 dark:bg-purple-900/20 dark:text-purple-400">
                              {template.contextKey}
                            </span>
                          ) : (
                            <span className="text-gray-300 dark:text-gray-600">
                              —
                            </span>
                          )}
                        </td>
                        <td className="max-w-[200px] truncate px-4 py-3 text-gray-600 dark:text-gray-300">
                          {template.subjectTemplate}
                        </td>
                        <td className="px-4 py-3 pr-5 sm:pr-6">
                          <div className="flex items-center justify-end gap-1">
                            <IconButton
                              icon={pencilIcon}
                              variant="default"
                              title="Edit template"
                              onClick={() => {
                                setEditingTemplate(template);
                                setTemplateModalOpen(true);
                              }}
                            />
                            <IconButton
                              icon={trashIcon}
                              variant="danger"
                              title="Archive template"
                              onClick={() => handleArchiveTemplate(template.id)}
                              disabled={isSaving}
                            />
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* ── Identity Create/Edit Modal ── */}
      <Modal
        isOpen={identityModalOpen}
        onClose={() => {
          setIdentityModalOpen(false);
          setEditingIdentity(null);
        }}
        title={editingIdentity ? "Edit Sender Identity" : "Add Sender Identity"}
      >
        {identityModalOpen && errorBanner && (
          <div className="mb-4">{errorBanner}</div>
        )}
        <fetcher.Form
          method="post"
          key={editingIdentity?.id ?? "new-identity"}
          className="space-y-4"
        >
          <input
            type="hidden"
            name="intent"
            value={editingIdentity ? "updateIdentity" : "createIdentity"}
          />
          {editingIdentity && (
            <input type="hidden" name="id" value={editingIdentity.id} />
          )}
          <div>
            <label className={labelClass}>From Email</label>
            <input
              name="fromEmail"
              type="email"
              required
              defaultValue={editingIdentity?.fromEmail ?? ""}
              placeholder="noreply@yourdomain.com"
              className={inputClass}
            />
            {allowedDomains.length > 0 && (
              <p className={helperClass}>
                Must use one of: {allowedDomains.join(", ")}
              </p>
            )}
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <div>
              <label className={labelClass}>Display Name</label>
              <input
                name="fromDisplayName"
                type="text"
                defaultValue={editingIdentity?.fromDisplayName ?? ""}
                placeholder="Subtract Manufacturing"
                className={inputClass}
              />
            </div>
            <div>
              <label className={labelClass}>Reply-To</label>
              <input
                name="replyToEmail"
                type="email"
                defaultValue={editingIdentity?.replyToEmail ?? ""}
                placeholder="support@yourdomain.com"
                className={inputClass}
              />
            </div>
          </div>
          {!editingIdentity && (
            <label className="flex items-center gap-2 text-sm text-gray-700 dark:text-gray-300">
              <input
                type="checkbox"
                name="setDefault"
                className="rounded border-gray-300"
              />
              Set as default identity
            </label>
          )}
          <div className="flex justify-end gap-3 border-t border-gray-200 pt-4 dark:border-gray-600">
            <Button
              type="button"
              variant="secondary"
              onClick={() => {
                setIdentityModalOpen(false);
                setEditingIdentity(null);
              }}
            >
              Cancel
            </Button>
            <Button type="submit" variant="primary" disabled={isSaving}>
              {isSaving
                ? "Saving..."
                : editingIdentity
                  ? "Save Changes"
                  : "Add Identity"}
            </Button>
          </div>
        </fetcher.Form>
      </Modal>

      {/* ── Snippet Create/Edit Modal ── */}
      <Modal
        isOpen={snippetModalOpen}
        onClose={() => {
          setSnippetModalOpen(false);
          setEditingSnippet(null);
        }}
        title={editingSnippet ? "Edit Snippet" : "Add Snippet"}
      >
        {snippetModalOpen && errorBanner && (
          <div className="mb-4">{errorBanner}</div>
        )}
        <fetcher.Form
          method="post"
          key={editingSnippet?.key ?? "new-snippet"}
          className="space-y-4"
        >
          <input
            type="hidden"
            name="intent"
            value={editingSnippet ? "updateSnippet" : "createSnippet"}
          />
          <div>
            <label className={labelClass}>Snippet name</label>
            {editingSnippet ? (
              <>
                <input type="hidden" name="key" value={editingSnippet.key} />
                <div className="rounded-lg bg-gray-50 px-3 py-2 font-mono text-sm text-gray-700 dark:bg-slate-800 dark:text-gray-300">
                  {editingSnippet.key}
                </div>
              </>
            ) : (
              <input
                name="key"
                type="text"
                required
                pattern="^[a-zA-Z]\w*$"
                title="Start with a letter; letters, numbers, underscores only"
                placeholder="e.g. default_signature or signOff"
                className={inputClass}
              />
            )}
            <p className={helperClass}>
              Use in templates as{" "}
              <code className="rounded bg-gray-100 px-1 text-xs dark:bg-slate-700">
                {"{{name}}"}
              </code>
              . Avoid{" "}
              <code className="rounded bg-gray-100 px-1 text-xs dark:bg-slate-700">
                quoteNumber
              </code>
              ,{" "}
              <code className="rounded bg-gray-100 px-1 text-xs dark:bg-slate-700">
                customerName
              </code>
              , etc., unless you want the live quote to override the snippet.
            </p>
            {editingSnippet &&
              SNIPPET_CONTEXT_COLLISION_KEYS.has(editingSnippet.key) && (
                <p className="mt-2 text-xs text-amber-600 dark:text-amber-400">
                  This name matches a quote field; the live quote value will
                  override this snippet when both exist.
                </p>
              )}
          </div>
          <div>
            <label className={labelClass}>Content</label>
            <textarea
              name="value"
              rows={5}
              defaultValue={editingSnippet?.value ?? ""}
              className={inputClass}
            />
          </div>
          <div className="flex justify-end gap-3 border-t border-gray-200 pt-4 dark:border-gray-600">
            <Button
              type="button"
              variant="secondary"
              onClick={() => {
                setSnippetModalOpen(false);
                setEditingSnippet(null);
              }}
            >
              Cancel
            </Button>
            <Button type="submit" variant="primary" disabled={isSaving}>
              {isSaving
                ? "Saving..."
                : editingSnippet
                  ? "Save Changes"
                  : "Add Snippet"}
            </Button>
          </div>
        </fetcher.Form>
      </Modal>

      {/* ── Template Create/Edit Modal ── */}
      <Modal
        isOpen={templateModalOpen}
        onClose={() => {
          setTemplateModalOpen(false);
          setEditingTemplate(null);
        }}
        title={editingTemplate ? "Edit Template" : "Create Template"}
        size="lg"
      >
        {templateModalOpen && errorBanner && (
          <div className="mb-4">{errorBanner}</div>
        )}
        <fetcher.Form
          method="post"
          key={editingTemplate?.id ?? "new-template"}
          className="space-y-4"
        >
          <input
            type="hidden"
            name="intent"
            value={editingTemplate ? "updateTemplate" : "createTemplate"}
          />
          {editingTemplate && (
            <input type="hidden" name="id" value={editingTemplate.id} />
          )}

          <div className="grid gap-4">
            {editingTemplate && (
              <div>
                <label className={labelClass}>System ID</label>
                <div className="rounded-lg bg-gray-50 px-3 py-2 font-mono text-sm text-gray-500 dark:bg-slate-800 dark:text-gray-400">
                  {editingTemplate.slug}
                </div>
              </div>
            )}
            <div>
              <label className={labelClass}>Template Name</label>
              <input
                name="name"
                required
                pattern="^[a-zA-Z0-9\s\-]+$"
                title="Letters, numbers, spaces, and hyphens only"
                defaultValue={editingTemplate?.name ?? ""}
                placeholder="e.g. Quote Send Email"
                className={inputClass}
              />
              {!editingTemplate && (
                <p className={helperClass}>
                  Letters, numbers, spaces, and hyphens only
                </p>
              )}
            </div>
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <div>
              <label className={labelClass}>Layout</label>
              <select
                name="layoutSlug"
                defaultValue={editingTemplate?.layoutSlug ?? "quote-send"}
                className={inputClass}
              >
                {REGISTERED_EMAIL_LAYOUT_SLUGS.map((layout) => (
                  <option key={layout} value={layout}>
                    {layout}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className={labelClass}>Sender Identity</label>
              <select
                name="emailIdentityId"
                required
                defaultValue={editingTemplate?.emailIdentityId ?? ""}
                className={inputClass}
              >
                <option value="">Select identity...</option>
                {activeIdentities.map((identity: EmailIdentity) => (
                  <option key={identity.id} value={identity.id}>
                    {identity.fromDisplayName
                      ? `${identity.fromDisplayName} <${identity.fromEmail}>`
                      : identity.fromEmail}
                  </option>
                ))}
              </select>
            </div>
          </div>

          <div>
            <label className={labelClass}>Context</label>
            <select
              name="contextKey"
              defaultValue={editingTemplate?.contextKey ?? ""}
              className={inputClass}
            >
              <option value="">None</option>
              {EMAIL_CONTEXTS.map((context) => (
                <option key={context.key} value={context.key}>
                  {context.label} ({context.key})
                </option>
              ))}
            </select>
            <p className={helperClass}>
              Binds this template to an application event. Only one template per
              context.
            </p>
          </div>

          <div>
            <label className={labelClass}>Subject Template</label>
            <input
              name="subjectTemplate"
              required
              defaultValue={editingTemplate?.subjectTemplate ?? ""}
              placeholder="Your Quote {{quoteNumber}} from Subtract Manufacturing"
              className={inputClass}
            />
          </div>

          <div>
            <label className={labelClass}>Body Copy (JSON)</label>
            <textarea
              name="bodyCopyJson"
              rows={8}
              defaultValue={
                editingTemplate
                  ? JSON.stringify(editingTemplate.bodyCopy, null, 2)
                  : defaultBodyCopyJson
              }
              className={`${inputClass} font-mono text-xs`}
            />
            <p className={helperClass}>
              JSON object with string values for each content block.
            </p>
          </div>

          <div className="flex justify-end gap-3 border-t border-gray-200 pt-4 dark:border-gray-600">
            <Button
              type="button"
              variant="secondary"
              onClick={() => {
                setTemplateModalOpen(false);
                setEditingTemplate(null);
              }}
            >
              Cancel
            </Button>
            <Button type="submit" variant="primary" disabled={isSaving}>
              {isSaving
                ? "Saving..."
                : editingTemplate
                  ? "Save Changes"
                  : "Create Template"}
            </Button>
          </div>
        </fetcher.Form>
      </Modal>
    </div>
  );
}
