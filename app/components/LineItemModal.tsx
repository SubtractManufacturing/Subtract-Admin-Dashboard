import { useState, useEffect } from "react";
import Modal from "./shared/Modal";
import Button from "./shared/Button";
import { InputField, TextareaField } from "./shared/FormField";
import PartSelectionModal from "./PartSelectionModal";
import type { OrderLineItem, Part } from "~/lib/db/schema";
import { Plus } from "lucide-react";

interface LineItemModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSubmit: (data: {
    name: string;
    description: string;
    quantity: number;
    unitPrice: string;
    partId?: string | null;
  }) => void;
  lineItem?: OrderLineItem | null;
  mode: "create" | "edit";
  customerId?: number | null;
  parts?: Part[];
}

export default function LineItemModal({
  isOpen,
  onClose,
  onSubmit,
  lineItem,
  mode,
  customerId,
  parts = [],
}: LineItemModalProps) {
  const [formData, setFormData] = useState({
    name: "",
    description: "",
    quantity: "1" as string | number,
    unitPrice: "",
    partId: null as string | null,
  });
  const [errors, setErrors] = useState({
    name: "",
    unitPrice: "",
    quantity: "",
  });
  const [showPartSelection, setShowPartSelection] = useState(false);

  useEffect(() => {
    if (isOpen) {
      if (lineItem && mode === "edit") {
        setFormData({
          name: lineItem.name || "",
          description: lineItem.description || "",
          quantity: lineItem.quantity.toString(),
          unitPrice: lineItem.unitPrice || "",
          partId: lineItem.partId || null,
        });
      } else {
        setFormData({
          name: "",
          description: "",
          quantity: "1",
          unitPrice: "",
          partId: null,
        });
      }
      setErrors({ name: "", unitPrice: "", quantity: "" });
    }
  }, [isOpen, lineItem, mode]);

  const handleClose = () => {
    // Reset form data when closing without saving
    setFormData({
      name: "",
      description: "",
      quantity: "1",
      unitPrice: "",
      partId: null,
    });
    setErrors({ name: "", unitPrice: "", quantity: "" });
    setShowPartSelection(false);
    onClose();
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
    
    // Validate name (title)
    if (!formData.name || formData.name.trim() === "") {
      newErrors.name = "Title is required";
      hasErrors = true;
    }
    
    // Validate unit price
    if (!formData.unitPrice || formData.unitPrice === "") {
      newErrors.unitPrice = "Unit price is required";
      hasErrors = true;
    } else if (parseFloat(formData.unitPrice) < 0) {
      newErrors.unitPrice = "Unit price must be positive";
      hasErrors = true;
    }
    
    // Validate quantity
    const qty = typeof formData.quantity === 'string' ? parseInt(formData.quantity) : formData.quantity;
    if (!formData.quantity || formData.quantity === "") {
      newErrors.quantity = "Quantity is required";
      hasErrors = true;
    } else if (!qty || qty < 1) {
      newErrors.quantity = "Quantity must be at least 1";
      hasErrors = true;
    }
    
    setErrors(newErrors);
    
    if (hasErrors) {
      return;
    }
    
    onSubmit({
      ...formData,
      quantity: qty
    });
    // Also reset form after successful submission
    setFormData({
      name: "",
      description: "",
      quantity: "1",
      unitPrice: "",
      partId: null,
    });
    setErrors({ name: "", unitPrice: "", quantity: "" });
    onClose();
  };

  const handleChange = (field: string, value: string | number) => {
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

  const handlePartSelect = (part: Part) => {
    // Build description from material, tolerance, and finishing
    const descriptionParts = [];
    if (part.material) descriptionParts.push(`Material: ${part.material}`);
    if (part.tolerance) descriptionParts.push(`Tolerance: ${part.tolerance}`);
    if (part.finishing) descriptionParts.push(`Finishing: ${part.finishing}`);
    
    const description = descriptionParts.join("\n");
    
    setFormData((prev) => ({
      ...prev,
      name: part.partName || prev.name,
      description: part.notes ? `${description}${description ? "\n" : ""}${part.notes}` : description,
      partId: part.id,
    }));
    
    setShowPartSelection(false);
  };

  return (
    <>
      <Modal
        isOpen={isOpen}
        onClose={handleClose}
        title={mode === "create" ? "Add Line Item" : "Edit Line Item"}
      >
      <form onSubmit={handleSubmit} className="space-y-4">
        {mode === "create" && parts.length > 0 && (
          <div className="flex justify-end -mt-2 mb-2">
            <button
              type="button"
              onClick={() => setShowPartSelection(true)}
              className="flex items-center gap-1 px-3 py-1 text-sm text-blue-600 hover:bg-blue-50 rounded-lg transition-colors"
              title="Select from Parts"
            >
              <Plus className="h-4 w-4" />
              Select from Parts
            </button>
          </div>
        )}
        <InputField
          label="Title"
          name="name"
          value={formData.name}
          onChange={(e: React.ChangeEvent<HTMLInputElement>) => handleChange("name", e.target.value)}
          required
          placeholder="Enter line item title"
          error={errors.name}
        />

        <TextareaField
          label="Description"
          name="description"
          value={formData.description}
          onChange={(e: React.ChangeEvent<HTMLTextAreaElement>) => handleChange("description", e.target.value)}
          placeholder="Enter line item description"
          rows={3}
        />

        <div className="grid grid-cols-2 gap-4">
          <div>
            <InputField
              label="Quantity"
              name="quantity"
              type="number"
              value={formData.quantity.toString()}
              onChange={(e: React.ChangeEvent<HTMLInputElement>) => handleChange("quantity", e.target.value)}
              required
              min={1}
              error={errors.quantity}
            />
          </div>

          <InputField
            label="Unit Price ($)"
            name="unitPrice"
            type="number"
            value={formData.unitPrice}
            onChange={(e: React.ChangeEvent<HTMLInputElement>) => handleChange("unitPrice", e.target.value)}
            required
            min={0}
            step="0.01"
            placeholder="0.00"
            error={errors.unitPrice}
          />
        </div>

        <div className="flex justify-end space-x-3 pt-4">
          <Button type="button" variant="secondary" onClick={handleClose}>
            Cancel
          </Button>
          <Button type="submit" variant="primary">
            {mode === "create" ? "Add Line Item" : "Update Line Item"}
          </Button>
        </div>
      </form>
      </Modal>

      <PartSelectionModal
        isOpen={showPartSelection}
        onClose={() => setShowPartSelection(false)}
        onSelectPart={handlePartSelect}
        customerId={customerId}
        parts={parts}
      />
    </>
  );
}