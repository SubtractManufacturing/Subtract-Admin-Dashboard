import { useRef, type ChangeEvent } from "react";
import { InputField, TextareaField } from "~/components/shared/FormField";
import Button from "~/components/shared/Button";
import { formatToleranceValue, initToleranceOnFocus } from "~/utils/tolerance";

interface PartConfigFormProps {
  material: string;
  tolerance: string;
  finish: string;
  notes: string;
  onChange: (
    field: "material" | "tolerance" | "finish" | "notes",
    value: string
  ) => void;
  drawings: File[];
  onDrawingsChange: (files: File[]) => void;
  acceptedDrawingTypes?: string;
}

export function PartConfigForm({
  material,
  tolerance,
  finish,
  notes,
  onChange,
  drawings,
  onDrawingsChange,
  acceptedDrawingTypes = ".pdf,.png,.jpg,.jpeg,.dwg,.dxf",
}: PartConfigFormProps) {
  const drawingInputRef = useRef<HTMLInputElement>(null);

  const handleDrawingSelect = (event: ChangeEvent<HTMLInputElement>) => {
    const files = event.target.files;
    if (!files) return;
    const next = [...drawings, ...Array.from(files)];
    onDrawingsChange(next);
  };

  const handleRemoveDrawing = (index: number) => {
    onDrawingsChange(drawings.filter((_, i) => i !== index));
  };

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-4">
        <InputField
          label="Material"
          value={material}
          onChange={(e) => onChange("material", e.target.value)}
          placeholder="e.g., Aluminum 6061"
        />
        <InputField
          label="Tolerance"
          value={tolerance}
          onChange={(e) => onChange("tolerance", formatToleranceValue(e.target.value))}
          onFocus={() => onChange("tolerance", initToleranceOnFocus(tolerance))}
          placeholder="e.g., ±0.005"
        />
      </div>

      <InputField
        label="Finish"
        value={finish}
        onChange={(e) => onChange("finish", e.target.value)}
        placeholder="e.g., Anodized Black"
      />

      <TextareaField
        label="Part Notes"
        value={notes}
        onChange={(e) => onChange("notes", e.target.value)}
        rows={3}
        placeholder="Any special requirements or part-level notes"
      />

      <div>
        <p className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
          Technical Drawings (Optional)
        </p>

        {drawings.length > 0 && (
          <div className="space-y-2 mb-3">
            {drawings.map((drawing, index) => (
              <div
                key={`${drawing.name}-${index}`}
                className="flex items-center justify-between bg-gray-50 dark:bg-gray-700 p-2 rounded"
              >
                <span className="text-sm text-gray-900 dark:text-gray-100 truncate">
                  {drawing.name}
                </span>
                <button
                  type="button"
                  onClick={() => handleRemoveDrawing(index)}
                  className="ml-2 text-red-600 hover:text-red-800 dark:text-red-400 dark:hover:text-red-300"
                >
                  Remove
                </button>
              </div>
            ))}
          </div>
        )}

        <input
          ref={drawingInputRef}
          type="file"
          multiple
          accept={acceptedDrawingTypes}
          onChange={handleDrawingSelect}
          className="hidden"
        />
        <Button
          type="button"
          variant="secondary"
          size="sm"
          onClick={() => drawingInputRef.current?.click()}
        >
          Add Drawing
        </Button>
      </div>
    </div>
  );
}
