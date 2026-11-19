import { json, type LoaderFunctionArgs } from "@remix-run/node";
import { Link, useLoaderData, useSearchParams } from "@remix-run/react";
import { AlertTriangle, CheckCircle2, Info } from "lucide-react";

import Breadcrumbs from "~/components/Breadcrumbs";
import { requireAuth, withAuthHeaders } from "~/lib/auth.server";
import { assertAuthorized } from "~/lib/authorization/authorize";
import {
  runReconciliation,
  type ReconciliationCheck,
  type ReconciliationFinding,
} from "~/lib/organizations/reconciliation.server";

type ReportView = {
  generatedAt: string;
  cutoverAt: string | null;
  legacyCustomers: number;
  legacyVendors: number;
  checks: ReconciliationCheck[];
  findings: ReconciliationFinding[];
  blocking: number;
  info: number;
  safeToDrop: boolean;
};

/**
 * ADR-0013 deployment 1: checks every legacy Customer and Vendor against its
 * Organization, Contact, account and addresses. Removed in deployment 2
 * together with the legacy tables.
 */
export async function loader({ request }: LoaderFunctionArgs) {
  const { actor, headers } = await requireAuth(request);
  assertAuthorized(actor, "reconciliation.view");
  const report = await runReconciliation();
  return withAuthHeaders(json({ report }), headers);
}

const formatDate = (value: string | null) =>
  value ? new Date(value).toLocaleString("en-US") : "never";

