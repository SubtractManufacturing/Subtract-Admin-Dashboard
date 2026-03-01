import { useRef, type ReactNode } from "react";
import { IconButton } from "~/components/shared/IconButton";
import type {
  NormalizedDrawing,
  NormalizedLineItem,
  NormalizedPart,
} from "~/components/shared/line-items/types";
import { formatToleranceValue, initToleranceOnFocus } from "~/utils/tolerance";

export type LineItemEditableField =
  | "description"
  | "notes"
  | "quantity"
  | "unitPrice"
  | "totalPrice";

interface LineItemRowProps {
  item: NormalizedLineItem;
  entityType: "order" | "quote";
  showSpecs: boolean;
  readOnly?: boolean;
  showActions?: boolean;
  editingField: { lineItemId: number; field: LineItemEditableField } | null;
  editingValue: string;
  onStartEdit: (
    lineItemId: number,
    field: LineItemEditableField,
    currentValue: string
  ) => void;
  onChangeEdit: (value: string) => void;
  onSaveEdit: () => void;
  onCancelEdit: () => void;
  editingAttribute: { partId: string; field: "material" | "tolerance" | "finish" } | null;
  editingAttributeValue: string;
  onStartAttributeEdit: (
    partId: string,
    field: "material" | "tolerance" | "finish",
    currentValue: string
  ) => void;
  onChangeAttributeEdit: (value: string) => void;
  onSaveAttributeEdit: () => void;
  onCancelAttributeEdit: () => void;
  onDelete: (lineItemId: number, partId?: string) => void;
  onView3DModel: (part: NormalizedPart) => void;
  onViewDrawing: (drawing: NormalizedDrawing, partId: string) => void;
  onDrawingUpload: (partId: string, files: FileList) => void;
  onDrawingDelete?: (drawingId: string, partId: string) => void;
  isDrawingUploading?: boolean;
  extraActions?: ReactNode;
}

function formatCurrency(value: string | undefined) {
  return `$${parseFloat(value || "0").toFixed(2)}`;
}

function renderFieldDisplay(value?: string, empty = "Click to add") {
  if (!value) {
    return <span className="text-sm text-gray-400 dark:text-gray-500 italic">{empty}</span>;
  }
  return <span className="text-sm break-words whitespace-pre-wrap">{value}</span>;
}

