import { json } from "@remix-run/node";
import type { LoaderFunctionArgs } from "@remix-run/node";
import { useLoaderData, Link } from "@remix-run/react";
import { useState } from "react";

import { requireAuth, withAuthHeaders } from "~/lib/auth.server";
import { isOutboundEmailEnabled } from "~/lib/featureFlags";
import {
  listRecentSentEmails,
  getSentEmailStatusCounts,
  type SentEmailListItem,
  type SentEmailStatusCounts,
} from "~/lib/sent-emails.server";
import { sanitizeEmailHtml } from "~/lib/email/sanitize-email-html";

export async function loader({ request }: LoaderFunctionArgs) {
  const { headers } = await requireAuth(request);

  if (!(await isOutboundEmailEnabled())) {
    throw new Response("Access Denied", { status: 403 });
  }

  const [emails, counts] = await Promise.all([
    listRecentSentEmails({ limit: 50 }),
    getSentEmailStatusCounts(),
  ]);

  return withAuthHeaders(
    json({
      emails: emails.map((e) => ({
        ...e,
        createdAt: e.createdAt.toISOString(),
        sentAt: e.sentAt ? e.sentAt.toISOString() : null,
      })),
      counts,
    }),
    headers,
  );
}

// ─── Status badge ────────────────────────────────────────────────────────────

type EmailStatus = SentEmailListItem["status"];

const STATUS_CONFIG: Record<EmailStatus, { label: string; className: string }> =
  {
    queued: {
      label: "Pending",
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
      label: "Pending",
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

function EmailRow({
  email,
}: {
  email: SentEmailListItem & { createdAt: string; sentAt: string | null };
}) {
  const [expanded, setExpanded] = useState(false);

  const entityLink =
    email.entityType === "quote" && email.quoteId
      ? `/quotes/${email.quoteId}`
      : null;

  const displayDate = email.sentAt ?? email.createdAt;
  const dateLabel = new Date(displayDate).toLocaleString(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
  });

  return (
    <li className="border-b border-gray-200 last:border-0 dark:border-slate-700">
      <button
        type="button"
        className="flex w-full items-start gap-4 px-4 py-3.5 text-left transition-colors hover:bg-gray-50 dark:hover:bg-slate-800/60"
        onClick={() => setExpanded((v) => !v)}
        aria-expanded={expanded}
      >
        {/* Expand chevron */}
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

        {/* Status badge */}
        <span className="mt-0.5 flex-shrink-0">
          <StatusBadge status={email.status} />
        </span>

        {/* Main content */}
        <span className="min-w-0 flex-1">
          <span className="block truncate font-medium text-gray-900 dark:text-gray-100">
            {email.subject}
          </span>
          <span className="mt-0.5 block text-sm text-gray-500 dark:text-gray-400">
            {email.toAddresses.join(", ")}
          </span>
        </span>

        {/* Right meta */}
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

      {expanded && <EmailPreview email={email} />}
    </li>
  );
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function EmailIndexPage() {
  const { emails, counts } = useLoaderData<typeof loader>();

  return (
    <div className="p-6 md:p-8">
      <header className="mb-6">
        <h1 className="text-2xl font-semibold text-gray-900 dark:text-gray-100">
          Outbound email
        </h1>
        <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">
          All outbound emails. Click any row to preview the rendered message.
        </p>
      </header>

      <SummaryStrip counts={counts} />

      <div className="overflow-hidden rounded-lg border border-gray-200 bg-white shadow-sm dark:border-slate-700 dark:bg-slate-800">
        {emails.length === 0 ? (
          <p className="px-4 py-10 text-center text-sm text-gray-500 dark:text-gray-400">
            No outbound emails have been recorded yet.
          </p>
        ) : (
          <ul className="divide-y-0">
            {emails.map((email: SentEmailListItem & { createdAt: string; sentAt: string | null }) => (
              <EmailRow key={email.id} email={email} />
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
