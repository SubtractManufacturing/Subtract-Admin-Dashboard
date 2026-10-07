import { useEffect, useState } from "react";
import {
  json,
  redirect,
  type ActionFunctionArgs,
  type LoaderFunctionArgs,
} from "@remix-run/node";
import { Link, useFetcher, useLoaderData } from "@remix-run/react";

import Button from "~/components/admin/Button";
import AdminPageHeader from "~/components/admin/PageHeader";
import { requireAuth, withAuthHeaders } from "~/lib/auth.server";
import {
  getRfqWebhookSetting,
  saveRfqWebhookSetting,
  sendRfqTestEvent,
} from "~/lib/rfq-intake/outbound-webhook.server";
import {
  listRfqIntakeSubmissions,
  parseRfqSubmissionStatusGroup,
  retryRfqIntakeSubmission,
  RfqSubmissionCommandError,
} from "~/lib/rfq-intake/submissions.server";
import type { ImportStatus } from "~/lib/rfq-intake/types";

const ROUTE_PATH = "/admin/rfq-intake";
type SubmissionRow = Awaited<
  ReturnType<typeof listRfqIntakeSubmissions>
>["rows"][number];

const STATUS_TABS = [
  { value: "all", label: "All" },
  { value: "in_progress", label: "In progress" },
  { value: "failed", label: "Failed" },
  { value: "completed", label: "Completed" },
] as const;

const STATUS_DETAILS: Record<
  ImportStatus,
  { label: string; className: string }
> = {
  pending: {
    label: "Pending",
    className:
      "bg-blue-50 text-blue-700 dark:bg-blue-900/30 dark:text-blue-300",
  },
  processing: {
    label: "Processing",
    className:
      "bg-violet-50 text-violet-700 dark:bg-violet-900/30 dark:text-violet-300",
  },
  retry_scheduled: {
    label: "Retry scheduled",
    className:
      "bg-amber-50 text-amber-700 dark:bg-amber-900/30 dark:text-amber-300",
  },
  cleanup_pending: {
    label: "Cleanup pending",
    className:
      "bg-cyan-50 text-cyan-700 dark:bg-cyan-900/30 dark:text-cyan-300",
  },
  permanent_failure: {
    label: "Failed",
    className:
      "bg-red-50 text-red-700 dark:bg-red-900/30 dark:text-red-300",
  },
  completed: {
    label: "Completed",
    className:
      "bg-emerald-50 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-300",
  },
};

function isAdminOrDev(role: string) {
  return role === "Admin" || role === "Dev";
}

function parsePage(value: string | null) {
  const page = Number(value);
  return Number.isFinite(page) && page > 0 ? Math.floor(page) : 1;
}

export async function loader({ request }: LoaderFunctionArgs) {
  const { userDetails, headers } = await requireAuth(request);
  if (!isAdminOrDev(userDetails.role)) {
    return withAuthHeaders(redirect("/"), headers);
  }

  const url = new URL(request.url);
  const status = parseRfqSubmissionStatusGroup(url.searchParams.get("status"));
  const page = parsePage(url.searchParams.get("page"));
  const [submissions, webhook] = await Promise.all([
    listRfqIntakeSubmissions({ status, page }),
    getRfqWebhookSetting(),
  ]);

  return withAuthHeaders(
    json({ submissions, webhook, status }),
    headers,
  );
}

