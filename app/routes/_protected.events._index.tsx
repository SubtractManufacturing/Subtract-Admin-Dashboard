import { json } from "@remix-run/node";
import { useLoaderData, useNavigate, useFetcher } from "@remix-run/react";
import { useState, useEffect, useCallback, useRef } from "react";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "@remix-run/node";

import {
  getRecentEvents,
  getEventById,
  createEvent,
  dismissEvent,
  restoreEvent,
  type EventFilters,
} from "~/lib/events";
import type { EventLog } from "~/lib/db/schema";
import { getCustomers } from "~/lib/customers";
import { getVendors } from "~/lib/vendors";
import { getOrdersWithRelations, restoreOrder } from "~/lib/orders";
import { restoreQuote } from "~/lib/quotes";
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
  if (endDate) filters.endDate = new Date(endDate);

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
  const { user, userDetails } = await requireAuth(request);
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

      case "dismiss": {
        const eventId = formData.get("eventId") as string;
        if (!eventId) {
          return json({ error: "Missing event ID" }, { status: 400 });
        }

        const result = await dismissEvent(eventId, userDetails?.email);
        if (!result) {
          return json({ error: "Event not found" }, { status: 404 });
        }

        return json({ success: true });
      }

      case "restore": {
        const eventId = formData.get("eventId") as string;
        if (!eventId) {
          return json({ error: "Missing event ID" }, { status: 400 });
        }

        const result = await restoreEvent(eventId);
        if (!result) {
          return json({ error: "Event not found" }, { status: 404 });
        }

        return json({ success: true });
      }

      case "restoreOrder": {
        const orderId = formData.get("orderId") as string;
        if (!orderId) {
          return json({ error: "Missing order ID" }, { status: 400 });
        }

        await restoreOrder(parseInt(orderId), {
          userId: user?.id,
          userEmail: user?.email || userDetails?.email || undefined,
        });

        return json({ success: true });
      }

      case "restoreQuote": {
        const quoteId = formData.get("quoteId") as string;
        if (!quoteId) {
          return json({ error: "Missing quote ID" }, { status: 400 });
        }

        await restoreQuote(parseInt(quoteId), {
          userId: user?.id,
          userEmail: user?.email || userDetails?.email || undefined,
        });

        return json({ success: true });
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
      ? new Date(filters.startDate).toISOString().slice(0, 16)
      : ""
  );
  const [endDate, setEndDate] = useState(
    filters.endDate ? new Date(filters.endDate).toISOString().slice(0, 16) : ""
  );
  const [sortOrder, setSortOrder] = useState(filters.sortOrder || "desc");
  const [pageSize, setPageSize] = useState(filters.limit || 25);

  const [showDetailsModal, setShowDetailsModal] = useState(false);
  const [selectedEvent, setSelectedEvent] = useState<EventLog | null>(null);
  const [displayedEvents, setDisplayedEvents] = useState<EventLog[]>(events);
  const [isLoadingMore, setIsLoadingMore] = useState(false);
  const [hasMore, setHasMore] = useState(totalCount > events.length);
  const [loadedOffsets, setLoadedOffsets] = useState<Set<number>>(new Set([0]));
  const loadMoreFetcher = useFetcher<typeof loader>();
  const restoreFetcher = useFetcher();
  const observerTarget = useRef<HTMLDivElement>(null);

  // Update displayed events only when filters change (not when loading more)
  useEffect(() => {
    // Reset when we get new initial events (from filters/navigation)
    // but not when we're loading more
    if (!isLoadingMore) {
      setDisplayedEvents(events);
      setHasMore(totalCount > events.length);
      setLoadedOffsets(new Set([0]));
      // Update page size from filters to ensure it persists
      if (filters.limit && filters.limit !== pageSize) {
        setPageSize(filters.limit);
      }
    }
  }, [events, totalCount, filters.limit, isLoadingMore, pageSize]);

  const applyFilters = () => {

    const params = new URLSearchParams();
    if (searchTerm) params.set("search", searchTerm);
    if (selectedCategory) params.set("category", selectedCategory);
    if (selectedEntity) params.set("entityType", selectedEntity);
    if (startDate) params.set("startDate", startDate);
    if (endDate) params.set("endDate", endDate);
    params.set("sort", sortOrder);
    params.set("limit", pageSize.toString());
    params.set("offset", "0");

    navigate(`/events?${params.toString()}`);
  };

  // Load more events when fetcher returns data
  useEffect(() => {
    if (loadMoreFetcher.data?.events && isLoadingMore) {
      const newEvents = loadMoreFetcher.data.events;

      // Filter out any duplicates based on event ID
      const existingIds = new Set(displayedEvents.map(e => e.id));
      const uniqueNewEvents = newEvents.filter((e: EventLog) => !existingIds.has(e.id));

      if (uniqueNewEvents.length > 0) {
        setDisplayedEvents(prev => [...prev, ...uniqueNewEvents]);
      }

      setIsLoadingMore(false);

      // Check if there are more events to load
      const currentTotal = displayedEvents.length + uniqueNewEvents.length;
      setHasMore(currentTotal < loadMoreFetcher.data.totalCount);
    }
  }, [loadMoreFetcher.data, displayedEvents, isLoadingMore]);

  // Set up intersection observer for infinite scroll
  useEffect(() => {
    const loadMore = () => {
      if (hasMore && !isLoadingMore && loadMoreFetcher.state === 'idle') {
        loadMoreEvents();
      }
    };

    const observer = new IntersectionObserver(
      entries => {
        if (entries[0].isIntersecting) {
          loadMore();
        }
      },
      { threshold: 0.1, rootMargin: '100px' }
    );

    const currentTarget = observerTarget.current;
    if (currentTarget) {
      observer.observe(currentTarget);
    }

    return () => {
      if (currentTarget) {
        observer.unobserve(currentTarget);
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hasMore, isLoadingMore, loadMoreFetcher.state, displayedEvents.length]);

  const loadMoreEvents = useCallback(() => {
    if (isLoadingMore || !hasMore || loadMoreFetcher.state !== 'idle') return;

    const nextOffset = displayedEvents.length;

    // Don't load if we've already loaded this offset
    if (loadedOffsets.has(nextOffset)) {
      return;
    }

    // Don't load if we already have all the events
    if (nextOffset >= totalCount) {
      setHasMore(false);
      return;
    }

    setIsLoadingMore(true);
    setLoadedOffsets(prev => new Set([...prev, nextOffset]));

    const params = new URLSearchParams();
    if (searchTerm) params.set("search", searchTerm);
    if (selectedCategory) params.set("category", selectedCategory);
    if (selectedEntity) params.set("entityType", selectedEntity);
    if (startDate) params.set("startDate", startDate);
    if (endDate) params.set("endDate", endDate);
    params.set("sort", sortOrder);
    params.set("limit", pageSize.toString());
    params.set("offset", nextOffset.toString());

    loadMoreFetcher.load(`/events?${params.toString()}`);
  }, [
    isLoadingMore,
    hasMore,
    displayedEvents.length,
    totalCount,
    loadedOffsets,
    searchTerm,
    selectedCategory,
    selectedEntity,
    startDate,
    endDate,
    sortOrder,
    pageSize,
    loadMoreFetcher
  ]);

  const handleViewDetails = async (event: EventLog) => {
    setSelectedEvent(event);
    setShowDetailsModal(true);
  };

  const handleRestoreEvent = (eventId: string) => {
    const formData = new FormData();
    formData.append('intent', 'restore');
    formData.append('eventId', eventId);

    restoreFetcher.submit(formData, {
      method: 'post',
      action: '/events'
    });

    // Close modal after restore
    setShowDetailsModal(false);
  };

  const handleRestoreEntity = () => {
    if (!selectedEvent) return;

    const formData = new FormData();

    if (selectedEvent.eventType === 'order_archived') {
      formData.append('intent', 'restoreOrder');
      formData.append('orderId', selectedEvent.entityId);
    } else if (selectedEvent.eventType === 'quote_archived') {
      formData.append('intent', 'restoreQuote');
      formData.append('quoteId', selectedEvent.entityId);
    } else {
      return;
    }

    restoreFetcher.submit(formData, {
      method: 'post',
      action: '/events'
    });

    // Close modal and navigate
    setShowDetailsModal(false);

    // Navigate to the restored entity after a short delay
    setTimeout(() => {
      if (selectedEvent.eventType === 'order_archived') {
        const metadata = selectedEvent.metadata as Record<string, unknown> | null;
        const orderNumber = metadata?.orderNumber;
        if (orderNumber) {
          navigate(`/orders/${orderNumber}`);
        }
      } else if (selectedEvent.eventType === 'quote_archived') {
        navigate(`/quotes/${selectedEvent.entityId}`);
      }
    }, 100);
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
      case "part": {
        const metadata = event.metadata as Record<string, unknown> | null;
        const orderNumber = metadata?.orderNumber;
        const partId = event.entityId.substring(0, 8);
        return orderNumber
          ? `Part #${partId} (${orderNumber})`
          : `Part #${partId}`;
      }
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
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 xl:grid-cols-7 gap-4">
            <div className="flex flex-col">
              <label htmlFor="search-input" className="text-xs text-gray-600 dark:text-gray-400 mb-1 px-1">
                Search
              </label>
              <input
                id="search-input"
                type="text"
                placeholder="Search events..."
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    applyFilters();
                  }
                }}
                className="px-3 py-2 border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100 placeholder-gray-500 dark:placeholder-gray-400 rounded focus:outline-none focus:ring-2 focus:ring-blue-500 dark:focus:ring-blue-400"
              />
            </div>

            <div className="flex flex-col">
              <label htmlFor="category-select" className="text-xs text-gray-600 dark:text-gray-400 mb-1 px-1">
                Category
              </label>
              <select
                id="category-select"
                value={selectedCategory}
                onChange={(e) => setSelectedCategory(e.target.value)}
                className="px-3 py-2 border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100 rounded focus:outline-none focus:ring-2 focus:ring-blue-500 dark:focus:ring-blue-400"
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
            </div>

            <div className="flex flex-col">
              <label htmlFor="entity-select" className="text-xs text-gray-600 dark:text-gray-400 mb-1 px-1">
                Entity Type
              </label>
              <select
                id="entity-select"
                value={selectedEntity}
                onChange={(e) => setSelectedEntity(e.target.value)}
                className="px-3 py-2 border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100 rounded focus:outline-none focus:ring-2 focus:ring-blue-500 dark:focus:ring-blue-400"
              >
                <option value="">All Entities</option>
              <option value="order">Orders</option>
              <option value="customer">Customers</option>
              <option value="vendor">Vendors</option>
              <option value="part">Parts</option>
                <option value="quote">Quotes</option>
              </select>
            </div>

            <div className="flex flex-col">
              <label htmlFor="start-date-input" className="text-xs text-gray-600 dark:text-gray-400 mb-1 px-1">
                Start Date & Time
              </label>
              <input
                id="start-date-input"
                type="datetime-local"
                value={startDate}
                onChange={(e) => setStartDate(e.target.value)}
                className="px-3 py-2 border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100 rounded focus:outline-none focus:ring-2 focus:ring-blue-500 dark:focus:ring-blue-400 [&::-webkit-calendar-picker-indicator]:hidden"
              />
            </div>

            <div className="flex flex-col">
              <label htmlFor="end-date-input" className="text-xs text-gray-600 dark:text-gray-400 mb-1 px-1">
                End Date & Time
              </label>
              <input
                id="end-date-input"
                type="datetime-local"
                value={endDate}
                onChange={(e) => setEndDate(e.target.value)}
                className="px-3 py-2 border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100 rounded focus:outline-none focus:ring-2 focus:ring-blue-500 dark:focus:ring-blue-400 [&::-webkit-calendar-picker-indicator]:hidden"
              />
            </div>

            <div className="flex flex-col">
              <label htmlFor="sort-select" className="text-xs text-gray-600 dark:text-gray-400 mb-1 px-1">
                Sort Order
              </label>
              <select
                id="sort-select"
                value={sortOrder}
                onChange={(e) => {
                  const newSortOrder = e.target.value as "asc" | "desc";
                  setSortOrder(newSortOrder);

                  // Apply the new sort order immediately
                  const params = new URLSearchParams();
                  if (searchTerm) params.set("search", searchTerm);
                  if (selectedCategory) params.set("category", selectedCategory);
                  if (selectedEntity) params.set("entityType", selectedEntity);
                  if (startDate) params.set("startDate", startDate);
                  if (endDate) params.set("endDate", endDate);
                  params.set("sort", newSortOrder);
                  params.set("limit", pageSize.toString());
                  params.set("offset", "0");

                  navigate(`/events?${params.toString()}`);
                }}
                className="px-3 py-2 border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100 rounded focus:outline-none focus:ring-2 focus:ring-blue-500 dark:focus:ring-blue-400"
              >
                <option value="desc">Newest First</option>
                <option value="asc">Oldest First</option>
              </select>
            </div>
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
                className="flex items-center gap-1 text-sm px-3 py-2 text-gray-600 dark:text-gray-300 hover:text-gray-800 dark:hover:text-gray-100 border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 rounded hover:bg-gray-50 dark:hover:bg-gray-600 transition-colors"
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
                  const newPageSize = parseInt(e.target.value);
                  setPageSize(newPageSize);

                  // Apply the new page size immediately
                  const params = new URLSearchParams();
                  if (searchTerm) params.set("search", searchTerm);
                  if (selectedCategory) params.set("category", selectedCategory);
                  if (selectedEntity) params.set("entityType", selectedEntity);
                  if (startDate) params.set("startDate", startDate);
                  if (endDate) params.set("endDate", endDate);
                  params.set("sort", sortOrder);
                  params.set("limit", newPageSize.toString());
                  params.set("offset", "0");

                  navigate(`/events?${params.toString()}`);
                }}
                className="px-3 py-2 border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100 rounded focus:outline-none focus:ring-2 focus:ring-blue-500 dark:focus:ring-blue-400"
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
                displayedEvents.map((event: EventLog) => (
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

          {/* Loading indicator and scroll target */}
          <div ref={observerTarget} className="py-8 bg-gray-50 dark:bg-gray-700">
            {isLoadingMore && (
              <div className="flex justify-center items-center">
                <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600"></div>
                <span className="ml-3 text-gray-600 dark:text-gray-400">Loading more events...</span>
              </div>
            )}
            {!hasMore && displayedEvents.length > 0 && (
              <div className="text-center text-sm text-gray-500 dark:text-gray-400">
                No more events to load • Showing {displayedEvents.length} of {totalCount} total events
              </div>
            )}
          </div>
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
            <div className="flex gap-2">
              {selectedEvent.isDismissed && (
                <Button
                  onClick={() => handleRestoreEvent(selectedEvent.id)}
                  variant="primary"
                  size="sm"
                >
                  Restore Event
                </Button>
              )}
              {(selectedEvent.eventType === 'order_archived' || selectedEvent.eventType === 'quote_archived') && (
                <Button
                  onClick={handleRestoreEntity}
                  variant="primary"
                  size="sm"
                  disabled={restoreFetcher.state === 'submitting'}
                >
                  {restoreFetcher.state === 'submitting'
                    ? 'Restoring...'
                    : `Restore ${selectedEvent.eventType === 'order_archived' ? 'Order' : 'Quote'}`}
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
