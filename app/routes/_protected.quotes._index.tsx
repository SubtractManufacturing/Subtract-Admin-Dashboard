import { json } from "@remix-run/node";
import {
  useLoaderData,
  useFetcher,
  useNavigate,
  useRevalidator,
  useRouteError,
  isRouteErrorResponse,
} from "@remix-run/react";
import { useState, useEffect } from "react";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "@remix-run/node";

import {
  getQuotes,
  createQuote,
  archiveQuote,
  convertQuoteToOrder,
} from "~/lib/quotes";
import { getCustomers } from "~/lib/customers";
import type { Customer } from "~/lib/customers";
import { getVendors } from "~/lib/vendors";
import type { Vendor } from "~/lib/vendors";
import type {
  QuoteWithRelations,
  QuoteInput,
  QuoteEventContext,
} from "~/lib/quotes";
import { requireAuth, withAuthHeaders } from "~/lib/auth.server";
import { getNextQuoteNumber } from "~/lib/number-generator";

import SearchHeader from "~/components/SearchHeader";
import Button from "~/components/shared/Button";
import ViewToggle, { useViewToggle } from "~/components/shared/ViewToggle";
import { DataTable } from "~/components/shared/DataTable";
import { listCardStyles, statusStyles } from "~/utils/tw-styles";
import NewQuoteModal from "~/components/quotes/NewQuoteModal";

export async function loader({ request }: LoaderFunctionArgs) {
  const { user, userDetails, headers } = await requireAuth(request);

  // Load customers and vendors first, separately, to ensure they always load
  let customers: Customer[] = [];
  let vendors: Vendor[] = [];

  try {
    customers = await getCustomers();
  } catch (err) {
    console.error("Failed to load customers:", err);
  }

  try {
    vendors = await getVendors();
  } catch (err) {
    console.error("Failed to load vendors:", err);
  }

  // Now load the rest
  let quotes: QuoteWithRelations[] = [];

  try {
    quotes = await getQuotes();
  } catch (error) {
    console.error("Failed to load quotes:", error);
    // Continue with empty quotes array but customers/vendors should still be loaded
  }

  return withAuthHeaders(
    json({
      quotes,
      customers,
      vendors,
      user,
      userDetails,
    }),
    headers
  );
}

export async function action({ request }: ActionFunctionArgs) {
  const { user, userDetails } = await requireAuth(request);
  const formData = await request.formData();
  const intent = formData.get("intent");

  const eventContext: QuoteEventContext = {
    userId: user?.id,
    userEmail: user?.email || userDetails?.name || undefined,
  };

  try {
    switch (intent) {
      case "generateQuoteNumber": {
        const nextQuoteNumber = await getNextQuoteNumber();
        return json({ quoteNumber: nextQuoteNumber });
      }
      case "create": {
        const quoteNumber = (formData.get("quoteNumber") as string) || null;
        const expirationDays = formData.get("expirationDays")
          ? parseInt(formData.get("expirationDays") as string)
          : null;

        const quoteData: QuoteInput = {
          quoteNumber,
          customerId: parseInt(formData.get("customerId") as string),
          vendorId: formData.get("vendorId")
            ? parseInt(formData.get("vendorId") as string)
            : null,
          status: (formData.get("status") as QuoteInput["status"]) || "RFQ",
          expirationDays,
          createdById: user?.id,
        };
        await createQuote(quoteData, eventContext);
        return json({ success: true });
      }
      case "archive": {
        const quoteId = parseInt(formData.get("quoteId") as string);
        await archiveQuote(quoteId, eventContext);
        return json({ success: true });
      }
      case "convertToOrder": {
        const quoteId = parseInt(formData.get("quoteId") as string);
        const result = await convertQuoteToOrder(quoteId, eventContext);
        if (result.success) {
          return json({ success: true, orderId: result.orderId });
        } else {
          return json({ error: result.error }, { status: 400 });
        }
      }
      default:
        return json({ error: "Invalid intent" }, { status: 400 });
    }
  } catch (error) {
    console.error("Quote action error:", error);
    return json({ error: "Failed to process quote action" }, { status: 500 });
  }
}

