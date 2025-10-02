import { useState, useEffect, useRef } from "react";
import { useFetcher, Link, useRevalidator } from "@remix-run/react";
import type { EventLog } from "~/lib/events";
import Button from "~/components/shared/Button";
import { formatEventForTimeline } from "~/utils/eventFormatters";

interface EventTimelineProps {
  entityType: string;
  entityId: string;
  entityName?: string;
  initialEvents?: EventLog[];
  className?: string;
}

export function EventTimeline({
  entityType,
  entityId,
  entityName,
  initialEvents = [],
  className = ""
}: EventTimelineProps) {
  const [events, setEvents] = useState<EventLog[]>(initialEvents.filter(e => !e.isDismissed));
  const [showAll, setShowAll] = useState(false);
  const [selectedEvent, setSelectedEvent] = useState<EventLog | null>(null);
  const modalRef = useRef<HTMLDivElement>(null);
  const revalidator = useRevalidator();
  const dismissFetcher = useFetcher();

  useEffect(() => {
    if (initialEvents && initialEvents.length > 0) {
      setEvents(initialEvents.filter(e => !e.isDismissed));
    }
  }, [initialEvents]);

  useEffect(() => {
    const handleEscape = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && selectedEvent) {
        setSelectedEvent(null);
      }
    };

    if (selectedEvent) {
      document.addEventListener('keydown', handleEscape);
      modalRef.current?.focus();

      // Lock body scroll
      document.body.style.overflow = 'hidden';
    }

    return () => {
      document.removeEventListener('keydown', handleEscape);
      // Restore body scroll
      document.body.style.overflow = '';
    };
  }, [selectedEvent]);

  const displayEvents = showAll ? events : events.slice(0, 5);

  const handleDismissEvent = (eventId: string) => {
    // Optimistically update UI by removing the event
    setEvents(prev => prev.filter(e => e.id !== eventId));

    // Persist to database
    const formData = new FormData();
    formData.append('intent', 'dismiss');
    formData.append('eventId', eventId);

    dismissFetcher.submit(formData, {
      method: 'post',
      action: '/events'
    });

    // Revalidate to get fresh data
    setTimeout(() => revalidator.revalidate(), 100);
  };

  const getEventIcon = (event: EventLog) => {
    const baseClasses = "flex-shrink-0 w-8 h-8 rounded-full flex items-center justify-center z-10 cursor-pointer hover:scale-110 transition-transform";

    // Special case for quote revision
    if (event.eventType === 'quote_revised') {
      return (
        <div className={`${baseClasses} bg-yellow-500`}>
          <svg className="w-4 h-4 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
              d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
          </svg>
        </div>
      );
    }

    // Special case for quote sent
    if (event.eventType === 'quote_status_changed') {
      const metadata = event.metadata as Record<string, unknown> | null;
      const newStatus = metadata?.newStatus || metadata?.status;

      if (newStatus === 'Sent') {
        return (
          <div className={`${baseClasses} bg-green-500`}>
            <svg className="w-4 h-4 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                d="M12 19l9 2-9-18-9 18 9-2zm0 0v-8" />
            </svg>
          </div>
        );
      }
    }

    switch (event.eventCategory) {
      case "financial":
        if (event.eventType.includes("failed") || event.eventType.includes("error")) {
          return (
            <div className={`${baseClasses} bg-red-500`}>
              <span className="text-white text-xs font-bold">!</span>
            </div>
          );
        }
        return (
          <div className={`${baseClasses} bg-purple-500`}>
            <span className="text-white text-xs">$</span>
          </div>
        );

      case "status":
        return (
          <div className={`${baseClasses} bg-blue-500`}>
            <svg className="w-4 h-4 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
          </div>
        );

      case "document":
        return (
          <div className={`${baseClasses} bg-gray-400`}>
            <svg className="w-4 h-4 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                d="M7 21h10a2 2 0 002-2V9.414a1 1 0 00-.293-.707l-5.414-5.414A1 1 0 0012.586 3H7a2 2 0 00-2 2v14a2 2 0 002 2z" />
            </svg>
          </div>
        );

      case "communication":
        return (
          <div className={`${baseClasses} bg-purple-500`}>
            <svg className="w-4 h-4 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                d="M3 8l7.89 5.26a2 2 0 002.22 0L21 8M5 19h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" />
            </svg>
          </div>
        );

      case "quality":
        return (
          <div className={`${baseClasses} bg-green-500`}>
            <svg className="w-4 h-4 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                d="M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z" />
            </svg>
          </div>
        );

      case "manufacturing":
        return (
          <div className={`${baseClasses} bg-green-500`}>
            <svg className="w-4 h-4 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0zm6 3a2 2 0 11-4 0 2 2 0 014 0zM7 10a2 2 0 11-4 0 2 2 0 014 0z" />
            </svg>
          </div>
        );

      default:
        return (
          <div className={`${baseClasses} bg-gray-400`}>
            <svg className="w-4 h-4 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                d="M12 4v16m8-8H4" />
            </svg>
          </div>
        );
    }
  };

  const formatTimeAgo = (date: Date | string) => {
    const dateObj = typeof date === 'string' ? new Date(date) : date;
    const now = new Date();
    const diffMs = now.getTime() - dateObj.getTime();
    const diffMins = Math.floor(diffMs / 60000);
    const diffHours = Math.floor(diffMins / 60);
    const diffDays = Math.floor(diffHours / 24);

    if (diffMins < 1) return "Just now";
    if (diffMins < 60) return `${diffMins} minute${diffMins > 1 ? 's' : ''} ago`;
    if (diffHours < 24) return `${diffHours} hour${diffHours > 1 ? 's' : ''} ago`;
    if (diffDays < 7) return `${diffDays} day${diffDays > 1 ? 's' : ''} ago`;
    if (diffDays < 30) {
      const weeks = Math.floor(diffDays / 7);
      return `${weeks} week${weeks > 1 ? 's' : ''} ago`;
    }

    return dateObj.toLocaleDateString('en-US', {
      month: 'short',
      day: 'numeric',
      year: dateObj.getFullYear() !== now.getFullYear() ? 'numeric' : undefined
    });
  };

  if (events.length === 0) {
    return (
      <div className={`bg-white dark:bg-gray-800 rounded-lg shadow-md border border-gray-200 dark:border-gray-700 ${className}`}>
        <div className="bg-gray-100 dark:bg-gray-700 px-6 py-4 border-b border-gray-200 dark:border-gray-600 flex justify-between items-center">
          <h3 className="text-xl font-bold text-gray-900 dark:text-gray-100">Event Log</h3>
          <Link to={`/events?search=${encodeURIComponent(entityName || entityId)}&entityType=${entityType}&sort=desc&limit=25&offset=0`}>
            <Button size="sm">
              View All
            </Button>
          </Link>
        </div>
        <div className="p-6">
          <p className="text-gray-500 dark:text-gray-400 text-center py-8">No events recorded yet.</p>
        </div>
      </div>
    );
  }

  return (
    <div className={`bg-white dark:bg-gray-800 rounded-lg shadow-md border border-gray-200 dark:border-gray-700 ${className}`}>
      <div className="bg-gray-100 dark:bg-gray-700 px-6 py-4 border-b border-gray-200 dark:border-gray-600 flex justify-between items-center">
        <h3 className="text-xl font-bold text-gray-900 dark:text-gray-100">Event Log</h3>
        <Link to={`/events?search=${encodeURIComponent(entityName || entityId)}&entityType=${entityType}&sort=desc&limit=25&offset=0`}>
          <Button size="sm">
            View All
          </Button>
        </Link>
      </div>
      <div className="p-6">

      <div className="relative">
        {/* Timeline Line */}
        <div
          className="absolute left-[15px] top-6 bottom-0 w-0.5 bg-gray-200 dark:bg-gray-700"
          style={{
            background: 'linear-gradient(180deg, #e5e7eb 0%, #e5e7eb 100%)'
          }}
        />

        {/* Timeline Events */}
        <div className="space-y-4">
          {displayEvents.map((event) => (
            <div key={event.id} className="relative flex items-start group">
              <button
                onClick={() => setSelectedEvent(event)}
                className="focus:outline-none focus:ring-2 focus:ring-blue-500 rounded-full"
                aria-label="View event details"
              >
                {getEventIcon(event)}
              </button>
              <div className="ml-4 flex-1">
                <div className="flex items-start justify-between">
                  <div className="flex-1">
                    {(() => {
                      const formatted = formatEventForTimeline(event);
                      return (
                        <>
                          <p className="text-sm font-medium text-gray-900 dark:text-gray-100">
                            {formatted.title}
                          </p>
                          {formatted.description && (
                            <p className="text-xs text-gray-500 dark:text-gray-400">
                              {formatted.description}
                            </p>
                          )}
                        </>
                      );
                    })()}
                    <div className="flex items-center gap-2 mt-1">
                      <p className="text-xs text-gray-400 dark:text-gray-500">
                        {formatTimeAgo(event.createdAt)}
                      </p>
                      {event.userEmail && (
                        <>
                          <span className="text-xs text-gray-400 dark:text-gray-500">•</span>
                          <p className="text-xs text-gray-400 dark:text-gray-500">
                            {event.userEmail.split('@')[0]}
                          </p>
                        </>
                      )}
                    </div>
                  </div>
                  <button
                    onClick={() => handleDismissEvent(event.id)}
                    className="opacity-0 group-hover:opacity-100 transition-opacity ml-2 p-1 rounded hover:bg-gray-100 dark:hover:bg-gray-700"
                    aria-label="Dismiss event"
                  >
                    <svg className="w-3 h-3 text-gray-400 hover:text-gray-600 dark:hover:text-gray-300" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                    </svg>
                  </button>
                </div>
              </div>
            </div>
          ))}
        </div>

        {/* Show More Button */}
        {events.length > 5 && !showAll && (
          <button
            onClick={() => setShowAll(true)}
            className="w-full text-center text-sm text-blue-600 dark:text-blue-400 hover:text-blue-800 dark:hover:text-blue-300 pt-4 transition-colors"
          >
            View all {events.length} events →
          </button>
        )}

        {showAll && events.length > 5 && (
          <button
            onClick={() => setShowAll(false)}
            className="w-full text-center text-sm text-blue-600 dark:text-blue-400 hover:text-blue-800 dark:hover:text-blue-300 pt-4 transition-colors"
          >
            Show less ←
          </button>
        )}
      </div>
      </div>

      {/* Event Details Modal */}
      {selectedEvent && (
        <>
          <div
            className="fixed inset-0 bg-black bg-opacity-50 z-50"
            onClick={() => setSelectedEvent(null)}
            aria-hidden="true"
          />
          <div
            className="fixed inset-0 flex items-center justify-center z-50 p-4 pointer-events-none"
            role="dialog"
            aria-modal="true"
            aria-labelledby="event-details-title"
          >
            <div
              ref={modalRef}
              className="bg-white dark:bg-gray-800 rounded-lg shadow-xl max-w-2xl w-full max-h-[80vh] overflow-auto pointer-events-auto"
              tabIndex={-1}
            >
            <div className="border-b border-gray-200 dark:border-gray-700 px-6 py-4">
              <div className="flex items-center justify-between">
                <h2 id="event-details-title" className="text-xl font-semibold text-gray-900 dark:text-gray-100">Event Details</h2>
                <button
                  onClick={() => setSelectedEvent(null)}
                  className="text-gray-400 hover:text-gray-600 dark:hover:text-gray-300"
                >
                  <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                  </svg>
                </button>
              </div>
            </div>

            <div className="px-6 py-4 space-y-4">
              {(() => {
                const formatted = formatEventForTimeline(selectedEvent);
                return (
                  <>
                    <div>
                      <h3 className="text-sm font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wide">Event</h3>
                      <p className="mt-1 text-base text-gray-900 dark:text-gray-100">{formatted.title}</p>
                    </div>

                    {formatted.description && (
                      <div>
                        <h3 className="text-sm font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wide">Details</h3>
                        <p className="mt-1 text-base text-gray-700 dark:text-gray-300">{formatted.description}</p>
                      </div>
                    )}
                  </>
                );
              })()}

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <h3 className="text-sm font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wide">Category</h3>
                  <p className="mt-1 text-base text-gray-900 dark:text-gray-100 capitalize">{selectedEvent.eventCategory}</p>
                </div>

                <div>
                  <h3 className="text-sm font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wide">Type</h3>
                  <p className="mt-1 text-base text-gray-900 dark:text-gray-100">{selectedEvent.eventType}</p>
                </div>
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <h3 className="text-sm font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wide">Date & Time</h3>
                  <p className="mt-1 text-base text-gray-900 dark:text-gray-100">
                    {new Date(selectedEvent.createdAt).toLocaleString('en-US', {
                      dateStyle: 'medium',
                      timeStyle: 'short'
                    })}
                  </p>
                </div>

                {selectedEvent.userEmail && (
                  <div>
                    <h3 className="text-sm font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wide">User</h3>
                    <p className="mt-1 text-base text-gray-900 dark:text-gray-100">{selectedEvent.userEmail}</p>
                  </div>
                )}
              </div>

              {(() => {
                const metadata = selectedEvent.metadata as Record<string, unknown> | null;
                if (!metadata || Object.keys(metadata).length === 0) return null;
                return (
                  <div>
                    <h3 className="text-sm font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wide mb-2">Additional Details</h3>
                    <div className="bg-gray-50 dark:bg-gray-900 rounded-lg p-4">
                      {Object.entries(metadata).map(([key, value]) => (
                      <div key={key} className="flex justify-between py-2 border-b border-gray-200 dark:border-gray-700 last:border-0">
                        <span className="text-sm font-medium text-gray-600 dark:text-gray-400">
                          {key.replace(/_/g, ' ').replace(/\b\w/g, l => l.toUpperCase())}
                        </span>
                        <span className="text-sm text-gray-900 dark:text-gray-100">
                          {value === null || value === undefined
                            ? ''
                            : typeof value === 'object'
                              ? JSON.stringify(value, null, 2)
                              : String(value)}
                        </span>
                      </div>
                    ))}
                  </div>
                </div>
                );
              })()}

              <div className="pt-4 border-t border-gray-200 dark:border-gray-700">
                <div className="text-xs text-gray-500 dark:text-gray-400">
                  <p>Event ID: {selectedEvent.id}</p>
                  <p>Entity: {selectedEvent.entityType} ({selectedEvent.entityId})</p>
                </div>
              </div>
            </div>
            </div>
          </div>
        </>
      )}
    </div>
  );
}