import { useState, useEffect, useRef, type ChangeEvent } from "react";
import { useFetcher } from "@remix-run/react";
import Modal from "~/components/shared/Modal";
import Button from "~/components/shared/Button";
import { InputField } from "~/components/shared/FormField";
import SearchableSelect from "~/components/shared/SearchableSelect";
import { PartConfigForm } from "~/components/shared/PartConfigForm";
import type { Customer } from "~/lib/customers";
import { isCadSourceFile, isDrawingSourceFile } from "~/lib/part-source-files";

interface PartConfig {
  /** CAD source file when present; omitted for drawing-only parts */
  file?: File;
  material?: string;
  tolerances?: string;
  quantity?: number;
  notes?: string;
  drawings?: File[];
  partName?: string;
  surfaceFinish?: string;
  isExpanded?: boolean;
}

interface NewQuoteModalProps {
  isOpen: boolean;
  onClose: () => void;
  customers: Customer[];
  onSuccess?: () => void;
}

type MixedFilePool = {
  cad: Array<{ id: string; file: File }>;
  drawings: Array<{ id: string; file: File }>;
};

type AssignmentSlot = { cadId: string | null; drawingId: string | null };

function baseFileName(file: File): string {
  return file.name.replace(/\.[^.]+$/, "");
}

function validateMixedAssignment(
  pool: MixedFilePool,
  slots: AssignmentSlot[],
): string | null {
  for (let i = 0; i < slots.length; i++) {
    if (!slots[i].cadId && !slots[i].drawingId) {
      return `Line item ${i + 1} must have a CAD file or a drawing (or remove the empty row).`;
    }
  }
  const usedCad = new Set(
    slots.map((s) => s.cadId).filter(Boolean) as string[],
  );
  const usedDrw = new Set(
    slots.map((s) => s.drawingId).filter(Boolean) as string[],
  );
  for (const c of pool.cad) {
    if (!usedCad.has(c.id)) {
      return `Assign every CAD file: "${c.file.name}" is not assigned to a line item.`;
    }
  }
  for (const d of pool.drawings) {
    if (!usedDrw.has(d.id)) {
      return `Assign every drawing file: "${d.file.name}" is not assigned to a line item.`;
    }
  }
  return null;
}

function partConfigsFromAssignment(
  pool: MixedFilePool,
  slots: AssignmentSlot[],
): PartConfig[] {
  return slots.map((slot, index) => {
    const cadFile = slot.cadId
      ? pool.cad.find((c) => c.id === slot.cadId)?.file
      : undefined;
    const drawingFile = slot.drawingId
      ? pool.drawings.find((d) => d.id === slot.drawingId)?.file
      : undefined;
    const partName =
      (cadFile ? baseFileName(cadFile) : undefined) ??
      (drawingFile ? baseFileName(drawingFile) : undefined) ??
      `Part ${index + 1}`;
    return {
      file: cadFile,
      drawings: drawingFile ? [drawingFile] : undefined,
      quantity: 1,
      partName,
      isExpanded: index === 0,
    };
  });
}

function cadOptionsForRow(
  pool: MixedFilePool,
  slots: AssignmentSlot[],
  rowIndex: number,
) {
  const taken = new Set<string>();
  for (let j = 0; j < slots.length; j++) {
    if (j !== rowIndex && slots[j].cadId) taken.add(slots[j].cadId!);
  }
  return pool.cad.filter(
    (c) => !taken.has(c.id) || slots[rowIndex].cadId === c.id,
  );
}

function drawingOptionsForRow(
  pool: MixedFilePool,
  slots: AssignmentSlot[],
  rowIndex: number,
) {
  const taken = new Set<string>();
  for (let j = 0; j < slots.length; j++) {
    if (j !== rowIndex && slots[j].drawingId) taken.add(slots[j].drawingId!);
  }
  return pool.drawings.filter(
    (d) => !taken.has(d.id) || slots[rowIndex].drawingId === d.id,
  );
}

function partSummaryLabel(config: PartConfig): string {
  if (config.file) return config.file.name;
  if (config.drawings?.length)
    return `${config.drawings.length} drawing file(s)`;
  return "Part";
}

type Step = "upload" | "assign" | "configure" | "customer" | "review";

