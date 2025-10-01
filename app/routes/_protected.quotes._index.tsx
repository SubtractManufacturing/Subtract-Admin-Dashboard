import { json } from "@remix-run/node";
import { useLoaderData, useFetcher, useNavigate, useRevalidator } from "@remix-run/react";
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
import type { QuoteWithRelations, QuoteInput, QuoteEventContext } from "~/lib/quotes";
import { requireAuth, withAuthHeaders } from "~/lib/auth.server";
import { getAppConfig } from "~/lib/config.server";
import { getNextQuoteNumber } from "~/lib/number-generator";
import { shouldShowEventsInNav, shouldShowQuotesInNav, canUserManageQuotes } from "~/lib/featureFlags";

import Navbar from "~/components/Navbar";
import SearchHeader from "~/components/SearchHeader";
import Button from "~/components/shared/Button";
import { tableStyles, statusStyles } from "~/utils/tw-styles";
import NewQuoteModal from "~/components/quotes/NewQuoteModal";

export async function loader({ request }: LoaderFunctionArgs) {
  const { user, userDetails, headers } = await requireAuth(request);
  const appConfig = getAppConfig();

  const canManageQuotes = await canUserManageQuotes();
  if (!canManageQuotes) {
    throw new Response("Not authorized to view quotes", { status: 403 });
  }

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
  let showEventsLink = true;
  let showQuotesLink = true;

  try {
    [quotes, showEventsLink, showQuotesLink] = await Promise.all([
      getQuotes(),
      shouldShowEventsInNav(),
      shouldShowQuotesInNav(),
    ]);
  } catch (error) {
    console.error("Failed to load quotes:", error);
    // Continue with empty quotes array but customers/vendors should still be loaded
  }

  return withAuthHeaders(
    json({ quotes, customers, vendors, user, userDetails, appConfig, showEventsLink, showQuotesLink }),
    headers
  );
}

