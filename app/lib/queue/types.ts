export const QUEUES = {
  MOCK_JOB: "mock-job",
  CAD_CONVERSION: "cad-conversion",
  SEND_EMAIL: "send-email",
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
