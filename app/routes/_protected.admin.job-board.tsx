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
  getJobBoardWebhookSetting,
  saveJobBoardWebhookSetting,
} from "~/lib/job-board/webhook-setting.server";

function isAdminOrDev(role: string) {
  return role === "Admin" || role === "Dev";
}

export async function loader({ request }: LoaderFunctionArgs) {
  const { userDetails, headers } = await requireAuth(request);
  if (!isAdminOrDev(userDetails.role)) {
    return withAuthHeaders(redirect("/"), headers);
  }

  const webhook = await getJobBoardWebhookSetting();
  return withAuthHeaders(json({ webhook }), headers);
}

export async function action({ request }: ActionFunctionArgs) {
  const { userDetails, headers } = await requireAuth(request);
  if (!isAdminOrDev(userDetails.role)) {
    return withAuthHeaders(redirect("/"), headers);
  }

  const formData = await request.formData();
  const intent = formData.get("intent");
  if (intent !== "saveWebhook") {
    return withAuthHeaders(
      json({ ok: false as const, message: "Invalid action." }, { status: 400 }),
      headers,
    );
  }

  const rawUrl = formData.get("webhookUrl");
  const result = await saveJobBoardWebhookSetting(
    typeof rawUrl === "string" ? rawUrl : "",
    userDetails.email ?? userDetails.name ?? userDetails.id,
  );
  if (!result.ok) {
    return withAuthHeaders(
      json({ ok: false as const, message: result.error }, { status: 400 }),
      headers,
    );
  }

  return withAuthHeaders(
    json({
      ok: true as const,
      message: result.maskedUrl
        ? `Webhook saved as ${result.maskedUrl}.`
        : "Webhook disabled.",
    }),
    headers,
  );
}

export default function AdminJobBoardSettings() {
  const { webhook } = useLoaderData<typeof loader>();
  const fetcher = useFetcher<typeof action>();
  const [webhookUrl, setWebhookUrl] = useState("");

  useEffect(() => {
    if (fetcher.data?.ok) {
      setWebhookUrl("");
    }
  }, [fetcher.data]);

  return (
    <div className="px-6 py-8 lg:px-10 lg:py-10">
      <AdminPageHeader
        breadcrumbs={[
          { label: "Admin", href: "/admin" },
          { label: "Job Board" },
        ]}
      />

      <div className="mt-6 mb-8 max-w-2xl">
        <h1 className="text-xl font-semibold text-gray-900 dark:text-white">
          Job Board webhook
        </h1>
        <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">
          Discord webhook used when operators post Pending orders to the Job Board.
        </p>
      </div>

      <section className="max-w-2xl rounded-xl border border-gray-200 bg-white p-5 sm:p-6 dark:border-slate-700 dark:bg-slate-800">
        <div className="mb-5">
          <h2 className="text-lg font-semibold text-gray-900 dark:text-white">
            Discord webhook
          </h2>
          <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">
            Paste a Discord channel webhook URL. Leave empty and save to disable
            automated posting. Operators can still use Mark as sent.
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

        {fetcher.data && (
          <div
            className={`mb-4 rounded-lg border px-4 py-3 text-sm ${
              fetcher.data.ok
                ? "border-emerald-200 bg-emerald-50 text-emerald-900 dark:border-emerald-900/50 dark:bg-emerald-950/40 dark:text-emerald-100"
                : "border-red-200 bg-red-50 text-red-900 dark:border-red-900/50 dark:bg-red-950/40 dark:text-red-100"
            }`}
          >
            {"message" in fetcher.data ? fetcher.data.message : "Saved."}
          </div>
        )}

        <fetcher.Form method="post" className="space-y-4">
          <div>
            <label
              htmlFor="webhookUrl"
              className="mb-1 block text-sm font-medium text-gray-700 dark:text-gray-300"
            >
              Webhook URL
            </label>
            <input
              id="webhookUrl"
              name="webhookUrl"
              type="url"
              value={webhookUrl}
              onChange={(event) => setWebhookUrl(event.target.value)}
              placeholder="https://discord.com/api/webhooks/…"
              className="w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 dark:border-slate-600 dark:bg-slate-900 dark:text-gray-100"
            />
          </div>
          <div className="flex items-center gap-3">
            <Button
              type="submit"
              name="intent"
              value="saveWebhook"
              disabled={fetcher.state !== "idle"}
            >
              {fetcher.state !== "idle" ? "Saving…" : "Save webhook"}
            </Button>
            <Link
              to="/admin"
              className="text-sm text-gray-600 no-underline hover:underline dark:text-gray-300"
            >
              Back to Admin
            </Link>
          </div>
        </fetcher.Form>
      </section>
    </div>
  );
}