export default function NewQuoteModal({
  isOpen,
  onClose,
  customers,
  onSuccess,
}: NewQuoteModalProps) {
  const fetcher = useFetcher();
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [currentStep, setCurrentStep] = useState<Step>("upload");
  const [partConfigs, setPartConfigs] = useState<PartConfig[]>([]);
  const [mixedFilePool, setMixedFilePool] = useState<MixedFilePool | null>(
    null,
  );
  const [assignmentSlots, setAssignmentSlots] = useState<AssignmentSlot[]>([]);
  const [enforceMaxOneDrawingInConfigure, setEnforceMaxOneDrawingInConfigure] =
    useState(false);
  const [selectedCustomer, setSelectedCustomer] = useState<Customer | null>(
    null,
  );
  const [createNewCustomer, setCreateNewCustomer] = useState(false);
  const [newCustomerData, setNewCustomerData] = useState({
    displayName: "",
    email: "",
    phone: "",
    zipCode: "",
  });
  const [dragActive, setDragActive] = useState(false);
  const [hasHandledSuccess, setHasHandledSuccess] = useState(false);
  const [isContentTransitioning, setIsContentTransitioning] = useState(false);

  // Reset flag when modal opens
  useEffect(() => {
    if (isOpen) {
      setHasHandledSuccess(false);
    }
  }, [isOpen]);

  useEffect(() => {
    const fetcherData = fetcher.data as
      | { success?: boolean; error?: string }
      | undefined;

    // Only process when fetcher is idle (not submitting) and we have data
    if (fetcher.state === "idle" && fetcherData) {
      // Handle successful creation
      if (fetcherData.success && !hasHandledSuccess) {
        setHasHandledSuccess(true);
        // Reset form state first
        setCurrentStep("upload");
        setPartConfigs([]);
        setMixedFilePool(null);
        setAssignmentSlots([]);
        setEnforceMaxOneDrawingInConfigure(false);
        setSelectedCustomer(null);
        setCreateNewCustomer(false);
        setNewCustomerData({
          displayName: "",
          email: "",
          phone: "",
          zipCode: "",
        });
        // Call onSuccess which will close modal and revalidate
        onSuccess?.();
      }

      // Handle errors
      if (fetcherData.error) {
        console.error("Quote creation error:", fetcherData.error);
        alert(`Failed to create quote: ${fetcherData.error}`);
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fetcher.data, fetcher.state, hasHandledSuccess]);

  const handleReset = () => {
    setCurrentStep("upload");
    setPartConfigs([]);
    setMixedFilePool(null);
    setAssignmentSlots([]);
    setEnforceMaxOneDrawingInConfigure(false);
    setSelectedCustomer(null);
    setCreateNewCustomer(false);
    setNewCustomerData({
      displayName: "",
      email: "",
      phone: "",
      zipCode: "",
    });
    setHasHandledSuccess(false);
    onClose();
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

    if (e.dataTransfer.files && e.dataTransfer.files[0]) {
      handleFiles(Array.from(e.dataTransfer.files));
    }
  };

  const handleFileSelect = (e: ChangeEvent<HTMLInputElement>) => {
    if (e.target.files) {
      handleFiles(Array.from(e.target.files));
    }
  };

  const handleFiles = (files: File[]) => {
    const supported = files.filter(
      (f) => isCadSourceFile(f.name) || isDrawingSourceFile(f.name),
    );
    if (supported.length === 0) {
      alert(
        "No supported files. Use CAD (STEP, STL, …) or drawings (PDF, PNG, JPEG, DWG, …).",
      );
      return;
    }

    const cad = supported.filter((f) => isCadSourceFile(f.name));
    const drawings = supported.filter((f) => isDrawingSourceFile(f.name));

    setIsContentTransitioning(true);
    setTimeout(() => {
      setEnforceMaxOneDrawingInConfigure(false);
      if (cad.length === 0 && drawings.length > 0) {
        const base = drawings[0].name.replace(/\.[^.]+$/, "");
        setPartConfigs([
          {
            quantity: 1,
            partName: base,
            drawings,
            isExpanded: true,
          },
        ]);
        setCurrentStep("configure");
      } else if (cad.length > 0 && drawings.length === 0) {
        setPartConfigs(
          cad.map((file, index) => ({
            file,
            quantity: 1,
            partName: file.name.replace(/\.[^.]+$/, ""),
            isExpanded: index === 0,
          })),
        );
        setCurrentStep("configure");
      } else if (cad.length === 1) {
        setPartConfigs([
          {
            file: cad[0],
            drawings,
            quantity: 1,
            partName: cad[0].name.replace(/\.[^.]+$/, ""),
            isExpanded: true,
          },
        ]);
        setCurrentStep("configure");
      } else {
        const cadEntries = cad.map((file) => ({
          id: crypto.randomUUID(),
          file,
        }));
        const drawingEntries = drawings.map((file) => ({
          id: crypto.randomUUID(),
          file,
        }));
        setMixedFilePool({ cad: cadEntries, drawings: drawingEntries });
        setAssignmentSlots(
          cadEntries.map((e) => ({ cadId: e.id, drawingId: null })),
        );
        setCurrentStep("assign");
      }
      setTimeout(() => setIsContentTransitioning(false), 300);
    }, 150);
  };

  const continueFromAssignment = () => {
    if (!mixedFilePool) return;
    const err = validateMixedAssignment(mixedFilePool, assignmentSlots);
    if (err) {
      alert(err);
      return;
    }
    setPartConfigs(partConfigsFromAssignment(mixedFilePool, assignmentSlots));
    setMixedFilePool(null);
    setAssignmentSlots([]);
    setEnforceMaxOneDrawingInConfigure(true);
    setIsContentTransitioning(true);
    setTimeout(() => {
      setCurrentStep("configure");
      setIsContentTransitioning(false);
    }, 150);
  };

  const updateAssignmentSlot = (
    index: number,
    patch: Partial<AssignmentSlot>,
  ) => {
    setAssignmentSlots((prev) => {
      const next = [...prev];
      next[index] = { ...next[index], ...patch };
      return next;
    });
  };

  const addAssignmentRow = () => {
    setAssignmentSlots((prev) => [...prev, { cadId: null, drawingId: null }]);
  };

  const removeAssignmentRow = (index: number) => {
    setAssignmentSlots((prev) => {
      if (prev.length <= 1) return prev;
      return prev.filter((_, i) => i !== index);
    });
  };

  const updatePartConfig = (
    index: number,
    field: keyof PartConfig,
    value: string | number | File[] | boolean | undefined,
  ) => {
    setPartConfigs((prev) => {
      const updated = [...prev];
      updated[index] = { ...updated[index], [field]: value };
      return updated;
    });
  };

  const togglePartExpanded = (index: number) => {
    setPartConfigs((prev) => {
      const updated = [...prev];
      updated[index] = {
        ...updated[index],
        isExpanded: !updated[index].isExpanded,
      };
      return updated;
    });
  };

  const removePart = (index: number) => {
    setPartConfigs((prev) => {
      const updated = [...prev];
      updated.splice(index, 1);
      if (updated.length === 0 && currentStep === "configure") {
        setCurrentStep("upload");
      }
      return updated;
    });
  };

  const handleSubmit = async () => {
    const formData = new FormData();

    // Check if we have parts to add
    const hasParts = partConfigs.length > 0;

    if (hasParts) {
      // Submit with parts to the /quotes/new route
      formData.append("intent", "createWithParts");

      // Add customer data
      if (createNewCustomer) {
        if (!newCustomerData.displayName || !newCustomerData.email) {
          alert("Please provide customer name and email");
          return;
        }
        formData.append("createCustomer", "true");
        formData.append("customerName", newCustomerData.displayName);
        formData.append("customerEmail", newCustomerData.email);
        formData.append("customerPhone", newCustomerData.phone || "");
        formData.append("customerZipCode", newCustomerData.zipCode || "");
      } else if (selectedCustomer) {
        formData.append("customerId", selectedCustomer.id.toString());
      } else {
        alert("Please select or create a customer");
        return;
      }

      formData.append("partsCount", partConfigs.length.toString());

      partConfigs.forEach((config, index) => {
        if (config.file) {
          formData.append(`parts[${index}][file]`, config.file);
        }
        const defaultName =
          config.partName ||
          (config.file ? baseFileName(config.file) : undefined) ||
          (config.drawings?.[0] ? baseFileName(config.drawings[0]) : undefined) ||
          `Part ${index + 1}`;
        formData.append(`parts[${index}][name]`, defaultName);
        formData.append(`parts[${index}][material]`, config.material || "");
        formData.append(`parts[${index}][tolerances]`, config.tolerances || "");
        formData.append(
          `parts[${index}][surfaceFinish]`,
          config.surfaceFinish || "",
        );
        formData.append(
          `parts[${index}][quantity]`,
          (config.quantity || 1).toString(),
        );
        formData.append(`parts[${index}][notes]`, config.notes || "");
        if (config.file) {
          formData.append(
            `parts[${index}][mode]`,
            config.drawings?.length ? "cad_with_drawings" : "cad",
          );
        } else {
          formData.append(`parts[${index}][mode]`, "drawing_only");
        }

        if (config.drawings) {
          config.drawings.forEach((drawing, drawingIndex) => {
            formData.append(
              `parts[${index}][drawings][${drawingIndex}]`,
              drawing,
            );
          });
        }
      });

      fetcher.submit(formData, {
        method: "post",
        action: "/quotes/new",
        encType: "multipart/form-data",
      });
    } else {
      // Create empty quote
      if (createNewCustomer) {
        // Need to use /quotes/new route to create customer
        formData.append("intent", "createWithParts");

        if (!newCustomerData.displayName || !newCustomerData.email) {
          alert("Please provide customer name and email");
          return;
        }
        formData.append("createCustomer", "true");
        formData.append("customerName", newCustomerData.displayName);
        formData.append("customerEmail", newCustomerData.email);
        formData.append("customerPhone", newCustomerData.phone || "");
        formData.append("customerZipCode", newCustomerData.zipCode || "");

        formData.append("partsCount", "0");
        fetcher.submit(formData, {
          method: "post",
          action: "/quotes/new",
          encType: "multipart/form-data",
        });
      } else {
        // Use simpler action on current page for existing customer
        formData.append("intent", "create");

        if (selectedCustomer) {
          formData.append("customerId", selectedCustomer.id.toString());
        } else {
          alert("Please select a customer");
          return;
        }

        // Use default values for empty quote
        formData.append("status", "RFQ");
        formData.append("expirationDays", "14");

        // Submit to current page action instead of /quotes/new
        fetcher.submit(formData, {
          method: "post",
        });
      }
    }
  };

  const renderAssignStep = () => {
    if (!mixedFilePool) return null;
    const pool = mixedFilePool;
    return (
      <div className="p-6 space-y-4 flex flex-col max-h-[min(70vh,560px)]">
        <p className="text-sm text-gray-600 dark:text-gray-400 shrink-0">
          You uploaded <strong>{pool.cad.length}</strong> CAD file(s) and{" "}
          <strong>{pool.drawings.length}</strong> drawing file(s). Assign each
          file to exactly one line item. Each line can have one CAD, one
          drawing, or both. Add rows if you need drawing-only line items.
        </p>

        <div className="overflow-y-auto flex-1 min-h-0 border border-gray-200 dark:border-gray-700 rounded-lg">
          <table className="w-full text-sm">
            <thead className="bg-gray-50 dark:bg-gray-800/80 sticky top-0 z-10">
              <tr>
                <th className="text-left p-3 font-medium text-gray-700 dark:text-gray-200">
                  Line item
                </th>
                <th className="text-left p-3 font-medium text-gray-700 dark:text-gray-200">
                  CAD file
                </th>
                <th className="text-left p-3 font-medium text-gray-700 dark:text-gray-200">
                  Drawing
                </th>
                <th className="w-10 p-3" aria-hidden />
              </tr>
            </thead>
            <tbody>
              {assignmentSlots.map((slot, index) => {
                const cadChoices = cadOptionsForRow(pool, assignmentSlots, index);
                const drwChoices = drawingOptionsForRow(
                  pool,
                  assignmentSlots,
                  index,
                );
                return (
                  <tr
                    key={index}
                    className="border-t border-gray-200 dark:border-gray-700 align-top"
                  >
                    <td className="p-3 text-gray-600 dark:text-gray-400 whitespace-nowrap">
                      {index + 1}
                    </td>
                    <td className="p-2">
                      <select
                        className="w-full max-w-[220px] rounded-md border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-900 text-gray-900 dark:text-gray-100 px-2 py-1.5 text-sm"
                        value={slot.cadId ?? ""}
                        onChange={(e) => {
                          const v = e.target.value;
                          updateAssignmentSlot(index, {
                            cadId: v === "" ? null : v,
                          });
                        }}
                      >
                        <option value="">None</option>
                        {cadChoices.map((c) => (
                          <option key={c.id} value={c.id}>
                            {c.file.name}
                          </option>
                        ))}
                      </select>
                    </td>
                    <td className="p-2">
                      <select
                        className="w-full max-w-[220px] rounded-md border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-900 text-gray-900 dark:text-gray-100 px-2 py-1.5 text-sm"
                        value={slot.drawingId ?? ""}
                        onChange={(e) => {
                          const v = e.target.value;
                          updateAssignmentSlot(index, {
                            drawingId: v === "" ? null : v,
                          });
                        }}
                      >
                        <option value="">None</option>
                        {drwChoices.map((d) => (
                          <option key={d.id} value={d.id}>
                            {d.file.name}
                          </option>
                        ))}
                      </select>
                    </td>
                    <td className="p-2">
                      <button
                        type="button"
                        disabled={assignmentSlots.length <= 1}
                        onClick={() => removeAssignmentRow(index)}
                        className="text-red-600 hover:text-red-800 dark:text-red-400 disabled:opacity-30 disabled:cursor-not-allowed p-1"
                        title="Remove line item"
                      >
                        <svg
                          className="w-5 h-5"
                          fill="none"
                          stroke="currentColor"
                          viewBox="0 0 24 24"
                        >
                          <path
                            strokeLinecap="round"
                            strokeLinejoin="round"
                            strokeWidth={2}
                            d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"
                          />
                        </svg>
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>

        <div className="flex flex-wrap gap-2 shrink-0">
          <Button type="button" variant="secondary" onClick={addAssignmentRow}>
            Add line item
          </Button>
        </div>
      </div>
    );
  };

  const renderUploadStep = () => (
    <div className="p-6">
      <div
        className={`border-2 border-dashed rounded-lg p-8 text-center transition-colors ${
          dragActive
            ? "border-blue-500 bg-blue-50 dark:bg-blue-900/20"
            : "border-gray-300 dark:border-gray-600 hover:border-gray-400"
        }`}
        onDragEnter={handleDrag}
        onDragLeave={handleDrag}
        onDragOver={handleDrag}
        onDrop={handleDrop}
      >
        <svg
          className="mx-auto h-12 w-12 text-gray-400 mb-4"
          stroke="currentColor"
          fill="none"
          viewBox="0 0 48 48"
        >
          <path
            d="M28 8H12a4 4 0 00-4 4v20m32-12v8m0 0v8a4 4 0 01-4 4H12a4 4 0 01-4-4v-4m32-4l-3.172-3.172a4 4 0 00-5.656 0L28 28M8 32l9.172-9.172a4 4 0 015.656 0L28 28m0 0l4 4m4-24h8m-4-4v8m-12 4h.02"
            strokeWidth={2}
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
        <p className="text-lg font-semibold mb-2">Upload Part Files</p>
        <p className="text-sm text-gray-600 dark:text-gray-400 mb-4">
          Drag & drop or click to browse
        </p>
        <p className="text-xs text-gray-500 dark:text-gray-500 mb-4">
          STEP, IGES, PDF, etc.
        </p>
        <input
          ref={fileInputRef}
          type="file"
          multiple
          accept=".step,.stp,.sldprt,.stl,.obj,.gltf,.glb,.igs,.iges,.x_t,.x_b,.sat,.pdf,.png,.jpg,.jpeg,.webp,.dwg,.dxf"
          onChange={handleFileSelect}
          className="hidden"
        />
        <div className="flex flex-col gap-3 items-center">
          <Button
            onClick={() => fileInputRef.current?.click()}
            variant="primary"
          >
            Select Files
          </Button>
          <div className="text-sm text-gray-500 dark:text-gray-400">or</div>
          <Button
            onClick={() => {
              setIsContentTransitioning(true);
              setTimeout(() => {
                setCurrentStep("customer");
                setTimeout(() => {
                  setIsContentTransitioning(false);
                }, 300);
              }, 150);
            }}
            variant="secondary"
          >
            Skip - Create Empty Quote
          </Button>
        </div>
      </div>
    </div>
  );

  const renderConfigureStep = () => {
    return (
      <div className="flex flex-col h-full">
        <div className="flex justify-between items-center mb-4 px-6">
          <h3 className="text-lg font-semibold">
            Configure Parts ({partConfigs.length} total)
          </h3>
        </div>

        <div className="flex-1 space-y-3 overflow-y-auto px-6">
          {partConfigs.map((config, index) => (
            <div
              key={index}
              className="border border-gray-200 dark:border-gray-700 rounded-lg"
            >
              {/* Part Header - Always Visible */}
              <div className="w-full flex items-center justify-between p-4">
                <button
                  className="flex items-center space-x-3 min-w-0 flex-1 cursor-pointer hover:bg-gray-50 dark:hover:bg-gray-800 text-left -m-4 p-4 rounded-l-lg"
                  onClick={() => togglePartExpanded(index)}
                  type="button"
                >
                  <svg
                    className={`w-5 h-5 text-gray-500 transform transition-transform flex-shrink-0 ${
                      config.isExpanded ? "rotate-90" : ""
                    }`}
                    fill="currentColor"
                    viewBox="0 0 20 20"
                  >
                    <path
                      fillRule="evenodd"
                      d="M7.293 14.707a1 1 0 010-1.414L10.586 10 7.293 6.707a1 1 0 011.414-1.414l4 4a1 1 0 010 1.414l-4 4a1 1 0 01-1.414 0z"
                      clipRule="evenodd"
                    />
                  </svg>
                  <div className="min-w-0 flex-1">
                    <div className="font-medium truncate">
                      {config.partName || partSummaryLabel(config)}
                    </div>
                    <div className="text-sm text-gray-500">
                      {config.material && `Material: ${config.material} | `}
                      {config.quantity && `Qty: ${config.quantity}`}
                    </div>
                  </div>
                  <span
                    className="text-xs text-gray-400 ml-2 truncate max-w-xs flex-shrink-0"
                    title={partSummaryLabel(config)}
                  >
                    {partSummaryLabel(config)}
                  </span>
                </button>
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    if (
                      confirm(
                        `Remove ${config.partName || partSummaryLabel(config)}?`,
                      )
                    ) {
                      removePart(index);
                    }
                  }}
                  type="button"
                  className="ml-3 p-2 text-red-600 hover:text-red-800 dark:text-red-400 dark:hover:text-red-300 hover:bg-red-50 dark:hover:bg-red-900/20 rounded transition-colors"
                  title="Remove part"
                >
                  <svg
                    className="w-5 h-5"
                    fill="none"
                    stroke="currentColor"
                    viewBox="0 0 24 24"
                  >
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      strokeWidth={2}
                      d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"
                    />
                  </svg>
                </button>
              </div>

              {/* Part Details - Collapsible */}
              {config.isExpanded && (
                <div className="px-4 pb-4 border-t border-gray-200 dark:border-gray-700">
                  <div className="grid grid-cols-2 gap-4 mt-4">
                    <InputField
                      label="Part Name"
                      value={config.partName || ""}
                      onChange={(e) =>
                        updatePartConfig(index, "partName", e.target.value)
                      }
                      placeholder="Enter part name"
                    />

                    <InputField
                      label="Quantity"
                      type="number"
                      min="1"
                      value={config.quantity?.toString() || "1"}
                      onChange={(e) =>
                        updatePartConfig(
                          index,
                          "quantity",
                          parseInt(e.target.value) || 1,
                        )
                      }
                      required
                    />
                  </div>

                  <div className="mt-4">
                    <PartConfigForm
                      material={config.material || ""}
                      tolerance={config.tolerances || ""}
                      finish={config.surfaceFinish || ""}
                      notes={config.notes || ""}
                      onChange={(field, value) => {
                        if (field === "material")
                          updatePartConfig(index, "material", value);
                        if (field === "tolerance")
                          updatePartConfig(index, "tolerances", value);
                        if (field === "finish")
                          updatePartConfig(index, "surfaceFinish", value);
                        if (field === "notes")
                          updatePartConfig(index, "notes", value);
                      }}
                      drawings={config.drawings || []}
                      onDrawingsChange={(files) =>
                        updatePartConfig(index, "drawings", files)
                      }
                      maxDrawings={
                        enforceMaxOneDrawingInConfigure ? 1 : undefined
                      }
                    />
                  </div>
                </div>
              )}
            </div>
          ))}
        </div>
      </div>
    );
  };

  const renderCustomerStep = () => (
    <div className="flex flex-col h-full">
      <div className="flex-1 space-y-4 overflow-y-auto px-6 min-h-[450px]">
        <div className="flex items-center space-x-4 mb-4">
          <label htmlFor="existing-customer" className="flex items-center">
            <input
              id="existing-customer"
              type="radio"
              checked={!createNewCustomer}
              onChange={() => setCreateNewCustomer(false)}
              className="mr-2"
            />
            Select Existing Customer
          </label>
          <label htmlFor="new-customer" className="flex items-center">
            <input
              id="new-customer"
              type="radio"
              checked={createNewCustomer}
              onChange={() => setCreateNewCustomer(true)}
              className="mr-2"
            />
            Create New Customer
          </label>
        </div>

        {!createNewCustomer ? (
          <SearchableSelect
            label="Customer"
            value={selectedCustomer?.id.toString() || ""}
            onChange={(value) => {
              const customer = customers.find((c) => c.id.toString() === value);
              setSelectedCustomer(customer || null);
            }}
            options={customers.map((customer) => ({
              value: customer.id.toString(),
              label: customer.displayName,
              secondaryLabel: customer.email || undefined,
            }))}
            placeholder="Search for a customer..."
            required
            emptyMessage="No customers found"
          />
        ) : (
          <div className="space-y-4">
            <InputField
              label="Company/Name"
              value={newCustomerData.displayName}
              onChange={(e) =>
                setNewCustomerData({
                  ...newCustomerData,
                  displayName: e.target.value,
                })
              }
              required
            />

            <div className="grid grid-cols-2 gap-4">
              <InputField
                label="Email"
                type="email"
                value={newCustomerData.email}
                onChange={(e) =>
                  setNewCustomerData({
                    ...newCustomerData,
                    email: e.target.value,
                  })
                }
                required
              />
              <InputField
                label="Phone (Optional)"
                type="tel"
                value={newCustomerData.phone}
                onChange={(e) =>
                  setNewCustomerData({
                    ...newCustomerData,
                    phone: e.target.value,
                  })
                }
              />
            </div>

            <InputField
              label="ZIP Code"
              value={newCustomerData.zipCode}
              onChange={(e) =>
                setNewCustomerData({
                  ...newCustomerData,
                  zipCode: e.target.value,
                })
              }
              placeholder="e.g., 10001"
            />

            <p className="text-sm text-gray-500 italic">
              Full address will be collected at time of payment
            </p>
          </div>
        )}
      </div>
    </div>
  );

  const renderReviewStep = () => (
    <div className="flex flex-col h-full">
      <div className="flex-1 space-y-4 overflow-y-auto px-6">
        <h3 className="text-lg font-semibold mb-4">
          Review Your Quote Request
        </h3>

        <div className="border rounded-lg p-4 space-y-3">
          <h4 className="font-semibold">Customer</h4>
          {createNewCustomer ? (
            <div className="text-sm">
              <p>
                <strong>New Customer:</strong> {newCustomerData.displayName}
              </p>
              <p>{newCustomerData.email}</p>
            </div>
          ) : (
            <div className="text-sm">
              <p>{selectedCustomer?.displayName}</p>
              <p>{selectedCustomer?.email}</p>
            </div>
          )}
        </div>

        <div className="border rounded-lg p-4 space-y-3">
          <h4 className="font-semibold">Parts ({partConfigs.length})</h4>
          {partConfigs.length === 0 ? (
            <p className="text-sm text-gray-500 dark:text-gray-400">
              No parts added. This will create an empty quote that you can add
              line items to later.
            </p>
          ) : (
            partConfigs.map((config, index) => (
              <div key={index} className="text-sm border-t pt-2 relative">
                <div className="flex items-start justify-between">
                  <div className="flex-1">
                    <p>
                      <strong>
                        {config.partName || partSummaryLabel(config)}
                      </strong>
                    </p>
                    <div className="grid grid-cols-2 gap-2 mt-1">
                      <p>Material: {config.material || "Not specified"}</p>
                      <p>Quantity: {config.quantity || 1}</p>
                      <p>Tolerances: {config.tolerances || "Not specified"}</p>
                      <p>Finish: {config.surfaceFinish || "Not specified"}</p>
                    </div>
                    {config.drawings && config.drawings.length > 0 && (
                      <p className="mt-1">
                        Drawings: {config.drawings.length} file(s)
                      </p>
                    )}
                    {config.notes && (
                      <p className="mt-1 text-gray-600">
                        Notes: {config.notes}
                      </p>
                    )}
                  </div>
                  <button
                    onClick={() => {
                      if (
                        confirm(
                          `Remove ${config.partName || partSummaryLabel(config)}?`,
                        )
                      ) {
                        removePart(index);
                      }
                    }}
                    type="button"
                    className="ml-3 p-1 text-red-600 hover:text-red-800 dark:text-red-400 dark:hover:text-red-300"
                    title="Remove part"
                  >
                    <svg
                      className="w-4 h-4"
                      fill="none"
                      stroke="currentColor"
                      viewBox="0 0 24 24"
                    >
                      <path
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        strokeWidth={2}
                        d="M6 18L18 6M6 6l12 12"
                      />
                    </svg>
                  </button>
                </div>
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  );

  const getStepContent = () => {
    switch (currentStep) {
      case "upload":
        return renderUploadStep();
      case "assign":
        return renderAssignStep();
      case "configure":
        return renderConfigureStep();
      case "customer":
        return renderCustomerStep();
      case "review":
        return renderReviewStep();
      default:
        return null;
    }
  };

  const getModalTitle = () => {
    switch (currentStep) {
      case "upload":
        return "New Quote - Upload Parts";
      case "assign":
        return "New Quote - Assign files to line items";
      case "configure":
        return "New Quote - Configure Parts";
      case "customer":
        return "New Quote - Customer Information";
      case "review":
        return "New Quote - Review & Submit";
      default:
        return "New Quote";
    }
  };

  const renderFooter = () => {
    if (currentStep === "upload") return null;

    if (currentStep === "assign") {
      return (
        <div className="flex justify-between items-center px-6 py-4 border-t bg-gray-50 dark:bg-gray-800">
          <Button
            type="button"
            variant="secondary"
            onClick={() => {
              setMixedFilePool(null);
              setAssignmentSlots([]);
              setCurrentStep("upload");
            }}
          >
            Back
          </Button>
          <Button
            type="button"
            variant="primary"
            onClick={continueFromAssignment}
          >
            Continue to configure parts
          </Button>
        </div>
      );
    }

    return (
      <div className="flex justify-between items-center px-6 py-4 border-t bg-gray-50 dark:bg-gray-800">
        <Button
          onClick={() => {
            setIsContentTransitioning(true);
            setTimeout(() => {
              if (currentStep === "configure") {
                setCurrentStep("upload");
                setEnforceMaxOneDrawingInConfigure(false);
              }
              else if (currentStep === "customer") {
                setCurrentStep(
                  partConfigs.length === 0 ? "upload" : "configure",
                );
              } else if (currentStep === "review") setCurrentStep("customer");
              setTimeout(() => {
                setIsContentTransitioning(false);
              }, 300);
            }, 150);
          }}
          variant="secondary"
        >
          Back
        </Button>
        <div className="ml-auto">
          {currentStep === "configure" && (
            <Button
              onClick={() => {
                setIsContentTransitioning(true);
                setTimeout(() => {
                  setCurrentStep("customer");
                  setTimeout(() => {
                    setIsContentTransitioning(false);
                  }, 300);
                }, 150);
              }}
              variant="primary"
            >
              Continue to Customer
            </Button>
          )}
          {currentStep === "customer" && (
            <Button
              onClick={() => {
                setIsContentTransitioning(true);
                setTimeout(() => {
                  setCurrentStep("review");
                  setTimeout(() => {
                    setIsContentTransitioning(false);
                  }, 300);
                }, 150);
              }}
              variant="primary"
              disabled={
                createNewCustomer
                  ? !newCustomerData.displayName || !newCustomerData.email
                  : !selectedCustomer
              }
            >
              Review Quote
            </Button>
          )}
          {currentStep === "review" && (
            <Button
              onClick={handleSubmit}
              variant="primary"
              disabled={fetcher.state === "submitting"}
            >
              {fetcher.state === "submitting" ? "Creating..." : "Create RFQ"}
            </Button>
          )}
        </div>
      </div>
    );
  };

  // Use 2xl size for wider modal with flexible height
  const modalSize = "2xl";

  return (
    <Modal
      isOpen={isOpen}
      onClose={handleReset}
      title={getModalTitle()}
      size={modalSize}
    >
      <div
        className={`${currentStep === "upload" ? "" : "flex flex-col h-full"} transition-opacity duration-300 ${isContentTransitioning ? "opacity-0" : "opacity-100"}`}
      >
        <div
          className={currentStep === "upload" ? "" : "flex-1 overflow-hidden"}
        >
          {getStepContent()}
        </div>
        {renderFooter()}
      </div>
    </Modal>
  );
}