export async function action({ request }: ActionFunctionArgs) {
  const { userDetails, headers } = await requireAuth(request);
  if (!isAdminOrDev(userDetails.role)) {
    return withAuthHeaders(redirect("/"), headers);
  }

  const formData = await request.formData();
  const intent = formData.get("intent");

  if (intent === "retry") {
    const receiptKey = formData.get("receiptKey");
    if (typeof receiptKey !== "string" || !receiptKey) {
      return withAuthHeaders(
        json(
          { intent, ok: false as const, message: "Submission is required." },
          { status: 400 },
        ),
        headers,
      );
    }

    try {
      await retryRfqIntakeSubmission(receiptKey, {
        role: userDetails.role,
      });
      return withAuthHeaders(
        json({
          intent,
          ok: true as const,
          message: "Submission queued for retry.",
        }),
        headers,
      );
    } catch (error) {
      if (error instanceof RfqSubmissionCommandError) {
        return withAuthHeaders(
          json(
            { intent, ok: false as const, message: error.message },
            { status: error.status },
          ),
          headers,
        );
      }
      throw error;
    }
  }

  if (intent === "saveWebhook") {
    const rawUrl = formData.get("webhookUrl");
    const result = await saveRfqWebhookSetting(
      typeof rawUrl === "string" ? rawUrl : "",
      userDetails.email ?? userDetails.name ?? userDetails.id,
    );
    if (!result.ok) {
      return withAuthHeaders(
        json(
          { intent, ok: false as const, message: result.error },
          { status: 400 },
        ),
        headers,
      );
    }
    return withAuthHeaders(
      json({
        intent,
        ok: true as const,
        message: result.maskedUrl
          ? `Webhook saved as ${result.maskedUrl}.`
          : "Webhook disabled.",
      }),
      headers,
    );
  }

  if (intent === "testWebhook") {
    const rawUrl = formData.get("webhookUrl");
    const currentUrl =
      typeof rawUrl === "string" && rawUrl.trim() ? rawUrl : undefined;
    const result = await sendRfqTestEvent(currentUrl);
    if (!result.ok) {
      return withAuthHeaders(
        json(
          {
            intent,
            ok: false as const,
            message: result.status
              ? `HTTP ${result.status}: ${result.error}`
              : result.error,
          },
          { status: 400 },
        ),
        headers,
      );
    }
    return withAuthHeaders(
      json({
        intent,
        ok: true as const,
        message: `Test event delivered (HTTP ${result.status}).`,
      }),
      headers,
    );
  }

  return withAuthHeaders(
    json(
      { intent: "unknown", ok: false as const, message: "Invalid action." },
      { status: 400 },
    ),
    headers,
  );
}

function formatDateTime(value: string | Date | null) {
  if (!value) return "—";
  return new Date(value).toLocaleString("en-US", {
    dateStyle: "medium",
    timeStyle: "short",
  });
}

function pageUrl(status: string, page: number) {
  const params = new URLSearchParams();
  if (status !== "all") params.set("status", status);
  if (page > 1) params.set("page", String(page));
  const query = params.toString();
  return query ? `${ROUTE_PATH}?${query}` : ROUTE_PATH;
}