export default function Reconciliation() {
  const report = useLoaderData<typeof loader>().report as unknown as ReportView;
  const [params, setParams] = useSearchParams();
  const show = params.get("show") === "all" ? "all" : "blocking";
  const visible = report.findings.filter((finding) => show === "all" || finding.severity === "blocking");

  return (
    <div className="mx-auto max-w-[1920px]">
      <div className="px-10 py-2.5">
        <Breadcrumbs
          items={[
            { label: "Dashboard", href: "/" },
            { label: "Customers", href: "/customers" },
            { label: "Reconciliation" },
          ]}
        />
      </div>
      <div className="space-y-6 px-4 pb-10 sm:px-6 lg:px-10">
        <header className="space-y-2">
          <h1 className="text-2xl font-bold text-gray-900 dark:text-gray-100">Organizations reconciliation</h1>
          <p className="max-w-3xl text-sm text-gray-600 dark:text-gray-400">
            Every legacy Customer and Vendor is checked against its Organization, Contact, account
            and addresses, and every Quote, Order, Part, email alias, attachment, communication,
            Note, Event log and Action Item that referenced it is checked against its new link.
            Differences explained by work done in the app since cutover are listed as information.
          </p>
          <p className="text-xs text-gray-500 dark:text-gray-400">
            {report.legacyCustomers} legacy Customers · {report.legacyVendors} legacy Vendors · backfill ran{" "}
            {formatDate(report.cutoverAt)} · checked {formatDate(report.generatedAt)}
          </p>
        </header>

        {report.safeToDrop ? (
          <div role="status" className="flex items-start gap-3 rounded-lg border border-green-300 bg-green-50 p-4 text-green-900 dark:border-green-800 dark:bg-green-950 dark:text-green-200">
            <CheckCircle2 className="mt-0.5 h-5 w-5 shrink-0" aria-hidden="true" />
            <div>
              <p className="font-semibold">No mismatches. The legacy tables are safe to drop.</p>
              <p className="text-sm">
                Deployment 2 can make the new foreign keys required and drop customers, vendors and
                their alias, attachment and communication tables.
                {report.info > 0 && ` ${report.info} informational differences are listed below.`}
              </p>
            </div>
          </div>
        ) : (
          <div role="alert" className="flex items-start gap-3 rounded-lg border border-red-300 bg-red-50 p-4 text-red-900 dark:border-red-800 dark:bg-red-950 dark:text-red-200">
            <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0" aria-hidden="true" />
            <div>
              <p className="font-semibold">
                {report.cutoverAt === null
                  ? "The backfill has not run on this database."
                  : `${report.blocking} mismatch${report.blocking === 1 ? "" : "es"} to fix. Do not drop the legacy tables yet.`}
              </p>
              <p className="text-sm">Fix each one, or fix the backfill and run it again: it skips rows it already copied.</p>
            </div>
          </div>
        )}

        <section aria-labelledby="checks-heading" className="rounded-lg border border-gray-200 bg-white shadow-sm dark:border-gray-700 dark:bg-gray-800">
          <h2 id="checks-heading" className="border-b border-gray-200 px-4 py-3 text-lg font-semibold text-gray-900 dark:border-gray-700 dark:text-gray-100">
            Checks
          </h2>
          <table className="min-w-full text-sm">
            <thead className="bg-gray-50 text-left text-xs uppercase tracking-wide text-gray-500 dark:bg-gray-900/40 dark:text-gray-400">
              <tr>
                <th className="px-4 py-2">Check</th>
                <th className="px-4 py-2 text-right">Checked</th>
                <th className="px-4 py-2 text-right">Mismatches</th>
                <th className="px-4 py-2 text-right">Information</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100 dark:divide-gray-700">
              {report.checks.map((check) => (
                <tr key={check.name}>
                  <td className="px-4 py-2 text-gray-900 dark:text-gray-100">{check.name}</td>
                  <td className="px-4 py-2 text-right tabular-nums text-gray-700 dark:text-gray-300">{check.checked}</td>
                  <td className={`px-4 py-2 text-right tabular-nums ${check.blocking > 0 ? "font-semibold text-red-700 dark:text-red-300" : "text-gray-500"}`}>
                    {check.blocking}
                  </td>
                  <td className="px-4 py-2 text-right tabular-nums text-gray-500">{check.info}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>

        <section aria-labelledby="findings-heading" className="space-y-3">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <h2 id="findings-heading" className="text-lg font-semibold text-gray-900 dark:text-gray-100">
              {show === "all" ? "All findings" : "Mismatches"}
            </h2>
            <button
              type="button"
              className="text-sm text-blue-600 hover:underline dark:text-blue-400"
              onClick={() => setParams(show === "all" ? {} : { show: "all" }, { replace: true })}
            >
              {show === "all" ? "Show mismatches only" : `Also show ${report.info} informational`}
            </button>
          </div>
          {visible.length === 0 ? (
            <p className="rounded-lg border border-dashed border-gray-300 px-4 py-8 text-center text-sm text-gray-600 dark:border-gray-600 dark:text-gray-400">
              Nothing to show.
            </p>
          ) : (
            <ul className="divide-y divide-gray-200 rounded-lg border border-gray-200 bg-white dark:divide-gray-700 dark:border-gray-700 dark:bg-gray-800">
              {visible.map((finding, index) => (
                <li key={`${finding.check}-${index}`} className="flex items-start gap-3 px-4 py-3 text-sm">
                  {finding.severity === "blocking" ? (
                    <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-red-600" aria-label="Mismatch" />
                  ) : (
                    <Info className="mt-0.5 h-4 w-4 shrink-0 text-gray-400" aria-label="Information" />
                  )}
                  <div className="min-w-0 flex-1">
                    <p className="font-medium text-gray-900 dark:text-gray-100">
                      {finding.check}
                      {finding.legacyId !== null && (
                        <span className="ml-2 font-normal text-gray-500">
                          legacy {finding.legacyType} #{finding.legacyId}
                          {finding.legacyName ? ` · ${finding.legacyName}` : ""}
                        </span>
                      )}
                    </p>
                    <p className="text-gray-700 dark:text-gray-300">{finding.detail}</p>
                  </div>
                  {finding.href && (
                    <Link to={finding.href} className="shrink-0 text-blue-600 hover:underline dark:text-blue-400">
                      Open
                    </Link>
                  )}
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>
    </div>
  );
}
