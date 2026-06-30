import { useFetcher } from "@remix-run/react";
import { useEffect, useMemo, useState } from "react";
import Modal from "~/components/shared/Modal";

interface ToolpathCutConfig {
  id: string;
  name: string;
  isDefault: boolean;
  readOnly: boolean;
  generic: boolean;
  toolLibraries: number;
  tools: number;
}

interface ToolpathUploadPart {
  id: string;
  partName: string;
  material: string | null;
  previousError?: string | null;
}

export interface ToolpathUploadSelection {
  quotePartId: string;
  cutConfigId: string;
}

export interface ToolpathUploadResult {
  quotePartId: string;
  partName: string;
  success: boolean;
  toolpathPartId?: string;
  error?: string;
}

interface CutConfigsResponse {
  cutConfigs?: ToolpathCutConfig[];
  error?: string;
}

interface ToolpathUploadModalProps {
  isOpen: boolean;
  onClose: () => void;
  parts: ToolpathUploadPart[];
  onUpload: (selections: ToolpathUploadSelection[]) => void;
  isUploading: boolean;
  uploadProgressText?: string;
  uploadError?: string | null;
  uploadResults?: ToolpathUploadResult[];
}

export default function ToolpathUploadModal({
  isOpen,
  onClose,
  parts,
  onUpload,
  isUploading,
  uploadProgressText,
  uploadError,
  uploadResults = [],
}: ToolpathUploadModalProps) {
  const cutConfigsFetcher = useFetcher<CutConfigsResponse>();
  const [selections, setSelections] = useState<Record<string, string>>({});

  useEffect(() => {
    if (!isOpen) return;

    setSelections({});
    cutConfigsFetcher.load("/toolpath/cut-configs");
  }, [cutConfigsFetcher, isOpen]);

  const cutConfigs = cutConfigsFetcher.data?.cutConfigs ?? [];
  const failedResultsByPartId = useMemo(
    () =>
      new Map(
        uploadResults
          .filter((result) => !result.success)
          .map((result) => [result.quotePartId, result]),
      ),
    [uploadResults],
  );

  const allPartsSelected =
    parts.length > 0 && parts.every((part) => selections[part.id]);
  const isLoadingConfigs =
    cutConfigsFetcher.state !== "idle" && cutConfigs.length === 0;
  const loadError = cutConfigsFetcher.data?.error;
  const canUpload =
    !isUploading && !isLoadingConfigs && !loadError && allPartsSelected;

  const handleUpload = () => {
    if (!canUpload) return;

    onUpload(
      parts.map((part) => ({
        quotePartId: part.id,
        cutConfigId: selections[part.id],
      })),
    );
  };

  const handleClose = () => {
    if (isUploading) return;
    onClose();
  };

  return (
    <Modal
      isOpen={isOpen}
      onClose={handleClose}
      title="Upload to Toolpath"
      size="xl"
    >
      <div className="space-y-4">
        <p className="text-sm text-gray-600 dark:text-gray-400">
          Select a Toolpath cut config for each quote part before uploading.
        </p>

        {loadError ? (
          <div className="rounded-md border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700 dark:border-red-900/50 dark:bg-red-900/20 dark:text-red-300">
            {loadError}
          </div>
        ) : null}

        {uploadError ? (
          <div className="rounded-md border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700 dark:border-red-900/50 dark:bg-red-900/20 dark:text-red-300">
            {uploadError}
          </div>
        ) : null}

        {uploadResults.some((result) => !result.success) ? (
          <div className="rounded-md border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800 dark:border-amber-900/50 dark:bg-amber-900/20 dark:text-amber-200">
            <p className="font-medium">Some parts failed to upload.</p>
            <ul className="mt-2 list-disc space-y-1 pl-5">
              {uploadResults
                .filter((result) => !result.success)
                .map((result) => (
                  <li key={result.quotePartId}>
                    {result.partName}: {result.error || "Upload failed"}
                  </li>
                ))}
            </ul>
          </div>
        ) : null}

        <div className="overflow-hidden rounded-lg border border-gray-200 dark:border-gray-700">
          <table className="min-w-full divide-y divide-gray-200 dark:divide-gray-700">
            <thead className="bg-gray-50 dark:bg-gray-700">
              <tr>
                <th className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wider text-gray-500 dark:text-gray-300">
                  Part Name
                </th>
                <th className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wider text-gray-500 dark:text-gray-300">
                  Part Material
                </th>
                <th className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wider text-gray-500 dark:text-gray-300">
                  Cut Config
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-200 bg-white dark:divide-gray-700 dark:bg-gray-800">
              {parts.length === 0 ? (
                <tr>
                  <td
                    colSpan={3}
                    className="px-4 py-6 text-center text-sm text-gray-500 dark:text-gray-400"
                  >
                    All parts are already uploaded or missing CAD files.
                  </td>
                </tr>
              ) : null}
              {parts.map((part) => {
                const failedResult = failedResultsByPartId.get(part.id);

                return (
                  <tr key={part.id}>
                    <td className="px-4 py-3 text-sm font-medium text-gray-900 dark:text-gray-100">
                      <div>{part.partName}</div>
                      {failedResult || part.previousError ? (
                        <div className="mt-1 text-xs font-normal text-red-600 dark:text-red-400">
                          {failedResult?.error || part.previousError}
                        </div>
                      ) : null}
                    </td>
                    <td className="px-4 py-3 text-sm text-gray-700 dark:text-gray-300">
                      {part.material || ""}
                    </td>
                    <td className="px-4 py-3">
                      <select
                        value={selections[part.id] ?? ""}
                        onChange={(event) =>
                          setSelections((current) => ({
                            ...current,
                            [part.id]: event.target.value,
                          }))
                        }
                        disabled={isUploading || isLoadingConfigs || !!loadError}
                        className="w-full rounded-md border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 shadow-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500 disabled:cursor-not-allowed disabled:opacity-60 dark:border-gray-600 dark:bg-gray-700 dark:text-gray-100"
                      >
                        <option value="">
                          {isLoadingConfigs
                            ? "Loading cut configs..."
                            : "Select cut config"}
                        </option>
                        {cutConfigs.map((config) => (
                          <option key={config.id} value={config.id}>
                            {config.name}
                            {config.isDefault ? " (Default)" : ""}
                          </option>
                        ))}
                      </select>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>

        {isUploading ? (
          <p className="text-sm text-gray-600 dark:text-gray-400">
            {uploadProgressText || `Uploading ${parts.length} part(s)...`}
          </p>
        ) : null}

        <div className="flex justify-end gap-3 pt-2">
          <button
            type="button"
            onClick={handleClose}
            disabled={isUploading}
            className="rounded border border-gray-800 bg-white px-4 py-2 font-semibold text-gray-800 transition-all hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-60 dark:border-gray-400 dark:bg-transparent dark:text-gray-200 dark:hover:bg-gray-700/30"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={handleUpload}
            disabled={!canUpload}
            className="rounded border border-transparent bg-[#2596be] px-4 py-2 font-semibold text-white transition-all hover:bg-[#1e7a9a] disabled:cursor-not-allowed disabled:opacity-60"
          >
            {isUploading ? "Uploading..." : "Upload to Toolpath"}
          </button>
        </div>
      </div>
    </Modal>
  );
}