export default function AdminRfqIntake() {
  const { submissions, webhook, status } = useLoaderData<typeof loader>();
  const retryFetcher = useFetcher<typeof action>();
  const webhookFetcher = useFetcher<typeof action>();
  const [webhookUrl, setWebhookUrl] = useState("");

  useEffect(() => {
    if (
      webhookFetcher.state === "idle" &&
      webhookFetcher.data?.ok &&
      webhookFetcher.data.intent === "saveWebhook"
    ) {
      setWebhookUrl("");
    }
  }, [webhookFetcher.state, webhookFetcher.data]);

  const retryingReceiptKey =
    retryFetcher.state !== "idle"
      ? retryFetcher.formData?.get("receiptKey")
      : null;
  const firstRow =
    submissions.total === 0
      ? 0
      : (submissions.page - 1) * 25 + 1;
  const lastRow = Math.min(submissions.page * 25, submissions.total);

  return (
    <div className="mx-auto max-w-[1920px]">
      <AdminPageHeader
        breadcrumbs={[
          { label: "Admin", href: "/admin" },
          { label: "RFQ Intake" },
        ]}
      />

      <div className="px-4 py-6 sm:px-6 lg:px-10 lg:py-8">
        <div className="mb-8">
          <h1 className="text-2xl font-semibold text-gray-900 dark:text-white">
            RFQ Intake
          </h1>
          <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">
            Monitor WordPress submissions, retry interrupted imports, and
            configure outbound notifications.
          </p>
        </div>

        <div className="space-y-8">
          <section className="rounded-xl border border-gray-200 bg-white dark:border-slate-700 dark:bg-slate-800">
            <div className="border-b border-gray-200 px-5 pt-5 sm:px-6 dark:border-slate-700">
              <div className="mb-5">
                <h2 className="text-lg font-semibold text-gray-900 dark:text-white">
                  Submissions
                </h2>
                <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">
                  Newest intake ledger entries appear first.
                </p>
              </div>

              <nav className="-mb-px flex gap-6 overflow-x-auto" aria-label="Submission status">
                {STATUS_TABS.map((tab) => {
                  const active = status === tab.value;
                  return (
                    <Link
                      key={tab.value}
                      to={pageUrl(tab.value, 1)}
                      aria-current={active ? "page" : undefined}
                      className={`whitespace-nowrap border-b-2 px-0.5 pb-3 text-sm font-medium no-underline ${
                        active
                          ? "border-[#840606] text-[#840606] dark:border-red-400 dark:text-red-400"
                          : "border-transparent text-gray-500 hover:border-gray-300 hover:text-gray-800 dark:text-gray-400 dark:hover:border-slate-500 dark:hover:text-gray-200"
                      }`}
                    >
                      {tab.label}
                    </Link>
                  );
                })}
              </nav>
            </div>

            {retryFetcher.data && (
              <div
                className={`mx-5 mt-5 rounded-lg border px-4 py-3 text-sm sm:mx-6 ${
                  retryFetcher.data.ok
                    ? "border-emerald-200 bg-emerald-50 text-emerald-900 dark:border-emerald-900/50 dark:bg-emerald-950/40 dark:text-emerald-100"
                    : "border-red-200 bg-red-50 text-red-800 dark:border-red-900/50 dark:bg-red-950/40 dark:text-red-200"
                }`}
                role="status"
              >
                {retryFetcher.data.message}
              </div>
            )}

            {submissions.rows.length === 0 ? (
              <div className="px-6 py-14 text-center text-sm text-gray-500 dark:text-gray-400">
                No submissions in this status.
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full min-w-[1100px] text-left text-sm">
                  <thead>
                    <tr className="border-b border-gray-200 dark:border-slate-700">
                      {[
                        "Received",
                        "Receipt / session",
                        "Status",
                        "Attempts",
                        "Next retry",
                        "Last safe error",
                        "Quote",
                        "Actions",
                      ].map((heading) => (
                        <th
                          key={heading}
                          className="px-4 py-3 text-xs font-semibold uppercase tracking-wider text-gray-500 first:pl-5 last:pr-5 sm:first:pl-6 sm:last:pr-6 dark:text-gray-400"
                        >
                          {heading}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-100 dark:divide-slate-700">
                    {submissions.rows.map((row: SubmissionRow) => {
                      const statusDetail = STATUS_DETAILS[row.status];
                      const isRetrying = retryingReceiptKey === row.receiptKey;
                      return (
                        <tr
                          key={row.receiptKey}
                          className="align-top transition-colors hover:bg-gray-50 dark:hover:bg-slate-700/40"
                        >
                          <td className="whitespace-nowrap px-4 py-3 pl-5 text-gray-600 sm:pl-6 dark:text-gray-300">
                            {formatDateTime(row.receivedAt)}
                          </td>
                          <td className="max-w-[220px] px-4 py-3">
                            <span
                              className="block truncate font-mono text-xs font-medium text-gray-900 dark:text-gray-100"
                              title={row.displayId}
                            >
                              {row.displayId}
                            </span>
                            {!row.receiptNumber && (
                              <span className="mt-0.5 block text-xs text-gray-400 dark:text-gray-500">
                                Session ID
                              </span>
                            )}
                          </td>
                          <td className="whitespace-nowrap px-4 py-3">
                            <span
                              className={`inline-flex rounded-full px-2.5 py-0.5 text-xs font-semibold ${statusDetail.className}`}
                            >
                              {statusDetail.label}
                            </span>
                          </td>
                          <td className="px-4 py-3 text-center tabular-nums text-gray-600 dark:text-gray-300">
                            {row.attemptCount}
                          </td>
                          <td className="whitespace-nowrap px-4 py-3 text-gray-600 dark:text-gray-300">
                            {formatDateTime(row.nextAttemptAt)}
                          </td>
                          <td className="max-w-xs px-4 py-3 text-gray-600 dark:text-gray-300">
                            {row.errorDetail ? (
                              <span className="line-clamp-3" title={row.errorDetail}>
                                {row.errorDetail}
                              </span>
                            ) : (
                              <span className="text-gray-300 dark:text-gray-600">
                                —
                              </span>
                            )}
                          </td>
                          <td className="whitespace-nowrap px-4 py-3">
                            {row.quoteId ? (
                              <Link
                                to={`/quotes/${row.quoteId}`}
                                className="font-medium text-[#840606] no-underline hover:underline dark:text-red-400"
                              >
                                {row.quoteNumber ?? `Quote ${row.quoteId}`}
                              </Link>
                            ) : (
                              <span className="text-gray-300 dark:text-gray-600">
                                —
                              </span>
                            )}
                          </td>
                          <td className="whitespace-nowrap px-4 py-3 pr-5 sm:pr-6">
                            {row.canRetry ? (
                              <retryFetcher.Form method="post" action={ROUTE_PATH}>
                                <input type="hidden" name="intent" value="retry" />
                                <input
                                  type="hidden"
                                  name="receiptKey"
                                  value={row.receiptKey}
                                />
                                <Button
                                  type="submit"
                                  variant="secondary"
                                  size="sm"
                                  disabled={retryFetcher.state !== "idle"}
                                >
                                  {isRetrying ? "Retrying…" : "Retry now"}
                                </Button>
                              </retryFetcher.Form>
                            ) : (
                              <span className="text-gray-300 dark:text-gray-600">
                                —
                              </span>
                            )}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}

            <div className="flex flex-col gap-3 border-t border-gray-200 px-5 py-4 text-sm sm:flex-row sm:items-center sm:justify-between sm:px-6 dark:border-slate-700">
              <p className="text-gray-500 dark:text-gray-400">
                Showing {firstRow}–{lastRow} of {submissions.total}
              </p>
              <div className="flex items-center gap-3">
                <Link
                  to={pageUrl(status, submissions.page - 1)}
                  aria-disabled={submissions.page <= 1}
                  tabIndex={submissions.page <= 1 ? -1 : undefined}
                  className={`rounded-md border px-3 py-1.5 text-sm font-medium no-underline ${
                    submissions.page <= 1
                      ? "pointer-events-none border-gray-200 text-gray-300 dark:border-slate-700 dark:text-slate-600"
                      : "border-gray-300 text-gray-700 hover:bg-gray-50 dark:border-slate-600 dark:text-gray-200 dark:hover:bg-slate-700"
                  }`}
                >
                  Previous
                </Link>
                <span className="tabular-nums text-gray-600 dark:text-gray-300">
                  Page {submissions.page} of {submissions.totalPages}
                </span>
                <Link
                  to={pageUrl(status, submissions.page + 1)}
                  aria-disabled={submissions.page >= submissions.totalPages}
                  tabIndex={
                    submissions.page >= submissions.totalPages ? -1 : undefined
                  }
                  className={`rounded-md border px-3 py-1.5 text-sm font-medium no-underline ${
                    submissions.page >= submissions.totalPages
                      ? "pointer-events-none border-gray-200 text-gray-300 dark:border-slate-700 dark:text-slate-600"
                      : "border-gray-300 text-gray-700 hover:bg-gray-50 dark:border-slate-600 dark:text-gray-200 dark:hover:bg-slate-700"
                  }`}
                >
                  Next
                </Link>
              </div>
            </div>
          </section>

          <section className="rounded-xl border border-gray-200 bg-white p-5 sm:p-6 dark:border-slate-700 dark:bg-slate-800">
            <div className="mb-5">
              <h2 className="text-lg font-semibold text-gray-900 dark:text-white">
                Outbound webhook
              </h2>
              <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">
                Notify an automation endpoint when RFQ intake events occur.
                Leave the URL empty and save to disable delivery.
              </p>
            </div>

            <div className="mb-4 rounded-lg bg-gray-50 px-4 py-3 dark:bg-slate-900/60">
              <span className="text-xs font-semibold uppercase tracking-wider text-gray-400 dark:text-gray-500">
                Saved destination
              </span>
              <p className="mt-1 font-mono text-sm text-gray-700 dark:text-gray-200">
                {webhook.configured ? webhook.maskedUrl : "Disabled"}
              </p>
            </div>

            {webhookFetcher.data && (
              <div
                className={`mb-4 rounded-lg border px-4 py-3 text-sm ${
                  webhookFetcher.data.ok
                    ? "border-emerald-200 bg-emerald-50 text-emerald-900 dark:border-emerald-900/50 dark:bg-emerald-950/40 dark:text-emerald-100"
                    : "border-red-200 bg-red-50 text-red-800 dark:border-red-900/50 dark:bg-red-950/40 dark:text-red-200"
                }`}
                role="status"
              >
                {webhookFetcher.data.message}
              </div>
            )}

            <webhookFetcher.Form
              method="post"
              action={ROUTE_PATH}
              className="space-y-4"
            >
              <div>
                <label
                  htmlFor="webhookUrl"
                  className="mb-1.5 block text-sm font-medium text-gray-700 dark:text-gray-300"
                >
                  Webhook URL
                </label>
                <input
                  id="webhookUrl"
                  name="webhookUrl"
                  type="url"
                  value={webhookUrl}
                  onChange={(event) => setWebhookUrl(event.target.value)}
                  placeholder={
                    webhook.configured
                      ? "Enter a replacement URL"
                      : "https://example.com/webhooks/rfq"
                  }
                  autoComplete="off"
                  className="w-full rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm text-gray-900 placeholder:text-gray-400 focus:border-gray-400 focus:outline-none focus:ring-1 focus:ring-gray-400 dark:border-slate-600 dark:bg-slate-900 dark:text-white dark:placeholder:text-gray-500 dark:focus:border-blue-500 dark:focus:ring-blue-500"
                />
                <p className="mt-1 text-xs text-gray-400 dark:text-gray-500">
                  HTTP and HTTPS URLs are accepted. Test uses the URL currently
                  entered above, or the saved destination when the field is empty.
                </p>
              </div>

              <div className="flex flex-wrap justify-end gap-3 border-t border-gray-200 pt-4 dark:border-slate-700">
                <Button
                  type="submit"
                  name="intent"
                  value="testWebhook"
                  variant="secondary"
                  disabled={webhookFetcher.state !== "idle"}
                >
                  {webhookFetcher.state !== "idle" &&
                  webhookFetcher.formData?.get("intent") === "testWebhook"
                    ? "Sending…"
                    : "Send test event"}
                </Button>
                <Button
                  type="submit"
                  name="intent"
                  value="saveWebhook"
                  disabled={webhookFetcher.state !== "idle"}
                >
                  {webhookFetcher.state !== "idle" &&
                  webhookFetcher.formData?.get("intent") === "saveWebhook"
                    ? "Saving…"
                    : "Save webhook"}
                </Button>
              </div>
            </webhookFetcher.Form>
          </section>
        </div>
      </div>
    </div>
  );
}
