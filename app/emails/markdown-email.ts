import { marked } from "marked";
import { sanitizeEmailHtml } from "~/lib/email/sanitize-email-html";

marked.setOptions({
  gfm: true,
  // Single newlines → <br> so plain-text-style templates (e.g. styled-quote) keep line breaks.
  breaks: true,
});

export function renderEmailMarkdownToHtml(markdown: string): string {
  const raw = marked.parse(markdown.trim() || "", { async: false }) as string;
  return sanitizeEmailHtml(raw);
}
