import { useEffect, useRef, useState } from "react";
import { Link, useFetcher, useLoaderData } from "@remix-run/react";

import Button from "~/components/admin/Button";
import AdminPageHeader from "~/components/admin/PageHeader";
import ToggleSlider from "~/components/shared/ToggleSlider";
import {
  explainTwentyFailure,
  type TwentyHealth,
  type TwentyHealthState,
} from "~/lib/twenty/health";
import type { CompanyChoiceDetail, TwentyCompanySummary } from "~/lib/twenty/matching";
import type { SingleQuoteSyncReport } from "~/lib/twenty/sync.server";

interface TwentyFailure {
  entityType: "customer" | "quote";
  entityId: number;
  label: string;
  lastError: string | null;
  companyChoice: CompanyChoiceDetail | null;
  attemptCount: number;
  lastAttemptAt: string | null;
  nextAttemptAt: string | null;
}

interface TwentyWarning {
  customerId: number;
  customerName: string;
  warning: string;
}

export type TwentyAdminLoaderData = {
  enabled: boolean;
  workspaceUrl: string;
  apiKeyConfigured: boolean;
  syncStartedAt: string | null;
  health: TwentyHealth;
  lastRunLabel: string;
  syncedQuotes: number;
  pendingCount: number;
  failureCount: number;
  failures: TwentyFailure[];
  warnings: TwentyWarning[];
};

export type TwentyAdminActionData = {
  ok: boolean;
  message: string;
  report?: SingleQuoteSyncReport;
  companies?: TwentyCompanySummary[];
};

const CARD_CLASS =
  "rounded-xl border border-gray-200 bg-white p-5 sm:p-6 dark:border-slate-700 dark:bg-slate-800";
const FOCUS_CLASS =
  "focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 focus-visible:ring-offset-2 dark:focus-visible:ring-offset-slate-800";
const INPUT_CLASS =
  "w-full min-w-0 rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm text-gray-900 placeholder:text-gray-400 focus:border-gray-400 focus:outline-none focus:ring-1 focus:ring-gray-400 disabled:opacity-50 dark:border-slate-600 dark:bg-slate-900 dark:text-white dark:placeholder:text-gray-500 dark:focus:border-blue-500 dark:focus:ring-blue-500";
const LABEL_CLASS = "mb-1 block text-sm font-medium text-gray-700 dark:text-gray-300";
const SUMMARY_CLASS = `cursor-pointer rounded text-sm font-semibold text-gray-900 dark:text-white ${FOCUS_CLASS}`;

const HEALTH_STYLES: Record<TwentyHealthState, { pill: string; dot: string; label: string }> = {
  healthy: {
    pill: "bg-emerald-50 text-emerald-800 dark:bg-emerald-950/50 dark:text-emerald-200",
    dot: "bg-emerald-500",
    label: "Healthy",
  },
  catching_up: {
    pill: "bg-blue-50 text-blue-800 dark:bg-blue-950/50 dark:text-blue-200",
    dot: "bg-blue-500",
    label: "Catching up",
  },
  attention: {
    pill: "bg-amber-50 text-amber-900 dark:bg-amber-950/50 dark:text-amber-200",
    dot: "bg-amber-500",
    label: "Attention",
  },
  stopped: {
    pill: "bg-red-50 text-red-800 dark:bg-red-950/50 dark:text-red-200",
    dot: "bg-red-500",
    label: "Stopped",
  },
  off: {
    pill: "bg-gray-100 text-gray-700 dark:bg-slate-700 dark:text-gray-200",
    dot: "bg-gray-400",
    label: "Off",
  },
  setup: {
    pill: "bg-gray-100 text-gray-700 dark:bg-slate-700 dark:text-gray-200",
    dot: "bg-gray-400",
    label: "Not set up",
  },
};

/**
 * The server does not know the viewer's locale or time zone, so the first render
 * is a fixed UTC string that matches on both sides, then local time after mount.
 */
function formatDateTime(value: string | null, isMounted: boolean): string {
  if (!value) return "Not scheduled";
  const date = new Date(value);
  return isMounted
    ? date.toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" })
    : date.toISOString().replace("T", " ").replace(/:\d{2}\.\d{3}Z$/, " UTC");
}

function Fact({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="min-w-0">
      <dt className="text-xs text-gray-500 dark:text-gray-400">{label}</dt>
      <dd className="mt-0.5 text-sm font-medium text-gray-900 dark:text-white">{value}</dd>
    </div>
  );
}

