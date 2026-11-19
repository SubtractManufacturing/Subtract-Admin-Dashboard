import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  values: new Map<string, string>(),
  failingKeys: new Set<string>(),
  clearTwentySyncLinks: vi.fn(),
}));

vi.mock("../developerSettings", () => ({
  TWENTY_SETTINGS: {
    ENABLED: "twenty_sync_enabled",
    WORKSPACE_URL: "twenty_workspace_url",
    SYNC_STARTED_AT: "twenty_sync_started_at",
    ENABLED_AT: "twenty_sync_enabled_at",
    LAST_RUN_AT: "twenty_sync_last_run_at",
  },
  getDeveloperSetting: async (key: string) => mocks.values.get(key) ?? null,
  setDeveloperSetting: async (key: string, value: string | null) => {
    if (mocks.failingKeys.has(key)) return false;
    if (value === null) mocks.values.delete(key);
    else mocks.values.set(key, value);
    return true;
  },
}));
vi.mock("../env.server", () => ({ getEnv: () => "test-key" }));
vi.mock("./store.server", () => ({
  clearTwentySyncLinks: mocks.clearTwentySyncLinks,
  withTwentySyncLock: async (run: () => Promise<unknown>) => ({
    ran: true,
    value: await run(),
  }),
}));

import { saveTwentyWorkspaceUrl } from "./settings.server";

const OLD_URL = "https://old.example.com";
const NEW_URL = "https://new.example.com";

beforeEach(() => {
  vi.clearAllMocks();
  mocks.values.clear();
  mocks.failingKeys.clear();
});

describe("saveTwentyWorkspaceUrl", () => {
  it("turns the sync off when an enabled workspace changes", async () => {
    mocks.values.set("twenty_workspace_url", OLD_URL);
    mocks.values.set("twenty_sync_enabled", "true");

    const result = await saveTwentyWorkspaceUrl(NEW_URL, "admin");

    expect(result).toEqual({ ok: true, url: NEW_URL, linksCleared: true, syncDisabled: true });
    expect(mocks.values.get("twenty_sync_enabled")).toBe("false");
    expect(mocks.clearTwentySyncLinks).toHaveBeenCalledOnce();
  });

  it("keeps the sync on when the same URL is saved again", async () => {
    mocks.values.set("twenty_workspace_url", OLD_URL);
    mocks.values.set("twenty_sync_enabled", "true");

    const result = await saveTwentyWorkspaceUrl(`${OLD_URL}/objects/people`, "admin");

    expect(result).toEqual({ ok: true, url: OLD_URL, linksCleared: false, syncDisabled: false });
    expect(mocks.values.get("twenty_sync_enabled")).toBe("true");
    expect(mocks.clearTwentySyncLinks).not.toHaveBeenCalled();
  });

  it("leaves the URL alone when the sync cannot be turned off", async () => {
    mocks.values.set("twenty_workspace_url", OLD_URL);
    mocks.values.set("twenty_sync_enabled", "true");
    mocks.failingKeys.add("twenty_sync_enabled");

    const result = await saveTwentyWorkspaceUrl(NEW_URL, "admin");

    expect(result.ok).toBe(false);
    expect(mocks.values.get("twenty_workspace_url")).toBe(OLD_URL);
    expect(mocks.clearTwentySyncLinks).not.toHaveBeenCalled();
  });
});
