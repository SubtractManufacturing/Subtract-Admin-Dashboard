import { useEffect, useState } from "react";
import { useFetcher, useLoaderData } from "@remix-run/react";

import AdminPageHeader from "~/components/admin/PageHeader";
import type { SingleQuoteSyncReport } from "~/lib/twenty/sync.server";

interface TwentyFailure {
  entityType: "customer" | "quote";
  entityId: number;
  label: string;
  lastError: string | null;
  attemptCount: number;
  lastAttemptAt: string | null;
  nextAttemptAt: string | null;
}

export type TwentyAdminLoaderData = {
  enabled: boolean;
  workspaceUrl: string;
  apiKeyConfigured: boolean;
  syncStartedAt: string | null;
  lastRunAt: string | null;
  syncedQuotes: number;
  failures: TwentyFailure[];
};

export type TwentyAdminActionData = {
  ok: boolean;
  message: string;
  report?: SingleQuoteSyncReport;
};

const BUTTON_CLASS =
  "rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm font-medium text-gray-700 transition hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-40 dark:border-slate-600 dark:bg-slate-900 dark:text-gray-200 dark:hover:bg-slate-700";

function formatTime(value: string | null): string {
  return value ? new Date(value).toLocaleString() : "Never";
}

export default function TwentySettingsPanel() {
  const data = useLoaderData<TwentyAdminLoaderData>();
  const fetcher = useFetcher<TwentyAdminActionData>();
  const [draftUrl, setDraftUrl] = useState(data.workspaceUrl);
  const [quoteNumber, setQuoteNumber] = useState("");
  const report = fetcher.data?.report;
  const isBusy = fetcher.state !== "idle";

  useEffect(() => {
    setDraftUrl(data.workspaceUrl);
  }, [data.workspaceUrl]);

  const submit = (intent: string, fields: Record<string, string> = {}) => {
    fetcher.submit({ intent, ...fields }, { method: "post" });
  };

  return (
    <div className="px-6 py-8 lg:px-10 lg:py-10">
      <AdminPageHeader
        breadcrumbs={[{ label: "Admin", href: "/admin" }, { label: "Twenty CRM" }]}
      />

      <div className="mt-6 mb-8 max-w-3xl">
        <h1 className="text-xl font-semibold text-gray-900 dark:text-white">
          Twenty CRM
        </h1>
        <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">
          One-way sync of customers and new quotes into Twenty. It runs in the
          background every few minutes and never holds up quotes or emails.
        </p>
      </div>

      {fetcher.data && (
        <div
          role="status"
          className={`mb-5 max-w-3xl rounded-lg border px-4 py-3 text-sm ${
            fetcher.data.ok
              ? "border-emerald-200 bg-emerald-50 text-emerald-900 dark:border-emerald-900/50 dark:bg-emerald-950/40 dark:text-emerald-100"
              : "border-red-200 bg-red-50 text-red-900 dark:border-red-900/50 dark:bg-red-950/40 dark:text-red-100"
          }`}
        >
          {fetcher.data.message}
        </div>
      )}

      <section className="max-w-3xl space-y-5 rounded-xl border border-gray-200 bg-white p-5 sm:p-6 dark:border-slate-700 dark:bg-slate-800">
        <div className="flex items-center justify-between gap-4">
          <div>
            <p className="text-sm font-medium text-gray-900 dark:text-white">
              Sync is {data.enabled ? "on" : "off"}
            </p>
            <p className="text-xs text-gray-500 dark:text-gray-400">
              {data.syncStartedAt
                ? `Quotes created since ${formatTime(data.syncStartedAt)} are synced.`
                : "Quotes created after you enable the sync will be synced."}
            </p>
          </div>
          <button
            type="button"
            className={BUTTON_CLASS}
            disabled={isBusy}
            onClick={() => submit(data.enabled ? "disable" : "enable")}
          >
            {data.enabled ? "Disable" : "Enable"}
          </button>
        </div>

        <div>
          <label
            htmlFor="twenty-url"
            className="mb-1 block text-sm font-medium text-gray-700 dark:text-gray-300"
          >
            Workspace URL
          </label>
          <div className="flex items-center gap-2">
            <input
              id="twenty-url"
              type="url"
              value={draftUrl}
              onChange={(event) => setDraftUrl(event.target.value)}
              placeholder="https://api.twenty.com"
              className="min-w-0 flex-1 rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 dark:border-slate-600 dark:bg-slate-900 dark:text-gray-100"
            />
            <button
              type="button"
              className={BUTTON_CLASS}
              disabled={isBusy || draftUrl.trim() === data.workspaceUrl}
              onClick={() => submit("saveUrl", { workspaceUrl: draftUrl })}
            >
              Save
            </button>
          </div>
        </div>

        <div className="flex items-center justify-between gap-4">
          <div>
            <p className="text-sm font-medium text-gray-700 dark:text-gray-300">API key</p>
            <p className="text-xs text-gray-500 dark:text-gray-400">
              {data.apiKeyConfigured
                ? "Configured on the server."
                : "Missing. Set TWENTY_API_KEY on the web and worker services."}
            </p>
          </div>
          <button
            type="button"
            className={BUTTON_CLASS}
            disabled={isBusy}
            onClick={() => submit("test")}
          >
            Test connection
          </button>
        </div>

        <p className="text-xs text-gray-500 dark:text-gray-400">
          Last run: {formatTime(data.lastRunAt)} · Quotes synced: {data.syncedQuotes}
        </p>
      </section>

      <section className="mt-6 max-w-3xl rounded-xl border border-gray-200 bg-white p-5 sm:p-6 dark:border-slate-700 dark:bg-slate-800">
        <h2 className="text-sm font-semibold text-gray-900 dark:text-white">
          Sync one quote
        </h2>
        <p className="mt-1 mb-3 text-xs text-gray-500 dark:text-gray-400">
          Pushes a single quote now and reads it back from Twenty. It works while
          the sync is off and touches no other quote, so run it twice to confirm
          the second run updates the same opportunity.
        </p>
        <div className="flex items-center gap-2">
          <input
            aria-label="Quote number"
            value={quoteNumber}
            onChange={(event) => setQuoteNumber(event.target.value)}
            placeholder="Quote number"
            className="min-w-0 flex-1 rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 dark:border-slate-600 dark:bg-slate-900 dark:text-gray-100"
          />
          <button
            type="button"
            className={BUTTON_CLASS}
            disabled={isBusy || !quoteNumber.trim()}
            onClick={() => submit("syncQuote", { quoteNumber })}
          >
            Sync quote
          </button>
        </div>
        {report && (
          <dl className="mt-4 grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-sm text-gray-700 dark:text-gray-300">
            <dt className="text-gray-500 dark:text-gray-400">Result</dt>
            <dd>{report.created ? "Created" : "Updated existing"}</dd>
            <dt className="text-gray-500 dark:text-gray-400">Opportunities for this quote</dt>
            <dd
              className={
                report.matchingOpportunities === 1
                  ? undefined
                  : "font-medium text-red-700 dark:text-red-300"
              }
            >
              {report.matchingOpportunities}
            </dd>
            <dt className="text-gray-500 dark:text-gray-400">Opportunity</dt>
            <dd>{report.opportunityName ?? report.opportunityId}</dd>
            <dt className="text-gray-500 dark:text-gray-400">Company</dt>
            <dd>{report.company ?? "None"}</dd>
            <dt className="text-gray-500 dark:text-gray-400">Contact</dt>
            <dd>
              {[report.contactName, report.contactEmail].filter(Boolean).join(", ") ||
                "None"}
            </dd>
            <dt className="text-gray-500 dark:text-gray-400">Amount</dt>
            <dd>{report.amount === null ? "None" : `${report.amount.toFixed(2)}`}</dd>
            <dt className="text-gray-500 dark:text-gray-400">rfqStatus</dt>
            <dd>{report.rfqStatus ?? "None"}</dd>
          </dl>
        )}
      </section>

      <section className="mt-6 max-w-3xl rounded-xl border border-gray-200 bg-white p-5 sm:p-6 dark:border-slate-700 dark:bg-slate-800">
        <div className="mb-4 flex items-center justify-between gap-4">
          <h2 className="text-sm font-semibold text-gray-900 dark:text-white">
            Sync failures ({data.failures.length})
          </h2>
          {data.failures.length > 0 && (
            <button
              type="button"
              className={BUTTON_CLASS}
              disabled={isBusy}
              onClick={() => submit("retryAll")}
            >
              Retry all
            </button>
          )}
        </div>

        {data.failures.length === 0 ? (
          <p className="text-sm text-gray-500 dark:text-gray-400">No failures.</p>
        ) : (
          <ul className="divide-y divide-gray-200 dark:divide-slate-700">
            {data.failures.map((failure) => (
              <li
                key={`${failure.entityType}-${failure.entityId}`}
                className="flex items-start justify-between gap-4 py-3"
              >
                <div className="min-w-0">
                  <p className="text-sm font-medium text-gray-900 dark:text-white">
                    {failure.label}{" "}
                    <span className="font-normal text-gray-500 dark:text-gray-400">
                      ({failure.entityType})
                    </span>
                  </p>
                  <p className="mt-0.5 break-words text-sm text-red-700 dark:text-red-300">
                    {failure.lastError}
                  </p>
                  <p className="mt-0.5 text-xs text-gray-500 dark:text-gray-400">
                    {failure.attemptCount} attempt(s). Next automatic retry:{" "}
                    {formatTime(failure.nextAttemptAt)}
                  </p>
                </div>
                <button
                  type="button"
                  className={BUTTON_CLASS}
                  disabled={isBusy}
                  onClick={() =>
                    submit("retry", {
                      entityType: failure.entityType,
                      entityId: String(failure.entityId),
                    })
                  }
                >
                  Retry
                </button>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
