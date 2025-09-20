import { useState, useEffect } from "react";
import { useFetcher } from "@remix-run/react";
import type { EventLog } from "~/lib/events";

interface EventTimelineProps {
  entityType: string;
  entityId: string;
  initialEvents?: EventLog[];
  className?: string;
}

export function EventTimeline({
  entityType,
  entityId,
  initialEvents = [],
  className = ""
}: EventTimelineProps) {
  const [events, setEvents] = useState<EventLog[]>(initialEvents);
  const [showAll, setShowAll] = useState(false);
  const fetcher = useFetcher<{ events: EventLog[] }>();

  useEffect(() => {
    if (!initialEvents || initialEvents.length === 0) {
      fetcher.load(`/api/events?entityType=${entityType}&entityId=${entityId}&limit=5`);
    }
  }, [entityType, entityId]);

  useEffect(() => {
    if (fetcher.data?.events) {
      setEvents(fetcher.data.events);
    }
  }, [fetcher.data]);

  const displayEvents = showAll ? events : events.slice(0, 5);

  const getEventIcon = (event: EventLog) => {
    const baseClasses = "flex-shrink-0 w-8 h-8 rounded-full flex items-center justify-center z-10";

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

  if (events.length === 0 && !fetcher.state) {
    return (
      <div className={`bg-white dark:bg-gray-800 rounded-lg shadow-md border border-gray-200 dark:border-gray-700 ${className}`}>
        <div className="bg-gray-100 dark:bg-gray-700 px-6 py-4 border-b border-gray-200 dark:border-gray-600">
          <h3 className="text-xl font-bold text-gray-900 dark:text-gray-100">Event Log</h3>
        </div>
        <div className="p-6">
          <p className="text-gray-500 dark:text-gray-400 text-center py-8">No events recorded yet.</p>
        </div>
      </div>
    );
  }

  return (
    <div className={`bg-white dark:bg-gray-800 rounded-lg shadow-md border border-gray-200 dark:border-gray-700 ${className}`}>
      <div className="bg-gray-100 dark:bg-gray-700 px-6 py-4 border-b border-gray-200 dark:border-gray-600">
        <h3 className="text-xl font-bold text-gray-900 dark:text-gray-100">Event Log</h3>
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
            <div key={event.id} className="relative flex items-start">
              {getEventIcon(event)}
              <div className="ml-4 flex-1">
                <p className="text-sm font-medium text-gray-900 dark:text-gray-100">
                  {event.title}
                </p>
                {event.description && (
                  <p className="text-xs text-gray-500 dark:text-gray-400">
                    {event.description}
                  </p>
                )}
                <p className="text-xs text-gray-400 dark:text-gray-500 mt-1">
                  {formatTimeAgo(event.createdAt)}
                </p>
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
    </div>
  );
}