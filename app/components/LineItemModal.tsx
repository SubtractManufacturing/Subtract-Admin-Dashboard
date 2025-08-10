import { useState, useEffect } from "react";
import Modal from "./shared/Modal";
import Button from "./shared/Button";
import { InputField, TextareaField } from "./shared/FormField";
import type { OrderLineItem } from "~/lib/db/schema";

interface LineItemModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSubmit: (data: {
    name: string;
    description: string;
    quantity: number;
    unitPrice: string;
  }) => void;
  lineItem?: OrderLineItem | null;
  mode: "create" | "edit";
}

export default function LineItemModal({
  isOpen,
  onClose,
  onSubmit,
  lineItem,
  mode,
}: LineItemModalProps) {
  const [formData, setFormData] = useState({
    name: "",
    description: "",
    quantity: "1" as string | number,
    unitPrice: "",
  });
  const [quantityError, setQuantityError] = useState(false);

  useEffect(() => {
    if (lineItem && mode === "edit") {
      setFormData({
        name: lineItem.name || "",
        description: lineItem.description || "",
        quantity: lineItem.quantity.toString(),
        unitPrice: lineItem.unitPrice || "",
      });
    } else {
      setFormData({
        name: "",
        description: "",
        quantity: "1",
        unitPrice: "",
      });
    }
    setQuantityError(false);
  }, [lineItem, mode]);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    
    // Validate quantity
    const qty = typeof formData.quantity === 'string' ? parseInt(formData.quantity) : formData.quantity;
    if (!qty || qty < 1) {
      setQuantityError(true);
      return;
    }
    
    onSubmit({
      ...formData,
      quantity: qty
    });
    onClose();
  };

  const handleChange = (field: string, value: string | number) => {
    setFormData((prev) => ({
      ...prev,
      [field]: value,
    }));
  };

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title={mode === "create" ? "Add Line Item" : "Edit Line Item"}
    >
      <form onSubmit={handleSubmit} className="space-y-4">
        <InputField
          label="Title"
          name="name"
          value={formData.name}
          onChange={(e: React.ChangeEvent<HTMLInputElement>) => handleChange("name", e.target.value)}
          required
          placeholder="Enter line item title"
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
              onChange={(e: React.ChangeEvent<HTMLInputElement>) => {
                const value = e.target.value;
                handleChange("quantity", value);
                setQuantityError(value === "" || parseInt(value) < 1);
              }}
              required
              min={1}
              error={quantityError ? "Quantity must be at least 1" : undefined}
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
          />
        </div>

        <div className="flex justify-end space-x-3 pt-4">
          <Button type="button" variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" variant="primary">
            {mode === "create" ? "Add Line Item" : "Update Line Item"}
          </Button>
        </div>
      </form>
    </Modal>
  );
}