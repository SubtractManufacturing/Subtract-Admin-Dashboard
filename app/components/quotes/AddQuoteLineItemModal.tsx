import { useState, useEffect, useRef } from "react";
import Modal from "../shared/Modal";
import Button from "../shared/Button";
import { InputField } from "../shared/FormField";

interface AddQuoteLineItemModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSubmit: (data: FormData) => void;
}

export default function AddQuoteLineItemModal({
  isOpen,
  onClose,
  onSubmit,
}: AddQuoteLineItemModalProps) {
  const [formData, setFormData] = useState({
    name: "",
    quantity: "1",
    unitPrice: "",
    totalPrice: "",
  });
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [errors, setErrors] = useState({
    name: "",
    unitPrice: "",
    quantity: "",
  });
  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (isOpen) {
      // Reset form when modal opens
      setFormData({
        name: "",
        quantity: "1",
        unitPrice: "",
        totalPrice: "",
      });
      setSelectedFile(null);
      setErrors({ name: "", unitPrice: "", quantity: "" });
    }
  }, [isOpen]);

  // Auto-calculate total price when quantity or unit price changes
  useEffect(() => {
    const qty = parseInt(formData.quantity);
    const unitPrice = parseFloat(formData.unitPrice);

    if (!isNaN(qty) && qty > 0 && !isNaN(unitPrice) && unitPrice >= 0) {
      const total = (qty * unitPrice).toFixed(2);
      setFormData(prev => ({ ...prev, totalPrice: total }));
    } else {
      setFormData(prev => ({ ...prev, totalPrice: "" }));
    }
  }, [formData.quantity, formData.unitPrice]);

  const handleClose = () => {
    setFormData({
      name: "",
      quantity: "1",
      unitPrice: "",
      totalPrice: "",
    });
    setSelectedFile(null);
    setErrors({ name: "", unitPrice: "", quantity: "" });
    onClose();
  };

  const handleFileSelect = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (file) {
      // Validate file type (3D model formats)
      const validExtensions = ['.step', '.stp', '.brep', '.sldprt', '.stl', '.obj', '.gltf', '.glb'];
      const fileName = file.name.toLowerCase();
      const isValid = validExtensions.some(ext => fileName.endsWith(ext));

      if (!isValid) {
        alert('Please select a valid 3D model file (.step, .stp, .brep, .sldprt, .stl, .obj, .gltf, .glb)');
        return;
      }

      setSelectedFile(file);

      // Auto-populate name field with filename (without extension) if name is empty
      if (!formData.name) {
        const nameWithoutExt = file.name.replace(/\.[^/.]+$/, "");
        setFormData(prev => ({ ...prev, name: nameWithoutExt }));
      }
    }
  };

  const handleRemoveFile = () => {
    setSelectedFile(null);
    if (fileInputRef.current) {
      fileInputRef.current.value = "";
    }
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();

    // Validate all required fields
    const newErrors = {
      name: "",
      unitPrice: "",
      quantity: "",
    };

    let hasErrors = false;

    // Validate name (only required field)
    if (!formData.name || formData.name.trim() === "") {
      newErrors.name = "Name is required";
      hasErrors = true;
    }

    setErrors(newErrors);

    if (hasErrors) {
      return;
    }

    // Default values if not provided
    const quantity = formData.quantity && formData.quantity !== "" ? formData.quantity : "1";
    const unitPrice = formData.unitPrice && formData.unitPrice !== "" ? formData.unitPrice : "0";
    const totalPrice = formData.totalPrice && formData.totalPrice !== "" ? formData.totalPrice : "0";

    // Create FormData to send to the server
    const submitData = new FormData();
    submitData.append("name", formData.name);
    submitData.append("quantity", quantity);
    submitData.append("unitPrice", unitPrice);
    submitData.append("totalPrice", totalPrice);

    if (selectedFile) {
      submitData.append("file", selectedFile);
    }

    onSubmit(submitData);
    handleClose();
  };

  const handleChange = (field: string, value: string) => {
    setFormData((prev) => ({
      ...prev,
      [field]: value,
    }));

    // Clear error for this field when user starts typing
    if (errors[field as keyof typeof errors]) {
      setErrors((prev) => ({
        ...prev,
        [field]: "",
      }));
    }
  };

  // Calculate total price when unit price changes
  const handleUnitPriceChange = (value: string) => {
    handleChange("unitPrice", value);
  };

  // Calculate unit price when total price changes
  const handleTotalPriceChange = (value: string) => {
    setFormData(prev => ({ ...prev, totalPrice: value }));

    const qty = parseInt(formData.quantity);
    const total = parseFloat(value);

    if (!isNaN(qty) && qty > 0 && !isNaN(total) && total >= 0) {
      const unitPrice = (total / qty).toFixed(2);
      setFormData(prev => ({ ...prev, unitPrice }));
    }
  };

  const formatFileSize = (bytes: number): string => {
    if (bytes === 0) return '0 Bytes';
    const k = 1024;
    const sizes = ['Bytes', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return Math.round(bytes / Math.pow(k, i) * 100) / 100 + ' ' + sizes[i];
  };

  return (
    <Modal
      isOpen={isOpen}
      onClose={handleClose}
      title="Add Line Item"
    >
      <form onSubmit={handleSubmit} className="space-y-4">
        {/* 3D Model Upload */}
        <div>
          <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
            3D Model (Optional)
          </label>

          {!selectedFile ? (
            <div className="flex items-center justify-center w-full">
              <label className="flex flex-col items-center justify-center w-full h-32 border-2 border-gray-300 border-dashed rounded-lg cursor-pointer bg-gray-50 dark:bg-gray-700 hover:bg-gray-100 dark:hover:bg-gray-600 transition-colors">
                <div className="flex flex-col items-center justify-center pt-5 pb-6">
                  <svg
                    className="w-8 h-8 mb-2 text-gray-500 dark:text-gray-400"
                    fill="none"
                    stroke="currentColor"
                    viewBox="0 0 24 24"
                  >
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      strokeWidth={2}
                      d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M15 13l-3-3m0 0l-3 3m3-3v12"
                    />
                  </svg>
                  <p className="mb-2 text-sm text-gray-500 dark:text-gray-400">
                    <span className="font-semibold">Click to upload</span> or drag and drop
                  </p>
                  <p className="text-xs text-gray-500 dark:text-gray-400">
                    STEP, BREP, SLDPRT, STL, OBJ, GLTF, GLB
                  </p>
                </div>
                <input
                  ref={fileInputRef}
                  type="file"
                  className="hidden"
                  accept=".step,.stp,.brep,.sldprt,.stl,.obj,.gltf,.glb"
                  onChange={handleFileSelect}
                />
              </label>
            </div>
          ) : (
            <div className="flex items-center justify-between p-4 border-2 border-blue-500 rounded-lg bg-blue-50 dark:bg-blue-900/20">
              <div className="flex items-center space-x-3 flex-1 min-w-0">
                <svg
                  className="w-8 h-8 text-blue-500 flex-shrink-0"
                  fill="none"
                  stroke="currentColor"
                  viewBox="0 0 24 24"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M20 7l-8-4-8 4m16 0l-8 4m8-4v10l-8 4m0-10L4 7m8 4v10M4 7v10l8 4"
                  />
                </svg>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium text-gray-900 dark:text-gray-100 truncate">
                    {selectedFile.name}
                  </p>
                  <p className="text-xs text-gray-500 dark:text-gray-400">
                    {formatFileSize(selectedFile.size)}
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={handleRemoveFile}
                className="ml-3 text-red-600 hover:text-red-800 dark:text-red-400 dark:hover:text-red-300 flex-shrink-0"
              >
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>
          )}
        </div>

        {/* Name Field */}
        <InputField
          label="Name"
          name="name"
          value={formData.name}
          onChange={(e: React.ChangeEvent<HTMLInputElement>) => handleChange("name", e.target.value)}
          required
          placeholder="Enter part name"
          error={errors.name}
        />

        {/* Quantity and Prices Grid */}
        <div className="grid grid-cols-3 gap-4">
          <InputField
            label="Quantity"
            name="quantity"
            type="number"
            value={formData.quantity}
            onChange={(e: React.ChangeEvent<HTMLInputElement>) => handleChange("quantity", e.target.value)}
            min={1}
            placeholder="1"
            error={errors.quantity}
          />

          <InputField
            label="Unit Price ($)"
            name="unitPrice"
            type="number"
            value={formData.unitPrice}
            onChange={(e: React.ChangeEvent<HTMLInputElement>) => handleUnitPriceChange(e.target.value)}
            min={0}
            step="0.01"
            placeholder="0.00"
            error={errors.unitPrice}
          />

          <InputField
            label="Total Price ($)"
            name="totalPrice"
            type="number"
            value={formData.totalPrice}
            onChange={(e: React.ChangeEvent<HTMLInputElement>) => handleTotalPriceChange(e.target.value)}
            min={0}
            step="0.01"
            placeholder="0.00"
          />
        </div>

        <div className="flex justify-end space-x-3 pt-4">
          <Button type="button" variant="secondary" onClick={handleClose}>
            Cancel
          </Button>
          <Button type="submit" variant="primary">
            Add Line Item
          </Button>
        </div>
      </form>
    </Modal>
  );
}