export default function QuotesIndex() {
  const {
    quotes,
    customers,
  } = useLoaderData<typeof loader>();
  const navigate = useNavigate();
  const archiveFetcher = useFetcher(); // Dedicated fetcher for archive actions
  const revalidator = useRevalidator();
  const [searchQuery, setSearchQuery] = useState("");
  const [showNewQuoteModal, setShowNewQuoteModal] = useState(false);
  const [selectedStatus, setSelectedStatus] = useState<string>("all");
  const [showAllQuotes, setShowAllQuotes] = useState(false);
  const [view, setView] = useViewToggle("quotes-view");

  // Handle archive success
  useEffect(() => {
    if (
      archiveFetcher.state === "idle" &&
      (archiveFetcher.data as { success?: boolean })?.success
    ) {
      revalidator.revalidate();
    }
  }, [archiveFetcher.data, archiveFetcher.state, revalidator]);

  const handleArchiveQuote = (quoteId: number) => {
    if (confirm("Are you sure you want to delete this quote?")) {
      const formData = new FormData();
      formData.append("intent", "archive");
      formData.append("quoteId", quoteId.toString());
      archiveFetcher.submit(formData, { method: "post" });
    }
  };

  const filteredQuotes = quotes.filter((quote: QuoteWithRelations) => {
    const matchesSearch =
      searchQuery === "" ||
      quote.quoteNumber.toLowerCase().includes(searchQuery.toLowerCase()) ||
      quote.customer?.displayName
        ?.toLowerCase()
        .includes(searchQuery.toLowerCase()) ||
      quote.vendor?.displayName
        ?.toLowerCase()
        .includes(searchQuery.toLowerCase());

    // Filter by status
    const matchesStatus =
      selectedStatus === "all" || quote.status === selectedStatus;

    // Exclude certain statuses unless "show all quotes" is checked OR that status is specifically selected
    const hiddenStatuses = ["Dropped", "Expired", "Accepted", "Rejected"];
    const isStatusSpecificallySelected =
      selectedStatus !== "all" && hiddenStatuses.includes(selectedStatus);
    const shouldShow =
      showAllQuotes ||
      isStatusSpecificallySelected ||
      !hiddenStatuses.includes(quote.status);

    return matchesSearch && matchesStatus && shouldShow;
  });

  const getStatusStyle = (status: string) => {
    switch (status.toLowerCase()) {
      case "rfq":
        return statusStyles.pending;
      case "draft":
        return statusStyles.pending;
      case "sent":
        return statusStyles.inProduction;
      case "accepted":
        return statusStyles.completed;
      case "rejected":
        return statusStyles.cancelled;
      case "dropped":
        return statusStyles.cancelled;
      case "expired":
        return statusStyles.archived;
      default:
        return "";
    }
  };

  const formatCurrency = (amount: string | null) => {
    if (!amount) return "--";
    return new Intl.NumberFormat("en-US", {
      style: "currency",
      currency: "USD",
    }).format(parseFloat(amount));
  };

  const formatDate = (date: Date | string | null) => {
    if (!date) return "--";
    const dateObj = typeof date === "string" ? new Date(date) : date;
    return dateObj.toLocaleDateString("en-US", {
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    });
  };

  const archiveIcon = (
    <svg
      className="w-[18px] h-[18px]"
      fill="none"
      stroke="currentColor"
      viewBox="0 0 24 24"
    >
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth={2}
        d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"
      />
    </svg>
  );

  return (
    <div className="max-w-[1920px] mx-auto">
      <SearchHeader
        breadcrumbs={[{ label: "Dashboard", href: "/" }, { label: "Quotes" }]}
        onSearch={setSearchQuery}
      />

      <div className="px-4 sm:px-6 lg:px-10 py-6 lg:py-8">
        <div className="flex flex-wrap justify-between items-end mb-5 gap-3">
          <h2 className="text-2xl font-semibold text-gray-900 dark:text-gray-100 transition-colors duration-150">
            Quotes ({filteredQuotes.length})
          </h2>

          <div className="flex flex-wrap gap-3 items-center justify-end">
            <ViewToggle view={view} onChange={setView} />
            <select
              id="status-filter"
              value={selectedStatus}
              onChange={(e) => setSelectedStatus(e.target.value)}
              className="px-3 py-2 border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100 rounded focus:outline-none focus:ring-2 focus:ring-blue-500 dark:focus:ring-blue-400"
            >
              <option value="all">-Status-</option>
              <option value="RFQ">RFQ</option>
              <option value="Draft">Draft</option>
              <option value="Sent">Sent</option>
              <option value="Accepted">Accepted</option>
              <option value="Rejected">Rejected</option>
              <option value="Dropped">Dropped</option>
              <option value="Expired">Expired</option>
            </select>

            <div className="flex items-center gap-2">
              <input
                type="checkbox"
                id="show-all-quotes"
                checked={showAllQuotes}
                onChange={(e) => setShowAllQuotes(e.target.checked)}
                className="rounded border-gray-300 dark:border-gray-600 text-blue-600 focus:ring-blue-500 dark:bg-gray-700"
              />
              <label
                htmlFor="show-all-quotes"
                className="text-sm text-gray-700 dark:text-gray-300 whitespace-nowrap"
              >
                Show all
              </label>
            </div>

            <Button onClick={() => setShowNewQuoteModal(true)}>
              New Quote
            </Button>
          </div>
        </div>

        <DataTable<QuoteWithRelations>
          data={filteredQuotes}
          viewMode={view}
          getRowKey={(quote) => quote.id}
          onRowClick={(quote) => navigate(`/quotes/${quote.id}`)}
          emptyMessage="No quotes found."
          columns={[
            {
              key: "quoteNumber",
              header: "Quote #",
              render: (quote) => quote.quoteNumber,
            },
            {
              key: "customer",
              header: "Customer",
              render: (quote) =>
                quote.customer?.id ? (
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      navigate(`/customers/${quote.customer!.id}`);
                    }}
                    className="text-blue-600 hover:text-blue-800 dark:text-blue-400 dark:hover:text-blue-300 hover:underline text-left"
                  >
                    {quote.customer.displayName}
                  </button>
                ) : (
                  <span>{quote.customer?.displayName || "--"}</span>
                ),
            },
            {
              key: "vendor",
              header: "Vendor",
              render: (quote) =>
                quote.vendor?.id ? (
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      navigate(`/vendors/${quote.vendor!.id}`);
                    }}
                    className="text-blue-600 hover:text-blue-800 dark:text-blue-400 dark:hover:text-blue-300 hover:underline text-left"
                  >
                    {quote.vendor.displayName}
                  </button>
                ) : (
                  <span>{quote.vendor?.displayName || "--"}</span>
                ),
            },
            {
              key: "status",
              header: "Status",
              render: (quote) => (
                <span className={`${statusStyles.base} ${getStatusStyle(quote.status)}`}>
                  {quote.status}
                </span>
              ),
            },
            {
              key: "total",
              header: "Total",
              render: (quote) => formatCurrency(quote.total),
            },
            {
              key: "validUntil",
              header: "Valid Until",
              render: (quote) => formatDate(quote.validUntil),
            },
            {
              key: "createdAt",
              header: "Created",
              render: (quote) => formatDate(quote.createdAt),
            },
          ]}
          rowActions={[
            {
              label: "Archive",
              icon: archiveIcon,
              variant: "danger",
              onClick: (quote) => handleArchiveQuote(quote.id),
            },
          ]}
          cardRender={(quote) => (
            <>
              <div className={listCardStyles.header}>
                <div className={listCardStyles.title}>{quote.quoteNumber}</div>
                <div
                  className={`${statusStyles.base} ${getStatusStyle(quote.status)} text-sm`}
                >
                  {quote.status}
                </div>
              </div>
              <div className={listCardStyles.sectionGrid}>
                <div>
                  <div className={listCardStyles.label}>Customer</div>
                  <div className={listCardStyles.value}>
                    {quote.customer?.displayName || "--"}
                  </div>
                </div>
                <div>
                  <div className={listCardStyles.label}>Vendor</div>
                  <div className={listCardStyles.value}>
                    {quote.vendor?.displayName || "--"}
                  </div>
                </div>
                <div>
                  <div className={listCardStyles.label}>Total</div>
                  <div className={listCardStyles.value}>
                    {formatCurrency(quote.total)}
                  </div>
                </div>
                <div>
                  <div className={listCardStyles.label}>Valid Until</div>
                  <div className={listCardStyles.value}>
                    {formatDate(quote.validUntil)}
                  </div>
                </div>
              </div>
            </>
          )}
        />
      </div>

      {/* New Quote Modal */}
      <NewQuoteModal
        isOpen={showNewQuoteModal}
        onClose={() => setShowNewQuoteModal(false)}
        customers={customers}
        onSuccess={() => {
          setShowNewQuoteModal(false);
          revalidator.revalidate();
        }}
      />
    </div>
  );
}