export function LineItemRow({
  item,
  entityType,
  showSpecs,
  readOnly,
  showActions = true,
  editingField,
  editingValue,
  onStartEdit,
  onChangeEdit,
  onSaveEdit,
  onCancelEdit,
  editingAttribute,
  editingAttributeValue,
  onStartAttributeEdit,
  onChangeAttributeEdit,
  onSaveAttributeEdit,
  onCancelAttributeEdit,
  onDelete,
  onView3DModel,
  onViewDrawing,
  onDrawingUpload,
  onDrawingDelete,
  isDrawingUploading,
  extraActions,
}: LineItemRowProps) {
  const drawingInputRef = useRef<HTMLInputElement>(null);
  const part = item.part;
  const rowTotal = (item.quantity || 0) * parseFloat(item.unitPrice || "0");
  const totalColumns = showActions ? 7 : 6;

  const isPartProcessing = part
    ? part.conversionStatus === "in_progress" ||
      part.conversionStatus === "queued" ||
      part.conversionStatus === "pending" ||
      (part.conversionStatus === "completed" && !part.thumbnailUrl) ||
      (part.cadFileUrl && !part.conversionStatus)
    : false;

  const startFieldEdit = (
    field: LineItemEditableField,
    value: string | number | undefined
  ) => {
    if (readOnly) return;
    onStartEdit(item.id, field, value?.toString() || "");
  };

  const isEditing = (field: LineItemEditableField) =>
    editingField?.lineItemId === item.id && editingField.field === field;

  return (
    <>
      <tr className="group">
        <td
          className="px-6 py-4"
          rowSpan={showSpecs && part ? 2 : 1}
          style={showSpecs && part ? { height: "120px" } : undefined}
        >
          <div className="flex items-start gap-3 h-full">
            {part ? (
              part.thumbnailUrl ? (
                <button
                  onClick={() => onView3DModel(part)}
                  className={`${
                    showSpecs ? "h-20 w-20" : "h-10 w-10"
                  } p-0 border-2 border-gray-300 dark:border-blue-500 bg-white dark:bg-gray-800 rounded-lg cursor-pointer hover:border-blue-500 dark:hover:border-blue-400 hover:shadow-md transition-all flex-shrink-0`}
                  title="Click to view 3D model"
                  type="button"
                >
                  <img
                    src={part.thumbnailUrl}
                    alt={`${part.partName || item.name} thumbnail`}
                    className="h-full w-full object-cover rounded-lg hover:opacity-90 transition-opacity"
                  />
                </button>
              ) : isPartProcessing ? (
                <div
                  className={`${
                    showSpecs ? "h-20 w-20" : "h-10 w-10"
                  } border-2 border-gray-300 dark:border-gray-600 rounded-lg bg-blue-50 dark:bg-blue-900/20 flex items-center justify-center flex-shrink-0`}
                  title="Processing 3D model..."
                >
                  <div
                    className={`animate-spin rounded-full ${
                      showSpecs ? "h-6 w-6" : "h-4 w-4"
                    } border-b-2 border-blue-600`}
                  ></div>
                </div>
              ) : (
                <button
                  onClick={() => onView3DModel(part)}
                  className={`${
                    showSpecs ? "h-20 w-20" : "h-10 w-10"
                  } bg-gray-200 dark:bg-gray-600 rounded-lg flex items-center justify-center flex-shrink-0 cursor-pointer hover:bg-gray-300 dark:hover:bg-gray-500 transition-colors border-0 p-0`}
                  title="Click to view 3D model"
                  type="button"
                >
                  <svg
                    className={`${showSpecs ? "h-6 w-6" : "h-5 w-5"} text-gray-400 dark:text-gray-500`}
                    fill="none"
                    stroke="currentColor"
                    viewBox="0 0 24 24"
                  >
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      strokeWidth={2}
                      d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z"
                    />
                  </svg>
                </button>
              )
            ) : null}

            {part ? (
              part.drawings.length > 0 ? (
                <button
                  onClick={() => onViewDrawing(part.drawings[0], part.id)}
                  className={`relative ${
                    showSpecs ? "h-20 w-20" : "h-10 w-10"
                  } border-2 border-gray-300 dark:border-gray-600 rounded-lg overflow-hidden hover:border-blue-500 transition-colors bg-white dark:bg-gray-700 flex items-center justify-center flex-shrink-0`}
                  title="View drawing"
                  type="button"
                >
                  {part.drawings[0].contentType?.startsWith("image/") ||
                  part.drawings[0].thumbnailSignedUrl ? (
                    <img
                      src={
                        part.drawings[0].contentType?.startsWith("image/")
                          ? part.drawings[0].signedUrl
                          : part.drawings[0].thumbnailSignedUrl || part.drawings[0].signedUrl
                      }
                      alt="Drawing thumbnail"
                      className="w-full h-full object-cover"
                    />
                  ) : (
                    <span className="text-xs text-red-500 font-bold">PDF</span>
                  )}
                  {part.drawings.length > 1 && (
                    <span className="absolute -top-1 -right-1 bg-blue-600 text-white text-xs rounded-full w-4 h-4 flex items-center justify-center font-bold">
                      {part.drawings.length}
                    </span>
                  )}
                </button>
              ) : readOnly ? null : isDrawingUploading ? (
                <div
                  className={`${
                    showSpecs ? "h-20 w-20" : "h-10 w-10"
                  } border-2 border-gray-300 dark:border-gray-600 rounded-lg bg-blue-50 dark:bg-blue-900/20 flex items-center justify-center flex-shrink-0`}
                >
                  <div
                    className={`animate-spin rounded-full ${
                      showSpecs ? "h-6 w-6" : "h-4 w-4"
                    } border-b-2 border-blue-600`}
                  ></div>
                </div>
              ) : (
                <>
                  <input
                    ref={drawingInputRef}
                    type="file"
                    accept=".pdf,.png,.jpg,.jpeg,.dwg,.dxf"
                    multiple
                    className="hidden"
                    onChange={(e) => {
                      if (e.target.files && e.target.files.length > 0) {
                        onDrawingUpload(part.id, e.target.files);
                      }
                      e.target.value = "";
                    }}
                  />
                  <button
                    onClick={() => drawingInputRef.current?.click()}
                    className={`${
                      showSpecs ? "h-20 w-20" : "h-10 w-10"
                    } border-2 border-dashed border-gray-300 dark:border-gray-600 rounded-lg hover:border-blue-500 transition-colors bg-gray-50 dark:bg-gray-800 flex items-center justify-center group flex-shrink-0 overflow-visible`}
                    title="Upload drawing"
                    type="button"
                  >
                    <svg
                      className={`${showSpecs ? "w-5 h-5" : "w-4 h-4"} text-gray-400 group-hover:text-blue-500 flex-shrink-0`}
                      fill="none"
                      viewBox="0 0 24 24"
                      stroke="currentColor"
                      strokeWidth={2}
                    >
                      <path
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M15 13l-3-3m0 0l-3 3m3-3v12"
                      />
                    </svg>
                  </button>
                </>
              )
            ) : null}

            <div className="flex flex-col">
              <span className="text-sm font-medium text-gray-900 dark:text-gray-100">
                {item.name || "--"}
              </span>
              {part && (
                <span className="text-xs text-gray-500 dark:text-gray-400">
                  Part: {part.partName || "--"}
                </span>
              )}
            </div>
          </div>
        </td>

        <td className="px-6 py-4 text-sm text-gray-900 dark:text-gray-100">
          {isEditing("description") ? (
            <textarea
              value={editingValue}
              onChange={(e) => onChangeEdit(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey) {
                  e.preventDefault();
                  onSaveEdit();
                } else if (e.key === "Escape") {
                  onCancelEdit();
                }
              }}
              className="w-full px-2 py-1 text-sm border border-gray-300 dark:border-gray-600 rounded bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100"
              rows={2}
              placeholder="Description"
            />
          ) : (
            <button
              type="button"
              className={`text-left w-full ${readOnly ? "" : "hover:bg-gray-100 dark:hover:bg-gray-700 rounded px-2 py-1"}`}
              onClick={() => startFieldEdit("description", item.description)}
            >
              {renderFieldDisplay(item.description, "Click to add description")}
            </button>
          )}
        </td>

        <td className="px-6 py-4 text-sm text-gray-900 dark:text-gray-100">
          {isEditing("notes") ? (
            <textarea
              value={editingValue}
              onChange={(e) => onChangeEdit(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey) {
                  e.preventDefault();
                  onSaveEdit();
                } else if (e.key === "Escape") {
                  onCancelEdit();
                }
              }}
              className="w-full px-2 py-1 text-sm border border-gray-300 dark:border-gray-600 rounded bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100"
              rows={2}
              placeholder="Notes"
            />
          ) : (
            <button
              type="button"
              className={`text-left w-full ${readOnly ? "" : "hover:bg-gray-100 dark:hover:bg-gray-700 rounded px-2 py-1"}`}
              onClick={() => startFieldEdit("notes", item.notes)}
            >
              {renderFieldDisplay(item.notes)}
            </button>
          )}
        </td>

        <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900 dark:text-gray-100">
          {isEditing("quantity") ? (
            <input
              type="number"
              min={1}
              value={editingValue}
              onChange={(e) => onChangeEdit(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") onSaveEdit();
                if (e.key === "Escape") onCancelEdit();
              }}
              className="w-20 px-2 py-1 text-sm border border-gray-300 dark:border-gray-600 rounded bg-white dark:bg-gray-700"
            />
          ) : (
            <button
              type="button"
              className={readOnly ? "" : "hover:bg-gray-100 dark:hover:bg-gray-700 rounded px-2 py-1"}
              onClick={() => startFieldEdit("quantity", item.quantity)}
            >
              {item.quantity}
            </button>
          )}
        </td>

        <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900 dark:text-gray-100">
          {isEditing("unitPrice") ? (
            <input
              type="number"
              min={0}
              step="0.01"
              value={editingValue}
              onChange={(e) => onChangeEdit(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") onSaveEdit();
                if (e.key === "Escape") onCancelEdit();
              }}
              className="w-24 px-2 py-1 text-sm border border-gray-300 dark:border-gray-600 rounded bg-white dark:bg-gray-700"
            />
          ) : (
            <button
              type="button"
              className={readOnly ? "" : "hover:bg-gray-100 dark:hover:bg-gray-700 rounded px-2 py-1"}
              onClick={() => startFieldEdit("unitPrice", item.unitPrice)}
            >
              {formatCurrency(item.unitPrice)}
            </button>
          )}
        </td>

        <td className="px-6 py-4 whitespace-nowrap text-sm font-medium text-gray-900 dark:text-gray-100">
          {entityType === "quote" && isEditing("totalPrice") ? (
            <input
              type="number"
              min={0}
              step="0.01"
              value={editingValue}
              onChange={(e) => onChangeEdit(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") onSaveEdit();
                if (e.key === "Escape") onCancelEdit();
              }}
              className="w-24 px-2 py-1 text-sm border border-gray-300 dark:border-gray-600 rounded bg-white dark:bg-gray-700"
            />
          ) : (
            <button
              type="button"
              className={readOnly || entityType === "order" ? "" : "hover:bg-gray-100 dark:hover:bg-gray-700 rounded px-2 py-1"}
              onClick={() =>
                entityType === "quote"
                  ? startFieldEdit("totalPrice", item.totalPrice || "0")
                  : undefined
              }
            >
              {formatCurrency(
                entityType === "quote" ? item.totalPrice || "0" : rowTotal.toString()
              )}
            </button>
          )}
        </td>

        {showActions && (
          <td className="px-6 py-4 whitespace-nowrap text-right">
            {!readOnly && (
              <div className="flex items-center justify-end gap-2 opacity-0 group-hover:opacity-100 transition-opacity">
                {extraActions}
                <IconButton
                  icon={
                    <svg className="w-[18px] h-[18px]" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        strokeWidth={2}
                        d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"
                      />
                    </svg>
                  }
                  variant="danger"
                  title="Delete line item"
                  onClick={() => onDelete(item.id, part?.id)}
                />
              </div>
            )}
          </td>
        )}
      </tr>

      {showSpecs && part && (
        <tr className="bg-white dark:bg-gray-800">
          <td
            colSpan={totalColumns}
            className="px-6 py-3 border-t border-gray-200 dark:border-gray-700"
          >
            <div className="space-y-4">
              <div className="grid grid-cols-3 gap-6">
                {(["material", "tolerance", "finish"] as const).map((field) => {
                  const value = part[field] || "";
                  const isEditingAttribute =
                    editingAttribute?.partId === part.id &&
                    editingAttribute?.field === field;
                  return (
                    <div key={field} className="flex flex-col">
                      <span className="text-xs font-semibold text-gray-600 dark:text-gray-400 mb-1 uppercase tracking-wide">
                        {field === "finish" ? "Finishing" : field}
                      </span>
                      {isEditingAttribute ? (
                        <div className="flex items-center gap-2">
                          <input
                            type="text"
                            value={editingAttributeValue}
                            onChange={(e) =>
                              onChangeAttributeEdit(
                                field === "tolerance"
                                  ? formatToleranceValue(e.target.value)
                                  : e.target.value
                              )
                            }
                            onFocus={() => {
                              if (field === "tolerance") {
                                onChangeAttributeEdit(
                                  initToleranceOnFocus(editingAttributeValue)
                                );
                              }
                            }}
                            onKeyDown={(e) => {
                              if (e.key === "Enter") {
                                e.preventDefault();
                                onSaveAttributeEdit();
                              } else if (e.key === "Escape") {
                                onCancelAttributeEdit();
                              }
                            }}
                            className="flex-1 px-2 py-1 text-sm border border-gray-300 dark:border-gray-600 rounded bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100"
                            placeholder={field === "tolerance" ? "e.g., ±0.005" : field}
                          />
                          <button
                            onClick={onSaveAttributeEdit}
                            className="p-1 text-green-600 hover:text-green-700 dark:text-green-400"
                            type="button"
                          >
                            Save
                          </button>
                          <button
                            onClick={onCancelAttributeEdit}
                            className="p-1 text-red-600 hover:text-red-700 dark:text-red-400"
                            type="button"
                          >
                            Cancel
                          </button>
                        </div>
                      ) : (
                        <button
                          type="button"
                          onClick={() => {
                            if (readOnly) return;
                            onStartAttributeEdit(part.id, field, value);
                          }}
                          className={`text-left px-2 py-1 rounded ${
                            readOnly ? "" : "hover:bg-gray-100 dark:hover:bg-gray-700"
                          }`}
                        >
                          <span className="text-sm text-gray-900 dark:text-gray-100">
                            {value || (
                              <span className="text-gray-400 dark:text-gray-500 italic">
                                Click to add
                              </span>
                            )}
                          </span>
                        </button>
                      )}
                    </div>
                  );
                })}
              </div>
              {part.drawings.length > 0 && (
                <div className="flex flex-col border-t border-gray-200 dark:border-gray-700 pt-3">
                  <span className="text-xs font-semibold text-gray-600 dark:text-gray-400 mb-2 uppercase tracking-wide">
                    Drawings
                  </span>
                  <ul className="space-y-1.5">
                    {part.drawings.map((drawing) => (
                      <li
                        key={drawing.id}
                        className="flex items-center justify-between gap-2 py-1"
                      >
                        <button
                          type="button"
                          onClick={() => onViewDrawing(drawing, part.id)}
                          className="text-sm text-blue-600 dark:text-blue-400 hover:underline truncate min-w-0 text-left"
                        >
                          {drawing.fileName}
                        </button>
                        {!readOnly && onDrawingDelete && (
                          <IconButton
                            icon={
                              <svg className="w-[18px] h-[18px]" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                <path
                                  strokeLinecap="round"
                                  strokeLinejoin="round"
                                  strokeWidth={2}
                                  d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"
                                />
                              </svg>
                            }
                            variant="danger"
                            title="Delete drawing"
                            aria-label={`Delete ${drawing.fileName}`}
                            onClick={(e) => {
                              e.stopPropagation();
                              if (confirm(`Delete "${drawing.fileName}"?`)) {
                                onDrawingDelete(drawing.id, part.id);
                              }
                            }}
                          />
                        )}
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </div>
          </td>
        </tr>
      )}
    </>
  );
}
