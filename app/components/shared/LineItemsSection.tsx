import { useState, type ReactNode } from "react";
import Button from "~/components/shared/Button";
import { ArchivedLineItemsModal } from "~/components/shared/ArchivedLineItemsModal";
import { LineItemRow, type LineItemEditableField } from "~/components/shared/LineItemRow";
import { SectionCard } from "~/components/shared/SectionCard";
import type { SerializedArchivedLineItem } from "~/lib/line-item-archive";
import type {
  NormalizedDrawing,
  NormalizedLineItem,
  NormalizedPart,
} from "~/components/shared/line-items/types";

interface LineItemsSectionProps {
  items: NormalizedLineItem[];
  entityType: "order" | "quote";
  /** When true, line items show CAD placeholder instead of raster 3D thumbnails (click still opens viewer). */
  hideThumbnails?: boolean;
  readOnly?: boolean;
  subtotal: string;
  archivedItems?: SerializedArchivedLineItem[];
  onAdd: () => void;
  onDelete: (lineItemId: number, partId?: string) => void;
  onRestoreArchived?: (lineItemId: number) => void;
  isRestoringArchived?: boolean;
  restoringArchivedLineItemId?: number | null;
  onSaveField: (
    lineItemId: number,
    field: LineItemEditableField,
    value: string
  ) => void;
  onSaveAttribute: (
    partId: string,
    field: "material" | "tolerance" | "finish",
    value: string
  ) => void;
  onDrawingUpload: (partId: string, files: FileList) => void;
  onDrawingDelete: (drawingId: string, partId: string) => void;
  drawingUploadingPartId?: string;
  onView3DModel: (part: NormalizedPart) => void;
  onViewDrawing: (drawing: NormalizedDrawing, partId: string) => void;
  rowExtraActions?: (item: NormalizedLineItem) => ReactNode;
  partAssetAdminAction?: string;
}

