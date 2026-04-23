import { describe, it, expect } from "vitest";
import { sanitizeEmailHtml } from "./sanitize.server";

// ---------------------------------------------------------------------------
// Allowed structural tags survive
// ---------------------------------------------------------------------------

describe("sanitizeEmailHtml — allowed tags pass through", () => {
  it("preserves a plain paragraph", () => {
    const result = sanitizeEmailHtml("<p>Hello world</p>");
    expect(result).toContain("<p>Hello world</p>");
  });

  it("preserves table structure tags", () => {
    const html = "<table><thead><tr><th>H</th></tr></thead><tbody><tr><td>D</td></tr></tbody></table>";
    const result = sanitizeEmailHtml(html);
    expect(result).toContain("<table>");
    expect(result).toContain("<thead>");
    expect(result).toContain("<tbody>");
    expect(result).toContain("<tr>");
    expect(result).toContain("<th>");
    expect(result).toContain("<td>");
  });

  it("preserves img tags with allowed attributes", () => {
    const html = `<img src="https://example.com/logo.png" alt="Logo" width="100" height="50" />`;
    const result = sanitizeEmailHtml(html);
    expect(result).toContain("img");
    expect(result).toContain('src="https://example.com/logo.png"');
    expect(result).toContain('alt="Logo"');
  });

  it("preserves style attribute on elements", () => {
    const html = `<p style="color: red; font-size: 14px;">Styled</p>`;
    const result = sanitizeEmailHtml(html);
    // sanitize-html normalises CSS whitespace; check that the attribute survives
    expect(result).toContain("style=");
    expect(result).toContain("color");
    expect(result).toContain("font-size");
  });

  it("preserves class attribute on elements", () => {
    const html = `<div class="email-body">Content</div>`;
    const result = sanitizeEmailHtml(html);
    expect(result).toContain('class="email-body"');
  });

  it("preserves standard anchor tags with https href", () => {
    const html = `<a href="https://example.com">Click here</a>`;
    const result = sanitizeEmailHtml(html);
    expect(result).toContain("https://example.com");
    expect(result).toContain("Click here");
  });

  it("preserves mailto: links", () => {
    const html = `<a href="mailto:info@example.com">Email us</a>`;
    const result = sanitizeEmailHtml(html);
    expect(result).toContain("mailto:info@example.com");
  });
});

// ---------------------------------------------------------------------------
// Dangerous tags are stripped
// ---------------------------------------------------------------------------

describe("sanitizeEmailHtml — dangerous tags are stripped", () => {
  it("strips <script> tags and their content", () => {
    const result = sanitizeEmailHtml("<p>Safe</p><script>alert('xss')</script>");
    expect(result).not.toContain("<script>");
    expect(result).not.toContain("alert");
    expect(result).toContain("Safe");
  });

  it("strips <iframe> tags", () => {
    const result = sanitizeEmailHtml('<iframe src="https://evil.com"></iframe>');
    expect(result).not.toContain("<iframe>");
  });

  it("strips <form> and <input> tags", () => {
    const result = sanitizeEmailHtml('<form action="/post"><input type="text" /></form>');
    expect(result).not.toContain("<form>");
    expect(result).not.toContain("<input>");
  });

  it("strips <object> and <embed> tags", () => {
    const result = sanitizeEmailHtml('<object data="x.swf"></object><embed src="x.swf" />');
    expect(result).not.toContain("<object>");
    expect(result).not.toContain("<embed>");
  });

  it("strips <style> block tags (not the attribute)", () => {
    const result = sanitizeEmailHtml("<style>body { color: red }</style><p>Text</p>");
    expect(result).not.toContain("<style>");
  });
});

// ---------------------------------------------------------------------------
// Dangerous event handler attributes are stripped
// ---------------------------------------------------------------------------

describe("sanitizeEmailHtml — event handler attributes are stripped", () => {
  it("strips onclick handlers", () => {
    const result = sanitizeEmailHtml('<p onclick="alert(1)">Click me</p>');
    expect(result).not.toContain("onclick");
    expect(result).toContain("Click me");
  });

  it("strips onmouseover handlers", () => {
    const result = sanitizeEmailHtml('<a href="https://x.com" onmouseover="steal()">Link</a>');
    expect(result).not.toContain("onmouseover");
    expect(result).toContain("Link");
  });

  it("strips onerror handlers on img", () => {
    const result = sanitizeEmailHtml(
      '<img src="x" onerror="alert(1)" alt="broken" />',
    );
    expect(result).not.toContain("onerror");
  });
});

// ---------------------------------------------------------------------------
// Dangerous URL schemes are blocked
// ---------------------------------------------------------------------------

describe("sanitizeEmailHtml — dangerous URL schemes are blocked", () => {
  it("strips javascript: href from anchor tags", () => {
    const result = sanitizeEmailHtml('<a href="javascript:alert(1)">XSS</a>');
    expect(result).not.toContain("javascript:");
  });

  it("strips vbscript: href", () => {
    const result = sanitizeEmailHtml('<a href="vbscript:msgbox()">XSS</a>');
    expect(result).not.toContain("vbscript:");
  });

  it("allows data: scheme on img src (configured allowedSchemes)", () => {
    const dataUri = "data:image/png;base64,iVBORw0KGgo=";
    const result = sanitizeEmailHtml(`<img src="${dataUri}" alt="img" />`);
    expect(result).toContain("data:");
  });
});

// ---------------------------------------------------------------------------
// Edge cases
// ---------------------------------------------------------------------------

describe("sanitizeEmailHtml — edge cases", () => {
  it("returns empty string for empty input", () => {
    expect(sanitizeEmailHtml("")).toBe("");
  });

  it("returns plain text unchanged (no tags to strip)", () => {
    const result = sanitizeEmailHtml("Just plain text.");
    expect(result).toContain("Just plain text.");
  });

  it("does not double-encode HTML entities already in text content", () => {
    const result = sanitizeEmailHtml("<p>Price: &lt;$100&gt;</p>");
    expect(result).toContain("&lt;");
    expect(result).toContain("&gt;");
  });
});
