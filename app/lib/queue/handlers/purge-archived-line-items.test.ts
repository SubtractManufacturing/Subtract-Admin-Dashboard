import { describe, it, expect, vi, beforeEach } from "vitest";
import type { Job } from "pg-boss";

vi.mock("../../line-item-archive.server", () => ({
  purgeExpiredArchivedLineItems: vi.fn(),
}));

import { purgeExpiredArchivedLineItems } from "../../line-item-archive.server";
import { handlePurgeArchivedLineItems } from "./purge-archived-line-items";

describe("handlePurgeArchivedLineItems", () => {
  beforeEach(() => {
    vi.mocked(purgeExpiredArchivedLineItems).mockReset();
  });

  it("calls purgeExpiredArchivedLineItems once per job", async () => {
    vi.mocked(purgeExpiredArchivedLineItems).mockResolvedValue({
      purgedQuoteLineItems: 1,
      purgedOrderLineItems: 2,
      errors: [],
    });

    await handlePurgeArchivedLineItems([
      {
        id: "job-1",
        name: "purge-archived-line-items",
        data: { triggeredAt: new Date().toISOString() },
      } as Job<{ triggeredAt: string }>,
    ]);

    expect(purgeExpiredArchivedLineItems).toHaveBeenCalledTimes(1);
  });

  it("rethrows when purge fails", async () => {
    vi.mocked(purgeExpiredArchivedLineItems).mockRejectedValue(
      new Error("purge failed"),
    );

    await expect(
      handlePurgeArchivedLineItems([
        {
          id: "job-2",
          name: "purge-archived-line-items",
          data: { triggeredAt: new Date().toISOString() },
        } as Job<{ triggeredAt: string }>,
      ]),
    ).rejects.toThrow("purge failed");
  });
});
