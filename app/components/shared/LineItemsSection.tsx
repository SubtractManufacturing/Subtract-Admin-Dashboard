import { useMemo, useState, type ReactNode } from "react";
import Button from "~/components/shared/Button";
import { LineItemRow, type LineItemEditableField } from "~/components/shared/LineItemRow";
import { SectionCard } from "~/components/shared/SectionCard";
import type {
  NormalizedDrawing,
  NormalizedLineItem,
  NormalizedPart,
} from "~/components/shared/line-items/types";

interface LineItemsSectionProps {
  items: NormalizedLineItem[];
  entityType: "order" | "quote";
  readOnly?: boolean;
  subtotal: string;
  onAdd: () => void;
  onDelete: (lineItemId: number, partId?: string) => void;
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
}

export function LineItemsSection({
  items,
  entityType,
  readOnly,
  subtotal,
  onAdd,
  onDelete,
  onSaveField,
  onSaveAttribute,
  onDrawingUpload,
  onDrawingDelete,
  drawingUploadingPartId,
  onView3DModel,
  onViewDrawing,
  rowExtraActions,
}: LineItemsSectionProps) {
  const [showSpecs, setShowSpecs] = useState(false);
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

  const sortedItems = useMemo(() => items, [items]);

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
    <SectionCard title="Line Items" actions={actions} contentClassName="p-6">
      {sortedItems.length > 0 ? (
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
              {sortedItems.map((item) => (
                <LineItemRow
                  key={item.id}
                  item={item}
                  entityType={entityType}
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
                  isDrawingUploading={drawingUploadingPartId === item.part?.id}
                  extraActions={rowExtraActions?.(item)}
                />
              ))}
            </tbody>
            <tfoot className="bg-gray-50 dark:bg-gray-700">
              <tr>
                <td
                  colSpan={showActions ? 5 : 4}
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
  );
}
