import { beforeEach, describe, expect, it, vi } from "vitest";

const { getDeveloperSetting, sendTwentySyncJob } = vi.hoisted(() => ({
  getDeveloperSetting: vi.fn(),
  sendTwentySyncJob: vi.fn(),
}));

vi.mock("../developerSettings", () => ({
  getDeveloperSetting,
  TWENTY_SETTINGS: { ENABLED: "twenty_sync_enabled" },
}));
vi.mock("../queue/producer.server", () => ({ sendTwentySyncJob }));

import { notifyTwentySync } from "./notify.server";

const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

beforeEach(() => {
  vi.clearAllMocks();
});

describe("notifyTwentySync", () => {
  it("queues a sync with its reason when the sync is on", async () => {
    getDeveloperSetting.mockResolvedValue("true");
    sendTwentySyncJob.mockResolvedValue("job");

    notifyTwentySync("quote.converted");
    await settle();

    expect(sendTwentySyncJob).toHaveBeenCalledWith(
      expect.objectContaining({ reason: "quote.converted" }),
    );
  });

  it("queues nothing while the sync is off", async () => {
    getDeveloperSetting.mockResolvedValue("false");

    notifyTwentySync("quote.created");
    await settle();

    expect(sendTwentySyncJob).not.toHaveBeenCalled();
  });

  it("returns before the job is queued, so callers are never held up", () => {
    getDeveloperSetting.mockReturnValue(new Promise(() => {}));

    expect(notifyTwentySync("customer.created")).toBeUndefined();
  });

  it("swallows a queue failure, so it cannot fail the caller", async () => {
    const logged = vi.spyOn(console, "error").mockImplementation(() => {});
    getDeveloperSetting.mockResolvedValue("true");
    sendTwentySyncJob.mockRejectedValue(new Error("queue down"));

    expect(() => notifyTwentySync("quote.updated")).not.toThrow();
    await settle();

    expect(logged).toHaveBeenCalled();
    logged.mockRestore();
  });
});
