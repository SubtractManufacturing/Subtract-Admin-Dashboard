import type { Job } from "pg-boss";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  buildTwentyClient: vi.fn(),
  getTwentySettings: vi.fn(),
  runTwentySync: vi.fn(),
  setDeveloperSetting: vi.fn(),
  withTwentySyncLock: vi.fn(),
}));

vi.mock("../../developerSettings", () => ({
  setDeveloperSetting: mocks.setDeveloperSetting,
  TWENTY_SETTINGS: { LAST_RUN_AT: "twenty_sync_last_run_at" },
}));
vi.mock("../../twenty/settings.server", () => ({
  buildTwentyClient: mocks.buildTwentyClient,
  getTwentySettings: mocks.getTwentySettings,
}));
vi.mock("../../twenty/store.server", () => ({
  postgresTwentySyncStore: {},
  withTwentySyncLock: mocks.withTwentySyncLock,
}));
vi.mock("../../twenty/sync.server", () => ({ runTwentySync: mocks.runTwentySync }));

import type { TwentySyncPayload } from "../types";
import { handleTwentySync } from "./twenty-sync";

const job = { id: "job" } as Job<TwentySyncPayload>;
const settings = {
  enabled: true,
  workspaceUrl: "http://localhost:3000",
  syncStartedAt: new Date("2026-11-01T00:00:00.000Z"),
};

beforeEach(() => {
  vi.clearAllMocks();
  mocks.getTwentySettings.mockResolvedValue(settings);
  mocks.buildTwentyClient.mockReturnValue({});
  mocks.runTwentySync.mockResolvedValue({ synced: 0, failed: 0, stoppedEarly: false });
  mocks.withTwentySyncLock.mockImplementation(async (run: () => Promise<unknown>) => ({
    ran: true,
    value: await run(),
  }));
});

describe("handleTwentySync", () => {
  it("reads the workspace only once it holds the lock", async () => {
    const order: string[] = [];
    mocks.withTwentySyncLock.mockImplementation(async (run: () => Promise<unknown>) => {
      order.push("locked");
      return { ran: true, value: await run() };
    });
    mocks.getTwentySettings.mockImplementation(async () => {
      order.push("settings");
      return settings;
    });

    await handleTwentySync([job]);

    expect(order).toEqual(["locked", "settings"]);
  });

  it("uses a workspace changed while it waited for the lock", async () => {
    mocks.withTwentySyncLock
      .mockResolvedValueOnce({ ran: false })
      .mockImplementationOnce(async (run: () => Promise<unknown>) => {
        mocks.getTwentySettings.mockResolvedValue({
          ...settings,
          workspaceUrl: "https://api.twenty.com",
        });
        return { ran: true, value: await run() };
      });

    vi.useFakeTimers();
    const handled = handleTwentySync([job]);
    await vi.runAllTimersAsync();
    await handled;
    vi.useRealTimers();

    expect(mocks.buildTwentyClient).toHaveBeenCalledTimes(1);
    expect(mocks.buildTwentyClient).toHaveBeenCalledWith("https://api.twenty.com");
  });

  it("skips a sync turned off while it waited for the lock", async () => {
    mocks.getTwentySettings.mockResolvedValue({ ...settings, enabled: false });

    await handleTwentySync([job]);

    expect(mocks.runTwentySync).not.toHaveBeenCalled();
    expect(mocks.setDeveloperSetting).not.toHaveBeenCalled();
  });

  it("records the run when it finishes", async () => {
    await handleTwentySync([job]);

    expect(mocks.runTwentySync).toHaveBeenCalledTimes(1);
    expect(mocks.setDeveloperSetting).toHaveBeenCalledTimes(1);
  });
});
