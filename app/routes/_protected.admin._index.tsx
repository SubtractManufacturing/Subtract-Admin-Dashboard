import { json, redirect, type LoaderFunctionArgs } from "@remix-run/node";
import { Link, useLoaderData } from "@remix-run/react";
import { getAppConfig } from "~/lib/config.server";
import { requireAuth, withAuthHeaders } from "~/lib/auth.server";
import { getAllUsers } from "~/lib/users";
import { isStripePaymentLinksEnabled, isOutboundEmailEnabled } from "~/lib/featureFlags";

export async function loader({ request }: LoaderFunctionArgs) {
  const { userDetails, headers } = await requireAuth(request);

  if (userDetails.role !== "Admin" && userDetails.role !== "Dev") {
    return withAuthHeaders(redirect("/"), headers);
  }

  const [users, stripeEnabled, outboundEmailEnabled] = await Promise.all([
    getAllUsers(),
    isStripePaymentLinksEnabled(),
    isOutboundEmailEnabled(),
  ]);
  const activeUserCount = users.filter((user) => user.status === "active").length;
  const totalUserCount = users.length;
  const pendingUserCount = users.filter((user) => user.status === "pending").length;
  const appConfig = getAppConfig();

  return withAuthHeaders(
    json({
      activeUserCount,
      totalUserCount,
      pendingUserCount,
      version: appConfig.version,
      environment: appConfig.environment,
      stripeEnabled,
      outboundEmailEnabled,
    }),
    headers
  );
}

