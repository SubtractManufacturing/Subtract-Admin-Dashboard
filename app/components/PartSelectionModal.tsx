import { useState, useEffect } from "react";
import Modal from "./shared/Modal";
import Button from "./shared/Button";
import { InputField } from "./shared/FormField";
import type { Part } from "~/lib/db/schema";

interface PartSelectionModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSelectPart: (part: Part) => void;
  customerId?: number | null;
  parts: Part[];
}

export default function PartSelectionModal({
  isOpen,
  onClose,
  onSelectPart,
  customerId,
  parts,
}: PartSelectionModalProps) {
  const [searchTerm, setSearchTerm] = useState("");
  const [filteredParts, setFilteredParts] = useState<Part[]>([]);

  useEffect(() => {
    // Filter parts based on search term and customer ID
    const filtered = parts.filter((part) => {
      const matchesSearch = searchTerm === "" || 
        part.partName?.toLowerCase().includes(searchTerm.toLowerCase()) ||
        part.material?.toLowerCase().includes(searchTerm.toLowerCase()) ||
        part.notes?.toLowerCase().includes(searchTerm.toLowerCase());
      
      const matchesCustomer = !customerId || part.customerId === customerId;
      
      return matchesSearch && matchesCustomer;
    });
    
    setFilteredParts(filtered);
  }, [searchTerm, parts, customerId]);

  const handleSelectPart = (part: Part, e: React.MouseEvent) => {
    e.stopPropagation();
    onSelectPart(part);
    onClose();
    setSearchTerm("");
  };

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title="Select a Part"
      zIndex={60}
    >
      <div className="space-y-4">
        <InputField
          label="Search Parts"
          name="search"
          value={searchTerm}
          onChange={(e) => setSearchTerm(e.target.value)}
          placeholder="Search by name, material, or notes..."
        />

        <div className="max-h-96 overflow-y-auto border rounded-lg">
          {filteredParts.length === 0 ? (
            <div className="p-4 text-center text-gray-500">
              No parts found
            </div>
          ) : (
            <div className="divide-y">
              {filteredParts.map((part) => (
                <button
                  key={part.id}
                  onClick={(e) => handleSelectPart(part, e)}
                  className="w-full text-left p-4 hover:bg-gray-50 transition-colors focus:bg-gray-50 focus:outline-none"
                >
                  <div className="font-medium text-gray-900">
                    {part.partName || "Unnamed Part"}
                  </div>
                  <div className="text-sm text-gray-600 mt-1">
                    {part.material && <span>Material: {part.material}</span>}
                    {part.material && part.tolerance && <span> • </span>}
                    {part.tolerance && <span>Tolerance: {part.tolerance}</span>}
                    {(part.material || part.tolerance) && part.finishing && <span> • </span>}
                    {part.finishing && <span>Finishing: {part.finishing}</span>}
                  </div>
                  {part.notes && (
                    <div className="text-sm text-gray-500 mt-1">
                      {part.notes}
                    </div>
                  )}
                </button>
              ))}
            </div>
          )}
        </div>

        <div className="flex justify-end">
          <Button type="button" variant="secondary" onClick={onClose}>
            Cancel
          </Button>
        </div>
      </div>
    </Modal>
  );
}