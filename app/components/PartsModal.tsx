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
    meshFile?: File; // TEMPORARY
    thumbnailFile?: File;
    deleteThumbnail?: boolean;
  }) => void;
  part?: Part | null;
  mode: "create" | "edit";
  canUploadMesh?: boolean;
}

export default function PartsModal({
  isOpen,
  onClose,
  onSubmit,
  part,
  mode,
  canUploadMesh = false,
}: PartsModalProps) {
  const [formData, setFormData] = useState({
    partName: "",
    material: "",
    tolerance: "",
    finishing: "",
    notes: "",
  });
  const [modelFile, setModelFile] = useState<File | null>(null);
  const [meshFile, setMeshFile] = useState<File | null>(null); // TEMPORARY
  const [thumbnailFile, setThumbnailFile] = useState<File | null>(null);
  const [thumbnailPreview, setThumbnailPreview] = useState<string | null>(null);
  const [shouldDeleteThumbnail, setShouldDeleteThumbnail] = useState(false);
  const [dragActive, setDragActive] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const meshInputRef = useRef<HTMLInputElement>(null); // TEMPORARY
  const thumbnailInputRef = useRef<HTMLInputElement>(null);
  const formRef = useRef<HTMLFormElement>(null);

  useEffect(() => {
    if (part && mode === "edit") {
      setFormData({
        partName: part.partName || "",
        material: part.material || "",
        tolerance: part.tolerance || "",
        finishing: part.finishing || "",
        notes: part.notes || "",
      });
      // Set existing thumbnail preview if available
      if (part.thumbnailUrl) {
        setThumbnailPreview(part.thumbnailUrl);
      }
      setShouldDeleteThumbnail(false);
    } else {
      setFormData({
        partName: "",
        material: "",
        tolerance: "",
        finishing: "",
        notes: "",
      });
      setModelFile(null);
      setMeshFile(null); // TEMPORARY
      setThumbnailFile(null);
      setThumbnailPreview(null);
      setShouldDeleteThumbnail(false);
    }
  }, [part, mode]);

  // Add keyboard event handler for Enter key
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // Only handle events when modal is open
      if (!isOpen) return;

      // Check if target is the notes textarea
      const isNotesTextarea = e.target instanceof HTMLTextAreaElement && 
                              (e.target as HTMLTextAreaElement).name === 'notes';

      // Handle Enter key
      if (e.key === 'Enter') {
        // In notes field: Shift+Enter creates new line, Enter alone saves
        if (isNotesTextarea) {
          if (!e.shiftKey) {
            // Plain Enter in notes field - save the form
            e.preventDefault();
            if (formRef.current) {
              const submitEvent = new Event('submit', { bubbles: true, cancelable: true });
              formRef.current.dispatchEvent(submitEvent);
            }
          }
          // Shift+Enter will naturally create a new line, no need to handle
        } else {
          // In any other field, Enter saves the form
          e.preventDefault();
          if (formRef.current) {
            const submitEvent = new Event('submit', { bubbles: true, cancelable: true });
            formRef.current.dispatchEvent(submitEvent);
          }
        }
      }
    };

    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, formData, modelFile, mode]);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();

    onSubmit({
      ...formData,
      modelFile: modelFile || undefined,
      meshFile: meshFile || undefined, // TEMPORARY
      thumbnailFile: thumbnailFile || undefined,
      deleteThumbnail: shouldDeleteThumbnail,
    });
    onClose();
  };

  const handleChange = (field: string, value: string) => {
    // Special handling for tolerance field
    if (field === "tolerance") {
      // Remove ± symbol from the value for processing
      const cleanValue = value.replace(/±/g, "");
      
      // Check if the clean value contains any non-numeric characters (excluding decimal point, minus, and spaces)
      const hasText = /[^0-9.\-\s]/.test(cleanValue);
      
      if (hasText) {
        // If there's text, don't add the ± symbol
        value = cleanValue;
      } else {
        // If it's empty or only contains numbers/decimal/minus/spaces
        if (cleanValue.trim() === "") {
          // If empty, just show the ± symbol
          value = "±";
        } else {
          // If it contains numbers, add ± at the beginning
          value = "±" + cleanValue;
        }
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

  // TEMPORARY mesh file handlers
  const handleMeshFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files[0]) {
      const file = e.target.files[0];
      setMeshFile(file);
    }
  };

  const removeMeshFile = () => {
    setMeshFile(null);
    if (meshInputRef.current) {
      meshInputRef.current.value = "";
    }
  };

  const handleThumbnailSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files[0]) {
      const file = e.target.files[0];
      
      // Validate file type
      if (!file.type.startsWith('image/')) {
        alert("Please upload an image file (PNG, JPG, etc.)");
        return;
      }

      setThumbnailFile(file);
      
      // Create preview URL
      const reader = new FileReader();
      reader.onloadend = () => {
        setThumbnailPreview(reader.result as string);
      };
      reader.readAsDataURL(file);
    }
  };

  const removeThumbnail = () => {
    setThumbnailFile(null);
    setThumbnailPreview(null);
    if (thumbnailInputRef.current) {
      thumbnailInputRef.current.value = "";
    }
    // If we're editing and there was an existing thumbnail, mark it for deletion
    if (mode === "edit" && part?.thumbnailUrl) {
      setShouldDeleteThumbnail(true);
    }
  };

  const handlePasteFromClipboard = async () => {
    try {
      const clipboardItems = await navigator.clipboard.read();
      for (const clipboardItem of clipboardItems) {
        for (const type of clipboardItem.types) {
          if (type.startsWith('image/')) {
            const blob = await clipboardItem.getType(type);
            const file = new File([blob], `clipboard-image-${Date.now()}.png`, { type });
            
            setThumbnailFile(file);
            
            // Create preview URL
            const reader = new FileReader();
            reader.onloadend = () => {
              setThumbnailPreview(reader.result as string);
            };
            reader.readAsDataURL(file);
            
            return;
          }
        }
      }
      alert("No image found in clipboard. Please copy an image first.");
    } catch (error) {
      console.error('Clipboard paste error:', error);
      alert("Unable to paste from clipboard. Please ensure you've copied an image and granted clipboard permissions.");
    }
  };

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title={mode === "create" ? "Add New Part" : "Edit Part"}
    >
      <form ref={formRef} onSubmit={handleSubmit} className="space-y-4">
        {/* 3D Model File Upload */}
        <div>
          <label
            htmlFor="modelFile"
            className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2"
          >
            3D Model File
          </label>
          <div
            className={`relative border-2 border-dashed rounded-lg p-4 ${
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
              accept=".stl,.step,.stp,.iges,.igs,.obj,.3mf,.sldprt"
              className="hidden"
            />

            {modelFile ? (
              <div className="flex items-center justify-between">
                <div className="flex items-center space-x-2">
                  <svg
                    className="w-6 h-6 text-blue-500"
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

        {/* TEMPORARY: Mesh File Upload - Only show if feature flag is enabled */}
        {canUploadMesh && (
          <div className="p-3 bg-yellow-50 dark:bg-yellow-900/20 rounded-lg border border-yellow-200 dark:border-yellow-800">
            <label
              htmlFor="meshFile"
              className="block text-sm font-medium text-yellow-800 dark:text-yellow-200 mb-2"
            >
              🚧 TEMPORARY: Mesh File (STL/OBJ/GLTF for 3D viewer)
            </label>
            <div className="flex items-center gap-2">
              <input
                ref={meshInputRef}
                id="meshFile"
                type="file"
                onChange={handleMeshFileSelect}
                accept=".stl,.obj,.gltf,.glb"
                className="hidden"
              />
              {meshFile ? (
                <div className="flex items-center gap-2 flex-1">
                  <span className="text-sm text-gray-700 dark:text-gray-300">
                    {meshFile.name}
                  </span>
                  <button
                    type="button"
                    onClick={removeMeshFile}
                    className="text-red-500 hover:text-red-700"
                  >
                    <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 20 20">
                      <path fillRule="evenodd" d="M4.293 4.293a1 1 0 011.414 0L10 8.586l4.293-4.293a1 1 0 111.414 1.414L11.414 10l4.293 4.293a1 1 0 01-1.414 1.414L10 11.414l-4.293 4.293a1 1 0 01-1.414-1.414L8.586 10 4.293 5.707a1 1 0 010-1.414z" clipRule="evenodd" />
                    </svg>
                  </button>
                </div>
              ) : (
                <button
                  type="button"
                  onClick={() => meshInputRef.current?.click()}
                  className="px-3 py-1 text-sm bg-yellow-600 text-white rounded hover:bg-yellow-700"
                >
                  Choose Mesh File
                </button>
              )}
            </div>
            <p className="text-xs text-yellow-700 dark:text-yellow-300 mt-1">
              This is temporary for testing. Upload STL/OBJ/GLTF to view in 3D.
            </p>
          </div>
        )}

        {/* Thumbnail Upload */}
        <div>
          <div className="flex items-center gap-2 mb-2">
            <label
              htmlFor="thumbnail"
              className="text-sm font-medium text-gray-700 dark:text-gray-300"
            >
              Thumbnail Image (Optional)
            </label>
            <button
              type="button"
              onClick={() => thumbnailInputRef.current?.click()}
              className="p-1 text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200 rounded hover:bg-gray-100 dark:hover:bg-gray-700"
              title="Upload from computer"
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
                  d="M12 4v16m8-8H4"
                />
              </svg>
            </button>
            <button
              type="button"
              onClick={handlePasteFromClipboard}
              className="p-1 text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200 rounded hover:bg-gray-100 dark:hover:bg-gray-700"
              title="Paste from clipboard"
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
                  d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2"
                />
              </svg>
            </button>
          </div>
          {thumbnailPreview && (
            <div className="relative inline-block">
              <img
                src={thumbnailPreview}
                alt="Part thumbnail"
                className="w-32 h-32 object-cover rounded-lg border-2 border-gray-300 dark:border-gray-600"
              />
              <button
                type="button"
                onClick={removeThumbnail}
                className="absolute -top-2 -right-2 bg-red-500 text-white rounded-full p-1 hover:bg-red-600"
              >
                <svg
                  className="w-4 h-4"
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
          )}
          <input
            ref={thumbnailInputRef}
            id="thumbnail"
            type="file"
            onChange={handleThumbnailSelect}
            accept="image/*"
            className="hidden"
          />
        </div>

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
