import { json } from "@remix-run/node";
import { useLoaderData, useNavigate, useFetcher } from "@remix-run/react";
import { useState, useEffect } from "react";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "@remix-run/node";

import {
  getRecentEvents,
  getEventById,
  createEvent,
  type EventFilters,
} from "~/lib/events";
import type { EventLog } from "~/lib/db/schema";
import { getCustomers } from "~/lib/customers";
import { getVendors } from "~/lib/vendors";
import { getOrdersWithRelations } from "~/lib/orders";
import { requireAuth, withAuthHeaders } from "~/lib/auth.server";
import { getAppConfig } from "~/lib/config.server";
import { canUserAccessEvents, shouldShowEventsInNav } from "~/lib/featureFlags";

import Navbar from "~/components/Navbar";
import Button from "~/components/shared/Button";
import Modal from "~/components/shared/Modal";
import { tableStyles } from "~/utils/tw-styles";

export async function loader({ request }: LoaderFunctionArgs) {
  const { user, userDetails, headers } = await requireAuth(request);
  const appConfig = getAppConfig();

  // Check if user has access to events
  const hasAccess = await canUserAccessEvents(userDetails?.role);
  if (!hasAccess) {
    throw new Response("Access Denied", { status: 403 });
  }

  const url = new URL(request.url);
  const searchParams = url.searchParams;

  const categoryParam = searchParams.get("category");
  const filters: EventFilters = {
    entityType: searchParams.get("entityType") || undefined,
    eventCategory: categoryParam === "dismissed" ? undefined : categoryParam || undefined,
    searchTerm: searchParams.get("search") || undefined,
    limit: parseInt(searchParams.get("limit") || "25"),
    offset: parseInt(searchParams.get("offset") || "0"),
    sortOrder: (searchParams.get("sort") || "desc") as "asc" | "desc",
    dismissedOnly: categoryParam === "dismissed",
  };

  // Parse date filters
  const startDate = searchParams.get("startDate");
  const endDate = searchParams.get("endDate");
  if (startDate) filters.startDate = new Date(startDate);
  if (endDate) {
    const end = new Date(endDate);
    end.setHours(23, 59, 59, 999);
    filters.endDate = end;
  }

  try {
    const { events, totalCount } = await getRecentEvents(filters);
    const [customers, vendors, orders, showEventsLink] = await Promise.all([
      getCustomers(),
      getVendors(),
      getOrdersWithRelations(),
      shouldShowEventsInNav(),
    ]);

    return withAuthHeaders(
      json({
        events,
        totalCount,
        filters,
        customers,
        vendors,
        orders,
        user,
        userDetails,
        appConfig,
        showEventsLink,
      }),
      headers
    );
  } catch (error) {
    console.error("Events loader error:", error);
    return withAuthHeaders(
      json({
        events: [],
        totalCount: 0,
        filters,
        customers: [],
        vendors: [],
        orders: [],
        user,
        userDetails,
        appConfig,
        showEventsLink: true,
      }),
      headers
    );
  }
}

export async function action({ request }: ActionFunctionArgs) {
  const formData = await request.formData();
  const intent = formData.get("intent");

  try {
    switch (intent) {
      case "viewDetails": {
        const eventId = formData.get("eventId") as string;
        const event = await getEventById(eventId);
        return json({ event });
      }

      case "manualEvent": {
        const eventData = {
          entityType: formData.get("entityType") as string,
          entityId: formData.get("entityId") as string,
          eventType: formData.get("eventType") as string,
          eventCategory: formData.get("eventCategory") as
            | "status"
            | "document"
            | "financial"
            | "communication"
            | "system"
            | "quality"
            | "manufacturing",
          title: formData.get("title") as string,
          description: (formData.get("description") as string) || undefined,
          userEmail: (formData.get("userEmail") as string) || undefined,
        };

        const newEvent = await createEvent(eventData);
        return json({ success: true, event: newEvent });
      }

      default:
        return json({ error: "Unknown intent" }, { status: 400 });
    }
  } catch (error) {
    console.error("Events action error:", error);
    return json({ error: "Failed to process request" }, { status: 500 });
  }
}

