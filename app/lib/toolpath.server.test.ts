import { beforeEach, describe, expect, it, vi } from "vitest";

const downloadFromS3 = vi.fn();

vi.mock("./s3.server", () => ({
  downloadFromS3,
}));

function jsonResponse(body: unknown, init?: ResponseInit) {
  return new Response(JSON.stringify(body), {
    headers: { "Content-Type": "application/json" },
    ...init,
  });
}

function mockReadyReportPolling(
  partId: string,
  programId: string,
  cutConfigId = "cfg00001",
) {
  return [
    jsonResponse({
      data: {
        id: partId,
        status: "ready",
        name: "Bracket",
        units: "in",
        currentProgramId: programId,
        failureCode: null,
        failureReason: null,
        createdAt: "2026-01-01T00:00:00.000Z",
      },
    }),
    jsonResponse({
      data: {
        programs: [
          {
            id: programId,
            url: `https://app.toolpath.com/parts/${programId}/report`,
            partId,
            status: "ready",
            cutConfigId,
            cutConfigName: "Default",
            createdAt: "2026-01-01T00:00:00.000Z",
            updatedAt: "2026-01-01T00:00:00.000Z",
          },
        ],
      },
    }),
  ];
}

describe("toolpath.server", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    process.env.TOOLPATH_API_KEY = "tp_test_123";
    globalThis.fetch = vi.fn();
    vi.useRealTimers();
  });

  it("reports whether Toolpath is configured", async () => {
    const { isToolpathEnabled } = await import("./toolpath.server");

    expect(isToolpathEnabled()).toBe(true);

    delete process.env.TOOLPATH_API_KEY;

    expect(isToolpathEnabled()).toBe(false);
  });

  it("lists cut configs from the Toolpath API", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(
      jsonResponse({
        data: {
          cutConfigs: [
            {
              id: "cfg00001",
              name: "Default Aluminum",
              createdAt: "2026-01-01T00:00:00.000Z",
              updatedAt: "2026-01-02T00:00:00.000Z",
              isDefault: true,
              readOnly: false,
              generic: false,
              toolLibraries: 1,
              tools: 42,
            },
          ],
        },
      }),
    );

    const { listCutConfigs } = await import("./toolpath.server");

    await expect(listCutConfigs()).resolves.toEqual([
      {
        id: "cfg00001",
        name: "Default Aluminum",
        createdAt: "2026-01-01T00:00:00.000Z",
        updatedAt: "2026-01-02T00:00:00.000Z",
        isDefault: true,
        readOnly: false,
        generic: false,
        toolLibraries: 1,
        tools: 42,
      },
    ]);

    expect(fetch).toHaveBeenCalledWith(
      "https://app.toolpath.com/api/public/v0/cut-configs",
      expect.objectContaining({
        method: "GET",
        headers: expect.objectContaining({
          Authorization: "Bearer tp_test_123",
        }),
      }),
    );
  });

  it("uploads a quote part and sends Idempotency-Key on Toolpath writes", async () => {
    const fileBuffer = Buffer.from("step file bytes");
    downloadFromS3.mockResolvedValueOnce(fileBuffer);

    vi.mocked(fetch)
      .mockResolvedValueOnce(
        jsonResponse(
          {
            data: {
              id: "prt00001",
              status: "processing",
              name: "Bracket",
              units: "in",
              currentProgramId: null,
              failureCode: null,
              failureReason: null,
              createdAt: "2026-01-01T00:00:00.000Z",
            },
            upload: {
              url: "https://upload.toolpath.example/part",
              method: "PUT",
              expiresAt: "2026-01-01T00:15:00.000Z",
            },
          },
          { status: 201 },
        ),
      )
      .mockResolvedValueOnce(new Response(null, { status: 200 }))
      .mockResolvedValueOnce(
        jsonResponse(
          {
            data: {
              id: "prt00001",
              status: "processing",
              name: "Bracket",
              units: "in",
              currentProgramId: null,
              failureCode: null,
              failureReason: null,
              createdAt: "2026-01-01T00:00:00.000Z",
            },
          },
          { status: 202 },
        ),
      )
      .mockResolvedValueOnce(
        mockReadyReportPolling("prt00001", "prg00001")[0],
      )
      .mockResolvedValueOnce(
        mockReadyReportPolling("prt00001", "prg00001")[1],
      );

    const { uploadQuotePartToToolpath } = await import("./toolpath.server");

    await expect(
      uploadQuotePartToToolpath({
        quotePartId: "quote-part-1",
        name: "Bracket",
        partFileUrl: "quote-parts/quote-part-1/source/bracket.step",
        cutConfigId: "cfg00001",
      }),
    ).resolves.toEqual({
      toolpathPartId: "prt00001",
      toolpathReportUrl: "https://app.toolpath.com/parts/prg00001/report",
    });

    expect(downloadFromS3).toHaveBeenCalledWith(
      "quote-parts/quote-part-1/source/bracket.step",
    );
    expect(fetch).toHaveBeenNthCalledWith(
      1,
      "https://app.toolpath.com/api/public/v0/parts",
      expect.objectContaining({
        method: "POST",
        headers: expect.objectContaining({
          "Content-Type": "application/json",
          "Idempotency-Key": "quote-part-1",
        }),
        body: JSON.stringify({
          name: "Bracket",
          units: "in",
          stepFileName: "bracket.step",
          autoCreateProgram: true,
          cutConfigIds: ["cfg00001"],
        }),
      }),
    );
    expect(fetch).toHaveBeenNthCalledWith(
      2,
      "https://upload.toolpath.example/part",
      expect.objectContaining({
        method: "PUT",
        body: new Uint8Array(fileBuffer),
      }),
    );
    expect(fetch).toHaveBeenNthCalledWith(
      3,
      "https://app.toolpath.com/api/public/v0/parts/prt00001/complete",
      expect.objectContaining({
        method: "POST",
        headers: expect.objectContaining({
          "Idempotency-Key": "quote-part-1",
        }),
      }),
    );
  });

  it("retries POST /parts on 429 using Retry-After and the same idempotency key", async () => {
    vi.useFakeTimers();
    const fileBuffer = Buffer.from("step file bytes");
    downloadFromS3.mockResolvedValueOnce(fileBuffer);

    vi.mocked(fetch)
      .mockResolvedValueOnce(
        jsonResponse(
          {
            error: {
              code: "rate_limited",
              message:
                "Too many requests. Honor the Retry-After header before retrying.",
            },
          },
          {
            status: 429,
            headers: { "Retry-After": "2" },
          },
        ),
      )
      .mockResolvedValueOnce(
        jsonResponse(
          {
            data: {
              id: "prt00002",
              status: "processing",
              name: "Bracket",
              units: "in",
              currentProgramId: null,
              failureCode: null,
              failureReason: null,
              createdAt: "2026-01-01T00:00:00.000Z",
            },
            upload: {
              url: "https://upload.toolpath.example/part",
              method: "PUT",
              expiresAt: "2026-01-01T00:15:00.000Z",
            },
          },
          { status: 201 },
        ),
      )
      .mockResolvedValueOnce(new Response(null, { status: 200 }))
      .mockResolvedValueOnce(
        jsonResponse(
          {
            data: {
              id: "prt00002",
              status: "processing",
              name: "Bracket",
              units: "in",
              currentProgramId: null,
              failureCode: null,
              failureReason: null,
              createdAt: "2026-01-01T00:00:00.000Z",
            },
          },
          { status: 202 },
        ),
      )
      .mockResolvedValueOnce(
        mockReadyReportPolling("prt00002", "prg00002")[0],
      )
      .mockResolvedValueOnce(
        mockReadyReportPolling("prt00002", "prg00002")[1],
      );

    const { resetPartCreationPacingForTests, uploadQuotePartToToolpath } =
      await import("./toolpath.server");
    resetPartCreationPacingForTests();

    const uploadPromise = uploadQuotePartToToolpath({
      quotePartId: "quote-part-2",
      name: "Bracket",
      partFileUrl: "quote-parts/quote-part-2/source/bracket.step",
      cutConfigId: "cfg00001",
    });

    await vi.advanceTimersByTimeAsync(2000);
    await expect(uploadPromise).resolves.toEqual({
      toolpathPartId: "prt00002",
      toolpathReportUrl: "https://app.toolpath.com/parts/prg00002/report",
    });

    expect(fetch).toHaveBeenNthCalledWith(
      1,
      "https://app.toolpath.com/api/public/v0/parts",
      expect.objectContaining({
        headers: expect.objectContaining({
          "Idempotency-Key": "quote-part-2",
        }),
      }),
    );
    expect(fetch).toHaveBeenNthCalledWith(
      2,
      "https://app.toolpath.com/api/public/v0/parts",
      expect.objectContaining({
        headers: expect.objectContaining({
          "Idempotency-Key": "quote-part-2",
        }),
      }),
    );
  });

  it("paces POST /parts requests at least 2 seconds apart in a batch", async () => {
    vi.useFakeTimers();
    const fileBuffer = Buffer.from("step file bytes");
    downloadFromS3.mockResolvedValue(fileBuffer);

    const createPartResponse = (id: string) =>
      jsonResponse(
        {
          data: {
            id,
            status: "processing",
            name: "Bracket",
            units: "in",
            currentProgramId: null,
            failureCode: null,
            failureReason: null,
            createdAt: "2026-01-01T00:00:00.000Z",
          },
          upload: {
            url: `https://upload.toolpath.example/${id}`,
            method: "PUT",
            expiresAt: "2026-01-01T00:15:00.000Z",
          },
        },
        { status: 201 },
      );

    const completePartResponse = (id: string) =>
      jsonResponse(
        {
          data: {
            id,
            status: "processing",
            name: "Bracket",
            units: "in",
            currentProgramId: null,
            failureCode: null,
            failureReason: null,
            createdAt: "2026-01-01T00:00:00.000Z",
          },
        },
        { status: 202 },
      );

    vi.mocked(fetch)
      .mockResolvedValueOnce(createPartResponse("prt00003"))
      .mockResolvedValueOnce(new Response(null, { status: 200 }))
      .mockResolvedValueOnce(completePartResponse("prt00003"))
      .mockResolvedValueOnce(
        mockReadyReportPolling("prt00003", "prg00003")[0],
      )
      .mockResolvedValueOnce(
        mockReadyReportPolling("prt00003", "prg00003")[1],
      )
      .mockResolvedValueOnce(createPartResponse("prt00004"))
      .mockResolvedValueOnce(new Response(null, { status: 200 }))
      .mockResolvedValueOnce(completePartResponse("prt00004"))
      .mockResolvedValueOnce(
        mockReadyReportPolling("prt00004", "prg00004")[0],
      )
      .mockResolvedValueOnce(
        mockReadyReportPolling("prt00004", "prg00004")[1],
      );

    const { resetPartCreationPacingForTests, uploadQuotePartToToolpath } =
      await import("./toolpath.server");
    resetPartCreationPacingForTests();

    const uploadOptions = {
      name: "Bracket",
      partFileUrl: "quote-parts/quote-part/source/bracket.step",
      cutConfigId: "cfg00001",
    };

    const firstUpload = uploadQuotePartToToolpath({
      quotePartId: "quote-part-3",
      ...uploadOptions,
    });
    await vi.runAllTimersAsync();
    await firstUpload;

    const postCallsAfterFirst = vi
      .mocked(fetch)
      .mock.calls.filter(
        ([url, init]) =>
          url === "https://app.toolpath.com/api/public/v0/parts" &&
          init?.method === "POST",
      ).length;
    expect(postCallsAfterFirst).toBe(1);

    const secondUpload = uploadQuotePartToToolpath({
      quotePartId: "quote-part-4",
      ...uploadOptions,
    });
    await vi.advanceTimersByTimeAsync(1999);
    await Promise.resolve();
    expect(
      vi
        .mocked(fetch)
        .mock.calls.filter(
          ([url, init]) =>
            url === "https://app.toolpath.com/api/public/v0/parts" &&
            init?.method === "POST",
        ).length,
    ).toBe(1);

    await vi.advanceTimersByTimeAsync(1);
    await vi.runAllTimersAsync();
    await secondUpload;

    expect(
      vi
        .mocked(fetch)
        .mock.calls.filter(
          ([url, init]) =>
            url === "https://app.toolpath.com/api/public/v0/parts" &&
            init?.method === "POST",
        ).length,
    ).toBe(2);
  });

  it("surfaces Toolpath error envelope messages", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(
      jsonResponse(
        {
          error: {
            code: "invalid_request",
            message: "Idempotency-Key header is required",
            requestId: "req_123",
          },
        },
        { status: 400 },
      ),
    );

    const { listCutConfigs } = await import("./toolpath.server");

    await expect(listCutConfigs()).rejects.toThrow(
      "Toolpath API error: Idempotency-Key header is required",
    );
  });

  it("resolves the program report URL instead of using the part id", async () => {
    vi.mocked(fetch)
      .mockResolvedValueOnce(
        mockReadyReportPolling("5x92lwfl", "ldxwtu50", "q9tclty6")[0],
      )
      .mockResolvedValueOnce(
        mockReadyReportPolling("5x92lwfl", "ldxwtu50", "q9tclty6")[1],
      );

    const { resolveToolpathReportUrl } = await import("./toolpath.server");

    await expect(
      resolveToolpathReportUrl({
        partId: "5x92lwfl",
        cutConfigId: "q9tclty6",
      }),
    ).resolves.toBe("https://app.toolpath.com/parts/ldxwtu50/report");
  });

  it("rejects invalid Toolpath part IDs before calling the API", async () => {
    const { resolveToolpathReportUrl } = await import("./toolpath.server");

    await expect(
      resolveToolpathReportUrl({ partId: "../secrets" }),
    ).rejects.toThrow("Invalid Toolpath part ID");
    expect(fetch).not.toHaveBeenCalled();
  });
});

