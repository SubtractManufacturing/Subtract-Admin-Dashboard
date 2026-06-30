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

describe("toolpath.server", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    process.env.TOOLPATH_API_KEY = "tp_test_123";
    globalThis.fetch = vi.fn();
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
    vi.spyOn(crypto, "randomUUID").mockReturnValue(
      "00000000-0000-4000-8000-000000000001",
    );

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
      );

    const { uploadQuotePartToToolpath } = await import("./toolpath.server");

    await expect(
      uploadQuotePartToToolpath({
        quotePartId: "quote-part-1",
        name: "Bracket",
        partFileUrl: "quote-parts/quote-part-1/source/bracket.step",
        cutConfigId: "cfg00001",
      }),
    ).resolves.toEqual({ toolpathPartId: "prt00001" });

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
          "Idempotency-Key": "00000000-0000-4000-8000-000000000001",
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
          "Idempotency-Key": "00000000-0000-4000-8000-000000000001",
        }),
      }),
    );
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
});
