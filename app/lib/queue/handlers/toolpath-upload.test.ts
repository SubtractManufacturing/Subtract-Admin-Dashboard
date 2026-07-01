import { describe, it, expect, vi, beforeEach } from "vitest";
import type { Job } from "pg-boss";

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
        toolpathPartId: null,
      },
    ]);
    const persistChain = chainReturning([]);

    mocks.mockUpdate
      .mockReturnValueOnce(claimChain)
      .mockReturnValueOnce(persistChain)
      .mockReturnValueOnce(persistChain);

    await handleToolpathUpload([
      {
        id: "job-1",
        name: "toolpath-upload",
        data: {
          quotePartId: "part-1",
          cutConfigId: "cfg00001",
          quoteId: 42,
        },
      } as Job<{
        quotePartId: string;
        cutConfigId: string;
        quoteId: number;
      }>,
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
      {
        id: "job-2",
        name: "toolpath-upload",
        data: {
          quotePartId: "part-1",
          cutConfigId: "cfg00001",
          quoteId: 42,
        },
      } as Job<{
        quotePartId: string;
        cutConfigId: string;
        quoteId: number;
      }>,
    ]);

    expect(mocks.mockUpload).not.toHaveBeenCalled();
    expect(mocks.mockSendPoll).not.toHaveBeenCalled();
  });
});
