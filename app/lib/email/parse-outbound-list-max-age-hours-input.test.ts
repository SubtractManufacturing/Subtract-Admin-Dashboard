import { describe, it, expect } from "vitest";
import { parseOutboundListMaxAgeHoursInput } from "./parse-outbound-list-max-age-hours-input";

describe("parseOutboundListMaxAgeHoursInput", () => {
  it("parses plain hours", () => {
    expect(parseOutboundListMaxAgeHoursInput("96")).toEqual({
      ok: true,
      hours: 96,
    });
    expect(parseOutboundListMaxAgeHoursInput("0")).toEqual({
      ok: true,
      hours: 0,
    });
  });

  it("parses days and weeks", () => {
    expect(parseOutboundListMaxAgeHoursInput("4d")).toEqual({
      ok: true,
      hours: 96,
    });
    expect(parseOutboundListMaxAgeHoursInput("1w")).toEqual({
      ok: true,
      hours: 168,
    });
    expect(parseOutboundListMaxAgeHoursInput("2W")).toEqual({
      ok: true,
      hours: 336,
    });
  });

  it("allows optional h suffix and whitespace", () => {
    expect(parseOutboundListMaxAgeHoursInput("12h")).toEqual({
      ok: true,
      hours: 12,
    });
    expect(parseOutboundListMaxAgeHoursInput(" 4 d ")).toEqual({
      ok: true,
      hours: 96,
    });
  });

  it("rejects invalid tokens", () => {
    const r = parseOutboundListMaxAgeHoursInput("4x");
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toBeTruthy();
  });

  it("rejects overflow after conversion", () => {
    const r = parseOutboundListMaxAgeHoursInput("600w");
    expect(r.ok).toBe(false);
  });
});
