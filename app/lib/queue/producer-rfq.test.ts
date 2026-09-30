import { describe, expect, it } from "vitest";

import { ensureRfqImportJob } from "./producer.server";

describe("RFQ import queue producer", () => {
  it("retries a failed strict-FIFO head instead of appending behind it", async () => {
    const retried: string[] = [];
    const sent: string[] = [];
    const client = {
      async findJobs() {
        return [{ id: "failed-head", state: "failed" }];
      },
      async retry(_name: string, id: string) {
        retried.push(id);
        return { requested: 1, affected: 1 };
      },
      async send() {
        sent.push("sent");
        return "new-job";
      },
    };

    await expect(
      ensureRfqImportJob(client, {
        receiptKey: "intake/018f0f7d-9f65-7eb4-bf9c-0fca82a87a10/meta/receipt.json",
      }),
    ).resolves.toEqual({
      disposition: "retried_failed",
      jobId: "failed-head",
    });
    expect(retried).toEqual(["failed-head"]);
    expect(sent).toEqual([]);
  });

  it("reuses existing runnable work instead of creating duplicate jobs", async () => {
    const sent: string[] = [];
    const client = {
      async findJobs() {
        return [{ id: "queued-job", state: "created" }];
      },
      async retry() {
        return { requested: 0, affected: 0 };
      },
      async send() {
        sent.push("sent");
        return "new-job";
      },
    };

    await expect(
      ensureRfqImportJob(client, {
        receiptKey: "intake/018f0f7d-9f65-7eb4-bf9c-0fca82a87a10/meta/receipt.json",
      }),
    ).resolves.toEqual({
      disposition: "already_queued",
      jobId: "queued-job",
    });
    expect(sent).toEqual([]);
  });
});
