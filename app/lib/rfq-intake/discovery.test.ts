import { describe, expect, it } from "vitest";

import { scanForReceipts } from "./discovery";
import type { ImportLedgerSummary, RfqQueue, RfqStorage } from "./types";

const RECEIPT_A =
  "intake/018f0f7d-9f65-7eb4-bf9c-0fca82a87a10/meta/receipt.json";
const RECEIPT_B =
  "intake/018f0f7d-9f65-7eb4-bf9c-0fca82a87a11/meta/receipt.json";
const RECEIPT_C =
  "intake/018f0f7d-9f65-7eb4-bf9c-0fca82a87a12/meta/receipt.json";
const RECEIPT_D =
  "intake/018f0f7d-9f65-7eb4-bf9c-0fca82a87a13/meta/receipt.json";

function storagePages(pages: string[][]): Pick<RfqStorage, "list"> {
  return {
    async list(_prefix, cursor) {
      const pageIndex = cursor ? Number(cursor) : 0;
      return {
        objects: pages[pageIndex].map((key) => ({
          key,
          size: 1,
          contentType: "application/json",
          etag: `etag-${key}`,
          lastModified: new Date("2026-09-21T00:00:00Z"),
        })),
        nextCursor: pageIndex + 1 < pages.length ? String(pageIndex + 1) : null,
      };
    },
  };
}

describe("receipt discovery", () => {
  it("paginates intake objects and enqueues only new or due receipts", async () => {
    const enqueued: string[] = [];
    const queue: RfqQueue = {
      async enqueue(receiptKey) {
        enqueued.push(receiptKey);
      },
      async enqueueDerivedAssets() {},
    };
    const summaries = new Map<string, ImportLedgerSummary>([
      [RECEIPT_B, { status: "completed", nextAttemptAt: null }],
      [RECEIPT_D, { status: "cleanup_pending", nextAttemptAt: null }],
      [
        RECEIPT_C,
        { status: "retry_scheduled", nextAttemptAt: new Date("2026-09-20T23:59:00Z") },
      ],
    ]);

    const outcome = await scanForReceipts({
      enabled: true,
      storage: storagePages([
        [RECEIPT_A, "intake/session/parts/model.step"],
        [RECEIPT_B, RECEIPT_C, RECEIPT_D],
      ]),
      queue,
      now: () => new Date("2026-09-21T00:00:00Z"),
      getLedgerSummaries: async (keys) =>
        new Map(keys.flatMap((key) => (summaries.has(key) ? [[key, summaries.get(key)!]] : []))),
    });

    expect(outcome).toEqual({ discovered: 4, enqueued: 3, skipped: 1 });
    expect(enqueued).toEqual([RECEIPT_A, RECEIPT_C, RECEIPT_D]);
  });

  it("does not enqueue future retries or duplicate keys returned across pages", async () => {
    const enqueued: string[] = [];

    const outcome = await scanForReceipts({
      enabled: true,
      storage: storagePages([[RECEIPT_A], [RECEIPT_A]]),
      queue: {
        async enqueue(key) {
          enqueued.push(key);
        },
      },
      now: () => new Date("2026-09-21T00:00:00Z"),
      getLedgerSummaries: async () =>
        new Map([
          [
            RECEIPT_A,
            {
              status: "retry_scheduled",
              nextAttemptAt: new Date("2026-09-22T00:00:00Z"),
            },
          ],
        ]),
    });

    expect(outcome).toEqual({ discovered: 1, enqueued: 0, skipped: 1 });
    expect(enqueued).toEqual([]);
  });
});
