import { describe, expect, it } from "vitest";

import {
  canRetryRfqSubmission,
  parseRfqSubmissionStatusGroup,
  retryRfqIntakeSubmission,
} from "./submissions.server";

describe("RFQ intake submissions interface", () => {
  it("maps the supported status groups and defaults unknown values to all", () => {
    expect(parseRfqSubmissionStatusGroup("in_progress")).toBe("in_progress");
    expect(parseRfqSubmissionStatusGroup("failed")).toBe("failed");
    expect(parseRfqSubmissionStatusGroup("completed")).toBe("completed");
    expect(parseRfqSubmissionStatusGroup("other")).toBe("all");
  });

  it("offers retry only for scheduled retries and permanent failures", () => {
    expect(canRetryRfqSubmission("retry_scheduled")).toBe(true);
    expect(canRetryRfqSubmission("permanent_failure")).toBe(true);
    expect(canRetryRfqSubmission("pending")).toBe(false);
    expect(canRetryRfqSubmission("processing")).toBe(false);
    expect(canRetryRfqSubmission("cleanup_pending")).toBe(false);
    expect(canRetryRfqSubmission("completed")).toBe(false);
  });

  it("refuses retry for ordinary users before reading the submission", async () => {
    await expect(
      retryRfqIntakeSubmission("intake/forged/meta/receipt.json", {
        userId: "ordinary-user",
        role: "User",
      }),
    ).rejects.toMatchObject({ status: 403 });
  });
});
