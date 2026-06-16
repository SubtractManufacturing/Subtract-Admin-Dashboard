import { useEffect, useMemo, useRef, useState } from "react";
import Button from "./Button";
import Modal from "./Modal";
import { formStyles } from "~/utils/tw-styles";

type PasteAttachmentModalProps = {
  isOpen: boolean;
  file: File | null;
  initialFileName: string;
  isUploading: boolean;
  error?: string;
  onClose: () => void;
  onUpload: (fileName: string) => void;
};

export function PasteAttachmentModal({
  isOpen,
  file,
  initialFileName,
  isUploading,
  error,
  onClose,
  onUpload,
}: PasteAttachmentModalProps) {
  const fileNameInputRef = useRef<HTMLInputElement>(null);
  const [fileName, setFileName] = useState(initialFileName);

  useEffect(() => {
    if (isOpen) {
      setFileName(initialFileName);
      requestAnimationFrame(() => fileNameInputRef.current?.focus());
    }
  }, [initialFileName, isOpen]);

  const previewUrl = useMemo(() => {
    if (!file) return null;
    return URL.createObjectURL(file);
  }, [file]);

  useEffect(() => {
    return () => {
      if (previewUrl) {
        URL.revokeObjectURL(previewUrl);
      }
    };
  }, [previewUrl]);

  if (!file) return null;

  const trimmedFileName = fileName.trim();
  const canUpload = trimmedFileName.length > 0 && !isUploading;

  return (
    <Modal
      isOpen={isOpen}
      onClose={isUploading ? () => undefined : onClose}
      title="Upload Pasted Image"
      size="lg"
    >
      <form
        className="space-y-4"
        onSubmit={(event) => {
          event.preventDefault();
          if (canUpload) {
            onUpload(trimmedFileName);
          }
        }}
      >
        {previewUrl && (
          <div className="rounded-lg border border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-900 p-3">
            <img
              src={previewUrl}
              alt="Pasted attachment preview"
              className="max-h-[50vh] w-full object-contain rounded"
            />
          </div>
        )}

        <div>
          <label htmlFor="pasted-attachment-file-name" className={formStyles.label}>
            File name
          </label>
          <input
            ref={fileNameInputRef}
            id="pasted-attachment-file-name"
            type="text"
            className={formStyles.input}
            value={fileName}
            onChange={(event) => setFileName(event.target.value)}
            disabled={isUploading}
          />
        </div>

        {error && (
          <p className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700 dark:border-red-700 dark:bg-red-900/20 dark:text-red-300">
            {error}
          </p>
        )}

        <div className="flex items-center justify-end gap-3 pt-2">
          <Button type="button" variant="secondary" onClick={onClose} disabled={isUploading}>
            Cancel
          </Button>
          <Button type="submit" disabled={!canUpload}>
            {isUploading ? (
              <span className="inline-flex items-center gap-2">
                <svg className="h-4 w-4 animate-spin" fill="none" viewBox="0 0 24 24">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                </svg>
                Uploading...
              </span>
            ) : (
              "Upload"
            )}
          </Button>
        </div>
      </form>
    </Modal>
  );
}
