export const QUEUES = {
  MOCK_JOB: "mock-job",
} as const;

export type QueueName = (typeof QUEUES)[keyof typeof QUEUES];

export interface MockJobPayload {
  message: string;
  triggeredAt: string;
}

// Explicit retry config to keep behavior predictable across queues.
export const DEFAULT_RETRY_OPTIONS = {
  retryLimit: 3,
  retryDelay: 15,
  retryBackoff: true,
  expireInSeconds: 300,
} as const;
