import { afterEach, describe, expect, it } from "vitest";

import {
  CAD_CONVERSION_OPTIONS,
  DEFAULT_RETRY_OPTIONS,
  DRAWING_THUMBNAIL_OPTIONS,
  getRfqReceiptScanCron,
  PURGE_ARCHIVED_LINE_ITEMS_OPTIONS,
  RFQ_IMPORT_OPTIONS,
  SEND_EMAIL_OPTIONS,
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

describe("getRfqReceiptScanCron", () => {
  const originalEnv = { ...process.env };

  afterEach(() => {
    process.env = { ...originalEnv };
  });

  it("uses a one-minute cron outside production by default", () => {
    delete process.env.RFQ_RECEIPT_SCAN_CRON;
    process.env.NODE_ENV = "development";
    expect(getRfqReceiptScanCron()).toBe("*/1 * * * *");
  });

  it("uses a five-minute cron in production by default", () => {
    delete process.env.RFQ_RECEIPT_SCAN_CRON;
    process.env.NODE_ENV = "production";
    expect(getRfqReceiptScanCron()).toBe("*/5 * * * *");
  });

  it("honors RFQ_RECEIPT_SCAN_CRON when set", () => {
    process.env.RFQ_RECEIPT_SCAN_CRON = "*/2 * * * *";
    expect(getRfqReceiptScanCron()).toBe("*/2 * * * *");
  });
});