function TechnicalDetails({ text }: { text: string }) {
  return (
    <details className="mt-1">
      <summary className={`cursor-pointer rounded text-xs text-gray-500 dark:text-gray-400 ${FOCUS_CLASS}`}>
        Technical details
      </summary>
      <pre className="mt-1 max-h-40 overflow-auto whitespace-pre-wrap rounded bg-gray-50 p-2 text-xs text-gray-700 [overflow-wrap:anywhere] dark:bg-slate-900 dark:text-gray-300">
        {text}
      </pre>
    </details>
  );
}

function CompanySelect({
  id,
  companies,
  newCompanyName,
  disabled,
  onChoose,
}: {
  id: string;
  companies: TwentyCompanySummary[];
  newCompanyName?: string;
  disabled: boolean;
  onChoose: (companyId: string) => void;
}) {
  const [selected, setSelected] = useState("");
  return (
    <form
      className="mt-2 flex flex-col gap-2 sm:flex-row sm:items-end"
      onSubmit={(event) => {
        event.preventDefault();
        if (selected) onChoose(selected);
      }}
    >
      <div className="min-w-0 flex-1">
        <label htmlFor={id} className={LABEL_CLASS}>
          Company in Twenty
        </label>
        <select
          id={id}
          value={selected}
          disabled={disabled}
          onChange={(event) => setSelected(event.target.value)}
          className={INPUT_CLASS}
        >
          <option value="">Choose a company</option>
          {companies.map((company) => (
            <option key={company.id} value={company.id}>
              {company.name}
              {company.domain ? ` (${company.domain})` : ""}
            </option>
          ))}
          {newCompanyName && <option value="new">Create new: {newCompanyName}</option>}
        </select>
      </div>
      <Button type="submit" disabled={disabled || !selected} className={`shrink-0 ${FOCUS_CLASS}`}>
        Use this company
      </Button>
    </form>
  );
}

function ChangeCompany({ customerId }: { customerId: number }) {
  const lookup = useFetcher<TwentyAdminActionData>();
  const save = useFetcher<TwentyAdminActionData>();
  const companies = lookup.data?.companies;
  const isLoading = lookup.state !== "idle";

  if (save.data?.ok) {
    return <p className="mt-2 text-sm text-gray-600 dark:text-gray-300">{save.data.message}</p>;
  }
  return (
    <div className="mt-3">
      {!companies && (
        <Button
          type="button"
          variant="secondary"
          size="sm"
          disabled={isLoading}
          className={FOCUS_CLASS}
          onClick={() => lookup.submit({ intent: "loadCompanies" }, { method: "post" })}
        >
          {isLoading ? "Loading companies…" : "Wrong company? Change it"}
        </Button>
      )}
      {lookup.data && !lookup.data.ok && (
        <p className="mt-1 text-sm text-red-700 dark:text-red-300">{lookup.data.message}</p>
      )}
      {companies && (
        <CompanySelect
          id={`change-company-${customerId}`}
          companies={companies}
          disabled={save.state !== "idle"}
          onChoose={(companyId) =>
            save.submit(
              { intent: "chooseCompany", customerId: String(customerId), companyId },
              { method: "post" },
            )
          }
        />
      )}
      {save.data && !save.data.ok && (
        <p className="mt-1 text-sm text-red-700 dark:text-red-300">{save.data.message}</p>
      )}
    </div>
  );
}

function QuoteResult({ report }: { report: SingleQuoteSyncReport }) {
  const rows: Array<[string, string]> = [
    ["Opportunity", report.opportunityName ?? report.opportunityId],
    ["Company", report.company ?? "None"],
    [
      "Contact",
      [report.contactName, report.contactEmail].filter(Boolean).join(", ") || "None",
    ],
    [
      "Amount",
      report.amount === null
        ? "None"
        : report.amount.toLocaleString(undefined, { style: "currency", currency: "USD" }),
    ],
    ["RFQ status", report.rfqStatus ?? "None"],
  ];
  return (
    <div className="mt-4 rounded-lg bg-gray-50 p-4 dark:bg-slate-900/60">
      <p className="text-sm font-medium text-gray-900 dark:text-white">
        {report.created ? "Added to Twenty" : "Updated in Twenty"}
      </p>
      {report.matchingOpportunities !== 1 && (
        <p className="mt-1 text-sm text-red-700 dark:text-red-300">
          Expected 1 opportunity for this quote but found {report.matchingOpportunities}.
        </p>
      )}
      <dl className="mt-2 space-y-2 text-sm sm:grid sm:grid-cols-[auto_1fr] sm:gap-x-4 sm:gap-y-1 sm:space-y-0">
        {rows.map(([label, value]) => (
          <div key={label} className="contents">
            <dt className="text-gray-500 dark:text-gray-400">{label}</dt>
            <dd className="text-gray-900 [overflow-wrap:anywhere] dark:text-gray-100">{value}</dd>
          </div>
        ))}
      </dl>
      {report.warning && (
        <p className="mt-2 text-sm text-amber-800 dark:text-amber-300">{report.warning}</p>
      )}
      <ChangeCompany key={report.opportunityId} customerId={report.customerId} />
    </div>
  );
}