function formatTimeAgo(date: Date | string | null): string {
  if (!date) return "";
  const now = new Date();
  const past = new Date(date);
  const diff = now.getTime() - past.getTime();

  const seconds = Math.floor(diff / 1000);
  const minutes = Math.floor(seconds / 60);
  const hours = Math.floor(minutes / 60);
  const days = Math.floor(hours / 24);

  if (days > 0) return `${days} day${days > 1 ? "s" : ""} ago`;
  if (hours > 0) return `${hours} hour${hours > 1 ? "s" : ""} ago`;
  if (minutes > 0) return `${minutes} minute${minutes > 1 ? "s" : ""} ago`;
  return `${seconds} second${seconds !== 1 ? "s" : ""} ago`;
}

export default function EventsPage() {
  const {
    events,
    totalCount,
    filters,
    customers,
    vendors,
    orders,
    user,
    userDetails,
    appConfig,
    showEventsLink,
  } = useLoaderData<typeof loader>();
  const navigate = useNavigate();

  const [searchTerm, setSearchTerm] = useState(filters.searchTerm || "");
  const [selectedCategory, setSelectedCategory] = useState(
    filters.eventCategory || ""
  );
  const [selectedEntity, setSelectedEntity] = useState(
    filters.entityType || ""
  );
  const [startDate, setStartDate] = useState(
    filters.startDate
      ? new Date(filters.startDate).toISOString().split("T")[0]
      : ""
  );
  const [endDate, setEndDate] = useState(
    filters.endDate ? new Date(filters.endDate).toISOString().split("T")[0] : ""
  );
  const [sortOrder, setSortOrder] = useState(filters.sortOrder || "desc");
  const [pageSize, setPageSize] = useState(filters.limit || 25);
  const [currentPage, setCurrentPage] = useState(
    Math.floor((filters.offset || 0) / pageSize) + 1
  );

  const [showDetailsModal, setShowDetailsModal] = useState(false);
  const [selectedEvent, setSelectedEvent] = useState<EventLog | null>(null);
  const restoreFetcher = useFetcher();

  const totalPages = Math.ceil(totalCount / pageSize);

  const applyFilters = () => {
    const params = new URLSearchParams();
    if (searchTerm) params.set("search", searchTerm);
    if (selectedCategory) params.set("category", selectedCategory);
    if (selectedEntity) params.set("entityType", selectedEntity);
    if (startDate) params.set("startDate", startDate);
    if (endDate) params.set("endDate", endDate);
    params.set("sort", sortOrder);
    params.set("limit", pageSize.toString());
    params.set("offset", ((currentPage - 1) * pageSize).toString());

    navigate(`/events?${params.toString()}`);
  };

  useEffect(() => {
    applyFilters();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentPage, pageSize, sortOrder]);

  const handleViewDetails = async (event: EventLog) => {
    setSelectedEvent(event);
    setShowDetailsModal(true);
  };

  const handleRestoreEvent = (eventId: string) => {
    const formData = new FormData();
    formData.append('eventId', eventId);

    restoreFetcher.submit(formData, {
      method: 'post',
      action: '/actions/events/restore'
    });

    // Close modal after restore
    setShowDetailsModal(false);
  };

  const handlePageChange = (page: number) => {
    setCurrentPage(page);
  };

  const handleExport = () => {
    const csv = [
      [
        "Time",
        "Entity Type",
        "Entity ID",
        "Event",
        "Description",
        "Severity",
        "Category",
        "User",
      ],
      ...events.map((event: EventLog) => [
        new Date(event.createdAt).toISOString(),
        event.entityType,
        event.entityId,
        event.title,
        event.description || "",
        event.eventCategory,
        event.userEmail || "System",
      ]),
    ]
      .map((row) => row.map((cell: string | number) => `"${cell}"`).join(","))
      .join("\n");

    const blob = new Blob([csv], { type: "text/csv" });
    const url = window.URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `events-${new Date().toISOString().split("T")[0]}.csv`;
    a.click();
    window.URL.revokeObjectURL(url);
  };

  const getEntityDisplay = (event: EventLog) => {
    switch (event.entityType) {
      case "order": {
        const order = orders.find((o: {id: number; orderNumber: string}) => o.id.toString() === event.entityId);
        return order
          ? `Order #${order.orderNumber}`
          : `Order #${event.entityId}`;
      }
      case "customer": {
        const customer = customers.find(
          (c: {id: number; displayName: string}) => c.id.toString() === event.entityId
        );
        return customer ? customer.displayName : `Customer #${event.entityId}`;
      }
      case "vendor": {
        const vendor = vendors.find((v: {id: number; displayName: string}) => v.id.toString() === event.entityId);
        return vendor ? vendor.displayName : `Vendor #${event.entityId}`;
      }
      case "part":
        return `Part #${event.entityId.substring(0, 8)}`;
      case "quote":
        return `Quote #${event.entityId}`;
      default:
        return `${event.entityType} #${event.entityId}`;
    }
  };

  return (
    <div className="min-h-screen bg-gray-50 dark:bg-gray-900">
      <Navbar
        userName={userDetails?.name || user?.email}
        userEmail={user?.email}
        userInitials={
          userDetails?.name
            ?.split(" ")
            .map((n: string) => n[0])
            .join("")
            .toUpperCase() || "U"
        }
        version={appConfig?.version}
        isStaging={appConfig?.isStaging}
        showEventsLink={showEventsLink}
      />

      <div className="px-8 py-6">
        {/* Header with Filters */}
        <div className="bg-white dark:bg-gray-800 rounded-lg shadow-md p-6 mb-6">
          <div className="mb-6">
            <h1 className="text-2xl font-bold text-gray-900 dark:text-white">
              Event Log
            </h1>
          </div>

          {/* Filters */}
          <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-7 gap-3">
            <input
              type="text"
              placeholder="Search events..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="px-3 py-2 border border-gray-300 rounded focus:outline-none focus:ring-2 focus:ring-blue-500"
            />

            <select
              value={selectedCategory}
              onChange={(e) => setSelectedCategory(e.target.value)}
              className="px-3 py-2 border border-gray-300 rounded focus:outline-none focus:ring-2 focus:ring-blue-500"
            >
              <option value="">All Categories</option>
              <option value="status">Status Changes</option>
              <option value="financial">Financial</option>
              <option value="document">Documents</option>
              <option value="communication">Communication</option>
              <option value="system">System</option>
              <option value="quality">Quality</option>
              <option value="manufacturing">Manufacturing</option>
              <option value="dismissed">Dismissed Events</option>
            </select>

            <select
              value={selectedEntity}
              onChange={(e) => setSelectedEntity(e.target.value)}
              className="px-3 py-2 border border-gray-300 rounded focus:outline-none focus:ring-2 focus:ring-blue-500"
            >
              <option value="">All Entities</option>
              <option value="order">Orders</option>
              <option value="customer">Customers</option>
              <option value="vendor">Vendors</option>
              <option value="part">Parts</option>
              <option value="quote">Quotes</option>
            </select>

            <input
              type="date"
              value={startDate}
              onChange={(e) => setStartDate(e.target.value)}
              className="px-3 py-2 border border-gray-300 rounded focus:outline-none focus:ring-2 focus:ring-blue-500"
            />

            <input
              type="date"
              value={endDate}
              onChange={(e) => setEndDate(e.target.value)}
              className="px-3 py-2 border border-gray-300 rounded focus:outline-none focus:ring-2 focus:ring-blue-500"
            />

            <select
              value={sortOrder}
              onChange={(e) => setSortOrder(e.target.value as "asc" | "desc")}
              className="px-3 py-2 border border-gray-300 rounded focus:outline-none focus:ring-2 focus:ring-blue-500"
            >
              <option value="desc">Newest First</option>
              <option value="asc">Oldest First</option>
            </select>
          </div>

          <div className="flex justify-between items-center mt-4">
            <div className="flex gap-2">
              <Button onClick={applyFilters} size="sm">
                Apply Filters
              </Button>
              <Button
                onClick={() => {
                  setSearchTerm("");
                  setSelectedCategory("");
                  setSelectedEntity("");
                  setStartDate("");
                  setEndDate("");
                  setSortOrder("desc");
                  setCurrentPage(1);
                  navigate("/events");
                }}
                variant="secondary"
                size="sm"
              >
                Clear Filters
              </Button>
            </div>

            <div className="flex gap-2 items-center">
              <button
                onClick={handleExport}
                className="flex items-center gap-1 text-sm px-3 py-2 text-gray-600 hover:text-gray-800 border border-gray-300 rounded hover:bg-gray-50 transition-colors"
                title="Export to CSV"
              >
                <svg
                  className="w-4 h-4"
                  fill="none"
                  stroke="currentColor"
                  viewBox="0 0 24 24"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M12 10v6m0 0l-3-3m3 3l3-3m2 8H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"
                  />
                </svg>
                Download CSV
              </button>
              <select
                value={pageSize}
                onChange={(e) => {
                  setPageSize(parseInt(e.target.value));
                  setCurrentPage(1);
                }}
                className="px-3 py-2 border border-gray-300 rounded focus:outline-none focus:ring-2 focus:ring-blue-500"
              >
                <option value="25">Show: 25 items</option>
                <option value="50">Show: 50 items</option>
                <option value="100">Show: 100 items</option>
              </select>
            </div>
          </div>
        </div>

        {/* Events Table */}
        <div className="bg-white dark:bg-gray-800 rounded-lg shadow-md overflow-hidden">
          <table className={tableStyles.container}>
            <thead className={tableStyles.header}>
              <tr>
                <th className={tableStyles.headerCell}>Time</th>
                <th className={tableStyles.headerCell}>Entity</th>
                <th className={tableStyles.headerCell}>Event</th>
                <th className={tableStyles.headerCell}>User</th>
                <th className={tableStyles.headerCell}>Actions</th>
              </tr>
            </thead>
            <tbody>
              {events.length === 0 ? (
                <tr>
                  <td colSpan={5} className={tableStyles.emptyState}>
                    No events found
                  </td>
                </tr>
              ) : (
                events.map((event: EventLog) => (
                  <tr key={event.id} className={`${tableStyles.row} ${event.isDismissed ? 'opacity-60' : ''}`}>
                    <td className={tableStyles.cell}>
                      <div>{new Date(event.createdAt).toLocaleString()}</div>
                      <div className="text-xs text-gray-500">
                        {formatTimeAgo(event.createdAt)}
                      </div>
                      {event.isDismissed && (
                        <div className="text-xs text-yellow-600 dark:text-yellow-400 font-medium">
                          Dismissed
                        </div>
                      )}
                    </td>
                    <td className={tableStyles.cell}>
                      <div className="font-medium">
                        {getEntityDisplay(event)}
                      </div>
                      <div className="text-xs text-gray-500 capitalize">
                        {event.entityType}
                      </div>
                    </td>
                    <td className={tableStyles.cell}>
                      <div>
                        <div className="font-medium">{event.title}</div>
                        {event.description && (
                          <div className="text-xs text-gray-500">
                            {event.description}
                          </div>
                        )}
                      </div>
                    </td>
                    <td className={tableStyles.cell}>
                      {event.userEmail || "System"}
                    </td>
                    <td className={tableStyles.cell}>
                      <button
                        onClick={() => handleViewDetails(event)}
                        className="text-blue-600 hover:underline"
                      >
                        View Details
                      </button>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>

          {/* Pagination */}
          {totalPages > 1 && (
            <div className="flex justify-center items-center py-4 gap-2 bg-gray-50 dark:bg-gray-700">
              <button
                onClick={() => handlePageChange(currentPage - 1)}
                disabled={currentPage === 1}
                className="px-3 py-1 border rounded disabled:opacity-50 disabled:cursor-not-allowed hover:bg-gray-100"
              >
                Previous
              </button>

              {Array.from({ length: Math.min(10, totalPages) }, (_, i) => {
                const pageNum = i + 1;
                if (totalPages > 10) {
                  // Show first, last, and pages around current
                  if (
                    pageNum === 1 ||
                    pageNum === totalPages ||
                    (pageNum >= currentPage - 2 && pageNum <= currentPage + 2)
                  ) {
                    return (
                      <button
                        key={pageNum}
                        onClick={() => handlePageChange(pageNum)}
                        className={`px-3 py-1 border rounded ${
                          currentPage === pageNum
                            ? "bg-blue-600 text-white"
                            : "hover:bg-gray-100"
                        }`}
                      >
                        {pageNum}
                      </button>
                    );
                  }
                  if (pageNum === 2 && currentPage > 4)
                    return <span key={pageNum}>...</span>;
                  if (
                    pageNum === totalPages - 1 &&
                    currentPage < totalPages - 3
                  )
                    return <span key={pageNum}>...</span>;
                  return null;
                } else {
                  return (
                    <button
                      key={pageNum}
                      onClick={() => handlePageChange(pageNum)}
                      className={`px-3 py-1 border rounded ${
                        currentPage === pageNum
                          ? "bg-blue-600 text-white"
                          : "hover:bg-gray-100"
                      }`}
                    >
                      {pageNum}
                    </button>
                  );
                }
              })}

              <button
                onClick={() => handlePageChange(currentPage + 1)}
                disabled={currentPage === totalPages}
                className="px-3 py-1 border rounded disabled:opacity-50 disabled:cursor-not-allowed hover:bg-gray-100"
              >
                Next
              </button>

              <span className="ml-4 text-sm text-gray-600">
                Page {currentPage} of {totalPages} ({totalCount} total events)
              </span>
            </div>
          )}
        </div>
      </div>

      {/* Event Details Modal */}
      {showDetailsModal && selectedEvent && (
        <Modal
          title="Event Details"
          isOpen={showDetailsModal}
          onClose={() => setShowDetailsModal(false)}
        >
          <h3 className="text-lg font-bold text-gray-900 dark:text-white mb-4">
            Event Details
          </h3>
          <div className="space-y-3">
            <div>
              <span className="text-sm font-medium text-gray-500">
                Event ID:
              </span>
              <span className="text-sm ml-2">{selectedEvent.id}</span>
            </div>
            <div>
              <span className="text-sm font-medium text-gray-500">
                Timestamp:
              </span>
              <span className="text-sm ml-2">
                {new Date(selectedEvent.createdAt).toLocaleString()}
              </span>
            </div>
            <div>
              <span className="text-sm font-medium text-gray-500">Entity:</span>
              <span className="text-sm ml-2">
                {getEntityDisplay(selectedEvent)} ({selectedEvent.entityType})
              </span>
            </div>
            <div>
              <span className="text-sm font-medium text-gray-500">
                Category:
              </span>
              <span className="text-sm ml-2 capitalize">
                {selectedEvent.eventCategory}
              </span>
            </div>
            <div>
              <span className="text-sm font-medium text-gray-500">
                Event Type:
              </span>
              <span className="text-sm ml-2">{selectedEvent.eventType}</span>
            </div>
            <div>
              <span className="text-sm font-medium text-gray-500">Title:</span>
              <span className="text-sm ml-2">{selectedEvent.title}</span>
            </div>
            {selectedEvent.description && (
              <div>
                <span className="text-sm font-medium text-gray-500">
                  Description:
                </span>
                <span className="text-sm ml-2">
                  {selectedEvent.description}
                </span>
              </div>
            )}
            <div>
              <span className="text-sm font-medium text-gray-500">User:</span>
              <span className="text-sm ml-2">
                {selectedEvent.userEmail || "System (Automated)"}
              </span>
            </div>
            {selectedEvent.ipAddress && (
              <div>
                <span className="text-sm font-medium text-gray-500">
                  IP Address:
                </span>
                <span className="text-sm ml-2">{selectedEvent.ipAddress}</span>
              </div>
            )}
            {selectedEvent.isDismissed && (
              <div className="bg-yellow-50 dark:bg-yellow-900/20 border border-yellow-200 dark:border-yellow-700 rounded-lg p-3 my-3">
                <h4 className="text-sm font-medium text-yellow-800 dark:text-yellow-300 mb-1">
                  Event Dismissed
                </h4>
                <div className="space-y-1 text-sm text-yellow-700 dark:text-yellow-400">
                  {selectedEvent.dismissedBy && (
                    <p>By: {selectedEvent.dismissedBy}</p>
                  )}
                  {selectedEvent.dismissedAt && (
                    <p>At: {new Date(selectedEvent.dismissedAt).toLocaleString()}</p>
                  )}
                </div>
              </div>
            )}
            {selectedEvent.metadata !== null &&
              selectedEvent.metadata !== undefined && (
                <div>
                  <span className="text-sm font-medium text-gray-500">
                    Metadata:
                  </span>
                  <pre className="text-xs bg-gray-50 dark:bg-gray-700 p-2 mt-1 rounded overflow-auto">
                    {JSON.stringify(selectedEvent.metadata, null, 2)}
                  </pre>
                </div>
              )}
          </div>
          <div className="mt-6 flex justify-between">
            <div>
              {selectedEvent.isDismissed && (
                <Button
                  onClick={() => handleRestoreEvent(selectedEvent.id)}
                  variant="primary"
                  size="sm"
                >
                  Restore Event
                </Button>
              )}
            </div>
            <Button
              onClick={() => setShowDetailsModal(false)}
              variant="secondary"
            >
              Close
            </Button>
          </div>
        </Modal>
      )}
    </div>
  );
}
