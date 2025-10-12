import { useState, useEffect, useRef, type ChangeEvent } from "react";
import { useFetcher } from "@remix-run/react";
import Modal from "~/components/shared/Modal";
import Button from "~/components/shared/Button";
import { InputField, TextareaField } from "~/components/shared/FormField";
import SearchableSelect from "~/components/shared/SearchableSelect";
import type { Customer } from "~/lib/customers";

interface PartConfig {
  file: File;
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

type Step = "upload" | "configure" | "customer" | "review";

export default function NewQuoteModal({ isOpen, onClose, customers, onSuccess }: NewQuoteModalProps) {
  const fetcher = useFetcher();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const drawingInputRefs = useRef<{ [key: number]: HTMLInputElement }>({});

  const [currentStep, setCurrentStep] = useState<Step>("upload");
  const [partFiles, setPartFiles] = useState<File[]>([]);
  const [partConfigs, setPartConfigs] = useState<PartConfig[]>([]);
  const [selectedCustomer, setSelectedCustomer] = useState<Customer | null>(null);
  const [createNewCustomer, setCreateNewCustomer] = useState(false);
  const [newCustomerData, setNewCustomerData] = useState({
    displayName: "",
    email: "",
    phone: "",
    zipCode: ""
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
    const fetcherData = fetcher.data as { success?: boolean; error?: string } | undefined;

    // Only process when fetcher is idle (not submitting) and we have data
    if (fetcher.state === 'idle' && fetcherData) {
      // Handle successful creation
      if (fetcherData.success && !hasHandledSuccess) {
        setHasHandledSuccess(true);
        // Reset form state first
        setCurrentStep("upload");
        setPartFiles([]);
        setPartConfigs([]);
        setSelectedCustomer(null);
        setCreateNewCustomer(false);
        setNewCustomerData({
          displayName: "",
          email: "",
          phone: "",
          zipCode: ""
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
    setPartFiles([]);
    setPartConfigs([]);
    setSelectedCustomer(null);
    setCreateNewCustomer(false);
    setNewCustomerData({
      displayName: "",
      email: "",
      phone: "",
      zipCode: ""
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
    const validFiles = files.filter(file => {
      const ext = file.name.split('.').pop()?.toLowerCase();
      return ['step', 'stp', 'sldprt', 'stl', 'obj', 'igs', 'iges', 'x_t', 'x_b', 'sat'].includes(ext || '');
    });

    if (validFiles.length > 0) {
      setPartFiles(validFiles);
      setPartConfigs(validFiles.map((file, index) => ({
        file,
        quantity: 1,
        partName: file.name.split('.').slice(0, -1).join('.'), // Remove extension
        isExpanded: index === 0 // Expand first part by default
      })));

      // Add smooth transition effect
      setIsContentTransitioning(true);
      setTimeout(() => {
        setCurrentStep("configure");
        setTimeout(() => {
          setIsContentTransitioning(false);
        }, 300);
      }, 150);
    } else {
      alert("Please upload valid CAD files (STEP, SLDPRT, STL, etc.)");
    }
  };

  const handleDrawingUpload = (partIndex: number, files: FileList | null) => {
    if (!files) return;
    const drawings = Array.from(files);
    setPartConfigs(prev => {
      const updated = [...prev];
      updated[partIndex] = {
        ...updated[partIndex],
        drawings: [...(updated[partIndex].drawings || []), ...drawings]
      };
      return updated;
    });
  };

  const removeDrawing = (partIndex: number, drawingIndex: number) => {
    setPartConfigs(prev => {
      const updated = [...prev];
      const drawings = [...(updated[partIndex].drawings || [])];
      drawings.splice(drawingIndex, 1);
      updated[partIndex] = { ...updated[partIndex], drawings };
      return updated;
    });
  };

  const updatePartConfig = (index: number, field: keyof PartConfig, value: string | number | File[] | boolean | undefined) => {
    setPartConfigs(prev => {
      const updated = [...prev];
      updated[index] = { ...updated[index], [field]: value };
      return updated;
    });
  };

  const handleToleranceInput = (index: number, value: string) => {
    // Remove ± symbol from the value for processing
    const cleanValue = value.replace(/±/g, "");

    // Check if the clean value contains any non-numeric characters (excluding decimal point, minus, and spaces)
    const hasText = /[^0-9.\-\s]/.test(cleanValue);

    if (hasText) {
      // If it contains text, don't add the ± symbol
      updatePartConfig(index, 'tolerances', cleanValue);
    } else {
      // If it's empty or only contains numbers/decimal/minus/spaces
      if (cleanValue.trim() === "") {
        // If empty, just show the ± symbol
        updatePartConfig(index, 'tolerances', "±");
      } else {
        // If it contains numbers, add ± at the beginning
        updatePartConfig(index, 'tolerances', "±" + cleanValue);
      }
    }
  };

  const togglePartExpanded = (index: number) => {
    setPartConfigs(prev => {
      const updated = [...prev];
      updated[index] = { ...updated[index], isExpanded: !updated[index].isExpanded };
      return updated;
    });
  };

  const removePart = (index: number) => {
    setPartFiles(prev => {
      const updated = [...prev];
      updated.splice(index, 1);
      return updated;
    });
    setPartConfigs(prev => {
      const updated = [...prev];
      updated.splice(index, 1);
      return updated;
    });

    // If no parts left and we're in configure step, go back to upload step
    // If we're in review/customer step, stay there (allow empty quote)
    if (partFiles.length === 1 && currentStep === 'configure') {
      setCurrentStep('upload');
    }
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

      // Add parts data
      partConfigs.forEach((config, index) => {
        formData.append(`parts[${index}][file]`, config.file);
        formData.append(`parts[${index}][name]`, config.partName || config.file.name);
        formData.append(`parts[${index}][material]`, config.material || "");
        formData.append(`parts[${index}][tolerances]`, config.tolerances || "");
        formData.append(`parts[${index}][surfaceFinish]`, config.surfaceFinish || "");
        formData.append(`parts[${index}][quantity]`, (config.quantity || 1).toString());
        formData.append(`parts[${index}][notes]`, config.notes || "");

        // Add drawings for this part
        if (config.drawings) {
          config.drawings.forEach((drawing, drawingIndex) => {
            formData.append(`parts[${index}][drawings][${drawingIndex}]`, drawing);
          });
        }
      });

      fetcher.submit(formData, {
        method: "post",
        action: "/quotes/new",
        encType: "multipart/form-data"
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

        // Submit empty parts array
        fetcher.submit(formData, {
          method: "post",
          action: "/quotes/new",
          encType: "multipart/form-data"
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
          method: "post"
        });
      }
    }
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
          Drag and drop your CAD files here, or click to browse
        </p>
        <p className="text-xs text-gray-500 dark:text-gray-500 mb-4">
          Supported formats: STEP, SLDPRT, STL, OBJ, IGES, Parasolid
        </p>
        <input
          ref={fileInputRef}
          type="file"
          multiple
          accept=".step,.stp,.sldprt,.stl,.obj,.igs,.iges,.x_t,.x_b,.sat"
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
                setCurrentStep('customer');
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
            Configure Parts ({partFiles.length} total)
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
                      config.isExpanded ? 'rotate-90' : ''
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
                    <div className="font-medium truncate">{config.partName || partFiles[index].name}</div>
                    <div className="text-sm text-gray-500">
                      {config.material && `Material: ${config.material} | `}
                      {config.quantity && `Qty: ${config.quantity}`}
                    </div>
                  </div>
                  <span className="text-xs text-gray-400 ml-2 truncate max-w-xs flex-shrink-0" title={partFiles[index].name}>{partFiles[index].name}</span>
                </button>
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    if (confirm(`Remove ${config.partName || partFiles[index].name}?`)) {
                      removePart(index);
                    }
                  }}
                  type="button"
                  className="ml-3 p-2 text-red-600 hover:text-red-800 dark:text-red-400 dark:hover:text-red-300 hover:bg-red-50 dark:hover:bg-red-900/20 rounded transition-colors"
                  title="Remove part"
                >
                  <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
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
                      onChange={(e) => updatePartConfig(index, "partName", e.target.value)}
                      placeholder="Enter part name"
                    />

                    <InputField
                      label="Quantity"
                      type="number"
                      min="1"
                      value={config.quantity?.toString() || "1"}
                      onChange={(e) => updatePartConfig(index, "quantity", parseInt(e.target.value) || 1)}
                      required
                    />
                  </div>

                  <div className="grid grid-cols-2 gap-4 mt-4">
                    <InputField
                      label="Material"
                      value={config.material || ""}
                      onChange={(e) => updatePartConfig(index, "material", e.target.value)}
                      placeholder="e.g., Aluminum 6061, Steel 316L"
                    />

                    <InputField
                      label="Tolerances"
                      value={config.tolerances || ""}
                      onChange={(e) => handleToleranceInput(index, e.target.value)}
                      onFocus={() => {
                        // If field is empty when focused, add ± symbol
                        if (!config.tolerances) {
                          handleToleranceInput(index, "±");
                        }
                      }}
                      placeholder="e.g., ±0.005"
                    />
                  </div>

                  <div className="mt-4">
                    <InputField
                      label="Surface Finish"
                      value={config.surfaceFinish || ""}
                      onChange={(e) => updatePartConfig(index, "surfaceFinish", e.target.value)}
                      placeholder="e.g., As Machined, Anodized Black, Powder Coated"
                    />
                  </div>

                  <div className="mt-4">
                    <div className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                      Technical Drawings (Optional)
                    </div>
                    <div className="space-y-2">
                      {config.drawings?.map((drawing, idx) => (
                        <div key={idx} className="flex items-center justify-between bg-gray-50 dark:bg-gray-800 p-2 rounded">
                          <span className="text-sm">{drawing.name}</span>
                          <button
                            onClick={() => removeDrawing(index, idx)}
                            className="text-red-600 hover:text-red-800"
                          >
                            Remove
                          </button>
                        </div>
                      ))}
                      <input
                        ref={(el) => { if (el) drawingInputRefs.current[index] = el; }}
                        type="file"
                        multiple
                        accept=".pdf,.png,.jpg,.jpeg,.dwg,.dxf"
                        onChange={(e) => handleDrawingUpload(index, e.target.files)}
                        className="hidden"
                      />
                      <Button
                        onClick={() => drawingInputRefs.current[index]?.click()}
                        variant="secondary"
                        size="sm"
                      >
                        Add Drawing
                      </Button>
                    </div>
                  </div>

                  <div className="mt-4">
                    <TextareaField
                      label="Part Notes"
                      value={config.notes || ""}
                      onChange={(e) => updatePartConfig(index, "notes", e.target.value)}
                      rows={3}
                      placeholder="Any special requirements or notes for this part"
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
            const customer = customers.find(c => c.id.toString() === value);
            setSelectedCustomer(customer || null);
          }}
          options={customers.map(customer => ({
            value: customer.id.toString(),
            label: customer.displayName,
            secondaryLabel: customer.email || undefined
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
            onChange={(e) => setNewCustomerData({ ...newCustomerData, displayName: e.target.value })}
            required
          />

          <div className="grid grid-cols-2 gap-4">
            <InputField
              label="Email"
              type="email"
              value={newCustomerData.email}
              onChange={(e) => setNewCustomerData({ ...newCustomerData, email: e.target.value })}
              required
            />
            <InputField
              label="Phone (Optional)"
              type="tel"
              value={newCustomerData.phone}
              onChange={(e) => setNewCustomerData({ ...newCustomerData, phone: e.target.value })}
            />
          </div>

          <InputField
            label="ZIP Code"
            value={newCustomerData.zipCode}
            onChange={(e) => setNewCustomerData({ ...newCustomerData, zipCode: e.target.value })}
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
      <h3 className="text-lg font-semibold mb-4">Review Your Quote Request</h3>

      <div className="border rounded-lg p-4 space-y-3">
        <h4 className="font-semibold">Customer</h4>
        {createNewCustomer ? (
          <div className="text-sm">
            <p><strong>New Customer:</strong> {newCustomerData.displayName}</p>
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
            No parts added. This will create an empty quote that you can add line items to later.
          </p>
        ) : (
          partConfigs.map((config, index) => (
            <div key={index} className="text-sm border-t pt-2 relative">
              <div className="flex items-start justify-between">
                <div className="flex-1">
                  <p><strong>{config.partName || partFiles[index].name}</strong></p>
                  <div className="grid grid-cols-2 gap-2 mt-1">
                    <p>Material: {config.material || "Not specified"}</p>
                    <p>Quantity: {config.quantity || 1}</p>
                    <p>Tolerances: {config.tolerances || "Not specified"}</p>
                    <p>Finish: {config.surfaceFinish || "Not specified"}</p>
                  </div>
                  {config.drawings && config.drawings.length > 0 && (
                    <p className="mt-1">Drawings: {config.drawings.length} file(s)</p>
                  )}
                  {config.notes && (
                    <p className="mt-1 text-gray-600">Notes: {config.notes}</p>
                  )}
                </div>
                <button
                  onClick={() => {
                    if (confirm(`Remove ${config.partName || partFiles[index].name}?`)) {
                      removePart(index);
                    }
                  }}
                  type="button"
                  className="ml-3 p-1 text-red-600 hover:text-red-800 dark:text-red-400 dark:hover:text-red-300"
                  title="Remove part"
                >
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
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
    if (currentStep === 'upload') return null;

    return (
      <div className="flex justify-between items-center px-6 py-4 border-t bg-gray-50 dark:bg-gray-800">
        <Button
          onClick={() => {
            setIsContentTransitioning(true);
            setTimeout(() => {
              if (currentStep === 'configure') setCurrentStep('upload');
              else if (currentStep === 'customer') {
                // If no parts, go back to upload; otherwise go to configure
                setCurrentStep(partConfigs.length === 0 ? 'upload' : 'configure');
              }
              else if (currentStep === 'review') setCurrentStep('customer');
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
          {currentStep === 'configure' && (
            <Button
              onClick={() => {
                setIsContentTransitioning(true);
                setTimeout(() => {
                  setCurrentStep('customer');
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
          {currentStep === 'customer' && (
            <Button
              onClick={() => {
                setIsContentTransitioning(true);
                setTimeout(() => {
                  setCurrentStep('review');
                  setTimeout(() => {
                    setIsContentTransitioning(false);
                  }, 300);
                }, 150);
              }}
              variant="primary"
              disabled={createNewCustomer ? (!newCustomerData.displayName || !newCustomerData.email) : !selectedCustomer}
            >
              Review Quote
            </Button>
          )}
          {currentStep === 'review' && (
            <Button
              onClick={handleSubmit}
              variant="primary"
              disabled={fetcher.state === 'submitting'}
            >
              {fetcher.state === 'submitting' ? 'Creating...' : 'Create RFQ'}
            </Button>
          )}
        </div>
      </div>
    );
  };

  // Use 2xl size for wider modal with flexible height
  const modalSize = '2xl';

  return (
    <Modal
      isOpen={isOpen}
      onClose={handleReset}
      title={getModalTitle()}
      size={modalSize}
    >
      <div className={`${currentStep === 'upload' ? '' : 'flex flex-col h-full'} transition-opacity duration-300 ${isContentTransitioning ? 'opacity-0' : 'opacity-100'}`}>
        <div className={currentStep === 'upload' ? '' : 'flex-1 overflow-hidden'}>
          {getStepContent()}
        </div>
        {renderFooter()}
      </div>
    </Modal>
  );
}