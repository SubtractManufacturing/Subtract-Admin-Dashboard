import { json, type ActionFunctionArgs, type LoaderFunctionArgs } from "@remix-run/node";
import { Form, Link, useActionData, useLoaderData, useNavigation } from "@remix-run/react";
import { AlertTriangle, CheckCircle2 } from "lucide-react";
import { useState } from "react";

import Breadcrumbs from "~/components/Breadcrumbs";
import Button from "~/components/shared/Button";
import { requireAuth, withAuthHeaders } from "~/lib/auth.server";
import { assertAuthorized } from "~/lib/authorization/authorize";
import { runCheck } from "~/lib/organizations/check.server";
import type { CheckReport } from "~/lib/organizations/check.server";
import type { DifferenceArea } from "~/lib/organizations/differences";
import { loadReviewRows, reviewProgress } from "~/lib/organizations/review.server";
import { getCutoverStage, STAGE_LABELS } from "~/lib/organizations/stage.server";
import {
  getLastSync,
  runSync,
  SyncError,
  type SyncResult,
} from "~/lib/organizations/sync.server";

/** How many differences the page lists; the counts always cover all of them. */
const LISTED = 300;

/**
 * Staged cutover to Organizations (ADR-0014): the status page. Admin and Dev
 * only. In this release (Shadow) it offers Sync, Check and the review list.
 */
export async function loader({ request }: LoaderFunctionArgs) {
  const { actor, headers } = await requireAuth(request);
  assertAuthorized(actor, "cutover.view");

  const [stage, lastSync, check, reviewRows] = await Promise.all([
    getCutoverStage(),
    getLastSync(),
    runCheck(),
    loadReviewRows(),
  ]);

  return withAuthHeaders(
    json({
      stage: stage
        ? { value: stage.stage, label: STAGE_LABELS[stage.stage], changedAt: stage.changedAt }
        : null,
      lastSync,
      check: { ...check, differences: check.differences.slice(0, LISTED) },
      review: reviewProgress(reviewRows),
    }),
    headers,
  );
}

export async function action({ request }: ActionFunctionArgs) {
  const { actor, headers } = await requireAuth(request);
  // Sync is the only action on this page; refuse before reading the request.
  assertAuthorized(actor, "cutover.sync");
  const form = await request.formData();
  if (form.get("intent") !== "sync") {
    return withAuthHeaders(json({ ok: false as const, error: "Unknown action" }, { status: 400 }), headers);
  }

  try {
    const result = await runSync({ userId: actor.userId, email: actor.email });
    return withAuthHeaders(json({ ok: true as const, result }), headers);
  } catch (error) {
    if (!(error instanceof SyncError)) throw error;
    return withAuthHeaders(json({ ok: false as const, error: error.message }, { status: 409 }), headers);
  }
}

const formatTime = (value: string | Date | null | undefined) =>
  value ? new Date(value).toLocaleString("en-US") : "never";

const plural = (count: number, word: string) => `${count} ${word}${count === 1 ? "" : "s"}`;

const card =
  "rounded-lg border border-gray-200 bg-white p-5 shadow-sm dark:border-gray-700 dark:bg-gray-800";
const heading = "text-lg font-semibold text-gray-900 dark:text-gray-100";
const muted = "text-sm text-gray-600 dark:text-gray-400";

