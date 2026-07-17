import { Link } from "@remix-run/react";
import Button from "~/components/shared/Button";
import {
  COMMUNICATION_METHOD_LABELS,
  type CommunicationMethod,
} from "~/lib/crm-constants";
import type { CustomerCommunicationListItem } from "~/lib/crm";

type Props = {
  items: CustomerCommunicationListItem[];
  totalCount: number;
  customerId: number;
  onLogClick: () => void;
};

function formatDateTime(date: Date | string) {
  const dateObj = typeof date === "string" ? new Date(date) : date;
  return dateObj.toLocaleString("en-US", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "numeric",
    minute: "2-digit",
  });
}

function truncateNote(text: string, max = 120) {
  if (text.length <= max) return text;
  return `${text.slice(0, max)}…`;
}

export default function CustomerCommunicationsSection({
  items,
  totalCount,
  customerId,
  onLogClick,
}: Props) {
  return (
    <div className="bg-white dark:bg-gray-800 rounded-lg shadow-md border border-gray-200 dark:border-gray-700">
      <div className="bg-gray-100 dark:bg-gray-700 px-6 py-4 border-b border-gray-200 dark:border-gray-600 flex flex-wrap justify-between items-center gap-3">
        <h3 className="text-xl font-bold text-gray-900 dark:text-gray-100">
          Communications
        </h3>
        <div className="flex flex-wrap items-center gap-4">
          <Link
            to={`/crm?customerId=${customerId}`}
            className="text-sm font-medium text-blue-600 hover:text-blue-800 dark:text-blue-400 dark:hover:text-blue-300 hover:underline px-2"
          >
            View all in CRM
          </Link>
          <Button size="sm" onClick={onLogClick}>
            Log Communication
          </Button>
        </div>
      </div>

      <div className="p-6">
        {items.length === 0 ? (
          <div className="text-center py-8">
            <p className="text-gray-500 dark:text-gray-400 mb-4">
              No communications logged yet.
            </p>
            <Button size="sm" onClick={onLogClick}>
              Log Communication
            </Button>
          </div>
        ) : (
          <>
            <div className="overflow-x-auto">
              <table className="min-w-full divide-y divide-gray-200 dark:divide-gray-700">
                <thead className="bg-gray-50 dark:bg-gray-700">
                  <tr>
                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-300 uppercase tracking-wider">
                      Date
                    </th>
                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-300 uppercase tracking-wider">
                      Method
                    </th>
                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-300 uppercase tracking-wider">
                      Note
                    </th>
                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-300 uppercase tracking-wider">
                      Author
                    </th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-200 dark:divide-gray-700">
                  {items.map((item) => (
                    <tr
                      key={item.id}
                      className="hover:bg-gray-50 dark:hover:bg-gray-700/40"
                    >
                      <td className="whitespace-nowrap px-4 py-3 text-sm text-gray-700 dark:text-gray-300">
                        {formatDateTime(item.createdAt)}
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
            {totalCount > items.length ? (
              <p className="mt-4 text-sm text-gray-500 dark:text-gray-400">
                Showing {items.length} of {totalCount}
              </p>
            ) : null}
          </>
        )}
      </div>
    </div>
  );
}
