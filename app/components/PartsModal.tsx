import { useState, useEffect, useRef } from "react";
import Modal from "./shared/Modal";
import Button from "./shared/Button";
import { InputField, TextareaField } from "./shared/FormField";
import type { Part } from "~/lib/db/schema";

interface PartsModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSubmit: (data: {
    partName: string;
    material: string;
    tolerance: string;
    finishing: string;
    notes: string;
    modelFile?: File;
  }) => void;
  part?: Part | null;
  mode: "create" | "edit";
}

export default function PartsModal({
  isOpen,
  onClose,
  onSubmit,
  part,
  mode,
}: PartsModalProps) {
  const [formData, setFormData] = useState({
    partName: "",
    material: "",
    tolerance: "",
    finishing: "",
    notes: "",
  });
  const [modelFile, setModelFile] = useState<File | null>(null);
  const [dragActive, setDragActive] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (part && mode === "edit") {
      setFormData({
        partName: part.partName || "",
        material: part.material || "",
        tolerance: part.tolerance || "",
        finishing: part.finishing || "",
        notes: part.notes || "",
      });
    } else {
      setFormData({
        partName: "",
        material: "",
        tolerance: "",
        finishing: "",
        notes: "",
      });
      setModelFile(null);
    }
  }, [part, mode]);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();

    // Validate that 3D file is provided for new parts
    if (mode === "create" && !modelFile) {
      alert("Please upload a 3D model file");
      return;
    }

    onSubmit({
      ...formData,
      modelFile: modelFile || undefined,
    });
    onClose();
  };

  const handleChange = (field: string, value: string) => {
    // Special handling for tolerance field to ensure ± is at the beginning
    if (field === "tolerance") {
      // If value is empty or user deleted everything, reset to just ±
      if (!value || value === "") {
        setFormData((prev) => ({
          ...prev,
          tolerance: "±",
        }));
        return;
      }
      
      // If value doesn't start with ±, add it
      if (!value.startsWith("±")) {
        value = "±" + value;
      }
      
      // Don't allow just the ± symbol to be deleted (keep at least ±)
      if (value.length < 1) {
        value = "±";
      }
    }
    
    setFormData((prev) => ({
      ...prev,
      [field]: value,
    }));
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
      const file = e.dataTransfer.files[0];
      // Accept common 3D file formats
      const validTypes = [
        ".stl",
        ".step",
        ".stp",
        ".iges",
        ".igs",
        ".obj",
        ".3mf",
      ];
      const fileExt = file.name
        .toLowerCase()
        .substring(file.name.lastIndexOf("."));

      if (validTypes.includes(fileExt)) {
        setModelFile(file);

        // Auto-populate part name from file name (without extension)
        if (!formData.partName || formData.partName === "") {
          const nameWithoutExt =
            file.name.substring(0, file.name.lastIndexOf(".")) || file.name;
          setFormData((prev) => ({
            ...prev,
            partName: nameWithoutExt,
          }));
        }
      } else {
        alert("Please upload a valid 3D file (STL, STEP, IGES, OBJ, 3MF)");
      }
    }
  };

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files[0]) {
      const file = e.target.files[0];
      setModelFile(file);

      // Auto-populate part name from file name (without extension)
      if (!formData.partName || formData.partName === "") {
        const nameWithoutExt =
          file.name.substring(0, file.name.lastIndexOf(".")) || file.name;
        setFormData((prev) => ({
          ...prev,
          partName: nameWithoutExt,
        }));
      }
    }
  };

  const removeFile = () => {
    setModelFile(null);
    if (fileInputRef.current) {
      fileInputRef.current.value = "";
    }
  };

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title={mode === "create" ? "Add New Part" : "Edit Part"}
    >
      <form onSubmit={handleSubmit} className="space-y-4">
        {/* 3D File Upload - Moved to top */}
        {mode === "create" && (
          <div>
            <label
              htmlFor="modelFile"
              className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2"
            >
              3D Model File <span className="text-red-500">*</span>
            </label>
            <div
              className={`relative border-2 border-dashed rounded-lg p-6 ${
                dragActive
                  ? "border-blue-500 bg-blue-50 dark:bg-blue-900/20"
                  : modelFile
                  ? "border-green-500 bg-green-50 dark:bg-green-900/20"
                  : "border-gray-300 dark:border-gray-600"
              }`}
              onDragEnter={handleDrag}
              onDragLeave={handleDrag}
              onDragOver={handleDrag}
              onDrop={handleDrop}
            >
              <input
                ref={fileInputRef}
                id="modelFile"
                type="file"
                onChange={handleFileSelect}
                accept=".stl,.step,.stp,.iges,.igs,.obj,.3mf"
                className="hidden"
              />

              {modelFile ? (
                <div className="flex items-center justify-between">
                  <div className="flex items-center space-x-2">
                    <svg
                      className="w-8 h-8 text-blue-500"
                      fill="currentColor"
                      viewBox="0 0 20 20"
                    >
                      <path d="M9 2a2 2 0 00-2 2v8a2 2 0 002 2h6a2 2 0 002-2V6.414A2 2 0 0016.414 5L14 2.586A2 2 0 0012.586 2H9z" />
                    </svg>
                    <div>
                      <p className="text-sm font-medium text-gray-900 dark:text-gray-100">
                        {modelFile.name}
                      </p>
                      <p className="text-xs text-gray-500 dark:text-gray-400">
                        {(modelFile.size / 1024 / 1024).toFixed(2)} MB
                      </p>
                    </div>
                  </div>
                  <button
                    type="button"
                    onClick={removeFile}
                    className="text-red-500 hover:text-red-700"
                  >
                    <svg
                      className="w-5 h-5"
                      fill="currentColor"
                      viewBox="0 0 20 20"
                    >
                      <path
                        fillRule="evenodd"
                        d="M4.293 4.293a1 1 0 011.414 0L10 8.586l4.293-4.293a1 1 0 111.414 1.414L11.414 10l4.293 4.293a1 1 0 01-1.414 1.414L10 11.414l-4.293 4.293a1 1 0 01-1.414-1.414L8.586 10 4.293 5.707a1 1 0 010-1.414z"
                        clipRule="evenodd"
                      />
                    </svg>
                  </button>
                </div>
              ) : (
                <div className="text-center">
                  <svg
                    className="mx-auto h-12 w-12 text-gray-400"
                    stroke="currentColor"
                    fill="none"
                    viewBox="0 0 48 48"
                  >
                    <path
                      d="M28 8H12a4 4 0 00-4 4v20m32-12v8m0 0v8a4 4 0 01-4 4H12a4 4 0 01-4-4v-4m32-4l-3.172-3.172a4 4 0 00-5.656 0L28 28M8 32l9.172-9.172a4 4 0 015.656 0L28 28m0 0l4 4m4-24h8m-4-4v8m-12 4h.02"
                      strokeWidth="2"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    />
                  </svg>
                  <p className="mt-2 text-sm text-gray-600 dark:text-gray-400">
                    <button
                      type="button"
                      onClick={() => fileInputRef.current?.click()}
                      className="font-medium text-blue-600 hover:text-blue-500"
                    >
                      Click to upload
                    </button>{" "}
                    or drag and drop
                  </p>
                  <p className="text-xs text-gray-500 dark:text-gray-400">
                    STL, STEP, IGES, OBJ, 3MF files
                  </p>
                </div>
              )}
            </div>
          </div>
        )}

        <InputField
          label="Part Name"
          name="partName"
          value={formData.partName}
          onChange={(e: React.ChangeEvent<HTMLInputElement>) =>
            handleChange("partName", e.target.value)
          }
          required
          placeholder="e.g., Modular Block V1"
        />

        <div className="grid grid-cols-2 gap-4">
          <InputField
            label="Material"
            name="material"
            value={formData.material}
            onChange={(e: React.ChangeEvent<HTMLInputElement>) =>
              handleChange("material", e.target.value)
            }
            placeholder="e.g., Aluminum 6061"
          />

          <InputField
            label="Tolerance"
            name="tolerance"
            value={formData.tolerance}
            onChange={(e: React.ChangeEvent<HTMLInputElement>) =>
              handleChange("tolerance", e.target.value)
            }
            onFocus={() => {
              // If field is empty when focused, add ± symbol
              if (!formData.tolerance) {
                handleChange("tolerance", "±");
              }
            }}
            placeholder="e.g., ±0.005"
          />
        </div>

        <InputField
          label="Finishing"
          name="finishing"
          value={formData.finishing}
          onChange={(e: React.ChangeEvent<HTMLInputElement>) =>
            handleChange("finishing", e.target.value)
          }
          placeholder="e.g., Anodized, Powder Coated"
        />

        <TextareaField
          label="Notes"
          name="notes"
          value={formData.notes}
          onChange={(e: React.ChangeEvent<HTMLTextAreaElement>) =>
            handleChange("notes", e.target.value)
          }
          placeholder="Additional specifications or requirements"
          rows={3}
        />

        <div className="flex justify-end space-x-3 pt-4">
          <Button type="button" variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" variant="primary">
            {mode === "create" ? "Add Part" : "Update Part"}
          </Button>
        </div>
      </form>
    </Modal>
  );
}