export default function AdminDashboard() {
  const { activeUserCount, totalUserCount, pendingUserCount, version, environment, stripeEnabled, outboundEmailEnabled } =
    useLoaderData<typeof loader>();

  return (
    <div className="px-6 py-8 lg:px-10 lg:py-10">
      <div className="mb-8">
        <h1 className="text-xl font-semibold text-gray-900 dark:text-white">
          Admin Console
        </h1>
        <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">
          Manage users, settings, and monitor your deployment.
        </p>
      </div>

      {/* Quick-access cards */}
      <div className="mb-10 grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3">
        <Link
          to="/admin/users"
          className="group rounded-xl border border-gray-200 bg-white p-5 no-underline transition hover:border-gray-300 hover:shadow-sm dark:border-slate-700 dark:bg-slate-800 dark:hover:border-slate-600"
        >
          <div className="mb-3 flex h-10 w-10 items-center justify-center rounded-lg bg-[#840606]/[0.07] text-[#840606] dark:bg-red-400/10 dark:text-red-400">
            <svg className="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={1.5}
                d="M15 19.128a9.38 9.38 0 002.625.372 9.337 9.337 0 004.121-.952 4.125 4.125 0 00-7.533-2.493M15 19.128v-.003c0-1.113-.285-2.16-.786-3.07M15 19.128v.106A12.318 12.318 0 018.624 21c-2.331 0-4.512-.645-6.374-1.766l-.001-.109a6.375 6.375 0 0111.964-3.07M12 6.375a3.375 3.375 0 11-6.75 0 3.375 3.375 0 016.75 0zm8.25 2.25a2.625 2.625 0 11-5.25 0 2.625 2.625 0 015.25 0z"
              />
            </svg>
          </div>
          <h2 className="text-sm font-semibold text-gray-900 dark:text-white">
            Users
          </h2>
          <p className="mt-0.5 text-sm text-gray-500 dark:text-gray-400">
            Manage accounts and invitations
          </p>
        </Link>

        {stripeEnabled && (
          <Link
            to="/admin/stripe"
            className="group rounded-xl border border-gray-200 bg-white p-5 no-underline transition hover:border-gray-300 hover:shadow-sm dark:border-slate-700 dark:bg-slate-800 dark:hover:border-slate-600"
          >
            <div className="mb-3 flex h-10 w-10 items-center justify-center rounded-lg bg-[#840606]/[0.07] text-[#840606] dark:bg-red-400/10 dark:text-red-400">
              <svg className="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={1.5}
                  d="M2.25 8.25h19.5M2.25 9h19.5m-16.5 5.25h6m-6 2.25h3m-3.75 3h15a2.25 2.25 0 002.25-2.25V6.75A2.25 2.25 0 0019.5 4.5h-15a2.25 2.25 0 00-2.25 2.25v10.5A2.25 2.25 0 004.5 19.5z"
                />
              </svg>
            </div>
            <h2 className="text-sm font-semibold text-gray-900 dark:text-white">
              Stripe
            </h2>
            <p className="mt-0.5 text-sm text-gray-500 dark:text-gray-400">
              Configure payment link defaults
            </p>
          </Link>
        )}

        {outboundEmailEnabled && (
          <Link
            to="/admin/email"
            className="group rounded-xl border border-gray-200 bg-white p-5 no-underline transition hover:border-gray-300 hover:shadow-sm dark:border-slate-700 dark:bg-slate-800 dark:hover:border-slate-600"
          >
            <div className="mb-3 flex h-10 w-10 items-center justify-center rounded-lg bg-[#840606]/[0.07] text-[#840606] dark:bg-red-400/10 dark:text-red-400">
              <svg className="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={1.5}
                  d="M21.75 6.75v10.5a2.25 2.25 0 01-2.25 2.25h-15a2.25 2.25 0 01-2.25-2.25V6.75m19.5 0A2.25 2.25 0 0019.5 4.5h-15a2.25 2.25 0 00-2.25 2.25m19.5 0v.243a2.25 2.25 0 01-1.07 1.916l-7.5 4.615a2.25 2.25 0 01-2.36 0L3.32 8.91a2.25 2.25 0 01-1.07-1.916V6.75"
                />
              </svg>
            </div>
            <h2 className="text-sm font-semibold text-gray-900 dark:text-white">
              Email
            </h2>
            <p className="mt-0.5 text-sm text-gray-500 dark:text-gray-400">
              Configure templates and identities
            </p>
          </Link>
        )}

        <div className="rounded-xl border border-dashed border-gray-300 bg-white/50 p-5 dark:border-slate-600 dark:bg-slate-800/50">
          <div className="mb-3 flex h-10 w-10 items-center justify-center rounded-lg bg-gray-100 text-gray-400 dark:bg-slate-700 dark:text-slate-500">
            <svg className="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={1.5}
                d="M17.25 6.75L22.5 12l-5.25 5.25m-10.5 0L1.5 12l5.25-5.25m7.5-3l-4.5 16.5"
              />
            </svg>
          </div>
          <h2 className="text-sm font-semibold text-gray-400 dark:text-slate-500">
            Developer
          </h2>
          <p className="mt-0.5 text-sm text-gray-400 dark:text-slate-500">
            Coming soon
          </p>
        </div>
      </div>

      {/* Metrics */}
      <div className="mb-2">
        <h2 className="text-[11px] font-semibold uppercase tracking-wider text-gray-400 dark:text-gray-500">
          Overview
        </h2>
      </div>

      <div className="grid grid-cols-2 gap-4 xl:grid-cols-4">
        <div className="rounded-xl border border-gray-200 bg-white px-5 py-4 dark:border-slate-700 dark:bg-slate-800">
          <p className="text-xs font-medium text-gray-500 dark:text-gray-400">Active users</p>
          <p className="mt-1 text-2xl font-semibold tabular-nums text-gray-900 dark:text-white">
            {activeUserCount}
          </p>
        </div>

        <div className="rounded-xl border border-gray-200 bg-white px-5 py-4 dark:border-slate-700 dark:bg-slate-800">
          <p className="text-xs font-medium text-gray-500 dark:text-gray-400">Total users</p>
          <p className="mt-1 text-2xl font-semibold tabular-nums text-gray-900 dark:text-white">
            {totalUserCount}
          </p>
        </div>

        <div className="rounded-xl border border-gray-200 bg-white px-5 py-4 dark:border-slate-700 dark:bg-slate-800">
          <p className="text-xs font-medium text-gray-500 dark:text-gray-400">Pending invites</p>
          <p className="mt-1 text-2xl font-semibold tabular-nums text-gray-900 dark:text-white">
            {pendingUserCount}
          </p>
        </div>

        <div className="rounded-xl border border-gray-200 bg-white px-5 py-4 dark:border-slate-700 dark:bg-slate-800">
          <p className="text-xs font-medium text-gray-500 dark:text-gray-400">Deployed version</p>
          <p className="mt-1 text-2xl font-semibold tabular-nums text-gray-900 dark:text-white">
            {version}
          </p>
          <p className="mt-0.5 text-xs text-gray-400 dark:text-gray-500">{environment}</p>
        </div>
      </div>
    </div>
  );
}
