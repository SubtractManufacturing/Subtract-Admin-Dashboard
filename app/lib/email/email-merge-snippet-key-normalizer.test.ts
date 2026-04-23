import { describe, it, expect } from "vitest";
import { normalizeEmailSnippetKeyInput } from "./email-merge-snippet-key-normalizer";

describe("normalizeEmailSnippetKeyInput", () => {
  it("matches documented examples from the module comment", () => {
    expect(normalizeEmailSnippetKeyInput("Button Text")).toBe("button_text");
    expect(normalizeEmailSnippetKeyInput("Sign Off")).toBe("sign_off");
    expect(normalizeEmailSnippetKeyInput("myURLChunk")).toBe("myURLChunk");
    expect(normalizeEmailSnippetKeyInput("9 New Field!")).toBe("new_field");
  });

  it("collapses whitespace and hyphen runs to a single underscore", () => {
    expect(normalizeEmailSnippetKeyInput("a  b")).toBe("a_b");
    expect(normalizeEmailSnippetKeyInput("a---b")).toBe("a_b");
    expect(normalizeEmailSnippetKeyInput("a -  b")).toBe("a_b");
  });

  it("strips characters that are not ASCII letters, digits, or underscore", () => {
    expect(normalizeEmailSnippetKeyInput("foo@bar")).toBe("foobar");
    expect(normalizeEmailSnippetKeyInput("café")).toBe("caf");
  });

  it("lowercases the start of a new letter run but preserves camelCase continuations", () => {
    expect(normalizeEmailSnippetKeyInput("MyURLChunk")).toBe("myURLChunk");
  });

  it("strips leading digits and underscores so the result can match /^[a-zA-Z]\\w*$/", () => {
    expect(normalizeEmailSnippetKeyInput("123abc")).toBe("abc");
    expect(normalizeEmailSnippetKeyInput("___x")).toBe("x");
    expect(normalizeEmailSnippetKeyInput("9_42name")).toBe("name");
  });

  it("returns empty string when nothing valid remains", () => {
    expect(normalizeEmailSnippetKeyInput("")).toBe("");
    expect(normalizeEmailSnippetKeyInput("@@@")).toBe("");
    expect(normalizeEmailSnippetKeyInput("123")).toBe("");
  });
});