describe("pollToolpathReportUrl", () => {
  it("returns report URL when part becomes ready", async () => {
    const readyPartBody = {
      data: {
        id: "5x92lwfl",
        status: "ready",
        name: "Bracket",
        units: "in",
        currentProgramId: "ldxwtu50",
        failureCode: null,
        failureReason: null,
        createdAt: "2026-01-01T00:00:00.000Z",
      },
    };
    const programsBody = {
      data: {
        programs: [
          {
            id: "ldxwtu50",
            url: "https://app.toolpath.com/parts/ldxwtu50/report",
            partId: "5x92lwfl",
            status: "ready",
            cutConfigId: "cfg00001",
            cutConfigName: "Default",
            createdAt: "2026-01-01T00:00:00.000Z",
            updatedAt: "2026-01-01T00:00:00.000Z",
          },
        ],
      },
    };

    vi.mocked(fetch)
      .mockResolvedValueOnce(jsonResponse(readyPartBody))
      .mockResolvedValueOnce(jsonResponse(readyPartBody))
      .mockResolvedValueOnce(jsonResponse(programsBody));

    const { pollToolpathReportUrl } = await import("./toolpath.server");

    await expect(
      pollToolpathReportUrl({
        partId: "5x92lwfl",
        cutConfigId: "cfg00001",
        maxWaitMs: 1000,
        intervalMs: 10,
        sleepFn: async () => undefined,
      }),
    ).resolves.toBe("https://app.toolpath.com/parts/ldxwtu50/report");
  });

  it("returns null after timeout when report never becomes ready", async () => {
    vi.mocked(fetch).mockImplementation(() =>
      Promise.resolve(
        jsonResponse({
          data: {
            id: "5x92lwfl",
            status: "processing",
            name: "Bracket",
            units: "in",
            currentProgramId: null,
            failureCode: null,
            failureReason: null,
            createdAt: "2026-01-01T00:00:00.000Z",
          },
        }),
      ),
    );

    const { pollToolpathReportUrl } = await import("./toolpath.server");

    await expect(
      pollToolpathReportUrl({
        partId: "5x92lwfl",
        cutConfigId: "cfg00001",
        maxWaitMs: 50,
        intervalMs: 10,
        sleepFn: async () => undefined,
      }),
    ).resolves.toBeNull();
  });

  it("retries through transient poll errors", async () => {
    const readyPartBody = {
      data: {
        id: "5x92lwfl",
        status: "ready",
        name: "Bracket",
        units: "in",
        currentProgramId: "ldxwtu50",
        failureCode: null,
        failureReason: null,
        createdAt: "2026-01-01T00:00:00.000Z",
      },
    };
    const programsBody = {
      data: {
        programs: [
          {
            id: "ldxwtu50",
            url: "https://app.toolpath.com/parts/ldxwtu50/report",
            partId: "5x92lwfl",
            status: "ready",
            cutConfigId: "cfg00001",
            cutConfigName: "Default",
            createdAt: "2026-01-01T00:00:00.000Z",
            updatedAt: "2026-01-01T00:00:00.000Z",
          },
        ],
      },
    };

    vi.mocked(fetch)
      .mockRejectedValueOnce(new TypeError("fetch failed"))
      .mockResolvedValueOnce(jsonResponse(readyPartBody))
      .mockResolvedValueOnce(jsonResponse(readyPartBody))
      .mockResolvedValueOnce(jsonResponse(programsBody));

    const { pollToolpathReportUrl } = await import("./toolpath.server");

    await expect(
      pollToolpathReportUrl({
        partId: "5x92lwfl",
        cutConfigId: "cfg00001",
        maxWaitMs: 1000,
        intervalMs: 10,
        sleepFn: async () => undefined,
      }),
    ).resolves.toBe("https://app.toolpath.com/parts/ldxwtu50/report");
  });
});
