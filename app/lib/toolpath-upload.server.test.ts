import { describe, it, expect, vi, beforeEach } from "vitest";

const mocks = vi.hoisted(() => ({
  mockExecute: vi.fn(),
  mockUpdate: vi.fn(),
}));

vi.mock("./db", () => ({
  db: {
    execute: mocks.mockExecute,
    update: mocks.mockUpdate,
    select: vi.fn(),
  },
}));

import { TOOLPATH_FAILED_JOB_UNBLOCK_ERROR } from "./toolpath-upload";
import { unblockFailedToolpathUploadJobs } from "./toolpath-upload.server";

function chainReturning(rows: unknown[]) {
  return {
    set: vi.fn().mockReturnThis(),
    where: vi.fn().mockReturnThis(),
    returning: vi.fn().mockResolvedValue(rows),
  };
}

describe("unblockFailedToolpathUploadJobs", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.mockUpdate.mockReturnValue(chainReturning([]));
  });

  it("reconciles stuck parts and deletes failed pg-boss jobs", async () => {
    mocks.mockExecute
      .mockResolvedValueOnce([
        {
          id: "job-failed-1",
          data: {
            quotePartId: "part-1",
            quoteId: 42,
            cutConfigId: "cfg00001",
          },
          output: {
            message: "Toolpath API not configured",
          },
        },
      ])
      .mockResolvedValueOnce([]);

    const count = await unblockFailedToolpathUploadJobs();

    expect(count).toBe(1);
    expect(mocks.mockUpdate).toHaveBeenCalledTimes(1);
    expect(mocks.mockExecute).toHaveBeenCalledTimes(2);
  });

  it("uses default error message when job output is missing", async () => {
    mocks.mockExecute
      .mockResolvedValueOnce([
        {
          id: "job-failed-2",
          data: {
            quotePartId: "part-2",
            quoteId: 7,
          },
          output: null,
        },
      ])
      .mockResolvedValueOnce([]);

    await unblockFailedToolpathUploadJobs();

    const updateChain = mocks.mockUpdate.mock.results[0]?.value;
    expect(updateChain.set).toHaveBeenCalledWith(
      expect.objectContaining({
        toolpathUploadError: TOOLPATH_FAILED_JOB_UNBLOCK_ERROR,
      }),
    );
  });

  it("returns zero when no failed jobs block the queue", async () => {
    mocks.mockExecute.mockResolvedValueOnce([]);

    const count = await unblockFailedToolpathUploadJobs();

    expect(count).toBe(0);
    expect(mocks.mockUpdate).not.toHaveBeenCalled();
    expect(mocks.mockExecute).toHaveBeenCalledTimes(1);
  });
});
