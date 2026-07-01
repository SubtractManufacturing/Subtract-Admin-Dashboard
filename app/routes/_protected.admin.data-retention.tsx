import { useState } from "react";
import {
  json,
  redirect,
  type LoaderFunctionArgs,
  type ActionFunctionArgs,
} from "@remix-run/node";
import { useLoaderData, useFetcher } from "@remix-run/react";
import { requireAuth, withAuthHeaders } from "~/lib/auth.server";
import { canUserAccessAdminConsole } from "~/lib/featureFlags";
import {
  getLineItemArchiveRetentionDays,
  parseLineItemRetentionDaysInput,
  setLineItemArchiveRetentionDays,
  LINE_ITEM_ARCHIVE_RETENTION_MAX_DAYS,
  LINE_ITEM_ARCHIVE_RETENTION_MIN_DAYS,
} from "~/lib/developerSettings";
import Button from "~/components/shared/Button";

export async function loader({ request }: LoaderFunctionArgs) {
  const { userDetails, headers } = await requireAuth(request);

  const canAccessAdminConsole = await canUserAccessAdminConsole(
    userDetails.role,
  );
  if (!canAccessAdminConsole) {
    return withAuthHeaders(redirect("/"), headers);
  }

  const retentionDays = await getLineItemArchiveRetentionDays();

  return withAuthHeaders(
    json({
      retentionDays,
      minDays: LINE_ITEM_ARCHIVE_RETENTION_MIN_DAYS,
      maxDays: LINE_ITEM_ARCHIVE_RETENTION_MAX_DAYS,
    }),
    headers,
  );
}

export async function action({ request }: ActionFunctionArgs) {
  const { userDetails, headers } = await requireAuth(request);

  const canAccessAdminConsole = await canUserAccessAdminConsole(
    userDetails.role,
  );
  if (!canAccessAdminConsole) {
    return withAuthHeaders(redirect("/"), headers);
  }

  const formData = await request.formData();
  const intent = formData.get("intent");

  if (intent === "saveDataRetention") {
    const parsed = parseLineItemRetentionDaysInput(
      formData.get("lineItemArchiveRetentionDays"),
    );
    if (!parsed.ok) {
      return withAuthHeaders(json({ error: parsed.error }, { status: 400 }), headers);
    }

    await setLineItemArchiveRetentionDays(
      parsed.days,
      userDetails.email ?? userDetails.name ?? undefined,
    );

    return withAuthHeaders(json({ success: true }), headers);
  }

  return withAuthHeaders(json({ error: "Invalid action" }, { status: 400 }), headers);
}

export default function AdminDataRetention() {
  const { retentionDays, minDays, maxDays } = useLoaderData<typeof loader>();
  const fetcher = useFetcher<{ success?: boolean; error?: string }>();
  const [days, setDays] = useState(String(retentionDays));
  const isSaving = fetcher.state !== "idle";

  return (
    <div className="px-6 py-8 lg:px-10 lg:py-10">
      <div className="mb-8">
        <h1 className="text-xl font-semibold text-gray-900 dark:text-white">
          Data Retention
        </h1>
        <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">
          Configure how long archived quote and order line items are kept before
          permanent deletion.
        </p>
      </div>

      <fetcher.Form method="post" className="max-w-2xl rounded-xl border border-gray-200 bg-white p-6 dark:border-slate-700 dark:bg-slate-800">
        <input type="hidden" name="intent" value="saveDataRetention" />

        <label
          htmlFor="lineItemArchiveRetentionDays"
          className="block text-sm font-medium text-gray-900 dark:text-white"
        >
          Line item archive retention (days)
        </label>
        <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">
          When a line item is deleted, it is archived for this many days. Users
          can restore archived items during that window. After the retention
          period, items are permanently deleted (including quote part files).
        </p>
        <input
          id="lineItemArchiveRetentionDays"
          name="lineItemArchiveRetentionDays"
          type="number"
          min={minDays}
          max={maxDays}
          value={days}
          onChange={(e) => setDays(e.target.value)}
          className="mt-4 block w-32 rounded-md border border-gray-300 px-3 py-2 text-sm text-gray-900 shadow-sm focus:border-[#840606] focus:outline-none focus:ring-1 focus:ring-[#840606] dark:border-slate-600 dark:bg-slate-900 dark:text-white"
        />
        <p className="mt-2 text-xs text-gray-500 dark:text-gray-400">
          Allowed range: {minDays}–{maxDays} days. Changes apply to newly archived
          items only.
        </p>

        {fetcher.data?.error && (
          <p className="mt-4 text-sm text-red-600 dark:text-red-400">
            {fetcher.data.error}
          </p>
        )}
        {fetcher.data?.success && (
          <p className="mt-4 text-sm text-green-600 dark:text-green-400">
            Settings saved.
          </p>
        )}

        <div className="mt-6">
          <Button type="submit" disabled={isSaving}>
            {isSaving ? "Saving..." : "Save Settings"}
          </Button>
        </div>
      </fetcher.Form>
    </div>
  );
}