function SetupSteps({
  hasKey,
  hasUrl,
}: {
  hasKey: boolean;
  hasUrl: boolean;
}) {
  const steps: Array<[boolean, string]> = [
    [hasKey, "API key: whoever maintains the server sets TWENTY_API_KEY on the web and worker services."],
    [hasUrl, "Workspace URL: enter it under Connection below."],
  ];
  return (
    <ol className="mt-4 space-y-1 text-sm text-gray-700 dark:text-gray-300">
      {steps.map(([done, text]) => (
        <li key={text} className="flex gap-2">
          <span aria-hidden className={done ? "text-emerald-600 dark:text-emerald-400" : "text-gray-400"}>
            {done ? "✓" : "○"}
          </span>
          <span>
            <span className="sr-only">{done ? "Done: " : "To do: "}</span>
            {text}
          </span>
        </li>
      ))}
      <li className="flex gap-2">
        <span aria-hidden className="text-gray-400">○</span>
        <span>
          <span className="sr-only">To do: </span>
          Test the connection, then turn on automatic sync.
        </span>
      </li>
    </ol>
  );
}

export default function TwentySettingsPanel() {
  const data = useLoaderData<TwentyAdminLoaderData>();
  const fetcher = useFetcher<TwentyAdminActionData>();
  const [draftUrl, setDraftUrl] = useState(data.workspaceUrl);
  const [quoteNumber, setQuoteNumber] = useState("");
  const [isMounted, setIsMounted] = useState(false);

  const isBusy = fetcher.state !== "idle";
  const activeIntent = isBusy ? String(fetcher.formData?.get("intent") ?? "") : null;
  const report = !isBusy ? fetcher.data?.report : undefined;
  // Feedback belongs beside the control that caused it, which can be far down the page.
  const lastIntent = useRef<string | null>(null);
  if (activeIntent) lastIntent.current = activeIntent;
  const quoteError =
    !isBusy && lastIntent.current === "syncQuote" && fetcher.data && !fetcher.data.ok
      ? fetcher.data.message
      : null;
  const banner =
    !isBusy && lastIntent.current !== "syncQuote" ? fetcher.data?.message : undefined;
  const isSetup = data.health.state === "setup";
  const canUseTwenty = data.apiKeyConfigured && Boolean(data.workspaceUrl);
  const style = HEALTH_STYLES[data.health.state];

  useEffect(() => {
    setDraftUrl(data.workspaceUrl);
  }, [data.workspaceUrl]);

  useEffect(() => {
    setIsMounted(true);
  }, []);

  const submit = (intent: string, fields: Record<string, string> = {}) => {
    fetcher.submit({ intent, ...fields }, { method: "post" });
  };

  // One customer's company decision can hold up several records; it's still one decision.
  const decisions = new Map<number, { choice: CompanyChoiceDetail; records: string[] }>();
  for (const failure of data.failures) {
    if (!failure.companyChoice) continue;
    const key = failure.companyChoice.customerId;
    const decision = decisions.get(key) ?? { choice: failure.companyChoice, records: [] };
    decision.records.push(failure.label);
    decisions.set(key, decision);
  }
  const otherFailures = data.failures.filter((failure) => !failure.companyChoice);
  const hasProblems =
    decisions.size > 0 || otherFailures.length > 0 || data.warnings.length > 0;

  return (
    <div className="px-6 py-8 lg:px-10 lg:py-10">
      <AdminPageHeader
        breadcrumbs={[{ label: "Admin", href: "/admin" }, { label: "Twenty CRM" }]}
      />

      <div className="mt-6 mb-6 max-w-3xl">
        <h1 className="text-xl font-semibold text-gray-900 dark:text-white">Twenty CRM</h1>
        <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">
          Copies customers and new quotes from the ERP into Twenty in the background.
          Changes made in Twenty don&apos;t come back here.
        </p>
      </div>

      <div className="max-w-3xl space-y-6">
        <div role="status" aria-live="polite">
          {banner && fetcher.data && (
            <div
              className={`rounded-lg border px-4 py-3 text-sm ${
                fetcher.data.ok
                  ? "border-emerald-200 bg-emerald-50 text-emerald-900 dark:border-emerald-900/50 dark:bg-emerald-950/40 dark:text-emerald-100"
                  : "border-red-200 bg-red-50 text-red-900 [overflow-wrap:anywhere] dark:border-red-900/50 dark:bg-red-950/40 dark:text-red-100"
              }`}
            >
              {banner}
            </div>
          )}
        </div>

        <section aria-labelledby="twenty-health" className={CARD_CLASS}>
          <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
            <div className="min-w-0">
              <span
                className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-xs font-medium ${style.pill}`}
              >
                <span aria-hidden className={`h-1.5 w-1.5 rounded-full ${style.dot}`} />
                {style.label}
              </span>
              <h2 id="twenty-health" className="mt-2 text-lg font-semibold text-gray-900 dark:text-white">
                {data.health.title}
              </h2>
              <p className="mt-1 text-sm text-gray-600 dark:text-gray-300">{data.health.detail}</p>
            </div>
            <ToggleSlider
              label="Automatic sync"
              checked={data.enabled}
              disabled={isBusy || (!data.enabled && !canUseTwenty)}
              onChange={(checked) => submit(checked ? "enable" : "disable")}
              className="shrink-0"
            />
          </div>

          {isSetup ? (
            <SetupSteps hasKey={data.apiKeyConfigured} hasUrl={Boolean(data.workspaceUrl)} />
          ) : (
            <dl className="mt-5 grid grid-cols-2 gap-4 border-t border-gray-100 pt-4 sm:grid-cols-4 dark:border-slate-700">
              <Fact label="Last run" value={data.lastRunLabel} />
              <Fact label="Quotes synced" value={data.syncedQuotes} />
              <Fact label="Waiting" value={data.pendingCount} />
              <Fact label="Blocked" value={data.failureCount} />
            </dl>
          )}
        </section>

        {hasProblems && (
          <section aria-labelledby="twenty-attention" className={CARD_CLASS}>
            <div className="flex items-center justify-between gap-4">
              <h2 id="twenty-attention" className="text-sm font-semibold text-gray-900 dark:text-white">
                To resolve
              </h2>
              {otherFailures.length > 1 && (
                <Button
                  type="button"
                  variant="secondary"
                  size="sm"
                  disabled={isBusy}
                  className={FOCUS_CLASS}
                  onClick={() => submit("retryAll")}
                >
                  {activeIntent === "retryAll" ? "Retrying…" : "Retry all"}
                </Button>
              )}
            </div>

            <ul className="mt-2 divide-y divide-gray-100 dark:divide-slate-700">
              {[...decisions.entries()].map(([customerId, { choice, records }]) => (
                <li key={customerId} className="py-4">
                  <p className="text-sm font-medium text-gray-900 [overflow-wrap:anywhere] dark:text-white">
                    Which company is {choice.companyName}?
                  </p>
                  <p className="mt-0.5 text-sm text-gray-600 dark:text-gray-300">
                    More than one company in Twenty could match. Choosing once settles
                    all of these: {records.join(", ")}.
                  </p>
                  <CompanySelect
                    id={`company-choice-${customerId}`}
                    companies={choice.candidates}
                    newCompanyName={choice.companyName}
                    disabled={isBusy}
                    onChoose={(companyId) =>
                      submit("chooseCompany", { customerId: String(customerId), companyId })
                    }
                  />
                </li>
              ))}

              {otherFailures.map((failure) => {
                const { summary, retriesItself } = explainTwentyFailure(failure.lastError);
                const retrying =
                  activeIntent === "retry" &&
                  fetcher.formData?.get("entityId") === String(failure.entityId);
                return (
                  <li
                    key={`${failure.entityType}-${failure.entityId}`}
                    className="flex flex-col gap-3 py-4 sm:flex-row sm:items-start sm:justify-between"
                  >
                    <div className="min-w-0 flex-1">
                      <p className="text-sm font-medium text-gray-900 [overflow-wrap:anywhere] dark:text-white">
                        {failure.label}
                      </p>
                      <p className="mt-0.5 text-sm text-gray-600 dark:text-gray-300">{summary}</p>
                      <p className="mt-0.5 text-xs text-gray-500 dark:text-gray-400">
                        {retriesItself
                          ? `Next try ${formatDateTime(failure.nextAttemptAt, isMounted)}`
                          : `Tried ${failure.attemptCount} time${failure.attemptCount === 1 ? "" : "s"}`}
                      </p>
                      {failure.lastError && <TechnicalDetails text={failure.lastError} />}
                    </div>
                    <Button
                      type="button"
                      variant="secondary"
                      size="sm"
                      disabled={isBusy}
                      className={`shrink-0 self-start ${FOCUS_CLASS}`}
                      onClick={() =>
                        submit("retry", {
                          entityType: failure.entityType,
                          entityId: String(failure.entityId),
                        })
                      }
                    >
                      {retrying ? "Retrying…" : "Retry"}
                    </Button>
                  </li>
                );
              })}

              {data.warnings.map((item) => (
                <li key={item.customerId} className="py-4">
                  <Link
                    to={`/customers/${item.customerId}`}
                    className={`rounded text-sm font-medium text-gray-900 underline [overflow-wrap:anywhere] dark:text-white ${FOCUS_CLASS}`}
                  >
                    {item.customerName}
                  </Link>
                  <p className="mt-0.5 text-sm text-gray-600 [overflow-wrap:anywhere] dark:text-gray-300">
                    {item.warning}
                  </p>
                </li>
              ))}
            </ul>
          </section>
        )}

        <details open={isSetup} className={CARD_CLASS}>
          <summary className={SUMMARY_CLASS}>Connection</summary>
          <div className="mt-4 space-y-5">
            <fetcher.Form method="post">
              <input type="hidden" name="intent" value="saveUrl" />
              <label htmlFor="twenty-url" className={LABEL_CLASS}>
                Workspace URL
              </label>
              <div className="flex flex-col gap-2 sm:flex-row">
                <input
                  id="twenty-url"
                  name="workspaceUrl"
                  type="url"
                  aria-describedby="twenty-url-help"
                  value={draftUrl}
                  onChange={(event) => setDraftUrl(event.target.value)}
                  placeholder="https://api.twenty.com"
                  className={INPUT_CLASS}
                />
                <Button
                  type="submit"
                  disabled={isBusy || draftUrl.trim() === data.workspaceUrl}
                  className={`shrink-0 ${FOCUS_CLASS}`}
                >
                  {activeIntent === "saveUrl" ? "Saving…" : "Save"}
                </Button>
              </div>
              <p id="twenty-url-help" className="mt-1 text-xs text-gray-500 dark:text-gray-400">
                Changing this starts over: records link to the new workspace on their next sync.
              </p>
            </fetcher.Form>

            <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <p className="text-sm font-medium text-gray-700 dark:text-gray-300">API key</p>
                <p className="text-xs text-gray-500 dark:text-gray-400">
                  {data.apiKeyConfigured
                    ? "Configured on the server."
                    : "Missing. It's set on the server, not here."}
                </p>
              </div>
              <Button
                type="button"
                variant="secondary"
                disabled={isBusy || !canUseTwenty}
                className={`shrink-0 ${FOCUS_CLASS}`}
                onClick={() => submit("test")}
              >
                {activeIntent === "test" ? "Testing…" : "Test connection"}
              </Button>
            </div>

            {data.syncStartedAt && (
              <p className="text-xs text-gray-500 dark:text-gray-400">
                Automatic sync covers quotes created since {formatDateTime(data.syncStartedAt, isMounted)}.
              </p>
            )}
          </div>
        </details>

        <details className={CARD_CLASS}>
          <summary className={SUMMARY_CLASS}>Sync one quote now</summary>
          <fetcher.Form method="post" className="mt-4">
            <input type="hidden" name="intent" value="syncQuote" />
            <label htmlFor="twenty-quote" className={LABEL_CLASS}>
              Quote number
            </label>
            <div className="flex flex-col gap-2 sm:flex-row">
              <input
                id="twenty-quote"
                name="quoteNumber"
                value={quoteNumber}
                onChange={(event) => setQuoteNumber(event.target.value)}
                aria-describedby="twenty-quote-help"
                placeholder="Q2611-A100"
                className={INPUT_CLASS}
              />
              <Button
                type="submit"
                disabled={isBusy || !canUseTwenty || !quoteNumber.trim()}
                className={`shrink-0 ${FOCUS_CLASS}`}
              >
                {activeIntent === "syncQuote" ? "Syncing…" : "Sync quote"}
              </Button>
            </div>
            <p id="twenty-quote-help" className="mt-1 text-xs text-gray-500 dark:text-gray-400">
              Sends just this quote right away, even with automatic sync off.
            </p>
          </fetcher.Form>
          {quoteError && (
            <p className="mt-3 text-sm text-red-700 [overflow-wrap:anywhere] dark:text-red-300">
              {quoteError}
            </p>
          )}
          {report && <QuoteResult report={report} />}
        </details>
      </div>
    </div>
  );
}
