import { useEffect, useMemo, useRef, useState, type ChangeEvent } from "react";
import Modal from "~/components/shared/Modal";
import Button from "~/components/shared/Button";
import { InputField, TextareaField } from "~/components/shared/FormField";
import PartSelectionModal from "~/components/PartSelectionModal";
import type { Part } from "~/lib/db/schema";

interface AddLineItemModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSubmit: (data: FormData) => void;
  context: "order" | "quote";
  customerId?: number | null;
  existingParts?: Part[];
}

const CAD_ACCEPT =
  ".step,.stp,.brep,.sldprt,.stl,.obj,.gltf,.glb,.igs,.iges,.x_t,.x_b,.sat";

export function AddLineItemModal({
  isOpen,
  onClose,
  onSubmit,
  context,
  customerId,
  existingParts = [],
}: AddLineItemModalProps) {
  const [cadFile, setCadFile] = useState<File | null>(null);
  const [showPartSelection, setShowPartSelection] = useState(false);
  const [selectedPartId, setSelectedPartId] = useState<string | null>(null);
  const [dragActive, setDragActive] = useState(false);
  const [showDetails, setShowDetails] = useState(false);
  const [errors, setErrors] = useState<{ name?: string }>({});
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [notes, setNotes] = useState("");
  const [quantity, setQuantity] = useState("1");
  const [unitPrice, setUnitPrice] = useState("");
  const [totalPrice, setTotalPrice] = useState("");

  const [material, setMaterial] = useState("");
  const [tolerance, setTolerance] = useState("");
  const [finish, setFinish] = useState("");
  const [partNotes, setPartNotes] = useState("");
  const [drawings, setDrawings] = useState<File[]>([]);
  const drawingInputRef = useRef<HTMLInputElement>(null);

  const selectedPart = useMemo(
    () => existingParts.find((p) => p.id === selectedPartId),
    [existingParts, selectedPartId]
  );

  const hasPartAttached = cadFile !== null || selectedPartId !== null;

  useEffect(() => {
    if (!isOpen) return;
    setCadFile(null);
    setSelectedPartId(null);
    setShowPartSelection(false);
    setDragActive(false);
    setShowDetails(false);
    setErrors({});
    setName("");
    setDescription("");
    setNotes("");
    setQuantity("1");
    setUnitPrice("");
    setTotalPrice("");
    setMaterial("");
    setTolerance("");
    setFinish("");
    setPartNotes("");
    setDrawings([]);
  }, [isOpen]);

  useEffect(() => {
    if (context !== "quote") return;
    const qty = parseFloat(quantity || "0");
    const unit = parseFloat(unitPrice || "0");
    if (!Number.isNaN(qty) && qty > 0 && !Number.isNaN(unit) && unit >= 0) {
      setTotalPrice((qty * unit).toFixed(2));
    } else if (!unitPrice) {
      setTotalPrice("");
    }
  }, [context, quantity, unitPrice]);

  const handleTotalPriceChange = (value: string) => {
    setTotalPrice(value);
    const qty = parseFloat(quantity || "0");
    const total = parseFloat(value || "0");
    if (!Number.isNaN(qty) && qty > 0 && !Number.isNaN(total) && total >= 0) {
      setUnitPrice((total / qty).toFixed(2));
    }
  };

  const handleDrag = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (e.type === "dragenter" || e.type === "dragover") {
      setDragActive(true);
    } else if (e.type === "dragleave") {
      setDragActive(false);
    }
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setDragActive(false);
    const file = e.dataTransfer.files?.[0];
    if (file) attachCadFile(file);
  };

  const handleFileSelect = (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) attachCadFile(file);
  };

  const attachCadFile = (file: File) => {
    setCadFile(file);
    setSelectedPartId(null);
    if (!name.trim()) {
      setName(file.name.replace(/\.[^/.]+$/, ""));
    }
  };

  const handleSelectPart = (part: Part) => {
    setSelectedPartId(part.id);
    setCadFile(null);
    setName(part.partName || name);
    setDescription(
      [
        part.material ? `Material: ${part.material}` : "",
        part.tolerance ? `Tolerance: ${part.tolerance}` : "",
        part.finishing ? `Finishing: ${part.finishing}` : "",
        part.notes || "",
      ]
        .filter(Boolean)
        .join("\n")
    );
  };

  const removeCadFile = () => {
    setCadFile(null);
    if (fileInputRef.current) fileInputRef.current.value = "";
  };

  const handleDrawingSelect = (e: ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files) return;
    setDrawings((prev) => [...prev, ...Array.from(files)]);
  };

  const handleSubmit = (event: React.FormEvent) => {
    event.preventDefault();

    const trimmedName = name.trim();
    if (!trimmedName) {
      setErrors({ name: "Name is required" });
      return;
    }
    setErrors({});

    const formData = new FormData();
    formData.append("name", trimmedName);
    formData.append("description", description);
    formData.append("notes", notes);
    formData.append("quantity", quantity || "1");
    formData.append("unitPrice", unitPrice || "0");

    if (context === "quote") {
      formData.append("totalPrice", totalPrice || "0");
    }

    if (selectedPartId) {
      formData.append("partId", selectedPartId);
    } else if (cadFile) {
      formData.append("file", cadFile);
      formData.append("material", material);
      formData.append("tolerance", tolerance);
      formData.append("finish", finish);
      formData.append("partNotes", partNotes);
      drawings.forEach((drawing, i) => {
        formData.append(`drawing_${i}`, drawing);
      });
      formData.append("drawingCount", drawings.length.toString());
    }

    onSubmit(formData);
    onClose();
  };

  return (
    <>
      <Modal isOpen={isOpen} onClose={onClose} title="Add Line Item">
        <form onSubmit={handleSubmit} className="space-y-5">
          {/* Upload zone — only shown when no file or part is attached */}
          {!hasPartAttached ? (
            <div>
              <div
                className={`border-2 border-dashed rounded-lg p-6 text-center transition-colors cursor-pointer ${
                  dragActive
                    ? "border-blue-500 bg-blue-50 dark:bg-blue-900/20"
                    : "border-gray-300 dark:border-gray-600 hover:border-gray-400 dark:hover:border-gray-500"
                }`}
                onDragEnter={handleDrag}
                onDragLeave={handleDrag}
                onDragOver={handleDrag}
                onDrop={handleDrop}
                onClick={() => fileInputRef.current?.click()}
                role="button"
                tabIndex={0}
                onKeyDown={(e) => {
                  if (e.key === "Enter" || e.key === " ") fileInputRef.current?.click();
                }}
              >
                <svg
                  className="mx-auto h-10 w-10 text-gray-400 dark:text-gray-500 mb-3"
                  fill="none"
                  stroke="currentColor"
                  viewBox="0 0 24 24"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={1.5}
                    d="M3 16.5v2.25A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75V16.5m-13.5-9L12 3m0 0l4.5 4.5M12 3v13.5"
                  />
                </svg>
                <p className="text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                  Upload your part file
                </p>
                <p className="text-xs text-gray-500 dark:text-gray-400">
                  Drag & drop or click to browse — STEP, SLDPRT, STL, OBJ, IGES
                </p>
                <input
                  ref={fileInputRef}
                  type="file"
                  accept={CAD_ACCEPT}
                  onChange={handleFileSelect}
                  className="hidden"
                />
              </div>

              {existingParts.length > 0 && (
                <button
                  type="button"
                  className="mt-2 text-xs text-blue-600 dark:text-blue-400 hover:underline"
                  onClick={() => setShowPartSelection(true)}
                >
                  or select from part library
                </button>
              )}

              <div className="relative my-4">
                <div className="absolute inset-0 flex items-center">
                  <div className="w-full border-t border-gray-200 dark:border-gray-700" />
                </div>
                <div className="relative flex justify-center text-xs">
                  <span className="px-2 bg-white dark:bg-gray-800 text-gray-500 dark:text-gray-400">
                    or enter item details
                  </span>
                </div>
              </div>
            </div>
          ) : (
            /* Attached file / part preview — compact chip */
            <div className="flex items-center gap-3 px-3 py-2.5 bg-gray-50 dark:bg-gray-700/50 rounded-lg border border-gray-200 dark:border-gray-600">
              <div className="flex-shrink-0 w-8 h-8 bg-blue-100 dark:bg-blue-900/30 rounded-md flex items-center justify-center">
                <svg className="w-4 h-4 text-blue-600 dark:text-blue-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                </svg>
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium text-gray-900 dark:text-gray-100 truncate">
                  {cadFile ? cadFile.name : selectedPart?.partName || "Selected part"}
                </p>
                <p className="text-xs text-gray-500 dark:text-gray-400">
                  {cadFile
                    ? `${(cadFile.size / 1024 / 1024).toFixed(1)} MB`
                    : "From part library"}
                </p>
              </div>
              <button
                type="button"
                className="p-1 rounded hover:bg-gray-200 dark:hover:bg-gray-600 transition-colors"
                onClick={() => {
                  removeCadFile();
                  setSelectedPartId(null);
                }}
                title="Remove"
              >
                <svg className="w-4 h-4 text-gray-500 dark:text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>
          )}

          {/* Core fields — always visible */}
          <InputField
            label="Item Name"
            value={name}
            onChange={(e) => {
              setName(e.target.value);
              if (errors.name) setErrors({});
            }}
            placeholder={hasPartAttached ? "Auto-filled from file name" : "Enter line item name"}
            error={errors.name}
          />

          <div
            className={`grid gap-4 ${context === "quote" ? "grid-cols-3" : "grid-cols-2"}`}
          >
            <InputField
              label="Quantity"
              type="number"
              min="1"
              value={quantity}
              onChange={(e) => setQuantity(e.target.value)}
            />
            <InputField
              label="Unit Price ($)"
              type="number"
              min="0"
              step="0.01"
              value={unitPrice}
              onChange={(e) => setUnitPrice(e.target.value)}
              placeholder="0.00"
            />
            {context === "quote" && (
              <InputField
                label="Total Price ($)"
                type="number"
                min="0"
                step="0.01"
                value={totalPrice}
                onChange={(e) => handleTotalPriceChange(e.target.value)}
                placeholder="0.00"
              />
            )}
          </div>

          {/* Part specs & drawings — visible when a CAD file is uploaded */}
          {cadFile && (
            <div className="space-y-3">
              <div className="grid grid-cols-3 gap-3">
                <InputField
                  label="Material"
                  value={material}
                  onChange={(e) => setMaterial(e.target.value)}
                  placeholder="e.g., Aluminum 6061"
                />
                <InputField
                  label="Tolerance"
                  value={tolerance}
                  onChange={(e) => setTolerance(e.target.value)}
                  placeholder="e.g., ±0.005"
                />
                <InputField
                  label="Finish"
                  value={finish}
                  onChange={(e) => setFinish(e.target.value)}
                  placeholder="e.g., Anodized"
                />
              </div>

              {/* Drawings */}
              <div>
                <input
                  ref={drawingInputRef}
                  type="file"
                  multiple
                  accept=".pdf,.png,.jpg,.jpeg,.dwg,.dxf"
                  onChange={handleDrawingSelect}
                  className="hidden"
                />
                {drawings.length > 0 ? (
                  <div className="space-y-1.5 mb-2">
                    {drawings.map((d, i) => (
                      <div
                        key={`${d.name}-${i}`}
                        className="flex items-center justify-between py-1.5 px-2.5 bg-gray-50 dark:bg-gray-700/50 rounded text-sm"
                      >
                        <span className="truncate text-gray-700 dark:text-gray-300">
                          {d.name}
                        </span>
                        <button
                          type="button"
                          className="ml-2 text-red-500 hover:text-red-700 dark:text-red-400 dark:hover:text-red-300 text-xs"
                          onClick={() =>
                            setDrawings((prev) =>
                              prev.filter((_, idx) => idx !== i)
                            )
                          }
                        >
                          Remove
                        </button>
                      </div>
                    ))}
                  </div>
                ) : null}
                <button
                  type="button"
                  className="text-sm text-blue-600 dark:text-blue-400 hover:underline"
                  onClick={() => drawingInputRef.current?.click()}
                >
                  + Add drawing / print
                </button>
              </div>
            </div>
          )}

          {/* Expandable details — description, notes, part notes */}
          <button
            type="button"
            className="flex items-center gap-1.5 text-sm text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-300 transition-colors"
            onClick={() => setShowDetails((prev) => !prev)}
          >
            <svg
              className={`w-4 h-4 transition-transform ${showDetails ? "rotate-90" : ""}`}
              fill="currentColor"
              viewBox="0 0 20 20"
            >
              <path
                fillRule="evenodd"
                d="M7.293 14.707a1 1 0 010-1.414L10.586 10 7.293 6.707a1 1 0 011.414-1.414l4 4a1 1 0 010 1.414l-4 4a1 1 0 01-1.414 0z"
                clipRule="evenodd"
              />
            </svg>
            {showDetails ? "Less details" : "More details"}
          </button>

          {showDetails && (
            <div className="space-y-4 pl-1">
              <TextareaField
                label="Description"
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                rows={2}
                placeholder="Enter description"
              />
              <TextareaField
                label="Notes"
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                rows={2}
                placeholder="Any internal notes"
              />
              {cadFile && (
                <TextareaField
                  label="Part Notes"
                  value={partNotes}
                  onChange={(e) => setPartNotes(e.target.value)}
                  rows={2}
                  placeholder="Special requirements for this part"
                />
              )}
            </div>
          )}

          {/* Actions */}
          <div className="flex justify-end gap-3 pt-1">
            <Button type="button" variant="secondary" onClick={onClose}>
              Cancel
            </Button>
            <Button type="submit">Add Line Item</Button>
          </div>
        </form>
      </Modal>

      <PartSelectionModal
        isOpen={showPartSelection}
        onClose={() => setShowPartSelection(false)}
        onSelectPart={handleSelectPart}
        customerId={customerId}
        parts={existingParts}
      />
    </>
  );
}
