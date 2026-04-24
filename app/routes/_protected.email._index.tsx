import { json } from "@remix-run/node";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "@remix-run/node";
import { and, eq } from "drizzle-orm";
import {
  useFetcher,
  useLoaderData,
  useLocation,
  useRevalidator,
  Link,
} from "@remix-run/react";
import { useState, useEffect, useRef } from "react";

import { requireAuth, withAuthHeaders } from "~/lib/auth.server";
import { isOutboundEmailEnabled } from "~/lib/featureFlags";
import { getEmailSettings } from "~/lib/email/templates.server";
import { sendApprovalPreviewToApproverInbox } from "~/lib/email/send-approval-preview-to-self.server";
import { sendEmailJob } from "~/lib/queue/producer.server";
import { db } from "~/lib/db";
import { sentEmails } from "~/lib/db/schema";
import {
  listRecentSentEmails,
  listPendingApprovalEmails,
  getSentEmailStatusCounts,
  countSentEmailsInListWindow,
  type SentEmailListItem,
  type SentEmailStatusCounts,
} from "~/lib/sent-emails.server";
import { sanitizeEmailHtml } from "~/lib/email/sanitize-email-html";
import { revertQuoteAfterPendingEmailRejection } from "~/lib/quotes.server";

const INTENT_REVIEW = "reviewOutboundEmail";
const INTENT_PREVIEW = "emailPreviewToSelf";

const EMAIL_LIST_PAGE_SIZE = 25;

export async function loader({ request }: LoaderFunctionArgs) {
  const { userDetails, headers } = await requireAuth(request);

  if (!(await isOutboundEmailEnabled())) {
    throw new Response("Access Denied", { status: 403 });
  }

  const url = new URL(request.url);
  const pageParam = Math.max(
    1,
    parseInt(url.searchParams.get("page") ?? "1", 10) || 1,
  );

  const settings = await getEmailSettings();
  const maxAgeHours = settings.emailListMaxAgeHours;
  const minCreatedAt =
    maxAgeHours > 0
      ? new Date(Date.now() - maxAgeHours * 60 * 60 * 1000)
      : null;

  const [pendingApprovalEmails, counts, totalInWindow] = await Promise.all([
    listPendingApprovalEmails(minCreatedAt),
    getSentEmailStatusCounts(minCreatedAt),
    countSentEmailsInListWindow(minCreatedAt),
  ]);
  const totalPages = Math.max(
    1,
    Math.ceil(totalInWindow / EMAIL_LIST_PAGE_SIZE),
  );
  const page = Math.min(pageParam, totalPages);

  const emails = await listRecentSentEmails({
    limit: EMAIL_LIST_PAGE_SIZE,
    offset: (page - 1) * EMAIL_LIST_PAGE_SIZE,
    minCreatedAt,
  });

  const isApprover = settings.approvalRoleSlugs.includes(userDetails.role);
  const hasRegisteredEmail = Boolean(
    (userDetails.email || "").trim().length > 0,
  );

  return withAuthHeaders(
    json({
      pendingApprovalEmails: pendingApprovalEmails.map((e) => ({
        ...e,
        createdAt: e.createdAt.toISOString(),
        sentAt: e.sentAt ? e.sentAt.toISOString() : null,
      })),
      emails: emails.map((e) => ({
        ...e,
        createdAt: e.createdAt.toISOString(),
        sentAt: e.sentAt ? e.sentAt.toISOString() : null,
      })),
      counts,
      isApprover,
      hasRegisteredEmail,
      emailListPage: page,
      emailListTotalPages: totalPages,
      emailListTotalInWindow: totalInWindow,
      emailListMaxAgeHours: maxAgeHours,
      emailListPageSize: EMAIL_LIST_PAGE_SIZE,
    }),
    headers,
  );
}

