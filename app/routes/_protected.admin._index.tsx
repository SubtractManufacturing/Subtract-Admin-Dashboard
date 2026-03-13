import { json, redirect, type LoaderFunctionArgs } from "@remix-run/node";
import { Link, useLoaderData } from "@remix-run/react";
import { getAppConfig } from "~/lib/config.server";
import { requireAuth, withAuthHeaders } from "~/lib/auth.server";
import { getAllUsers } from "~/lib/users";

export async function loader({ request }: LoaderFunctionArgs) {
  const { userDetails, headers } = await requireAuth(request);

  if (userDetails.role !== "Admin" && userDetails.role !== "Dev") {
    return withAuthHeaders(redirect("/"), headers);
  }

  const users = await getAllUsers();
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
    }),
    headers
  );
}

export default function AdminDashboard() {
  const { activeUserCount, totalUserCount, pendingUserCount, version, environment } =
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

        <div className="rounded-xl border border-dashed border-gray-300 bg-white/50 p-5 dark:border-slate-600 dark:bg-slate-800/50">
          <div className="mb-3 flex h-10 w-10 items-center justify-center rounded-lg bg-gray-100 text-gray-400 dark:bg-slate-700 dark:text-slate-500">
            <svg className="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={1.5}
                d="M9.594 3.94c.09-.542.56-.94 1.11-.94h2.593c.55 0 1.02.398 1.11.94l.213 1.281c.063.374.313.686.645.87.074.04.147.083.22.127.324.196.72.257 1.075.124l1.217-.456a1.125 1.125 0 011.37.49l1.296 2.247a1.125 1.125 0 01-.26 1.431l-1.003.827c-.293.24-.438.613-.431.992a6.759 6.759 0 010 .255c-.007.378.138.75.43.99l1.005.828c.424.35.534.954.26 1.43l-1.298 2.247a1.125 1.125 0 01-1.369.491l-1.217-.456c-.355-.133-.75-.072-1.076.124a6.57 6.57 0 01-.22.128c-.331.183-.581.495-.644.869l-.213 1.28c-.09.543-.56.941-1.11.941h-2.594c-.55 0-1.02-.398-1.11-.94l-.213-1.281c-.062-.374-.312-.686-.644-.87a6.52 6.52 0 01-.22-.127c-.325-.196-.72-.257-1.076-.124l-1.217.456a1.125 1.125 0 01-1.369-.49l-1.297-2.247a1.125 1.125 0 01.26-1.431l1.004-.827c.292-.24.437-.613.43-.992a6.932 6.932 0 010-.255c.007-.378-.138-.75-.43-.99l-1.004-.828a1.125 1.125 0 01-.26-1.43l1.297-2.247a1.125 1.125 0 011.37-.491l1.216.456c.356.133.751.072 1.076-.124.072-.044.146-.087.22-.128.332-.183.582-.495.644-.869l.214-1.281z"
              />
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
            </svg>
          </div>
          <h2 className="text-sm font-semibold text-gray-400 dark:text-slate-500">
            App Settings
          </h2>
          <p className="mt-0.5 text-sm text-gray-400 dark:text-slate-500">
            Coming soon
          </p>
        </div>

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