export function LineItemsSection({
  items,
  entityType,
  hideThumbnails,
  readOnly,
  subtotal,
  archivedItems = [],
  onAdd,
  onDelete,
  onRestoreArchived,
  isRestoringArchived = false,
  restoringArchivedLineItemId = null,
  onSaveField,
  onSaveAttribute,
  onDrawingUpload,
  onDrawingDelete,
  drawingUploadingPartId,
  onView3DModel,
  onViewDrawing,
  rowExtraActions,
  partAssetAdminAction,
}: LineItemsSectionProps) {
  const [showSpecs, setShowSpecs] = useState(false);
  const [archivedModalOpen, setArchivedModalOpen] = useState(false);
  const [editingField, setEditingField] = useState<{
    lineItemId: number;
    field: LineItemEditableField;
  } | null>(null);
  const [editingValue, setEditingValue] = useState("");
  const [editingAttribute, setEditingAttribute] = useState<{
    partId: string;
    field: "material" | "tolerance" | "finish";
  } | null>(null);
  const [editingAttributeValue, setEditingAttributeValue] = useState("");

  const showActions = !readOnly;

  const saveEdit = () => {
    if (!editingField) return;
    onSaveField(editingField.lineItemId, editingField.field, editingValue);
    setEditingField(null);
    setEditingValue("");
  };

  const saveAttributeEdit = () => {
    if (!editingAttribute) return;
    onSaveAttribute(
      editingAttribute.partId,
      editingAttribute.field,
      editingAttributeValue
    );
    setEditingAttribute(null);
    setEditingAttributeValue("");
  };

  const actions = (
    <div className="flex items-center gap-3">
      <style>{`
        .specs-icon path {
          transition: transform 0.3s ease-in-out;
        }
        .specs-icon.open .layer-top { transform: translateY(-2px); }
        .specs-icon.open .layer-middle { transform: translateY(0px); }
        .specs-icon.open .layer-bottom { transform: translateY(2px); }
        .specs-icon.closed .layer-top { transform: translateY(0); }
        .specs-icon.closed .layer-middle { transform: translateY(0); }
        .specs-icon.closed .layer-bottom { transform: translateY(0); }
      `}</style>
      <button
        type="button"
        onClick={() => setArchivedModalOpen(true)}
        className="relative flex items-center gap-2 rounded-md border border-gray-300 bg-white px-3 py-1.5 text-sm font-medium text-gray-700 transition-colors hover:bg-gray-50 dark:border-gray-500 dark:bg-gray-600 dark:text-gray-200 dark:hover:bg-gray-500"
        title="View archived line items"
      >
        <svg
          xmlns="http://www.w3.org/2000/svg"
          width="16"
          height="16"
          fill="currentColor"
          viewBox="0 0 16 16"
          aria-hidden="true"
        >
          <path d="M1.5 1.5A.5.5 0 0 1 2 1h12a.5.5 0 0 1 .5.5v2a.5.5 0 0 1-.128.334L10 8.692V13.5a.5.5 0 0 1-.342.474l-3 1A.5.5 0 0 1 6 14.5V8.692L1.628 3.834A.5.5 0 0 1 1.5 3.5v-2z" />
        </svg>
        Archived
        {archivedItems.length > 0 && (
          <span className="inline-flex min-w-[1.25rem] items-center justify-center rounded-full bg-gray-900 px-1.5 py-0.5 text-xs font-semibold text-white dark:bg-gray-100 dark:text-gray-900">
            {archivedItems.length}
          </span>
        )}
      </button>
      <button
        onClick={() => setShowSpecs((prev) => !prev)}
        className={`flex items-center gap-2 px-3 py-1.5 rounded-md text-sm font-medium transition-colors ${
          showSpecs
            ? "bg-blue-600 text-white hover:bg-blue-700 dark:bg-blue-500 dark:hover:bg-blue-600"
            : "bg-white dark:bg-gray-600 text-gray-700 dark:text-gray-200 border border-gray-300 dark:border-gray-500 hover:bg-gray-50 dark:hover:bg-gray-500"
        }`}
        title={showSpecs ? "Hide part specifications" : "Show part specifications"}
      >
        <svg
          xmlns="http://www.w3.org/2000/svg"
          width="16"
          height="16"
          fill="currentColor"
          viewBox="0 0 16 16"
          className={`specs-icon ${showSpecs ? "open" : "closed"}`}
        >
          <path
            className="layer-top"
            d="M8.235 1.559a.5.5 0 0 0-.47 0l-7.5 4a.5.5 0 0 0 0 .882l7.5 4a.5.5 0 0 0 .47 0l7.5-4a.5.5 0 0 0 0-.882l-7.5-4zM8 9.433 1.562 6 8 2.567 14.438 6 8 9.433z"
          />
          <path
            className="layer-middle"
            d="M3.188 8 .264 9.559a.5.5 0 0 0 0 .882l7.5 4a.5.5 0 0 0 .47 0l7.5-4a.5.5 0 0 0 0-.882L12.813 8l-4.578 2.441a.5.5 0 0 1-.47 0L3.188 8z"
            style={{ opacity: 0.7 }}
          />
          <path
            className="layer-bottom"
            d="M11.75 8.567l3.688 1.966L8 13.433l-6.438-2.9L4.25 8.567l3.515 1.874a.5.5 0 0 0 .47 0l3.515-1.874z"
            style={{ opacity: 0.5 }}
          />
        </svg>
        Specs
      </button>
      {!readOnly && (
        <Button size="sm" onClick={onAdd}>
          Add Line Item
        </Button>
      )}
    </div>
  );

  return (
    <>
      <SectionCard title="Line Items" actions={actions} contentClassName="p-6">
      {items.length > 0 ? (
        <div className="overflow-x-auto">
          <table className="min-w-full divide-y divide-gray-200 dark:divide-gray-700 table-fixed">
            <thead className="bg-gray-50 dark:bg-gray-700">
              <tr>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-300 uppercase tracking-wider w-[25%]">
                  Item
                </th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-300 uppercase tracking-wider w-[20%]">
                  Description
                </th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-300 uppercase tracking-wider w-[25%]">
                  Notes
                </th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-300 uppercase tracking-wider w-[8%]">
                  Quantity
                </th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-300 uppercase tracking-wider w-[10%]">
                  Unit Price
                </th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-300 uppercase tracking-wider w-[10%]">
                  Total
                </th>
                {showActions && <th className="px-6 py-3 w-[7%]"></th>}
              </tr>
            </thead>
            <tbody className="bg-white dark:bg-gray-800 divide-y divide-gray-200 dark:divide-gray-700">
              {items.map((item) => (
                <LineItemRow
                  key={item.id}
                  item={item}
                  entityType={entityType}
                  hideThumbnails={hideThumbnails}
                  showSpecs={showSpecs}
                  readOnly={readOnly}
                  showActions={showActions}
                  editingField={editingField}
                  editingValue={editingValue}
                  onStartEdit={(lineItemId, field, currentValue) => {
                    setEditingField({ lineItemId, field });
                    setEditingValue(currentValue);
                  }}
                  onChangeEdit={setEditingValue}
                  onSaveEdit={saveEdit}
                  onCancelEdit={() => {
                    setEditingField(null);
                    setEditingValue("");
                  }}
                  editingAttribute={editingAttribute}
                  editingAttributeValue={editingAttributeValue}
                  onStartAttributeEdit={(partId, field, currentValue) => {
                    setEditingAttribute({ partId, field });
                    setEditingAttributeValue(currentValue);
                  }}
                  onChangeAttributeEdit={setEditingAttributeValue}
                  onSaveAttributeEdit={saveAttributeEdit}
                  onCancelAttributeEdit={() => {
                    setEditingAttribute(null);
                    setEditingAttributeValue("");
                  }}
                  onDelete={onDelete}
                  onView3DModel={onView3DModel}
                  onViewDrawing={onViewDrawing}
                  onDrawingUpload={onDrawingUpload}
                  onDrawingDelete={onDrawingDelete}
                  isDrawingUploading={drawingUploadingPartId === item.part?.id}
                  extraActions={rowExtraActions?.(item)}
                  partAssetAdminAction={partAssetAdminAction}
                />
              ))}
            </tbody>
            <tfoot className="bg-gray-50 dark:bg-gray-700">
              <tr>
                <td
                  colSpan={5}
                  className="px-6 py-3 text-right text-sm font-medium text-gray-900 dark:text-gray-100"
                >
                  Subtotal:
                </td>
                <td className="px-6 py-3 whitespace-nowrap text-sm font-bold text-gray-900 dark:text-gray-100">
                  {subtotal}
                </td>
                {showActions && <td></td>}
              </tr>
            </tfoot>
          </table>
        </div>
      ) : (
        <p className="text-gray-500 dark:text-gray-400 text-center py-8">
          No line items added yet.
        </p>
      )}
      </SectionCard>
      <ArchivedLineItemsModal
        isOpen={archivedModalOpen}
        onClose={() => setArchivedModalOpen(false)}
        items={archivedItems}
        onRestore={(lineItemId) => {
          onRestoreArchived?.(lineItemId);
        }}
        isRestoring={isRestoringArchived}
        restoringLineItemId={restoringArchivedLineItemId}
      />
    </>
  );
}