export function ErrorBoundary() {
  const error = useRouteError();

  if (isRouteErrorResponse(error)) {
    return (
      <div className="min-h-screen bg-gray-50 dark:bg-gray-900 flex items-center justify-center px-4">
        <div className="max-w-md w-full bg-white dark:bg-gray-800 rounded-lg shadow-lg p-6">
          <h1 className="text-2xl font-bold text-red-600 dark:text-red-400 mb-2">
            {error.status} {error.statusText}
          </h1>
          <p className="text-gray-600 dark:text-gray-400 mb-4">
            {error.data || "An error occurred while loading quotes."}
          </p>
          <a
            href="/quotes"
            className="inline-block px-4 py-2 bg-blue-600 text-white rounded hover:bg-blue-700"
          >
            Try Again
          </a>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-50 dark:bg-gray-900 flex items-center justify-center px-4">
      <div className="max-w-md w-full bg-white dark:bg-gray-800 rounded-lg shadow-lg p-6">
        <h1 className="text-2xl font-bold text-red-600 dark:text-red-400 mb-2">
          Unexpected Error
        </h1>
        <p className="text-gray-600 dark:text-gray-400 mb-4">
          {error instanceof Error ? error.message : "An unexpected error occurred while loading quotes."}
        </p>
        <a
          href="/quotes"
          className="inline-block px-4 py-2 bg-blue-600 text-white rounded hover:bg-blue-700"
        >
          Try Again
        </a>
      </div>
    </div>
  );
}
