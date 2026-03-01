import type { MouseEvent, ReactNode } from "react";
import { listCardStyles, tableStyles } from "~/utils/tw-styles";
import { IconButton } from "./IconButton";
import type { ViewMode } from "./ViewToggle";

export interface ColumnDef<T> {
  key: string;
  header: string;
  render: (row: T) => ReactNode;
  headerClassName?: string;
  cellClassName?: string;
}

export interface RowAction<T> {
  label: string;
  icon: ReactNode;
  variant: "default" | "danger";
  onClick: (row: T, e: MouseEvent<HTMLButtonElement>) => void;
}

interface DataTableProps<T> {
  data: T[];
  columns: ColumnDef<T>[];
  rowActions?: RowAction<T>[];
  onRowClick?: (row: T) => void;
  viewMode: ViewMode;
  emptyMessage?: string;
  cardRender: (row: T) => ReactNode;
  getRowKey: (row: T) => string | number;
}

export function DataTable<T>({
  data,
  columns,
  rowActions = [],
  onRowClick,
  viewMode,
  emptyMessage,
  cardRender,
  getRowKey,
}: DataTableProps<T>) {
  if (data.length === 0) {
    return (
      <div className={tableStyles.emptyState}>
        {emptyMessage ?? "No items found."}
      </div>
    );
  }

  if (viewMode === "list") {
    return (
      <div className="overflow-x-auto">
        <table className={tableStyles.container}>
          <thead className={tableStyles.header}>
            <tr>
              {columns.map((column) => (
                <th
                  key={column.key}
                  className={`${tableStyles.headerCell} ${column.headerClassName ?? ""}`}
                >
                  {column.header}
                </th>
              ))}
              {rowActions.length > 0 && (
                <th className={`${tableStyles.headerCell} text-right`}>Actions</th>
              )}
            </tr>
          </thead>
          <tbody>
            {data.map((row) => (
              <tr
                key={getRowKey(row)}
                className={`${tableStyles.row} ${onRowClick ? "cursor-pointer hover:bg-gray-50 dark:hover:bg-gray-800" : ""}`}
                onClick={onRowClick ? () => onRowClick(row) : undefined}
              >
                {columns.map((column) => (
                  <td
                    key={column.key}
                    className={`${tableStyles.cell} ${column.cellClassName ?? ""}`}
                  >
                    {column.render(row)}
                  </td>
                ))}
                {rowActions.length > 0 && (
                  <td className={`${tableStyles.cell} text-right`}>
                    <div className="inline-flex items-center gap-1">
                      {rowActions.map((action) => (
                        <IconButton
                          key={action.label}
                          icon={action.icon}
                          variant={action.variant}
                          title={action.label}
                          aria-label={action.label}
                          onClick={(e) => {
                            e.stopPropagation();
                            action.onClick(row, e);
                          }}
                        />
                      ))}
                    </div>
                  </td>
                )}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    );
  }

  return (
    <div className={listCardStyles.grid}>
      {data.map((row) => (
        <div
          key={getRowKey(row)}
          className={`${listCardStyles.card} ${onRowClick ? listCardStyles.clickableCard : ""}`}
          onClick={onRowClick ? () => onRowClick(row) : undefined}
          onKeyDown={
            onRowClick
              ? (e) => {
                  if (e.key === "Enter" || e.key === " ") {
                    e.preventDefault();
                    onRowClick(row);
                  }
                }
              : undefined
          }
          role={onRowClick ? "button" : undefined}
          tabIndex={onRowClick ? 0 : undefined}
        >
          {cardRender(row)}
          {rowActions.length > 0 && (
            <div className={listCardStyles.actionRow}>
              {rowActions.map((action) => (
                <IconButton
                  key={action.label}
                  icon={action.icon}
                  variant={action.variant}
                  title={action.label}
                  aria-label={action.label}
                  onClick={(e) => {
                    e.stopPropagation();
                    action.onClick(row, e);
                  }}
                />
              ))}
            </div>
          )}
        </div>
      ))}
    </div>
  );
}
