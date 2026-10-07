export const QUEUES = {
  MOCK_JOB: "mock-job",
  CAD_CONVERSION: "cad-conversion",
  SEND_EMAIL: "send-email",
  PURGE_ARCHIVED_LINE_ITEMS: "purge-archived-line-items",
  RFQ_IMPORT: "rfq-import",
  RFQ_RECEIPT_SCAN: "rfq-receipt-scan",
  DRAWING_THUMBNAIL: "drawing-thumbnail",
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

export interface RfqImportPayload {
  receiptKey: string;
}

export interface RfqReceiptScanPayload {
  triggeredAt: string;
}

export interface DrawingThumbnailPayload {
  attachmentId: string;
}

export const RFQ_IMPORT_OPTIONS = {
  // The import ledger owns the bounded retry schedule.
  retryLimit: 0,
  // Recover promptly when a dev-worker restart or process crash abandons an active job.
  heartbeatSeconds: 60,
  // pg-boss rejects job expirations longer than 24 hours.
  expireInSeconds: 24 * 60 * 60,
} as const;

export const DRAWING_THUMBNAIL_OPTIONS = {
  retryLimit: 3,
  retryDelay: 30,
  retryBackoff: true,
  expireInSeconds: 600,
} as const;

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
