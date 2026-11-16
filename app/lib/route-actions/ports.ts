/**
 * Ports shared by the Quote and Order detail seams.
 * Production adapters: `./adapters.server.ts`.
 */
import type { EventLogInput } from "~/lib/events";

/** Object storage (S3). */
export type FilesPort = {
  upload(input: {
    key: string;
    buffer: Buffer;
    contentType: string;
    fileName: string;
  }): Promise<{
    key: string;
    bucket: string;
    fileName: string;
    contentType: string;
    size: number;
  }>;
  delete(key: string): Promise<void>;
  /** Time-limited download link for a stored object (default one hour). */
  signedUrl(key: string, expiresInSeconds?: number): Promise<string>;
  /** Storage key for an attachment on entity `entityId`. */
  keyFor(entityId: number, fileName: string): string;
};

/** Audit/timeline events. */
export type EventsPort = {
  create(event: EventLogInput): Promise<unknown>;
};
