import { describe, it, expect, vi, beforeEach } from "vitest";
import type { Job } from "pg-boss";

vi.mock("../../toolpath-upload.server", () => ({
  failStaleToolpathQueuedParts: vi.fn(),
  unblockFailedToolpathUploadJobs: vi.fn(),
}));

import {
  failStaleToolpathQueuedParts,
  unblockFailedToolpathUploadJobs,
} from "../../toolpath-upload.server";
import { handleToolpathStaleCleanup } from "./toolpath-stale-cleanup";

describe("handleToolpathStaleCleanup", () => {
  beforeEach(() => {
    vi.mocked(failStaleToolpathQueuedParts).mockReset();
    vi.mocked(unblockFailedToolpathUploadJobs).mockReset();
  });

  it("runs stale-part cleanup and failed-job unblocking", async () => {
    vi.mocked(failStaleToolpathQueuedParts).mockResolvedValue(2);
    vi.mocked(unblockFailedToolpathUploadJobs).mockResolvedValue(1);

    await handleToolpathStaleCleanup([
      {
        id: "job-1",
        name: "toolpath-stale-cleanup",
        data: { triggeredAt: new Date().toISOString() },
      } as Job<{ triggeredAt: string }>,
    ]);

    expect(failStaleToolpathQueuedParts).toHaveBeenCalledTimes(1);
    expect(unblockFailedToolpathUploadJobs).toHaveBeenCalledTimes(1);
  });
});
