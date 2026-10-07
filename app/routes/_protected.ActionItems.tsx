import { ActionFunctionArgs, json, LoaderFunctionArgs, redirect } from "@remix-run/node";
import { Form, Link, useActionData, useLoaderData } from "@remix-run/react";
import { requireAuth, withAuthHeaders } from "~/lib/auth.server";
import {
  ActionItemCommandError,
  getActionItemsForUser,
  markActionItemRead,
  resolveActionItem,
  retryActionItemNow,
  softDeleteActionItem,
} from "~/lib/action-items.server";

import SearchHeader from "~/components/SearchHeader";
import { DeleteActionItemButton } from "~/components/action-items/DeleteActionItemButton";
import type { ActionItem, UserRole } from "~/lib/db/schema";

type ActionItemsLoaderData = {
  items: Array<ActionItem & { isUnread: boolean }>;
  role: UserRole;
};

export async function loader({ request }: LoaderFunctionArgs) {
  const { headers, userDetails } = await requireAuth(request);
  const items = await getActionItemsForUser(userDetails.id);
  return withAuthHeaders(json({ items, role: userDetails.role }), headers);
}

export async function action({ request }: ActionFunctionArgs) {
  const { headers, userDetails } = await requireAuth(request);
  const form = await request.formData();
  const id = String(form.get("actionItemId") ?? "");
  const intent = String(form.get("intent") ?? "");
  const actor = { userId: userDetails.id, role: userDetails.role };
  if (!id) return withAuthHeaders(json({ error: "Action Item is required" }, { status: 400 }), headers);

  try {
    if (intent === "read") await markActionItemRead(id, actor);
    else if (intent === "resolve") await resolveActionItem(id, actor);
    else if (intent === "retry") await retryActionItemNow(id, actor);
    else if (intent === "delete") await softDeleteActionItem(id, actor);
    else return withAuthHeaders(json({ error: "Unknown action" }, { status: 400 }), headers);
    return withAuthHeaders(redirect("/ActionItems"), headers);
  } catch (error) {
    if (!(error instanceof ActionItemCommandError)) throw error;
    return withAuthHeaders(
      json({ error: error.message }, { status: error.status }),
      headers,
    );
  }
}

export default function ActionItems() {
  const { items, role } = useLoaderData<ActionItemsLoaderData>();
  const actionData = useActionData<{ error?: string }>();
  const elevated = role === "Admin" || role === "Dev";
  return (
    <div className="max-w-[1920px] mx-auto">
      <SearchHeader breadcrumbs={[
        { label: "Dashboard", href: "/" },
        { label: "Action Items" }
      ]} />

      <div className="px-10 py-8">
        <h2 className="text-2xl font-semibold text-gray-900 dark:text-gray-100 transition-colors duration-150 mb-5">Items that require input</h2>
        {actionData?.error && (
          <p className="mb-4 rounded-lg border border-red-300 bg-red-50 px-4 py-3 text-sm text-red-800 dark:border-red-800 dark:bg-red-950 dark:text-red-200">
            {actionData.error}
          </p>
        )}
        {items.length === 0 ? (
          <div className="rounded-lg border border-gray-300 bg-white p-10 text-center text-gray-600 dark:border-gray-600 dark:bg-gray-800 dark:text-gray-300">
            No active Action Items.
          </div>
        ) : (
          <div className="space-y-4">
            {items.map((item) => (
              <article key={item.id} className="rounded-lg border border-gray-300 bg-white p-5 dark:border-gray-600 dark:bg-gray-800">
                <div className="flex flex-wrap items-start justify-between gap-4">
                  <div>
                    <div className="flex items-center gap-2">
                      {item.isUnread && <span className="h-2.5 w-2.5 rounded-full bg-blue-600" aria-label="Unread" />}
                      <h3 className="font-semibold text-gray-900 dark:text-gray-100">{item.title}</h3>
                    </div>
                    <p className="mt-2 text-sm text-gray-600 dark:text-gray-300">{item.description}</p>
                    {item.entityType === "quote" && item.entityId && (
                      <Link className="mt-2 inline-block text-sm text-blue-600" to={`/quotes/${item.entityId}`}>Open Quote</Link>
                    )}
                  </div>
                  <Form method="post" className="flex flex-wrap items-center gap-3">
                    {item.isUnread && <button name="intent" value="read" className="text-sm text-blue-600">Mark read</button>}
                    {item.type === "customer_match_review" && <button name="intent" value="resolve" className="text-sm text-green-700">Resolve</button>}
                    {elevated && item.type === "rfq_import_failure" && <button name="intent" value="retry" className="text-sm text-blue-600">Retry now</button>}
                    {elevated && <DeleteActionItemButton id={item.id} />}
                    <input type="hidden" name="actionItemId" value={item.id} />
                  </Form>
                </div>
              </article>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
