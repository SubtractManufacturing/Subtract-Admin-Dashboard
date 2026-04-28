import { describe, it, expect } from "vitest";
import { wrapSimpleMarkdownPlainTextAsHtml } from "./simple-markdown-plain-html.server";

describe("wrapSimpleMarkdownPlainTextAsHtml", () => {
  it("escapes HTML and uses pre-wrap for line breaks", () => {
    const html = wrapSimpleMarkdownPlainTextAsHtml("a < b\nok");
    expect(html).toContain("a &lt; b");
    expect(html).not.toContain("<b>");
    expect(html).toContain("white-space:pre-wrap");
  });

  it("breaks long unbroken segments without injecting raw HTML tags", () => {
    const html = wrapSimpleMarkdownPlainTextAsHtml(
      "https://example.com/path?x=" + "a".repeat(200),
    );
    expect(html).toContain("overflow-wrap:anywhere");
    expect(html).not.toContain("<script>");
  });
});
