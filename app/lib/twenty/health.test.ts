import { describe, expect, it } from "vitest";

import {
  explainTwentyFailure,
  formatTimeAgo,
  OVERDUE_AFTER_MINUTES,
  twentySyncHealth,
  type TwentyHealthInput,
} from "./health";

const NOW = new Date("2026-11-03T12:00:00.000Z");
const minutesAgo = (minutes: number) =>
  new Date(NOW.getTime() - minutes * 60_000).toISOString();

const healthy: TwentyHealthInput = {
  enabled: true,
  workspaceUrl: "https://api.twenty.com",
  apiKeyConfigured: true,
  lastRunAt: minutesAgo(1),
  enabledAt: minutesAgo(600),
  failureCount: 0,
  warningCount: 0,
  pendingCount: 0,
};

const stateOf = (input: Partial<TwentyHealthInput>) =>
  twentySyncHealth({ ...healthy, ...input }, NOW).state;

describe("twentySyncHealth", () => {
  it("reports a working sync", () => {
    expect(stateOf({})).toBe("healthy");
  });

  it("asks for setup before anything else", () => {
    expect(stateOf({ apiKeyConfigured: false, failureCount: 3 })).toBe("setup");
    expect(stateOf({ workspaceUrl: "" })).toBe("setup");
  });

  it("reports off even when the last run is old", () => {
    expect(stateOf({ enabled: false, lastRunAt: minutesAgo(900) })).toBe("off");
  });

  it("does not call a switched-on sync healthy once runs stop", () => {
    const health = twentySyncHealth({ ...healthy, lastRunAt: minutesAgo(300) }, NOW);
    expect(health.state).toBe("stopped");
    expect(health.detail).toContain("5 hours ago");
  });

  it("puts a stopped sync ahead of older failures", () => {
    expect(stateOf({ lastRunAt: minutesAgo(300), failureCount: 2 })).toBe("stopped");
  });

  it("gives a sync time before calling it stopped", () => {
    expect(stateOf({ lastRunAt: minutesAgo(OVERDUE_AFTER_MINUTES - 1) })).toBe("healthy");
    expect(stateOf({ lastRunAt: minutesAgo(OVERDUE_AFTER_MINUTES + 1) })).toBe("stopped");
  });

  it("does not call a sync stopped just after it is turned back on", () => {
    expect(stateOf({ lastRunAt: minutesAgo(3000), enabledAt: minutesAgo(1) })).toBe("healthy");
    expect(stateOf({ lastRunAt: null, enabledAt: minutesAgo(1) })).toBe("healthy");
  });

  it("calls a sync that never ran stopped once it should have", () => {
    expect(stateOf({ lastRunAt: null, enabledAt: minutesAgo(60) })).toBe("stopped");
  });

  it("summarizes what needs attention", () => {
    const health = twentySyncHealth({ ...healthy, failureCount: 1, warningCount: 2 }, NOW);
    expect(health.state).toBe("attention");
    expect(health.detail).toContain("1 record blocked and 2 customers with missing details");
  });

  it("shows waiting records as catching up", () => {
    expect(stateOf({ pendingCount: 4 })).toBe("catching_up");
  });
});

describe("explainTwentyFailure", () => {
  it.each([
    "Could not reach Twenty (TimeoutError)",
    "Twenty returned 503",
    "Twenty returned 429",
  ])("treats %s as fixing itself", (error) => {
    expect(explainTwentyFailure(error).retriesItself).toBe(true);
  });

  it("does not show raw JSON as the summary", () => {
    const { summary, retriesItself } = explainTwentyFailure(
      'Twenty returned 400: {"statusCode":400,"messages":["Invalid value"]}',
    );
    expect(summary).not.toContain("{");
    expect(retriesItself).toBe(false);
  });

  it("explains a refused key and duplicates", () => {
    expect(explainTwentyFailure("Twenty returned 401").summary).toContain("API key");
    expect(
      explainTwentyFailure("Several Twenty opportunities carry ERP quote ID 5.").summary,
    ).toContain("more than one opportunity");
  });

  it("has a fallback", () => {
    expect(explainTwentyFailure(null).retriesItself).toBe(false);
  });
});

describe("formatTimeAgo", () => {
  it.each([
    [null, "Never"],
    [minutesAgo(0), "Just now"],
    [minutesAgo(1), "1 minute ago"],
    [minutesAgo(59), "59 minutes ago"],
    [minutesAgo(60), "1 hour ago"],
    [minutesAgo(300), "5 hours ago"],
    [minutesAgo(4320), "3 days ago"],
  ])("formats %s", (iso, expected) => {
    expect(formatTimeAgo(iso, NOW)).toBe(expected);
  });
});