export default function CutoverStatus() {
  const data = useLoaderData<typeof loader>();
  const { stage, lastSync, review } = data;
  // Dates arrive as strings; nothing below reads them as Date.
  const check = data.check as unknown as CheckReport;
  const actionData = useActionData<typeof action>() as
    | { ok: true; result: SyncResult }
    | { ok: false; error: string }
    | undefined;
  const navigation = useNavigation();
  const syncing = navigation.state !== "idle" && navigation.formData?.get("intent") === "sync";
  const checking = navigation.state === "loading" && !navigation.formData;
  const [area, setArea] = useState<DifferenceArea | "all">("all");

  const inShadow = stage?.value === "shadow";
  const differences = check.differences.filter(
    (difference) => area === "all" || difference.area === area,
  );

  return (
    <div className="mx-auto max-w-[1920px]">
      <div className="px-10 py-2.5">
        <Breadcrumbs items={[{ label: "Dashboard", href: "/" }, { label: "Cutover" }]} />
      </div>
      <div className="space-y-6 px-4 pb-10 sm:px-6 lg:px-10">
        <header className="space-y-2">
          <h1 className="text-2xl font-bold text-gray-900 dark:text-gray-100">
            Cutover to Organizations
          </h1>
          <p className={`max-w-3xl ${muted}`}>
            Customers and Vendors are moving to Organizations, Contacts and accounts in stages.
            Staff keep using the app as it is. This page shows where the move stands and offers the
            actions that are valid for the current stage.
          </p>
        </header>

        <section aria-labelledby="stage-heading" className={card} data-testid="cutover-stage">
          <h2 id="stage-heading" className={heading}>
            Stage
          </h2>
          <dl className="mt-3 grid gap-4 sm:grid-cols-3">
            <div>
              <dt className={muted}>Current stage</dt>
              <dd className="text-xl font-bold text-gray-900 dark:text-gray-100" data-testid="stage-value">
                {stage ? stage.label : "Not recorded"}
              </dd>
              {stage && <dd className={muted}>since {formatTime(stage.changedAt)}</dd>}
            </div>
            <div>
              <dt className={muted}>Live tables</dt>
              <dd className="font-semibold text-gray-900 dark:text-gray-100" data-testid="live-tables">
                {inShadow
                  ? "The old tables (customers, vendors)"
                  : "Not served by this release"}
              </dd>
              <dd className={muted}>
                {inShadow
                  ? "The new tables are a copy that Sync fills. Nothing reads them yet."
                  : "This release only works in Shadow. It records Shadow each time it starts."}
              </dd>
            </div>
            <div>
              <dt className={muted}>Old records</dt>
              <dd className="font-semibold text-gray-900 dark:text-gray-100">
                {plural(check.counts.customers, "Customer")}, {plural(check.counts.vendors, "Vendor")}
              </dd>
              <dd className={muted}>
                copied to {plural(check.counts.organizations, "Organization")},{" "}
                {plural(check.counts.contacts, "Contact")}, {plural(check.counts.accounts, "account")}
              </dd>
            </div>
          </dl>
        </section>

        <section aria-labelledby="sync-heading" className={card} data-testid="cutover-sync">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div className="space-y-1">
              <h2 id="sync-heading" className={heading}>
                Sync
              </h2>
              <p className={`max-w-2xl ${muted}`}>
                Makes the copy equal to the old Customers and Vendors, including edits, archives
                and merges made since the last run. It never changes an old record.
              </p>
              <p className={muted} data-testid="last-sync">
                Last Sync:{" "}
                {lastSync
                  ? `${formatTime(lastSync.ranAt)}${lastSync.userEmail ? ` by ${lastSync.userEmail}` : ""}, ${plural(lastSync.applied, "difference")} removed`
                  : "never"}
              </p>
            </div>
            <Form method="post">
              <input type="hidden" name="intent" value="sync" />
              <Button type="submit" disabled={!inShadow || syncing}>
                {syncing ? "Syncing…" : "Run Sync"}
              </Button>
            </Form>
          </div>
          {actionData && !actionData.ok && (
            <p role="alert" className="mt-3 rounded border border-red-300 bg-red-50 p-3 text-sm text-red-900 dark:border-red-800 dark:bg-red-950 dark:text-red-200">
              {actionData.error}
            </p>
          )}
          {actionData?.ok && (
            <p role="status" data-testid="sync-result" className="mt-3 rounded border border-green-300 bg-green-50 p-3 text-sm text-green-900 dark:border-green-800 dark:bg-green-950 dark:text-green-200">
              Sync finished: {plural(actionData.result.applied, "difference")} removed
              {actionData.result.appliedByArea.length > 0 &&
                ` (${actionData.result.appliedByArea.map((row) => `${row.label}: ${row.count}`).join(", ")})`}
              .
              {actionData.result.notFixable > 0 &&
                ` ${plural(actionData.result.notFixable, "difference")} left that Sync does not repair.`}
            </p>
          )}
        </section>

        <section aria-labelledby="check-heading" className={card} data-testid="cutover-check">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div className="space-y-1">
              <h2 id="check-heading" className={heading}>
                Check
              </h2>
              <p className={`max-w-2xl ${muted}`}>
                Every place where the copy is not equal to the old records, which is every place a
                Sync would change something. Read-only.
              </p>
              <p className={muted}>Checked {formatTime(check.checkedAt)}</p>
            </div>
            <Form method="get">
              <Button type="submit" variant="secondary" disabled={checking}>
                {checking ? "Checking…" : "Check again"}
              </Button>
            </Form>
          </div>

          {check.total === 0 ? (
            <div role="status" data-testid="check-headline" className="mt-4 flex items-start gap-3 rounded-lg border border-green-300 bg-green-50 p-4 text-green-900 dark:border-green-800 dark:bg-green-950 dark:text-green-200">
              <CheckCircle2 className="mt-0.5 h-5 w-5 shrink-0" aria-hidden="true" />
              <p className="font-semibold">0 differences. Old and new are equal.</p>
            </div>
          ) : (
            <div role="status" data-testid="check-headline" className="mt-4 flex items-start gap-3 rounded-lg border border-amber-300 bg-amber-50 p-4 text-amber-900 dark:border-amber-700 dark:bg-amber-950 dark:text-amber-200">
              <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0" aria-hidden="true" />
              <div>
                <p className="font-semibold">{plural(check.total, "difference")}.</p>
                <p className="text-sm">
                  {check.fixable > 0 && `Sync removes ${check.fixable} of them. `}
                  {check.notFixable > 0 &&
                    `${check.notFixable} ${check.notFixable === 1 ? "is" : "are"} in a shape Sync does not repair; a developer has to look.`}
                </p>
              </div>
            </div>
          )}

          {check.total > 0 && (
            <>
              <div className="mt-4 flex flex-wrap items-center gap-2 text-sm">
                <label htmlFor="difference-area" className={muted}>
                  Show
                </label>
                <select
                  id="difference-area"
                  value={area}
                  onChange={(event) => setArea(event.target.value as DifferenceArea | "all")}
                  className="h-9 rounded border border-gray-300 bg-white px-2 text-gray-900 dark:border-gray-600 dark:bg-gray-700 dark:text-gray-100"
                >
                  <option value="all">All ({check.total})</option>
                  {check.byArea.map((row) => (
                    <option key={row.area} value={row.area}>
                      {row.label} ({row.count})
                    </option>
                  ))}
                </select>
                {check.total > check.differences.length && (
                  <span className={muted}>
                    Listing the first {check.differences.length} of {check.total}.
                  </span>
                )}
              </div>
              <ul data-testid="differences" className="mt-3 divide-y divide-gray-200 rounded-lg border border-gray-200 dark:divide-gray-700 dark:border-gray-700">
                {differences.map((difference, index) => (
                  <li key={index} className="flex items-start gap-3 px-4 py-2 text-sm">
                    <div className="min-w-0 flex-1">
                      <p className="font-medium text-gray-900 dark:text-gray-100">
                        {check.byArea.find((row) => row.area === difference.area)?.label}
                        {difference.legacyId !== null && (
                          <span className="ml-2 font-normal text-gray-500 dark:text-gray-400">
                            {difference.legacyType === "customer" ? "Customer" : "Vendor"} #
                            {difference.legacyId}
                          </span>
                        )}
                        {difference.name && (
                          <span className="ml-2 font-normal text-gray-500 dark:text-gray-400">
                            {difference.name}
                          </span>
                        )}
                        {!difference.fixable && (
                          <span className="ml-2 rounded bg-red-100 px-1.5 py-0.5 text-xs font-semibold text-red-800 dark:bg-red-900 dark:text-red-200">
                            Sync does not repair this
                          </span>
                        )}
                      </p>
                      <p className="break-words text-gray-700 dark:text-gray-300">{difference.detail}</p>
                    </div>
                    {difference.href && (
                      <Link
                        to={difference.href}
                        className="shrink-0 text-blue-600 hover:underline dark:text-blue-400"
                      >
                        Open
                      </Link>
                    )}
                  </li>
                ))}
              </ul>
            </>
          )}
        </section>

        <section aria-labelledby="review-heading" className={card} data-testid="cutover-review">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div className="space-y-1">
              <h2 id="review-heading" className={heading}>
                Review list
              </h2>
              <p className={`max-w-2xl ${muted}`}>
                Each active Customer and Vendor beside the Organization, type and Contact it
                becomes. Correct the company and contact names here before staff see the new app.
              </p>
              <p className={muted} data-testid="review-progress">
                {review.reviewed} of {review.total} reviewed
                {review.flaggedUnreviewed > 0 &&
                  `, ${review.flaggedUnreviewed} flagged ${review.flaggedUnreviewed === 1 ? "row" : "rows"} still to review`}
                .
              </p>
            </div>
            <Link
              to="/cutover/review"
              className="rounded border border-gray-800 px-4 py-2 font-semibold text-gray-800 hover:bg-gray-50 dark:border-gray-400 dark:text-gray-200 dark:hover:bg-gray-700/30"
            >
              Open the review list
            </Link>
          </div>
        </section>

        <section aria-labelledby="groups-heading" className={`${card} opacity-80`} data-testid="cutover-groups">
          <h2 id="groups-heading" className={heading}>
            Groups list
          </h2>
          <p className={`mt-1 max-w-2xl ${muted}`}>
            Which records are one Organization: two people at one business, or a Customer and a
            Vendor that are the same company. Not in this release; it arrives with the next one.
            Nothing is merged before Unlock.
          </p>
        </section>
      </div>
    </div>
  );
}
