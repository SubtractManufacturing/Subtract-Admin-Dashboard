export const QUEUES = {
  MOCK_JOB: "mock-job",
  CAD_CONVERSION: "cad-conversion",
  SEND_EMAIL: "send-email",
  PURGE_ARCHIVED_LINE_ITEMS: "purge-archived-line-items",
  TOOLPATH_UPLOAD: "toolpath-upload",
  TOOLPATH_REPORT_POLL: "toolpath-report-poll",
  TOOLPATH_STALE_CLEANUP: "toolpath-stale-cleanup",
} as const;

export type QueueName = (typeof QUEUES)[keyof typeof QUEUES];

export interface MockJobPayload {
  message: string;
  triggeredAt: string;
}

export interface CadConversionPayload {
  entityType: "part" | "quote_part";
  entityId: string;
}

export interface SendEmailPayload {
  sentEmailId: number;
}

export interface PurgeArchivedLineItemsPayload {
  triggeredAt: string;
}

export interface ToolpathUploadPayload {
  quotePartId: string;
  cutConfigId: string;
  quoteId: number;
  triggeredByUserId?: string;
}

export interface ToolpathReportPollPayload {
  quotePartId: string;
  toolpathPartId: string;
  cutConfigId: string;
  quoteId: number;
}

export interface ToolpathStaleCleanupPayload {
  triggeredAt: string;
}

export const DEFAULT_RETRY_OPTIONS = {
  retryLimit: 3,
  retryDelay: 15,
  retryBackoff: true,
  expireInSeconds: 300,
} as const;

export const CAD_CONVERSION_OPTIONS = {
  retryLimit: 3,
  retryDelay: 30,
  retryBackoff: true,
  expireInSeconds: 600,
} as const;

export const SEND_EMAIL_OPTIONS = {
  retryLimit: 5,
  retryDelay: 60,
  retryBackoff: true,
  expireInSeconds: 900,
} as const;

export const PURGE_ARCHIVED_LINE_ITEMS_OPTIONS = {
  retryLimit: 3,
  retryDelay: 60,
  retryBackoff: true,
  expireInSeconds: 1800,
} as const;

export const TOOLPATH_UPLOAD_OPTIONS = {
  retryLimit: 3,
  retryDelay: 30,
  retryBackoff: true,
  expireInSeconds: 300,
} as const;

export const TOOLPATH_REPORT_POLL_OPTIONS = {
  retryLimit: 5,
  retryDelay: 60,
  retryBackoff: true,
  expireInSeconds: 900,
} as const;

export const TOOLPATH_STALE_CLEANUP_OPTIONS = {
  retryLimit: 3,
  retryDelay: 60,
  retryBackoff: true,
  expireInSeconds: 300,
} as const;