export async function action({ request }: ActionFunctionArgs) {
  if (request.method !== "POST") {
    return json({ error: "Method not allowed" }, { status: 405 });
  }

  const { user, userDetails, headers } = await requireAuth(request);
  if (!(await isOutboundEmailEnabled())) {
    return withAuthHeaders(
      json({ error: "Outbound email is disabled." }, { status: 403 }),
      headers,
    );
  }

  const formData = await request.formData();
  const intent = (formData.get("intent") as string) || "";
  const sentEmailIdRaw = formData.get("sentEmailId") as string | null;
  const sentEmailId =
    sentEmailIdRaw != null && sentEmailIdRaw !== ""
      ? parseInt(sentEmailIdRaw, 10)
      : NaN;
  if (!Number.isFinite(sentEmailId)) {
    return withAuthHeaders(
      json({ error: "Missing or invalid sent email id." }, { status: 400 }),
      headers,
    );
  }

  const settings = await getEmailSettings();
  if (!settings.approvalRoleSlugs.includes(userDetails.role)) {
    return withAuthHeaders(
      json(
        { error: "You are not authorized to review outbound email." },
        { status: 403 },
      ),
      headers,
    );
  }

  if (intent === INTENT_PREVIEW) {
    const to = (user.email || userDetails.email || "").trim();
    if (!to) {
      return withAuthHeaders(
        json(
          {
            error:
              "No email on your account. Add an email in your profile before using this.",
          },
          { status: 400 },
        ),
        headers,
      );
    }
    const [row] = await db
      .select()
      .from(sentEmails)
      .where(eq(sentEmails.id, sentEmailId))
      .limit(1);
    if (!row) {
      return withAuthHeaders(
        json({ error: "Email not found." }, { status: 404 }),
        headers,
      );
    }
    if (row.status !== "pending_approval") {
      return withAuthHeaders(
        json(
          { error: "This message is not awaiting approval." },
          { status: 409 },
        ),
        headers,
      );
    }
    try {
      await sendApprovalPreviewToApproverInbox(row, to);
    } catch (e) {
      console.error("[emailPreviewToSelf]", e);
      return withAuthHeaders(
        json(
          {
            error:
              "Could not send preview. Try again or contact an administrator.",
          },
          { status: 502 },
        ),
        headers,
      );
    }
    return withAuthHeaders(
      json({ success: true, result: "previewEmailed" as const }),
      headers,
    );
  }

  if (intent === INTENT_REVIEW) {
    const decision = (formData.get("decision") as string) || "";
    if (decision !== "approve" && decision !== "reject") {
      return withAuthHeaders(
        json({ error: "Invalid decision." }, { status: 400 }),
        headers,
      );
    }
    const [row] = await db
      .select()
      .from(sentEmails)
      .where(eq(sentEmails.id, sentEmailId))
      .limit(1);
    if (!row) {
      return withAuthHeaders(
        json({ error: "Email not found." }, { status: 404 }),
        headers,
      );
    }
    if (row.status !== "pending_approval") {
      return withAuthHeaders(
        json(
          { error: "This message is not awaiting approval." },
          { status: 409 },
        ),
        headers,
      );
    }

    const now = new Date();
    if (decision === "approve") {
      const approved = await db
        .update(sentEmails)
        .set({
          status: "queued",
          approvedByUserId: user.id,
          approvedAt: now,
          updatedAt: now,
        })
        .where(
          and(
            eq(sentEmails.id, sentEmailId),
            eq(sentEmails.status, "pending_approval"),
          ),
        )
        .returning({ id: sentEmails.id });
      if (approved.length === 0) {
        return withAuthHeaders(
          json(
            {
              error:
                "This message is not awaiting approval (it may have changed).",
            },
            { status: 409 },
          ),
          headers,
        );
      }
      try {
        await sendEmailJob({ sentEmailId }, settings.outboundDelayMinutes);
      } catch (e) {
        console.error("[reviewOutboundEmail:approve] sendEmailJob", e);
      }
      return withAuthHeaders(
        json({ success: true, result: "approved" as const }),
        headers,
      );
    }

    const rejected = await db
      .update(sentEmails)
      .set({
        status: "rejected",
        rejectedByUserId: user.id,
        rejectedAt: now,
        updatedAt: now,
      })
      .where(
        and(
          eq(sentEmails.id, sentEmailId),
          eq(sentEmails.status, "pending_approval"),
        ),
      )
      .returning({ id: sentEmails.id });
    if (rejected.length === 0) {
      return withAuthHeaders(
        json(
          {
            error:
              "This message is not awaiting approval (it may have changed).",
          },
          { status: 409 },
        ),
        headers,
      );
    }
    if (row.entityType === "quote" && row.quoteId != null) {
      try {
        await revertQuoteAfterPendingEmailRejection(row.quoteId, sentEmailId, {
          userId: user.id,
          userEmail: user.email ?? userDetails.email ?? undefined,
        });
      } catch (e) {
        console.error("[reviewOutboundEmail:reject] revertQuote", e);
      }
    }
    return withAuthHeaders(
      json({ success: true, result: "rejected" as const }),
      headers,
    );
  }

  return withAuthHeaders(
    json({ error: "Invalid action." }, { status: 400 }),
    headers,
  );
}

