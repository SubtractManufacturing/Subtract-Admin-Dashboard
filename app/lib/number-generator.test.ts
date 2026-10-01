import { describe, expect, it } from "vitest";

import { nextQuoteNumberFromExisting } from "./number-generator";

describe("nextQuoteNumberFromExisting", () => {
  const now = new Date("2026-09-21T12:00:00Z");

  it("uses the largest matching sequence regardless of query order", () => {
    expect(
      nextQuoteNumberFromExisting(
        ["Q269-A104", "Q269-A101", "Q268-Z999", "not-a-quote"],
        now,
      ),
    ).toBe("Q269-A105");
  });

  it("advances the letter after sequence 999", () => {
    expect(nextQuoteNumberFromExisting(["Q269-A999"], now)).toBe("Q269-B100");
  });

  it("starts a new month at A100", () => {
    expect(nextQuoteNumberFromExisting(["Q268-Z999"], now)).toBe("Q269-A100");
  });
});
