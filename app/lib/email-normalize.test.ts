import { describe, expect, it } from "vitest";

import { normalizeEmail } from "./email-normalize";

describe("normalizeEmail", () => {
  it.each([
    ["jane@acme.com", "jane@acme.com"],
    ["  jane@acme.com  ", "jane@acme.com"],
    ["\tjane@acme.com\n", "jane@acme.com"],
    ["Jane@Acme.COM", "jane@acme.com"],
    ["jane\u200B@acme.com", "jane@acme.com"],
    ["\uFEFFjane@acme.com", "jane@acme.com"],
    ["jane@acme.com\u00A0", "jane@acme.com"],
    ["jane\u00A0@acme.com", "jane@acme.com"],
    ["ja\u202Fne@acme\u2007.com", "jane@acme.com"],
    ["jane@\u2060acme.com", "jane@acme.com"],
    ["jane＠acme.com", "jane@acme.com"],
    ["ｊane@acme.com", "jane@acme.com"],
    ["mailto:jane@acme.com", "jane@acme.com"],
    ["MAILTO:Jane@Acme.com", "jane@acme.com"],
    ["<jane@acme.com>", "jane@acme.com"],
    ["Jane Doe <jane@acme.com>", "jane@acme.com"],
    ["Jane\u00A0Doe\u00A0<jane@acme.com>", "jane@acme.com"],
    ["jane@acme.com.", "jane@acme.com"],
    ["jane@acme.com,", "jane@acme.com"],
    ["jane@acme.com;", "jane@acme.com"],
    ["jane@acme.com..", "jane@acme.com"],
  ])("canonicalizes %j to %j", (input, expected) => {
    expect(normalizeEmail(input)).toBe(expected);
  });

  it.each([
    ["jane+rfq@acme.com", "jane+rfq@acme.com"],
    ["first.last@gmail.com", "first.last@gmail.com"],
    ["firstlast@gmail.com", "firstlast@gmail.com"],
    ["j.a.n.e+tag@gmail.com", "j.a.n.e+tag@gmail.com"],
  ])("deliberately leaves %j untouched", (input, expected) => {
    expect(normalizeEmail(input)).toBe(expected);
  });

  it("treats gmail dot variants and plus-tags as different mailboxes", () => {
    expect(normalizeEmail("first.last@gmail.com")).not.toBe(
      normalizeEmail("firstlast@gmail.com"),
    );
    expect(normalizeEmail("jane+a@acme.com")).not.toBe(
      normalizeEmail("jane@acme.com"),
    );
  });

  it.each([
    [null],
    [undefined],
    [""],
    ["   "],
    ["\u200B\u00A0"],
    ["not an email"],
    ["jane acme.com"],
    ["mailto:"],
    ["<>"],
    ["jane @acme.com"],
  ])("returns null when %j has no usable email", (input) => {
    expect(normalizeEmail(input)).toBeNull();
  });
});
