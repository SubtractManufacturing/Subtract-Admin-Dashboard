import { useState, useCallback, useRef } from "react";

interface UseDownloadOptions {
  onStart?: () => void;
  onComplete?: (filename: string) => void;
  onError?: (error: Error) => void;
}

interface UseDownloadReturn {
  /** Trigger a download from a URL. The file is fetched as a blob and saved via a programmatic anchor click. */
  download: (url: string, fallbackFilename?: string) => Promise<void>;
  /** True while a download is in progress. */
  isDownloading: boolean;
  /** The last error that occurred, if any. */
  error: Error | null;
}

/**
 * Hook for triggering file downloads without opening a new tab.
 *
 * Uses `fetch()` → blob → programmatic `<a>` click so the user stays
 * on the current page and all file types (STEP/CAD, ZIP, etc.) are
 * handled correctly via the `Content-Disposition` header.
 *
 * @example
 * ```tsx
 * const { download, isDownloading } = useDownload({
 *   onError: (err) => toast.error(`Download failed: ${err.message}`),
 * });
 *
 * <button
 *   onClick={() => download(`/download/attachment/${id}`)}
 *   disabled={isDownloading}
 * >
 *   {isDownloading ? "Downloading..." : "Download"}
 * </button>
 * ```
 */
export function useDownload(options?: UseDownloadOptions): UseDownloadReturn {
  const [isDownloading, setIsDownloading] = useState(false);
  const [error, setError] = useState<Error | null>(null);

  // Store options in a ref so callers don't need to memoize them
  const optionsRef = useRef(options);
  optionsRef.current = options;

  const download = useCallback(
    async (url: string, fallbackFilename = "download") => {
      setIsDownloading(true);
      setError(null);
      optionsRef.current?.onStart?.();

      try {
        const response = await fetch(url);

        if (!response.ok) {
          // Try to extract a meaningful error message from the response
          let message = `Download failed: ${response.statusText}`;
          try {
            const text = await response.text();
            if (text) message = text;
          } catch {
            // ignore – use the default message
          }
          throw new Error(message);
        }

        // Extract filename from Content-Disposition header
        const disposition = response.headers.get("Content-Disposition");
        const filenameMatch = disposition?.match(
          /filename[^;=\n]*=((['"]).*?\2|[^;\n]*)/
        );
        const filename =
          filenameMatch?.[1]?.replace(/['"]/g, "") || fallbackFilename;

        // Create blob and trigger download
        const blob = await response.blob();
        const objectUrl = URL.createObjectURL(blob);

        const a = document.createElement("a");
        a.href = objectUrl;
        a.download = filename;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);

        // Clean up the object URL after a short delay
        setTimeout(() => URL.revokeObjectURL(objectUrl), 100);

        optionsRef.current?.onComplete?.(filename);
      } catch (err) {
        const downloadError =
          err instanceof Error ? err : new Error("Download failed");
        setError(downloadError);
        optionsRef.current?.onError?.(downloadError);
      } finally {
        setIsDownloading(false);
      }
    },
    []
  );

  return { download, isDownloading, error };
}
