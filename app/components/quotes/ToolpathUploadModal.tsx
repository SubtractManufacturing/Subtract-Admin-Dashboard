import { useFetcher } from "@remix-run/react";
import { useEffect, useMemo, useRef, useState } from "react";
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
  toolpathReportUrl?: string | null;
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
  queuedCount?: number;
  uploadError?: string | null;
  uploadResults?: ToolpathUploadResult[];
}

export default function ToolpathUploadModal({
  isOpen,
  onClose,
  parts,
  onUpload,
  isUploading,
  queuedCount,
  uploadError,
  uploadResults = [],
}: ToolpathUploadModalProps) {
  const cutConfigsFetcher = useFetcher<CutConfigsResponse>();
  const [selections, setSelections] = useState<Record<string, string>>({});
  const cutConfigsLoadRequestedRef = useRef(false);
  const [showConfirmation, setShowConfirmation] = useState(false);
  const autoCloseTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (!isOpen) {
      cutConfigsLoadRequestedRef.current = false;
      setShowConfirmation(false);
      if (autoCloseTimerRef.current) {
        clearTimeout(autoCloseTimerRef.current);
        autoCloseTimerRef.current = null;
      }
      return;
    }

    setSelections({});

    if (cutConfigsLoadRequestedRef.current) return;
    cutConfigsLoadRequestedRef.current = true;
    cutConfigsFetcher.load("/toolpath/cut-configs");
    // Only re-fetch when the modal opens; fetcher identity changes each render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen]);

  const hasQueueFailures =
    !!uploadError ||
    uploadResults.some((result) => !result.success);

  useEffect(() => {
    if (
      isUploading ||
      queuedCount == null ||
      queuedCount <= 0 ||
      hasQueueFailures
    ) {
      return;
    }

    setShowConfirmation(true);

    if (autoCloseTimerRef.current) {
      clearTimeout(autoCloseTimerRef.current);
    }

    autoCloseTimerRef.current = setTimeout(() => {
      onClose();
    }, 3000);

    return () => {
      if (autoCloseTimerRef.current) {
        clearTimeout(autoCloseTimerRef.current);
        autoCloseTimerRef.current = null;
      }
    };
  }, [isUploading, queuedCount, hasQueueFailures, onClose]);

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
  const hasConfigResponse = cutConfigsFetcher.data !== undefined;
  const isLoadingConfigs =
    isOpen && !hasConfigResponse && cutConfigsFetcher.state !== "idle";
  const loadError = cutConfigsFetcher.data?.error;
  const canUpload =
    !isUploading &&
    !showConfirmation &&
    !isLoadingConfigs &&
    !loadError &&
    allPartsSelected;

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

  const failedResults = uploadResults.filter((result) => !result.success);

  return (
    <Modal
      isOpen={isOpen}
      onClose={handleClose}
      title="Upload to Toolpath"
      size="xl"
    >
      <div className="space-y-4">
        {showConfirmation && queuedCount != null && queuedCount > 0 ? (
          <div className="rounded-md border border-green-200 bg-green-50 px-4 py-3 text-sm text-green-800 dark:border-green-900/50 dark:bg-green-900/20 dark:text-green-200">
            <p className="font-medium">
              Queued {queuedCount} part{queuedCount === 1 ? "" : "s"} for
              Toolpath upload.
            </p>
            <p className="mt-1">
              Uploads will continue in the background. You can leave this page.
            </p>
            {failedResults.length > 0 ? (
              <ul className="mt-2 list-disc space-y-1 pl-5">
                {failedResults.map((result) => (
                  <li key={result.quotePartId}>
                    {result.partName}: {result.error || "Failed to queue"}
                  </li>
                ))}
              </ul>
            ) : null}
          </div>
        ) : (
          <>
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

            {failedResults.length > 0 && !showConfirmation ? (
              <div className="rounded-md border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800 dark:border-amber-900/50 dark:bg-amber-900/20 dark:text-amber-200">
                <p className="font-medium">Some parts could not be queued.</p>
                <ul className="mt-2 list-disc space-y-1 pl-5">
                  {failedResults.map((result) => (
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
                            disabled={
                              isUploading || isLoadingConfigs || !!loadError
                            }
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
                Uploading {parts.length} part(s)...
              </p>
            ) : null}
          </>
        )}

        <div className="flex justify-end gap-3 pt-2">
          <button
            type="button"
            onClick={handleClose}
            disabled={isUploading}
            className="rounded border border-gray-800 bg-white px-4 py-2 font-semibold text-gray-800 transition-all hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-60 dark:border-gray-400 dark:bg-transparent dark:text-gray-200 dark:hover:bg-gray-700/30"
          >
            {showConfirmation ? "Close" : "Cancel"}
          </button>
          {!showConfirmation ? (
            <button
              type="button"
              onClick={handleUpload}
              disabled={!canUpload}
              className="rounded border border-transparent bg-[#2596be] px-4 py-2 font-semibold text-white transition-all hover:bg-[#1e7a9a] disabled:cursor-not-allowed disabled:opacity-60"
            >
              {isUploading ? "Uploading..." : "Upload to Toolpath"}
            </button>
          ) : null}
        </div>
      </div>
    </Modal>
  );
}