// ─── Status badge ────────────────────────────────────────────────────────────

type EmailStatus = SentEmailListItem["status"];

const STATUS_CONFIG: Record<EmailStatus, { label: string; className: string }> =
  {
    queued: {
      label: "Pending send",
      className:
        "bg-yellow-100 text-yellow-800 dark:bg-yellow-900/40 dark:text-yellow-300",
    },
    sending: {
      label: "Sending",
      className:
        "bg-blue-100 text-blue-800 dark:bg-blue-900/40 dark:text-blue-300",
    },
    sent: {
      label: "Sent",
      className:
        "bg-green-100 text-green-800 dark:bg-green-900/40 dark:text-green-300",
    },
    failed: {
      label: "Failed",
      className: "bg-red-100 text-red-800 dark:bg-red-900/40 dark:text-red-300",
    },
    bounced: {
      label: "Bounced",
      className:
        "bg-orange-100 text-orange-800 dark:bg-orange-900/40 dark:text-orange-300",
    },
    pending_approval: {
      label: "Needs approval",
      className:
        "bg-purple-100 text-purple-800 dark:bg-purple-900/40 dark:text-purple-300",
    },
    rejected: {
      label: "Rejected",
      className:
        "bg-gray-100 text-gray-600 dark:bg-gray-800/60 dark:text-gray-400",
    },
  };

