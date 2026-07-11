import { json } from "@remix-run/node";
import {
  Link,
  useLoaderData,
  useLocation,
  useNavigate,
  useSearchParams,
} from "@remix-run/react";
import { useState } from "react";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "@remix-run/node";

import { requireAuth, withAuthHeaders } from "~/lib/auth.server";
import { getCustomers } from "~/lib/customers";
import {
  createCustomerCommunication,
  listCustomerCommunications,
  type CrmEventContext,
  type CustomerCommunicationListItem,
} from "~/lib/crm";
import {
  COMMUNICATION_METHOD_LABELS,
  isCommunicationMethod,
  type CommunicationMethod,
} from "~/lib/crm-constants";

type CustomerOption = {
  id: number;
  displayName: string;
  email?: string | null;
};

import SearchHeader from "~/components/SearchHeader";
import Button from "~/components/shared/Button";
import SearchableSelect from "~/components/shared/SearchableSelect";
import LogCommunicationModal from "~/components/crm/LogCommunicationModal";

function crmListPageHref(pathname: string, search: string, page: number) {
  const params = new URLSearchParams(search);
  if (page <= 1) {
    params.delete("page");
  } else {
    params.set("page", String(page));
  }
  const qs = params.toString();
  return qs ? `${pathname}?${qs}` : pathname;
}

export async function loader({ request }: LoaderFunctionArgs) {
  const { user, userDetails, headers } = await requireAuth(request);
  const url = new URL(request.url);

  const pageParam = Math.max(
    1,
    parseInt(url.searchParams.get("page") ?? "1", 10) || 1,
  );

  const customerIdRaw = url.searchParams.get("customerId");
  const customerId =
    customerIdRaw && /^\d+$/.test(customerIdRaw)
      ? parseInt(customerIdRaw, 10)
      : undefined;

  const [listResult, customers] = await Promise.all([
    listCustomerCommunications({
      page: pageParam,
      customerId,
    }),
    getCustomers({ sortBy: "name" }),
  ]);

  return withAuthHeaders(
    json({
      ...listResult,
      customers: customers.map((c) => ({
        id: c.id,
        displayName: c.displayName,
        email: c.email,
      })),
      filterCustomerId: customerId ?? null,
      user,
      userDetails,
    }),
    headers,
  );
}

export async function action({ request }: ActionFunctionArgs) {
  const { user, userDetails } = await requireAuth(request);
  const formData = await request.formData();
  const intent = formData.get("intent");

  if (intent !== "create") {
    return json({ error: "Invalid intent" }, { status: 400 });
  }

  if (!user?.id) {
    return json({ error: "User not authenticated" }, { status: 401 });
  }

  const customerIdRaw = formData.get("customerId");
  const methodRaw = formData.get("method");
  const noteRaw = formData.get("note");

  const customerId =
    typeof customerIdRaw === "string" && /^\d+$/.test(customerIdRaw)
      ? parseInt(customerIdRaw, 10)
      : NaN;
  const method = typeof methodRaw === "string" ? methodRaw : "";
  const note = typeof noteRaw === "string" ? noteRaw : "";

  if (!Number.isFinite(customerId)) {
    return json({ error: "Customer is required" }, { status: 400 });
  }
  if (!isCommunicationMethod(method)) {
    return json({ error: "Invalid communication method" }, { status: 400 });
  }
  if (!note.trim()) {
    return json({ error: "Note is required" }, { status: 400 });
  }

  const eventContext: CrmEventContext = {
    userId: user.id,
    userEmail: user.email || userDetails?.name || undefined,
  };

  try {
    await createCustomerCommunication(
      {
        customerId,
        method,
        note,
        createdBy: user.id,
      },
      eventContext,
    );
    return json({ success: true });
  } catch (error) {
    return json({ error: (error as Error).message }, { status: 400 });
  }
}

