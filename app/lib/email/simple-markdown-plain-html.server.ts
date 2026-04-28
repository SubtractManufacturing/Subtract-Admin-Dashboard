function escapeHtmlEntities(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/**
 * HTML MIME body for layout `simple-markdown`: visually like a plain Gmail
 * message—one block of interpolated text (no Markdown paragraph/link markup),
 * with wrapping so long URLs do not widen the viewport horizontally.
 *
 * The same string is sent as `TextBody` elsewhere; here it is HTML-escaped with
 * `white-space: pre-wrap`.
 */
export function wrapSimpleMarkdownPlainTextAsHtml(
  interpolatedPlainBody: string,
): string {
  const escaped = escapeHtmlEntities(interpolatedPlainBody);
  return `<div style="margin:0;padding:0;white-space:pre-wrap;word-wrap:break-word;overflow-wrap:anywhere;word-break:break-word;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;font-size:14px;line-height:1.5;color:#222222">${escaped}</div>`;
}
