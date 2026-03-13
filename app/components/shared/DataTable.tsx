import type { MouseEvent, ReactNode } from "react";
import { useNavigate } from "@remix-run/react";
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
  rowLinkHref?: (row: T) => string;
  viewMode: ViewMode;
  emptyMessage?: string;
  cardRender: (row: T) => ReactNode;
  getRowKey: (row: T) => string | number;
}

function openInNewTab(href: string) {
  window.open(href, "_blank", "noopener,noreferrer");
}

export function DataTable<T>({
  data,
  columns,
  rowActions = [],
  onRowClick,
  rowLinkHref,
  viewMode,
  emptyMessage,
  cardRender,
  getRowKey,
}: DataTableProps<T>) {
  const navigate = useNavigate();

  const isClickable = !!(rowLinkHref || onRowClick);

  const handleRowClick = (
    e: MouseEvent<HTMLElement>,
    row: T,
  ) => {
    if (e.defaultPrevented) return;

    if (rowLinkHref) {
      const href = rowLinkHref(row);
      if (e.button !== 0) return;
      if (e.metaKey || e.ctrlKey) {
        e.preventDefault();
        openInNewTab(href);
        return;
      }
      navigate(href);
    } else if (onRowClick) {
      onRowClick(row);
    }
  };

  const handleRowAuxClick = (
    e: MouseEvent<HTMLElement>,
    row: T,
  ) => {
    if (e.defaultPrevented) return;
    if (!rowLinkHref) return;
    if (e.button === 1) {
      e.preventDefault();
      openInNewTab(rowLinkHref(row));
    }
  };

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
                className={`${tableStyles.row} ${isClickable ? "cursor-pointer hover:bg-gray-50 dark:hover:bg-gray-800" : ""}`}
                onMouseDown={rowLinkHref ? (e) => { if (e.button === 1) e.preventDefault(); } : undefined}
                onClick={isClickable ? (e) => handleRowClick(e, row) : undefined}
                onAuxClick={rowLinkHref ? (e) => handleRowAuxClick(e, row) : undefined}
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
          className={`${listCardStyles.card} ${isClickable ? listCardStyles.clickableCard : ""}`}
          onMouseDown={rowLinkHref ? (e) => { if (e.button === 1) e.preventDefault(); } : undefined}
          onClick={isClickable ? (e) => handleRowClick(e, row) : undefined}
          onAuxClick={rowLinkHref ? (e) => handleRowAuxClick(e, row) : undefined}
          onKeyDown={
            isClickable
              ? (e) => {
                  if (e.key === "Enter" || e.key === " ") {
                    e.preventDefault();
                    if (rowLinkHref) {
                      navigate(rowLinkHref(row));
                    } else if (onRowClick) {
                      onRowClick(row);
                    }
                  }
                }
              : undefined
          }
          role={isClickable ? "button" : undefined}
          tabIndex={isClickable ? 0 : undefined}
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
