import Modal from "~/components/shared/Modal";
import Button from "~/components/shared/Button";
import {
  formatArchiveExpiry,
  type SerializedArchivedLineItem,
} from "~/lib/line-item-archive";

interface ArchivedLineItemsModalProps {
  isOpen: boolean;
  onClose: () => void;
  items: SerializedArchivedLineItem[];
  onRestore: (lineItemId: number) => void;
  isRestoring?: boolean;
  restoringLineItemId?: number | null;
}

export function ArchivedLineItemsModal({
  isOpen,
  onClose,
  items,
  onRestore,
  isRestoring = false,
  restoringLineItemId = null,
}: ArchivedLineItemsModalProps) {
  return (
    <Modal isOpen={isOpen} onClose={onClose} title="Archived Line Items" size="lg">
      {items.length === 0 ? (
        <p className="text-sm text-gray-500 dark:text-gray-400">
          No archived line items. Deleted line items appear here until they are
          permanently removed after the retention period.
        </p>
      ) : (
        <div className="overflow-x-auto">
          <table className="min-w-full divide-y divide-gray-200 dark:divide-gray-700">
            <thead className="bg-gray-50 dark:bg-gray-700">
              <tr>
                <th className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wider text-gray-500 dark:text-gray-300">
                  Item
                </th>
                <th className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wider text-gray-500 dark:text-gray-300">
                  Qty
                </th>
                <th className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wider text-gray-500 dark:text-gray-300">
                  Archived
                </th>
                <th className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wider text-gray-500 dark:text-gray-300">
                  Expires
                </th>
                <th className="px-4 py-3 text-right text-xs font-medium uppercase tracking-wider text-gray-500 dark:text-gray-300">
                  Action
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-200 bg-white dark:divide-gray-700 dark:bg-gray-800">
              {items.map((item) => {
                const hardDeleteAt = new Date(item.hardDeleteAt);
                const archivedAt = new Date(item.archivedAt);
                const isRowRestoring =
                  isRestoring && restoringLineItemId === item.id;

                return (
                  <tr key={item.id}>
                    <td className="px-4 py-3 text-sm text-gray-900 dark:text-gray-100">
                      {item.name}
                    </td>
                    <td className="px-4 py-3 text-sm text-gray-700 dark:text-gray-300">
                      {item.quantity}
                    </td>
                    <td className="px-4 py-3 text-sm text-gray-700 dark:text-gray-300">
                      {archivedAt.toLocaleDateString()}
                    </td>
                    <td className="px-4 py-3 text-sm text-gray-700 dark:text-gray-300">
                      {formatArchiveExpiry(hardDeleteAt)}
                    </td>
                    <td className="px-4 py-3 text-right">
                      <Button
                        size="sm"
                        variant="secondary"
                        disabled={isRestoring}
                        onClick={() => onRestore(item.id)}
                      >
                        {isRowRestoring ? "Restoring..." : "Restore"}
                      </Button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </Modal>
  );
}