function StatusBadge({ status }: { status: EmailStatus }) {
  const cfg = STATUS_CONFIG[status] ?? {
    label: status,
    className: "bg-gray-100 text-gray-700 dark:bg-gray-700 dark:text-gray-300",
  };
  return (
    <span
      className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium ${cfg.className}`}
    >
      {cfg.label}
    </span>
  );
}

// ─── Summary strip ───────────────────────────────────────────────────────────

function SummaryStrip({ counts }: { counts: SentEmailStatusCounts }) {
  const items = [
    {
      label: "Needs approval",
      value: counts.pendingApproval,
      className:
        counts.pendingApproval > 0
          ? "text-purple-700 dark:text-purple-400"
          : "text-gray-400 dark:text-gray-500",
    },
    {
      label: "Total",
      value: counts.total,
      className: "text-gray-900 dark:text-gray-100",
    },
    {
      label: "Sent",
      value: counts.sent,
      className: "text-green-700 dark:text-green-400",
    },
    {
      label: "Pending send",
      value: counts.inFlight,
      className: "text-yellow-700 dark:text-yellow-400",
    },
    {
      label: "Failed",
      value: counts.failed,
      className: "text-red-700 dark:text-red-400",
    },
    {
      label: "Bounced",
      value: counts.bounced,
      className: "text-orange-700 dark:text-orange-400",
    },
    {
      label: "Rejected",
      value: counts.rejected,
      className: "text-gray-600 dark:text-gray-400",
    },
  ];

  return (
    <div className="mb-6 flex flex-wrap gap-3">
      {items.map(({ label, value, className }) => (
        <div
          key={label}
          className="flex items-baseline gap-1.5 rounded-lg border border-gray-200 bg-white px-4 py-2.5 dark:border-slate-700 dark:bg-slate-800"
        >
          <span className={`text-xl font-semibold tabular-nums ${className}`}>
            {value}
          </span>
          <span className="text-sm text-gray-500 dark:text-gray-400">
            {label}
          </span>
        </div>
      ))}
    </div>
  );
}

// ─── Email preview panel ──────────────────────────────────────────────────────

function EmailPreview({
  email,
}: {
  email: SentEmailListItem & { createdAt: string; sentAt: string | null };
}) {
  const [tab, setTab] = useState<"html" | "text">("html");
  const sanitized = sanitizeEmailHtml(email.htmlBody);

  return (
    <div className="border-t border-gray-200 bg-gray-50 dark:border-slate-700 dark:bg-slate-900/50">
      <div className="p-4 pb-2">
        <div className="mb-3 flex flex-wrap gap-x-4 gap-y-1 text-sm text-gray-600 dark:text-gray-400">
          <span>
            <span className="font-medium">From:</span>{" "}
            {email.fromDisplayName
              ? `${email.fromDisplayName} <${email.fromEmail}>`
              : email.fromEmail}
          </span>
          <span>
            <span className="font-medium">To:</span>{" "}
            {email.toAddresses.join(", ")}
          </span>
          {email.ccAddresses && email.ccAddresses.length > 0 && (
            <span>
              <span className="font-medium">CC:</span>{" "}
              {email.ccAddresses.join(", ")}
            </span>
          )}
        </div>

        {email.errorMessage && (
          <div className="mb-3 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700 dark:border-red-800 dark:bg-red-900/20 dark:text-red-400">
            <span className="font-medium">Error:</span> {email.errorMessage}
          </div>
        )}

        <div className="flex gap-2 border-b border-gray-200 dark:border-slate-700">
          <button
            type="button"
            onClick={() => setTab("html")}
            className={`px-3 py-1.5 text-sm font-medium transition-colors ${
              tab === "html"
                ? "border-b-2 border-[#840606] text-[#840606] dark:border-red-400 dark:text-red-400"
                : "text-gray-500 hover:text-gray-900 dark:text-gray-400 dark:hover:text-gray-200"
            }`}
          >
            HTML preview
          </button>
          {email.textBody && (
            <button
              type="button"
              onClick={() => setTab("text")}
              className={`px-3 py-1.5 text-sm font-medium transition-colors ${
                tab === "text"
                  ? "border-b-2 border-[#840606] text-[#840606] dark:border-red-400 dark:text-red-400"
                  : "text-gray-500 hover:text-gray-900 dark:text-gray-400 dark:hover:text-gray-200"
              }`}
            >
              Plain text
            </button>
          )}
        </div>
      </div>

      <div className="px-4 pb-4">
        {tab === "html" ? (
          <iframe
            title={`Email preview — ${email.subject}`}
            srcDoc={sanitized}
            sandbox="allow-same-origin"
            className="h-96 w-full rounded border border-gray-200 bg-white dark:border-slate-700"
          />
        ) : (
          <pre className="h-96 overflow-auto whitespace-pre-wrap rounded border border-gray-200 bg-white p-3 text-sm text-gray-800 dark:border-slate-700 dark:bg-slate-800 dark:text-gray-200">
            {email.textBody}
          </pre>
        )}
      </div>
    </div>
  );
}

// ─── Row ─────────────────────────────────────────────────────────────────────

type RowEmail = SentEmailListItem & {
  createdAt: string;
  sentAt: string | null;
};

function approverFormClass(disabled: boolean) {
  return `rounded-md px-3 py-1.5 text-sm font-medium transition-colors ${
    disabled
      ? "cursor-not-allowed bg-gray-100 text-gray-400 dark:bg-slate-700 dark:text-slate-500"
      : "bg-[#840606] text-white hover:bg-[#6a0505] dark:bg-red-700 dark:hover:bg-red-600"
  }`;
}

function rejectFormClass(disabled: boolean) {
  return `rounded-md border px-3 py-1.5 text-sm font-medium transition-colors ${
    disabled
      ? "cursor-not-allowed border-gray-200 text-gray-400 dark:border-slate-600"
      : "border-gray-300 text-gray-800 hover:bg-gray-50 dark:border-slate-600 dark:text-gray-200 dark:hover:bg-slate-700"
  }`;
}

function previewFormClass(disabled: boolean) {
  return `rounded-md border border-purple-200 bg-purple-50 px-3 py-1.5 text-sm font-medium text-purple-900 transition-colors dark:border-purple-800 dark:bg-purple-900/30 dark:text-purple-200 ${
    disabled
      ? "cursor-not-allowed opacity-50"
      : "hover:bg-purple-100 dark:hover:bg-purple-900/50"
  }`;
}

function EmailRow({
  email,
  isApprover,
  hasRegisteredEmail,
}: {
  email: RowEmail;
  isApprover: boolean;
  hasRegisteredEmail: boolean;
}) {
  const [expanded, setExpanded] = useState(false);
  const reviewFetcher = useFetcher<{
    success?: boolean;
    error?: string;
    result?: string;
  }>();
  const revalidator = useRevalidator();
  const lastRevalidatedKey = useRef<string | null>(null);

  useEffect(() => {
    if (reviewFetcher.state !== "idle" || !reviewFetcher.data?.success) {
      return;
    }
    const key = `${email.id}-${reviewFetcher.data.result ?? "ok"}`;
    if (lastRevalidatedKey.current === key) {
      return;
    }
    lastRevalidatedKey.current = key;
    revalidator.revalidate();
  }, [email.id, revalidator, reviewFetcher.data, reviewFetcher.state]);

  const entityLink =
    email.entityType === "quote" && email.quoteId
      ? `/quotes/${email.quoteId}`
      : null;

  const displayDate = email.sentAt ?? email.createdAt;
  const dateLabel = new Date(displayDate).toLocaleString(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
  });

  const showApproverBar = isApprover && email.status === "pending_approval";
  const busy = reviewFetcher.state !== "idle";

  return (
    <li className="border-b border-gray-200 last:border-0 dark:border-slate-700">
      <button
        type="button"
        className="flex w-full items-start gap-4 px-4 py-3.5 text-left transition-colors hover:bg-gray-50 dark:hover:bg-slate-800/60"
        onClick={() => setExpanded((v) => !v)}
        aria-expanded={expanded}
      >
        <span className="mt-0.5 flex-shrink-0 text-gray-400 dark:text-gray-500">
          <svg
            className={`h-4 w-4 transition-transform duration-150 ${expanded ? "rotate-90" : ""}`}
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M9 5l7 7-7 7"
            />
          </svg>
        </span>

        <span className="mt-0.5 flex-shrink-0">
          <StatusBadge status={email.status} />
        </span>

        <span className="min-w-0 flex-1">
          <span className="block truncate font-medium text-gray-900 dark:text-gray-100">
            {email.subject}
          </span>
          <span className="mt-0.5 block text-sm text-gray-500 dark:text-gray-400">
            {email.toAddresses.join(", ")}
          </span>
        </span>

        <span className="flex flex-shrink-0 flex-col items-end gap-1">
          <span className="text-xs text-gray-400 dark:text-gray-500">
            {dateLabel}
          </span>
          {entityLink && (
            <Link
              to={entityLink}
              onClick={(e) => e.stopPropagation()}
              className="text-xs text-[#840606] no-underline hover:underline dark:text-red-400"
            >
              {email.entityType} #{email.entityId}
            </Link>
          )}
        </span>
      </button>

      {showApproverBar && (
        <div className="flex flex-wrap items-center gap-2 border-b border-gray-100 px-4 pb-3 dark:border-slate-700/80">
          <reviewFetcher.Form method="post" className="inline">
            <input type="hidden" name="intent" value={INTENT_REVIEW} />
            <input type="hidden" name="decision" value="approve" />
            <input type="hidden" name="sentEmailId" value={String(email.id)} />
            <button
              type="submit"
              className={approverFormClass(busy)}
              disabled={busy}
            >
              Approve
            </button>
          </reviewFetcher.Form>
          <reviewFetcher.Form method="post" className="inline">
            <input type="hidden" name="intent" value={INTENT_REVIEW} />
            <input type="hidden" name="decision" value="reject" />
            <input type="hidden" name="sentEmailId" value={String(email.id)} />
            <button
              type="submit"
              className={rejectFormClass(busy)}
              disabled={busy}
            >
              Reject
            </button>
          </reviewFetcher.Form>
          <reviewFetcher.Form method="post" className="inline">
            <input type="hidden" name="intent" value={INTENT_PREVIEW} />
            <input type="hidden" name="sentEmailId" value={String(email.id)} />
            <button
              type="submit"
              className={previewFormClass(busy || !hasRegisteredEmail)}
              disabled={busy || !hasRegisteredEmail}
              title={
                hasRegisteredEmail
                  ? "Send a copy to your registered account email to open in your own mail app"
                  : "Add an email to your account to use this"
              }
            >
              Email me a preview
            </button>
          </reviewFetcher.Form>
          {reviewFetcher.data?.error && (
            <p className="w-full text-sm text-red-600 dark:text-red-400">
              {reviewFetcher.data.error}
            </p>
          )}
        </div>
      )}

      {expanded && <EmailPreview email={email} />}
    </li>
  );
}

// ─── Page ─────────────────────────────────────────────────────────────────────

function emailListPageHref(pathname: string, search: string, page: number) {
  const params = new URLSearchParams(search);
  if (page <= 1) {
    params.delete("page");
  } else {
    params.set("page", String(page));
  }
  const qs = params.toString();
  return qs ? `${pathname}?${qs}` : pathname;
}

export default function EmailIndexPage() {
  const {
    pendingApprovalEmails,
    emails,
    counts,
    isApprover,
    hasRegisteredEmail,
    emailListPage,
    emailListTotalPages,
    emailListTotalInWindow,
    emailListMaxAgeHours,
    emailListPageSize,
  } = useLoaderData<typeof loader>();
  const location = useLocation();

  return (
    <div className="p-6 md:p-8">
      <header className="mb-6">
        <h1 className="text-2xl font-semibold text-gray-900 dark:text-gray-100">
          Outbound email
        </h1>
      </header>

      <SummaryStrip counts={counts} />

      {pendingApprovalEmails.length > 0 && (
        <div className="mb-8">
          <h2 className="mb-3 text-base font-semibold text-purple-700 dark:text-purple-400">
            Awaiting approval ({pendingApprovalEmails.length})
          </h2>
          <div className="overflow-hidden rounded-lg border-2 border-purple-300 bg-white shadow-sm dark:border-purple-800 dark:bg-slate-800">
            {pendingApprovalEmails.length === 0 ? null : (
              <ul className="divide-y-0">
                {pendingApprovalEmails.map((email: RowEmail) => (
                  <EmailRow
                    key={email.id}
                    email={email}
                    isApprover={isApprover}
                    hasRegisteredEmail={hasRegisteredEmail}
                  />
                ))}
              </ul>
            )}
          </div>
        </div>
      )}

      <div className="mb-3">
        <h2 className="text-sm font-medium text-gray-500 dark:text-gray-400">
          Recent activity
        </h2>
        <p className="mt-1 text-xs text-gray-400 dark:text-gray-500">
          {emailListMaxAgeHours > 0 ? (
            <>
              Showing sends from the last {emailListMaxAgeHours} hours (
              {emailListTotalInWindow} in range). {emailListPageSize} per page.
              Adjust the window in Admin → Email.
            </>
          ) : (
            <>
              {emailListTotalInWindow} record
              {emailListTotalInWindow === 1 ? "" : "s"} total,{" "}
              {emailListPageSize} per page.
            </>
          )}
        </p>
      </div>
      <div className="overflow-hidden rounded-lg border border-gray-200 bg-white shadow-sm dark:border-slate-700 dark:bg-slate-800">
        {emails.length === 0 ? (
          <p className="px-4 py-10 text-center text-sm text-gray-500 dark:text-gray-400">
            {emailListTotalInWindow === 0
              ? emailListMaxAgeHours > 0
                ? "No outbound email in this time window."
                : "No outbound email has been recorded yet."
              : "No rows on this page."}
          </p>
        ) : (
          <ul className="divide-y-0">
            {emails.map((email: RowEmail) => (
              <EmailRow
                key={email.id}
                email={email}
                isApprover={isApprover}
                hasRegisteredEmail={hasRegisteredEmail}
              />
            ))}
          </ul>
        )}
        {emailListTotalPages > 1 ? (
          <div className="flex flex-wrap items-center justify-between gap-3 border-t border-gray-200 px-4 py-3 text-sm dark:border-slate-700">
            <Link
              to={emailListPageHref(
                location.pathname,
                location.search,
                emailListPage - 1,
              )}
              className={
                emailListPage <= 1
                  ? "pointer-events-none text-gray-300 dark:text-slate-600"
                  : "font-medium text-[#840606] no-underline hover:underline dark:text-red-400"
              }
              aria-disabled={emailListPage <= 1}
            >
              Previous
            </Link>
            <span className="text-gray-600 dark:text-gray-400">
              Page {emailListPage} of {emailListTotalPages}
            </span>
            <Link
              to={emailListPageHref(
                location.pathname,
                location.search,
                emailListPage + 1,
              )}
              className={
                emailListPage >= emailListTotalPages
                  ? "pointer-events-none text-gray-300 dark:text-slate-600"
                  : "font-medium text-[#840606] no-underline hover:underline dark:text-red-400"
              }
              aria-disabled={emailListPage >= emailListTotalPages}
            >
              Next
            </Link>
          </div>
        ) : null}
      </div>
    </div>
  );
}
