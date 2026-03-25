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
import Button from "~/components/shared/Button";
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

function parseBodyCopyJson(raw: string): Record<string, string> | null {
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      return null;
    }
    const result: Record<string, string> = {};
    for (const [key, value] of Object.entries(parsed as Record<string, unknown>)) {
      if (typeof value === "string") result[key] = value;
    }
    return result;
  } catch {
    return null;
  }
}

function normalizeContextKey(raw: FormDataEntryValue | null): EmailContextKey | null {
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

  const [settingsRows, identities, templates] = await Promise.all([
    db.select().from(emailSettings),
    db.select().from(emailIdentities).orderBy(desc(emailIdentities.id)),
    db.select().from(emailTemplates).where(eq(emailTemplates.isArchived, false)),
  ]);

  const settingsMap = new Map<string, string>();
  for (const row of settingsRows) {
    if (row.value !== null) settingsMap.set(row.key, row.value);
  }

  return withAuthHeaders(
    json({
      settings: {
        outboundDelayMinutes: settingsMap.get("outbound_delay_minutes") || "0",
        recipientOverride: settingsMap.get("recipient_override") || "",
        defaultSignature: settingsMap.get("default_signature") || "",
        defaultFooter: settingsMap.get("default_footer") || "",
      },
      identities,
      templates,
      allowedDomains: getAllowedEmailDomains(),
    }),
    headers
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
    const delay = parseInt((formData.get("outboundDelayMinutes") as string) ?? "0", 10);
    if (isNaN(delay) || delay < 0 || delay > 1440) {
      return withAuthHeaders(
        json({ error: "Delay must be between 0 and 1440 minutes." }, { status: 400 }),
        headers
      );
    }

    const updates = [
      { key: "outbound_delay_minutes", value: String(delay) },
      { key: "recipient_override", value: ((formData.get("recipientOverride") as string) ?? "").trim() },
      { key: "default_signature", value: (formData.get("defaultSignature") as string) ?? "" },
      { key: "default_footer", value: (formData.get("defaultFooter") as string) ?? "" },
    ];

    await Promise.all(
      updates.map((u) =>
        db
          .insert(emailSettings)
          .values({ key: u.key, value: u.value, updatedBy })
          .onConflictDoUpdate({
            target: emailSettings.key,
            set: { value: u.value, updatedAt: new Date(), updatedBy },
          })
      )
    );
    return withAuthHeaders(json({ success: true }), headers);
  }

  if (intent === "createIdentity" || intent === "updateIdentity") {
    const id = intent === "updateIdentity" ? parseInt(formData.get("id") as string, 10) : null;
    const fromEmail = (formData.get("fromEmail") as string)?.trim().toLowerCase();
    const fromDisplayName = ((formData.get("fromDisplayName") as string) ?? "").trim() || null;
    const replyToEmail = ((formData.get("replyToEmail") as string) ?? "").trim() || null;

    if (!fromEmail) {
      return withAuthHeaders(json({ error: "From email is required." }, { status: 400 }), headers);
    }
    if (!isEmailDomainAllowed(fromEmail)) {
      return withAuthHeaders(
        json({ error: "From email domain must be in EMAIL_DOMAIN allowlist." }, { status: 400 }),
        headers
      );
    }
    if (replyToEmail && !isEmailDomainAllowed(replyToEmail)) {
      return withAuthHeaders(
        json({ error: "Reply-To domain must be in EMAIL_DOMAIN allowlist." }, { status: 400 }),
        headers
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
        return withAuthHeaders(json({ error: "Invalid identity." }, { status: 400 }), headers);
      }
      await db
        .update(emailIdentities)
        .set({ fromEmail, fromDisplayName, replyToEmail, updatedAt: new Date(), updatedBy })
        .where(and(eq(emailIdentities.id, id), eq(emailIdentities.isArchived, false)));
    }
    return withAuthHeaders(json({ success: true }), headers);
  }

  if (intent === "setDefaultIdentity") {
    const id = parseInt(formData.get("id") as string, 10);
    if (isNaN(id)) {
      return withAuthHeaders(json({ error: "Invalid identity." }, { status: 400 }), headers);
    }

    await db.transaction(async (tx) => {
      await tx
        .update(emailIdentities)
        .set({ isDefault: false, updatedAt: new Date(), updatedBy })
        .where(eq(emailIdentities.isArchived, false));
      await tx
        .update(emailIdentities)
        .set({ isDefault: true, updatedAt: new Date(), updatedBy })
        .where(and(eq(emailIdentities.id, id), eq(emailIdentities.isArchived, false)));
    });
    return withAuthHeaders(json({ success: true }), headers);
  }

  if (intent === "archiveIdentity") {
    const id = parseInt(formData.get("id") as string, 10);
    if (isNaN(id)) {
      return withAuthHeaders(json({ error: "Invalid identity." }, { status: 400 }), headers);
    }

    const [inUse] = await db
      .select({ id: emailTemplates.id })
      .from(emailTemplates)
      .where(and(eq(emailTemplates.emailIdentityId, id), eq(emailTemplates.isArchived, false)))
      .limit(1);
    if (inUse) {
      return withAuthHeaders(
        json({ error: "Cannot archive this identity because active templates use it." }, { status: 400 }),
        headers
      );
    }

    await db
      .update(emailIdentities)
      .set({ isArchived: true, isDefault: false, updatedAt: new Date(), updatedBy })
      .where(eq(emailIdentities.id, id));
    return withAuthHeaders(json({ success: true }), headers);
  }

  if (intent === "createTemplate" || intent === "updateTemplate") {
    const id = intent === "updateTemplate" ? parseInt(formData.get("id") as string, 10) : null;
    const slug = (formData.get("slug") as string)?.trim().toLowerCase();
    const name = (formData.get("name") as string)?.trim();
    const layoutSlug = (formData.get("layoutSlug") as string)?.trim();
    const contextKeyRaw = formData.get("contextKey");
    const contextKey = normalizeContextKey(contextKeyRaw);
    const emailIdentityId = parseInt(formData.get("emailIdentityId") as string, 10);
    const subjectTemplate = (formData.get("subjectTemplate") as string)?.trim();
    const bodyCopyRaw = (formData.get("bodyCopyJson") as string) ?? "";

    if ((contextKeyRaw as string)?.trim() && !contextKey) {
      return withAuthHeaders(json({ error: "Invalid context key." }, { status: 400 }), headers);
    }
    if (!name || !subjectTemplate) {
      return withAuthHeaders(
        json({ error: "Template name and subject are required." }, { status: 400 }),
        headers
      );
    }
    if (!isRegisteredEmailLayoutSlug(layoutSlug)) {
      return withAuthHeaders(json({ error: "Invalid layout slug." }, { status: 400 }), headers);
    }
    if (isNaN(emailIdentityId)) {
      return withAuthHeaders(json({ error: "Select a sender identity." }, { status: 400 }), headers);
    }

    if (intent === "createTemplate") {
      if (!slug || !SLUG_RE.test(slug)) {
        return withAuthHeaders(
          json({ error: "Slug must be lowercase letters, numbers, and hyphens only." }, { status: 400 }),
          headers
        );
      }
    } else if (!id || isNaN(id)) {
      return withAuthHeaders(json({ error: "Invalid template." }, { status: 400 }), headers);
    }

    if (contextKey) {
      const conflict = await findConflictingTemplateForContextKey(contextKey, id ?? undefined);
      if (conflict) {
        return withAuthHeaders(json({ error: contextConflictMessage(conflict) }, { status: 400 }), headers);
      }
    }

    const [identity] = await db
      .select()
      .from(emailIdentities)
      .where(and(eq(emailIdentities.id, emailIdentityId), eq(emailIdentities.isArchived, false)))
      .limit(1);
    if (!identity) {
      return withAuthHeaders(json({ error: "Selected sender identity is invalid." }, { status: 400 }), headers);
    }

    const bodyCopy =
      parseBodyCopyJson(bodyCopyRaw) ??
      (layoutSlug === "quote-send" ? { ...DEFAULT_QUOTE_SEND_BODY_COPY } : null);
    if (!bodyCopy || Object.keys(bodyCopy).length === 0) {
      return withAuthHeaders(
        json({ error: "Body copy must be a non-empty JSON object with string values." }, { status: 400 }),
        headers
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
          .where(and(eq(emailTemplates.id, id!), eq(emailTemplates.isArchived, false)));
      }
    } catch (error) {
      const dbError = error as { code?: string };
      if (dbError.code === "23505") {
        return withAuthHeaders(
          json({ error: "Slug or context key already exists." }, { status: 400 }),
          headers
        );
      }
      throw error;
    }
    return withAuthHeaders(json({ success: true }), headers);
  }

  if (intent === "archiveTemplate") {
    const id = parseInt(formData.get("id") as string, 10);
    if (isNaN(id)) {
      return withAuthHeaders(json({ error: "Invalid template." }, { status: 400 }), headers);
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

  return withAuthHeaders(json({ error: "Invalid action." }, { status: 400 }), headers);
}

export default function AdminEmail() {
  const { settings, identities, templates, allowedDomains } =
    useLoaderData<typeof loader>();
  const fetcher = useFetcher<{ success?: boolean; error?: string }>();
  const revalidator = useRevalidator();
  const isSaving = fetcher.state !== "idle";

  const [templateSearch, setTemplateSearch] = useState("");
  const [editingTemplateId, setEditingTemplateId] = useState<number | null>(null);
  const [editingIdentityId, setEditingIdentityId] = useState<number | null>(null);

  useEffect(() => {
    if (fetcher.state === "idle" && fetcher.data?.success) {
      revalidator.revalidate();
      setEditingTemplateId(null);
      setEditingIdentityId(null);
    }
  }, [fetcher.state, fetcher.data, revalidator]);

  const activeIdentities = identities.filter((i: EmailIdentity) => !i.isArchived);
  const filteredTemplates = templateSearch.trim()
    ? matchSorter(templates, templateSearch, {
        keys: ["name", "slug", "layoutSlug", "contextKey", "subjectTemplate"],
      })
    : templates;
  const defaultBodyCopyJson = JSON.stringify(DEFAULT_QUOTE_SEND_BODY_COPY, null, 2);

  return (
    <div className="px-6 py-8 lg:px-10 lg:py-10">
      <div className="mb-8">
        <h1 className="text-xl font-semibold text-gray-900 dark:text-white">
          Email Configuration
        </h1>
        <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">
          Configure global settings, sender identities, and template mappings by context.
        </p>
      </div>

      {fetcher.data?.error && (
        <div className="mb-6 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800 dark:border-red-900/50 dark:bg-red-950/40 dark:text-red-200">
          {fetcher.data.error}
        </div>
      )}

      <div className="space-y-8">
        <div className="max-w-2xl rounded-xl border border-gray-200 bg-white p-6 dark:border-slate-700 dark:bg-slate-800">
          <h2 className="mb-4 text-base font-semibold text-gray-900 dark:text-white">
            Global Settings
          </h2>
          <fetcher.Form method="post" className="space-y-4">
            <input type="hidden" name="intent" value="saveSettings" />
            <div>
              <label className="mb-1 block text-sm font-medium text-gray-700 dark:text-gray-300">
                Outbound Delay (minutes)
              </label>
              <input
                type="number"
                name="outboundDelayMinutes"
                defaultValue={settings.outboundDelayMinutes}
                min={0}
                max={1440}
                className="w-full rounded-md border border-gray-300 bg-white px-3 py-2 text-gray-900 dark:border-slate-600 dark:bg-slate-900 dark:text-white"
              />
            </div>
            <div>
              <label className="mb-1 block text-sm font-medium text-gray-700 dark:text-gray-300">
                Recipient Override
              </label>
              <input
                type="email"
                name="recipientOverride"
                defaultValue={settings.recipientOverride}
                className="w-full rounded-md border border-gray-300 bg-white px-3 py-2 text-gray-900 dark:border-slate-600 dark:bg-slate-900 dark:text-white"
              />
            </div>
            <div>
              <label className="mb-1 block text-sm font-medium text-gray-700 dark:text-gray-300">
                Default Signature
              </label>
              <textarea
                rows={3}
                name="defaultSignature"
                defaultValue={settings.defaultSignature}
                className="w-full rounded-md border border-gray-300 bg-white px-3 py-2 text-gray-900 dark:border-slate-600 dark:bg-slate-900 dark:text-white"
              />
            </div>
            <div>
              <label className="mb-1 block text-sm font-medium text-gray-700 dark:text-gray-300">
                Default Footer
              </label>
              <textarea
                rows={3}
                name="defaultFooter"
                defaultValue={settings.defaultFooter}
                className="w-full rounded-md border border-gray-300 bg-white px-3 py-2 text-gray-900 dark:border-slate-600 dark:bg-slate-900 dark:text-white"
              />
            </div>
            <div className="flex justify-end">
              <Button type="submit" variant="primary" disabled={isSaving}>
                {isSaving ? "Saving..." : "Save Settings"}
              </Button>
            </div>
          </fetcher.Form>
        </div>

        <div className="max-w-4xl rounded-xl border border-gray-200 bg-white p-6 dark:border-slate-700 dark:bg-slate-800">
          <h2 className="mb-4 text-base font-semibold text-gray-900 dark:text-white">
            Sender identities
          </h2>
          <div className="mb-4 rounded-md bg-blue-50 p-3 text-sm text-blue-800 dark:bg-blue-900/30 dark:text-blue-200">
            <strong>Allowed domains:</strong>{" "}
            {allowedDomains.length > 0 ? allowedDomains.join(", ") : "None configured"}
          </div>
          <fetcher.Form method="post" className="grid gap-3 sm:grid-cols-2">
            <input type="hidden" name="intent" value="createIdentity" />
            <input name="fromEmail" type="email" required placeholder="From email" className="rounded-md border border-gray-300 px-3 py-2 text-sm dark:border-slate-600 dark:bg-slate-900 dark:text-white sm:col-span-2" />
            <input name="fromDisplayName" type="text" placeholder="Display name" className="rounded-md border border-gray-300 px-3 py-2 text-sm dark:border-slate-600 dark:bg-slate-900 dark:text-white" />
            <input name="replyToEmail" type="email" placeholder="Reply-To (optional)" className="rounded-md border border-gray-300 px-3 py-2 text-sm dark:border-slate-600 dark:bg-slate-900 dark:text-white" />
            <label className="sm:col-span-2 flex items-center gap-2 text-sm text-gray-700 dark:text-gray-300">
              <input type="checkbox" name="setDefault" className="rounded border-gray-300" />
              Set as default identity
            </label>
            <div className="sm:col-span-2">
              <Button type="submit" variant="secondary" disabled={isSaving}>
                Add identity
              </Button>
            </div>
          </fetcher.Form>

          <div className="mt-6 overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead className="bg-gray-50 text-gray-500 dark:bg-slate-700/50 dark:text-gray-400">
                <tr>
                  <th className="px-3 py-2 font-medium">From</th>
                  <th className="px-3 py-2 font-medium">Display</th>
                  <th className="px-3 py-2 font-medium">Reply-To</th>
                  <th className="px-3 py-2 font-medium">Default</th>
                  <th className="px-3 py-2 font-medium">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-200 dark:divide-slate-700">
                {activeIdentities.map((identity: EmailIdentity) => (
                  <tr key={identity.id}>
                    <td className="px-3 py-2">{identity.fromEmail}</td>
                    <td className="px-3 py-2">{identity.fromDisplayName || "—"}</td>
                    <td className="px-3 py-2">{identity.replyToEmail || "—"}</td>
                    <td className="px-3 py-2">{identity.isDefault ? "Yes" : "—"}</td>
                    <td className="px-3 py-2">
                      <div className="flex gap-2">
                        {!identity.isDefault && (
                          <fetcher.Form method="post">
                            <input type="hidden" name="intent" value="setDefaultIdentity" />
                            <input type="hidden" name="id" value={identity.id} />
                            <button className="text-xs text-[#840606] hover:underline" disabled={isSaving}>
                              Set default
                            </button>
                          </fetcher.Form>
                        )}
                        <button
                          type="button"
                          className="text-xs text-[#840606] hover:underline"
                          onClick={() =>
                            setEditingIdentityId(
                              editingIdentityId === identity.id ? null : identity.id
                            )
                          }
                        >
                          {editingIdentityId === identity.id ? "Close" : "Edit"}
                        </button>
                        <fetcher.Form method="post">
                          <input type="hidden" name="intent" value="archiveIdentity" />
                          <input type="hidden" name="id" value={identity.id} />
                          <button className="text-xs text-gray-500 hover:text-red-600" disabled={isSaving}>
                            Archive
                          </button>
                        </fetcher.Form>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {editingIdentityId !== null &&
            (() => {
              const i = activeIdentities.find(
                (x: EmailIdentity) => x.id === editingIdentityId
              );
              if (!i) return null;
              return (
                <fetcher.Form method="post" className="mt-4 grid gap-3 sm:grid-cols-2">
                  <input type="hidden" name="intent" value="updateIdentity" />
                  <input type="hidden" name="id" value={i.id} />
                  <input name="fromEmail" type="email" required defaultValue={i.fromEmail} className="rounded-md border border-gray-300 px-3 py-2 text-sm dark:border-slate-600 dark:bg-slate-900 dark:text-white sm:col-span-2" />
                  <input name="fromDisplayName" type="text" defaultValue={i.fromDisplayName ?? ""} className="rounded-md border border-gray-300 px-3 py-2 text-sm dark:border-slate-600 dark:bg-slate-900 dark:text-white" />
                  <input name="replyToEmail" type="email" defaultValue={i.replyToEmail ?? ""} className="rounded-md border border-gray-300 px-3 py-2 text-sm dark:border-slate-600 dark:bg-slate-900 dark:text-white" />
                  <div className="sm:col-span-2">
                    <Button type="submit" variant="primary" disabled={isSaving}>
                      Save identity
                    </Button>
                  </div>
                </fetcher.Form>
              );
            })()}
        </div>

        <div className="max-w-4xl rounded-xl border border-gray-200 bg-white p-6 dark:border-slate-700 dark:bg-slate-800">
          <div className="mb-4 flex items-center justify-between gap-3">
            <h2 className="text-base font-semibold text-gray-900 dark:text-white">Templates</h2>
            <input
              type="search"
              value={templateSearch}
              onChange={(e) => setTemplateSearch(e.target.value)}
              placeholder="Search templates..."
              className="rounded-md border border-gray-300 px-3 py-1.5 text-sm dark:border-slate-600 dark:bg-slate-900 dark:text-white"
            />
          </div>

          <fetcher.Form method="post" className="mb-6 grid gap-3 sm:grid-cols-2">
            <input type="hidden" name="intent" value="createTemplate" />
            <input name="slug" required pattern="[a-z0-9]+(-[a-z0-9]+)*" placeholder="Slug" className="rounded-md border border-gray-300 px-3 py-2 text-sm font-mono dark:border-slate-600 dark:bg-slate-900 dark:text-white" />
            <input name="name" required placeholder="Template name" className="rounded-md border border-gray-300 px-3 py-2 text-sm dark:border-slate-600 dark:bg-slate-900 dark:text-white" />
            <select name="layoutSlug" defaultValue="quote-send" className="rounded-md border border-gray-300 px-3 py-2 text-sm dark:border-slate-600 dark:bg-slate-900 dark:text-white">
              {REGISTERED_EMAIL_LAYOUT_SLUGS.map((layout) => (
                <option key={layout} value={layout}>
                  {layout}
                </option>
              ))}
            </select>
            <select name="emailIdentityId" required className="rounded-md border border-gray-300 px-3 py-2 text-sm dark:border-slate-600 dark:bg-slate-900 dark:text-white">
              <option value="">Select identity</option>
              {activeIdentities.map((identity: EmailIdentity) => (
                <option key={identity.id} value={identity.id}>
                  {identity.fromEmail}
                </option>
              ))}
            </select>
            <select name="contextKey" defaultValue="" className="rounded-md border border-gray-300 px-3 py-2 text-sm dark:border-slate-600 dark:bg-slate-900 dark:text-white sm:col-span-2">
              <option value="">None</option>
              {EMAIL_CONTEXTS.map((context) => (
                <option key={context.key} value={context.key}>
                  {context.label} ({context.key})
                </option>
              ))}
            </select>
            <input name="subjectTemplate" required placeholder="Subject template" className="rounded-md border border-gray-300 px-3 py-2 text-sm dark:border-slate-600 dark:bg-slate-900 dark:text-white sm:col-span-2" />
            <textarea name="bodyCopyJson" rows={8} defaultValue={defaultBodyCopyJson} className="rounded-md border border-gray-300 px-3 py-2 font-mono text-xs dark:border-slate-600 dark:bg-slate-900 dark:text-white sm:col-span-2" />
            <div className="sm:col-span-2">
              <Button type="submit" variant="secondary" disabled={isSaving}>
                Create template
              </Button>
            </div>
          </fetcher.Form>

          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead className="bg-gray-50 text-gray-500 dark:bg-slate-700/50 dark:text-gray-400">
                <tr>
                  <th className="px-3 py-2 font-medium">Name</th>
                  <th className="px-3 py-2 font-medium">Slug</th>
                  <th className="px-3 py-2 font-medium">Layout</th>
                  <th className="px-3 py-2 font-medium">Context</th>
                  <th className="px-3 py-2 font-medium">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-200 dark:divide-slate-700">
                {filteredTemplates.map((template: EmailTemplate) => (
                  <tr key={template.id}>
                    <td className="px-3 py-2">{template.name}</td>
                    <td className="px-3 py-2 font-mono text-xs">{template.slug}</td>
                    <td className="px-3 py-2">{template.layoutSlug}</td>
                    <td className="px-3 py-2">{template.contextKey || "None"}</td>
                    <td className="px-3 py-2">
                      <button
                        type="button"
                        className="text-xs text-[#840606] hover:underline"
                        onClick={() =>
                          setEditingTemplateId(
                            editingTemplateId === template.id ? null : template.id
                          )
                        }
                      >
                        {editingTemplateId === template.id ? "Close" : "Edit"}
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {editingTemplateId !== null &&
            (() => {
              const t = templates.find((x: EmailTemplate) => x.id === editingTemplateId);
              if (!t) return null;
              return (
                <div className="mt-4 rounded-lg border border-gray-200 p-4 dark:border-slate-600">
                  <fetcher.Form method="post" className="grid gap-3 sm:grid-cols-2">
                    <input type="hidden" name="intent" value="updateTemplate" />
                    <input type="hidden" name="id" value={t.id} />
                    <div className="sm:col-span-2 text-xs text-gray-500">Slug: {t.slug}</div>
                    <input name="name" required defaultValue={t.name} className="rounded-md border border-gray-300 px-3 py-2 text-sm dark:border-slate-600 dark:bg-slate-900 dark:text-white sm:col-span-2" />
                    <select name="layoutSlug" defaultValue={t.layoutSlug} className="rounded-md border border-gray-300 px-3 py-2 text-sm dark:border-slate-600 dark:bg-slate-900 dark:text-white">
                      {REGISTERED_EMAIL_LAYOUT_SLUGS.map((layout) => (
                        <option key={layout} value={layout}>
                          {layout}
                        </option>
                      ))}
                    </select>
                    <select name="emailIdentityId" defaultValue={t.emailIdentityId} className="rounded-md border border-gray-300 px-3 py-2 text-sm dark:border-slate-600 dark:bg-slate-900 dark:text-white">
                      {activeIdentities.map((identity: EmailIdentity) => (
                        <option key={identity.id} value={identity.id}>
                          {identity.fromEmail}
                        </option>
                      ))}
                    </select>
                    <select name="contextKey" defaultValue={t.contextKey ?? ""} className="rounded-md border border-gray-300 px-3 py-2 text-sm dark:border-slate-600 dark:bg-slate-900 dark:text-white sm:col-span-2">
                      <option value="">None</option>
                      {EMAIL_CONTEXTS.map((context) => (
                        <option key={context.key} value={context.key}>
                          {context.label} ({context.key})
                        </option>
                      ))}
                    </select>
                    <input name="subjectTemplate" required defaultValue={t.subjectTemplate} className="rounded-md border border-gray-300 px-3 py-2 text-sm dark:border-slate-600 dark:bg-slate-900 dark:text-white sm:col-span-2" />
                    <textarea name="bodyCopyJson" rows={10} required defaultValue={JSON.stringify(t.bodyCopy, null, 2)} className="rounded-md border border-gray-300 px-3 py-2 font-mono text-xs dark:border-slate-600 dark:bg-slate-900 dark:text-white sm:col-span-2" />
                    <div className="sm:col-span-2 flex flex-wrap gap-2">
                      <Button type="submit" variant="primary" disabled={isSaving}>
                        Save template
                      </Button>
                    </div>
                  </fetcher.Form>
                  <fetcher.Form method="post" className="mt-2">
                    <input type="hidden" name="intent" value="archiveTemplate" />
                    <input type="hidden" name="id" value={t.id} />
                    <Button type="submit" variant="secondary" disabled={isSaving}>
                      Archive template
                    </Button>
                  </fetcher.Form>
                </div>
              );
            })()}
        </div>
      </div>
    </div>
  );
}
