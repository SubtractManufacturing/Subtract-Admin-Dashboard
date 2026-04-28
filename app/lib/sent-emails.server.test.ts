import { describe, expect, it } from "vitest";
import {
  outboundAttentionCountFromStatusCounts,
  type SentEmailStatusCounts,
} from "./sent-emails.server";

function counts(partial: Partial<SentEmailStatusCounts>): SentEmailStatusCounts {
  return {
    inFlight: 0,
    pendingApproval: 0,
    sent: 0,
    failed: 0,
    bounced: 0,
    rejected: 0,
    total: 0,
    ...partial,
  };
}

describe("outboundAttentionCountFromStatusCounts", () => {
  it("sums pending approval, failed, and bounced", () => {
    expect(
      outboundAttentionCountFromStatusCounts(
        counts({ pendingApproval: 2, failed: 1, bounced: 3 }),
      ),
    ).toBe(6);
  });

  it("ignores in-flight, sent, and rejected", () => {
    expect(
      outboundAttentionCountFromStatusCounts(
        counts({
          inFlight: 5,
          sent: 10,
          rejected: 2,
          pendingApproval: 0,
          failed: 0,
          bounced: 0,
        }),
      ),
    ).toBe(0);
  });

  it("returns zero for empty attention", () => {
    expect(outboundAttentionCountFromStatusCounts(counts({}))).toBe(0);
  });
});
