import { describe, expect, it } from "vitest";

import {
  CAD_CONVERSION_OPTIONS,
  DEFAULT_RETRY_OPTIONS,
  DRAWING_THUMBNAIL_OPTIONS,
  PURGE_ARCHIVED_LINE_ITEMS_OPTIONS,
  RFQ_IMPORT_OPTIONS,
  SEND_EMAIL_OPTIONS,
  TOOLPATH_REPORT_POLL_OPTIONS,
  TOOLPATH_STALE_CLEANUP_OPTIONS,
  TOOLPATH_UPLOAD_OPTIONS,
} from "./types";

const PGBOSS_MAX_EXPIRATION_SECONDS = 24 * 60 * 60;

describe("pg-boss queue options", () => {
  const queueOptions = {
    CAD_CONVERSION_OPTIONS,
    DEFAULT_RETRY_OPTIONS,
    DRAWING_THUMBNAIL_OPTIONS,
    PURGE_ARCHIVED_LINE_ITEMS_OPTIONS,
    RFQ_IMPORT_OPTIONS,
    SEND_EMAIL_OPTIONS,
    TOOLPATH_REPORT_POLL_OPTIONS,
    TOOLPATH_STALE_CLEANUP_OPTIONS,
    TOOLPATH_UPLOAD_OPTIONS,
  };

  it.each(Object.entries(queueOptions))(
    "%s stays within pg-boss's maximum expiration",
    (_name, options) => {
      expect(options.expireInSeconds).toBeLessThanOrEqual(
        PGBOSS_MAX_EXPIRATION_SECONDS,
      );
    },
  );

  it("detects an abandoned RFQ worker without waiting for the 24-hour expiration", () => {
    expect(RFQ_IMPORT_OPTIONS.heartbeatSeconds).toBe(60);
  });
});
