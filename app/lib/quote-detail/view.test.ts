import { describe, expect, it } from "vitest";
import {
  daysUntil,
  describeQuoteReceivedResendPrompt,
  formatQuoteDate,
  formatQuoteDateTime,
  formatQuoteMoney,
  quoteSectionLocks,
  quoteStatusBadgeClasses,
  sortQuoteLineItems,
  sumLineTotals,
} from "./view";

describe("quoteSectionLocks", () => {
  it.each([
    ["RFQ", { notes: false, attachments: false, pricing: false, details: false }],
    ["Draft", { notes: false, attachments: false, pricing: false, details: false }],
    ["Dropped", { notes: false, attachments: false, pricing: false, details: false }],
    // Sent: context can still be added, but what was quoted is frozen.
    ["Sent", { notes: false, attachments: false, pricing: true, details: true }],
    ["Accepted", { notes: true, attachments: true, pricing: true, details: true }],
    ["Rejected", { notes: true, attachments: true, pricing: true, details: true }],
    ["Expired", { notes: true, attachments: true, pricing: true, details: true }],
  ])("%s", (status, expected) => {
    expect(quoteSectionLocks(status)).toEqual(expected);
  });
});

describe("quoteStatusBadgeClasses", () => {
  it("is case-insensitive and falls back to gray", () => {
    expect(quoteStatusBadgeClasses("SENT")).toContain("yellow");
    expect(quoteStatusBadgeClasses("accepted")).toContain("green");
    expect(quoteStatusBadgeClasses("Rejected")).toContain("red");
    expect(quoteStatusBadgeClasses("Expired")).toContain("orange");
    expect(quoteStatusBadgeClasses("Draft")).toContain("blue");
    for (const status of ["RFQ", "Dropped", "mystery"]) {
      expect(quoteStatusBadgeClasses(status)).toContain("gray");
    }
  });
});

describe("formatters", () => {
  it("formats money to two decimals, empty as $0.00", () => {
    expect(formatQuoteMoney("12.5")).toBe("$12.50");
    expect(formatQuoteMoney("1234.567")).toBe("$1234.57");
    expect(formatQuoteMoney(null)).toBe("$0.00");
    expect(formatQuoteMoney("")).toBe("$0.00");
  });

  it("formats dates, with a placeholder for none", () => {
    expect(formatQuoteDate(null)).toBe("--");
    expect(formatQuoteDateTime(undefined)).toBe("--");
    // Local-noon dates avoid timezone edge cases.
    expect(formatQuoteDate(new Date(2026, 2, 5, 12))).toBe("3/5/2026");
    expect(formatQuoteDate(new Date(2026, 2, 5, 12).toISOString())).toBe("3/5/2026");
    expect(formatQuoteDateTime(new Date(2026, 2, 5, 15, 7))).toBe("3/5/2026, 3:07 PM");
  });
});

describe("daysUntil", () => {
  const now = new Date("2026-03-01T00:00:00Z");

  it("rounds partial days up", () => {
    expect(daysUntil("2026-03-01T06:00:00Z", now)).toBe(1);
    expect(daysUntil("2026-03-08T00:00:00Z", now)).toBe(7);
  });

  it("is zero or negative once due or past", () => {
    expect(daysUntil("2026-03-01T00:00:00Z", now)).toBe(0);
    expect(daysUntil("2026-02-27T00:00:00Z", now)).toBe(-2);
  });

  it("is null when unset", () => {
    expect(daysUntil(null, now)).toBeNull();
    expect(daysUntil(undefined, now)).toBeNull();
  });
});

describe("line items", () => {
  it("sorts part lines before additional services, by id within each group", () => {
    const sorted = sortQuoteLineItems([
      { id: 5, quotePartId: null },
      { id: 4, quotePartId: "qp-b" },
      { id: 2, quotePartId: null },
      { id: 3, quotePartId: "qp-a" },
    ]);
    expect(sorted.map((i) => i.id)).toEqual([3, 4, 2, 5]);
  });

  it("does not mutate its input", () => {
    const input = [{ id: 2 }, { id: 1 }];
    sortQuoteLineItems(input);
    expect(input.map((i) => i.id)).toEqual([2, 1]);
  });

  it("sums totals, treating blanks and junk as zero", () => {
    expect(
      sumLineTotals([
        { totalPrice: "100.10" },
        { totalPrice: "-20.05" },
        { totalPrice: null },
        { totalPrice: "n/a" },
      ]),
    ).toBe("80.05");
    expect(sumLineTotals([])).toBe("0.00");
  });
});

describe("describeQuoteReceivedResendPrompt", () => {
  const base = { createdAt: "2026-03-01T12:00:00Z", sentAt: null, to: "a@b.co", status: "failed" };

  it("says when it was already sent", () => {
    expect(
      describeQuoteReceivedResendPrompt({ ...base, sentAt: "2026-03-02T12:00:00Z", status: "sent" }),
    ).toMatch(/^An acknowledgment was already sent on .* to a@b\.co\.$/);
  });

  it("explains pending approval, in-flight and other states", () => {
    expect(describeQuoteReceivedResendPrompt({ ...base, status: "pending_approval" })).toMatch(
      /awaiting approval\.$/,
    );
    for (const status of ["queued", "sending"]) {
      expect(describeQuoteReceivedResendPrompt({ ...base, status })).toMatch(/still in progress\.$/);
    }
    expect(describeQuoteReceivedResendPrompt(base)).toMatch(/^A prior acknowledgment request on/);
  });
});