export default function CrmIndex() {
  const {
    items,
    totalCount,
    page,
    totalPages,
    customers,
    filterCustomerId,
  } = useLoaderData<typeof loader>();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const location = useLocation();
  const [isModalOpen, setIsModalOpen] = useState(false);

  const handleFilterChange = (value: string) => {
    const params = new URLSearchParams(searchParams);
    params.delete("page");
    if (value) {
      params.set("customerId", value);
    } else {
      params.delete("customerId");
    }
    const qs = params.toString();
    navigate(qs ? `/crm?${qs}` : "/crm");
  };

  const formatDateTime = (date: Date | string) => {
    const dateObj = typeof date === "string" ? new Date(date) : date;
    return dateObj.toLocaleString("en-US", {
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "numeric",
      minute: "2-digit",
    });
  };

  const truncateNote = (text: string, max = 120) => {
    if (text.length <= max) return text;
    return `${text.slice(0, max)}…`;
  };

  return (
    <div className="max-w-[1920px] mx-auto">
      <SearchHeader
        breadcrumbs={[
          { label: "Dashboard", href: "/" },
          { label: "CRM" },
        ]}
      />

      <div className="px-4 sm:px-6 lg:px-10 py-6 lg:py-8">
        <div className="flex flex-wrap justify-between items-end mb-5 gap-3">
          <h2 className="text-2xl font-semibold text-gray-900 dark:text-gray-100 transition-colors duration-150">
            Communications ({totalCount})
          </h2>
          <div className="flex flex-wrap items-end gap-3">
            <div className="min-w-[240px] w-72">
              <SearchableSelect
                label="Customer"
                value={filterCustomerId ? String(filterCustomerId) : ""}
                onChange={handleFilterChange}
                options={[
                  { value: "", label: "All customers" },
                  ...customers.map((c: CustomerOption) => ({
                    value: c.id.toString(),
                    label: c.displayName,
                    secondaryLabel: c.email || undefined,
                  })),
                ]}
                placeholder="Search for a customer..."
                emptyMessage="No customers found"
              />
            </div>
            <Button onClick={() => setIsModalOpen(true)}>
              Log Communication
            </Button>
          </div>
        </div>

        <div className="overflow-hidden rounded-lg border border-gray-200 bg-white shadow-sm dark:border-slate-700 dark:bg-slate-800">
          {items.length === 0 ? (
            <p className="px-4 py-10 text-center text-sm text-gray-500 dark:text-gray-400">
              {filterCustomerId
                ? "No communications found for this customer."
                : "No communications logged yet. Log one to get started."}
            </p>
          ) : (
            <div className="overflow-x-auto">
              <table className="min-w-full divide-y divide-gray-200 dark:divide-slate-700">
                <thead className="bg-gray-50 dark:bg-slate-900/50">
                  <tr>
                    <th className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wider text-gray-500 dark:text-gray-400">
                      Date/time
                    </th>
                    <th className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wider text-gray-500 dark:text-gray-400">
                      Customer
                    </th>
                    <th className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wider text-gray-500 dark:text-gray-400">
                      Method
                    </th>
                    <th className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wider text-gray-500 dark:text-gray-400">
                      Note
                    </th>
                    <th className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wider text-gray-500 dark:text-gray-400">
                      Logged by
                    </th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-200 dark:divide-slate-700">
                  {items.map((item: CustomerCommunicationListItem) => (
                    <tr
                      key={item.id}
                      className="hover:bg-gray-50 dark:hover:bg-slate-700/40"
                    >
                      <td className="whitespace-nowrap px-4 py-3 text-sm text-gray-700 dark:text-gray-300">
                        {formatDateTime(item.createdAt)}
                      </td>
                      <td className="whitespace-nowrap px-4 py-3 text-sm">
                        <Link
                          to={`/customers/${item.customerId}`}
                          className="font-medium text-blue-600 hover:text-blue-800 dark:text-blue-400 dark:hover:text-blue-300 hover:underline"
                        >
                          {item.customerDisplayName}
                        </Link>
                      </td>
                      <td className="whitespace-nowrap px-4 py-3 text-sm text-gray-700 dark:text-gray-300">
                        {
                          COMMUNICATION_METHOD_LABELS[
                            item.method as CommunicationMethod
                          ]
                        }
                      </td>
                      <td
                        className="max-w-md px-4 py-3 text-sm text-gray-700 dark:text-gray-300"
                        title={item.note}
                      >
                        {truncateNote(item.note)}
                      </td>
                      <td className="whitespace-nowrap px-4 py-3 text-sm text-gray-700 dark:text-gray-300">
                        {item.authorName || item.authorEmail || "—"}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {totalPages > 1 ? (
            <div className="flex flex-wrap items-center justify-between gap-3 border-t border-gray-200 px-4 py-3 text-sm dark:border-slate-700">
              <Link
                to={crmListPageHref(
                  location.pathname,
                  location.search,
                  page - 1,
                )}
                className={
                  page <= 1
                    ? "pointer-events-none text-gray-300 dark:text-slate-600"
                    : "font-medium text-blue-600 no-underline hover:underline dark:text-blue-400"
                }
                aria-disabled={page <= 1}
              >
                Previous
              </Link>
              <span className="text-gray-600 dark:text-gray-400">
                Page {page} of {totalPages}
              </span>
              <Link
                to={crmListPageHref(
                  location.pathname,
                  location.search,
                  page + 1,
                )}
                className={
                  page >= totalPages
                    ? "pointer-events-none text-gray-300 dark:text-slate-600"
                    : "font-medium text-blue-600 no-underline hover:underline dark:text-blue-400"
                }
                aria-disabled={page >= totalPages}
              >
                Next
              </Link>
            </div>
          ) : null}
        </div>
      </div>

      <LogCommunicationModal
        isOpen={isModalOpen}
        onClose={() => setIsModalOpen(false)}
        customers={customers}
        defaultCustomerId={filterCustomerId}
      />
    </div>
  );
}