export async function action({ request }: ActionFunctionArgs) {
  const { user, userDetails } = await requireAuth(request);
  const formData = await request.formData();
  const intent = formData.get("intent");

  const canManageQuotes = await canUserManageQuotes();
  if (!canManageQuotes) {
    return json({ error: "Not authorized to manage quotes" }, { status: 403 });
  }

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
  const { quotes, customers, vendors, user, userDetails, appConfig, showEventsLink, showQuotesLink } = useLoaderData<typeof loader>();
  const navigate = useNavigate();
  const archiveFetcher = useFetcher(); // Dedicated fetcher for archive actions
  const revalidator = useRevalidator();
  const [searchQuery, setSearchQuery] = useState("");
  const [showNewQuoteModal, setShowNewQuoteModal] = useState(false);

  // Handle archive success
  useEffect(() => {
    if (archiveFetcher.state === "idle" && (archiveFetcher.data as { success?: boolean })?.success) {
      revalidator.revalidate();
    }
  }, [archiveFetcher.data, archiveFetcher.state, revalidator]);

  const handleArchiveQuote = (quoteId: number) => {
    if (confirm("Are you sure you want to archive this quote?")) {
      const formData = new FormData();
      formData.append("intent", "archive");
      formData.append("quoteId", quoteId.toString());
      archiveFetcher.submit(formData, { method: "post" });
    }
  };


  const filteredQuotes = quotes.filter((quote: QuoteWithRelations) => {
    const matchesSearch = searchQuery === "" ||
      quote.quoteNumber.toLowerCase().includes(searchQuery.toLowerCase()) ||
      quote.customer?.displayName?.toLowerCase().includes(searchQuery.toLowerCase()) ||
      quote.vendor?.displayName?.toLowerCase().includes(searchQuery.toLowerCase());

    return matchesSearch;
  });

  const getStatusStyle = (status: string) => {
    switch (status.toLowerCase()) {
      case "rfq": return statusStyles.pending;
      case "draft": return statusStyles.pending;
      case "sent": return statusStyles.inProduction;
      case "accepted": return statusStyles.completed;
      case "rejected": return statusStyles.cancelled;
      case "dropped": return statusStyles.cancelled;
      case "expired": return statusStyles.archived;
      default: return "";
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

  return (
    <div>
      <Navbar
        userName={userDetails?.name || user.email}
        userEmail={user.email}
        userInitials={userDetails?.name?.charAt(0).toUpperCase() || user.email.charAt(0).toUpperCase()}
        version={appConfig.version}
        isStaging={appConfig.isStaging}
        showEventsLink={showEventsLink}
        showQuotesLink={showQuotesLink}
      />
      <div className="max-w-[1920px] mx-auto">
        <SearchHeader
          breadcrumbs={[
            { label: "Dashboard", href: "/" },
            { label: "Quotes" }
          ]}
          onSearch={setSearchQuery}
        />

        <div className="px-10 py-8">
          <div className="flex justify-between items-center mb-5">
            <h2 className="text-2xl font-semibold text-gray-900 dark:text-gray-100 transition-colors duration-150">
              Quotes ({filteredQuotes.length})
            </h2>
            <Button onClick={() => setShowNewQuoteModal(true)}>New Quote</Button>
          </div>

          <table className={tableStyles.container}>
            <thead className={tableStyles.header}>
              <tr>
                <th className={tableStyles.headerCell}>Quote #</th>
                <th className={tableStyles.headerCell}>Customer</th>
                <th className={tableStyles.headerCell}>Vendor</th>
                <th className={tableStyles.headerCell}>Status</th>
                <th className={tableStyles.headerCell}>Total</th>
                <th className={tableStyles.headerCell}>Valid Until</th>
                <th className={tableStyles.headerCell}>Created</th>
                <th className={tableStyles.headerCell}>Actions</th>
              </tr>
            </thead>
            <tbody>
              {filteredQuotes.map((quote: QuoteWithRelations) => (
                <tr
                  key={quote.id}
                  className={`${tableStyles.row} cursor-pointer hover:bg-gray-50 dark:hover:bg-gray-800`}
                  onClick={() => navigate(`/quotes/${quote.id}`)}
                >
                  <td className={tableStyles.cell}>{quote.quoteNumber}</td>
                  <td className={tableStyles.cell}>
                    {quote.customer?.id ? (
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
                    )}
                  </td>
                  <td className={tableStyles.cell}>
                    {quote.vendor?.id ? (
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
                    )}
                  </td>
                  <td
                    className={`${tableStyles.cell} ${
                      statusStyles.base
                    } ${getStatusStyle(quote.status)}`}
                  >
                    {quote.status}
                  </td>
                  <td className={tableStyles.cell}>
                    {formatCurrency(quote.total)}
                  </td>
                  <td className={tableStyles.cell}>
                    {formatDate(quote.validUntil)}
                  </td>
                  <td className={tableStyles.cell}>
                    {formatDate(quote.createdAt)}
                  </td>
                  <td className={tableStyles.cell}>
                    <div className="flex space-x-2">
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          handleArchiveQuote(quote.id);
                        }}
                        className="p-1.5 text-white bg-red-600 rounded hover:bg-red-700 dark:bg-red-500 dark:hover:bg-red-600 transition-colors duration-150"
                        title="Archive"
                      >
                        <svg
                          xmlns="http://www.w3.org/2000/svg"
                          width="16"
                          height="16"
                          fill="currentColor"
                          viewBox="0 0 16 16"
                        >
                          <path d="M12.643 15C13.979 15 15 13.845 15 12.5V5H1v7.5C1 13.845 2.021 15 3.357 15h9.286zM5.5 7h5a.5.5 0 0 1 0 1h-5a.5.5 0 0 1 0-1zM.8 1a.8.8 0 0 0-.8.8V3a.8.8 0 0 0 .8.8h14.4A.8.8 0 0 0 16 3V1.8a.8.8 0 0 0-.8-.8H.8z" />
                        </svg>
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
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