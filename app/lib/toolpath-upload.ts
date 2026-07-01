export const TOOLPATH_UPLOAD_STATUS = {
  QUEUED: "queued",
  IN_PROGRESS: "in_progress",
  PROCESSING: "processing",
  FAILED: "failed",
} as const;

export type ToolpathUploadStatus =
  (typeof TOOLPATH_UPLOAD_STATUS)[keyof typeof TOOLPATH_UPLOAD_STATUS];

export const TOOLPATH_IN_FLIGHT_STATUSES: ToolpathUploadStatus[] = [
  TOOLPATH_UPLOAD_STATUS.QUEUED,
  TOOLPATH_UPLOAD_STATUS.IN_PROGRESS,
  TOOLPATH_UPLOAD_STATUS.PROCESSING,
];

export const TOOLPATH_PART_CREATION_SINGLETON_KEY = "toolpath-part-creation";

export const TOOLPATH_STALE_QUEUED_MS = 5 * 60 * 1000;

export const TOOLPATH_REPORT_POLL_INTERVAL_MS = 5_000;

export const TOOLPATH_REPORT_POLL_MAX_MS = 10 * 60 * 1000;

export const TOOLPATH_STALE_QUEUED_ERROR =
  "Upload never started — worker may not be running";

export const TOOLPATH_REPORT_TIMEOUT_ERROR =
  "Toolpath report not ready after 10 minutes";

export function isToolpathUploadInFlight(
  status: string | null | undefined,
): boolean {
  return (
    !!status &&
    TOOLPATH_IN_FLIGHT_STATUSES.includes(status as ToolpathUploadStatus)
  );
}
