import { describe, it, expect, vi, beforeEach } from "vitest";
import type { JobWithMetadata } from "pg-boss";

const mocks = vi.hoisted(() => ({
  mockUpdate: vi.fn(),
  mockUpload: vi.fn(),
  mockSendPoll: vi.fn(),
  mockCreateEvent: vi.fn(),
  mockLogAlert: vi.fn(),
}));

vi.mock("../../db", () => ({
  db: {
    update: mocks.mockUpdate,
  },
}));

vi.mock("../../events", () => ({
  createEvent: mocks.mockCreateEvent,
}));

vi.mock("../producer.server", () => ({
  sendToolpathReportPollJob: mocks.mockSendPoll,
}));

vi.mock("../../toolpath.server", () => ({
  uploadQuotePartToToolpath: mocks.mockUpload,
}));

vi.mock("../../toolpath-upload.server", () => ({
  logToolpathUploadAlert: mocks.mockLogAlert,
}));

import { handleToolpathUpload } from "./toolpath-upload";

function chainReturning(rows: unknown[]) {
  const chain = {
    set: vi.fn().mockReturnThis(),
    where: vi.fn().mockReturnThis(),
    returning: vi.fn().mockResolvedValue(rows),
  };
  return chain;
}

function makeJob(
  data: {
    quotePartId: string;
    cutConfigId: string;
    quoteId: number;
  },
  retry: { retryCount: number; retryLimit: number } = {
    retryCount: 0,
    retryLimit: 3,
  },
): JobWithMetadata<typeof data> {
  return {
    id: "job-1",
    name: "toolpath-upload",
    data,
    expireInSeconds: 300,
    heartbeatSeconds: null,
    signal: new AbortController().signal,
    ...retry,
  } as unknown as JobWithMetadata<typeof data>;
}

describe("handleToolpathUpload", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.mockSendPoll.mockResolvedValue("poll-job-1");
    mocks.mockUpload.mockResolvedValue({
      toolpathPartId: "abc12345",
      toolpathReportUrl: null,
    });
    mocks.mockCreateEvent.mockResolvedValue(undefined);
  });

  it("claims queued part, uploads, and enqueues report poll job", async () => {
    const claimChain = chainReturning([
      {
        id: "part-1",
        partName: "Bracket",
        partFileUrl: "quote-parts/part-1/source/file.step",
      },
    ]);
    const persistChain = chainReturning([]);

    mocks.mockUpdate
      .mockReturnValueOnce(claimChain)
      .mockReturnValueOnce(persistChain);

    await handleToolpathUpload([
      makeJob({
        quotePartId: "part-1",
        cutConfigId: "cfg00001",
        quoteId: 42,
      }),
    ]);

    expect(mocks.mockUpload).toHaveBeenCalledWith({
      quotePartId: "part-1",
      name: "Bracket",
      partFileUrl: "quote-parts/part-1/source/file.step",
      cutConfigId: "cfg00001",
      units: "in",
      resolveReport: false,
    });
    expect(mocks.mockSendPoll).toHaveBeenCalledWith({
      quotePartId: "part-1",
      toolpathPartId: "abc12345",
      cutConfigId: "cfg00001",
      quoteId: 42,
    });
  });

  it("no-ops when part is not in queued state", async () => {
    mocks.mockUpdate.mockReturnValueOnce(chainReturning([]));

    await handleToolpathUpload([
      makeJob({
        quotePartId: "part-1",
        cutConfigId: "cfg00001",
        quoteId: 42,
      }),
    ]);

    expect(mocks.mockUpload).not.toHaveBeenCalled();
    expect(mocks.mockSendPoll).not.toHaveBeenCalled();
  });

  it("resets to queued on transient failure when retries remain", async () => {
    const claimChain = chainReturning([
      {
        id: "part-1",
        partName: "Bracket",
        partFileUrl: "quote-parts/part-1/source/file.step",
      },
    ]);
    const retryChain = chainReturning([]);

    mocks.mockUpdate
      .mockReturnValueOnce(claimChain)
      .mockReturnValueOnce(retryChain);
    mocks.mockUpload.mockRejectedValueOnce(new Error("network blip"));

    await expect(
      handleToolpathUpload([
        makeJob(
          {
            quotePartId: "part-1",
            cutConfigId: "cfg00001",
            quoteId: 42,
          },
          { retryCount: 0, retryLimit: 3 },
        ),
      ]),
    ).rejects.toThrow("network blip");

    expect(retryChain.set).toHaveBeenCalledWith(
      expect.objectContaining({
        toolpathUploadStatus: "queued",
      }),
    );
    expect(mocks.mockLogAlert).not.toHaveBeenCalled();
  });

  it("marks failed on the final retry attempt", async () => {
    const claimChain = chainReturning([
      {
        id: "part-1",
        partName: "Bracket",
        partFileUrl: "quote-parts/part-1/source/file.step",
      },
    ]);
    const failedChain = chainReturning([]);

    mocks.mockUpdate
      .mockReturnValueOnce(claimChain)
      .mockReturnValueOnce(failedChain);
    mocks.mockUpload.mockRejectedValueOnce(new Error("network blip"));

    await expect(
      handleToolpathUpload([
        makeJob(
          {
            quotePartId: "part-1",
            cutConfigId: "cfg00001",
            quoteId: 42,
          },
          { retryCount: 3, retryLimit: 3 },
        ),
      ]),
    ).rejects.toThrow("network blip");

    expect(failedChain.set).toHaveBeenCalledWith(
      expect.objectContaining({
        toolpathUploadStatus: "failed",
      }),
    );
    expect(mocks.mockLogAlert).toHaveBeenCalled();
  });
});
