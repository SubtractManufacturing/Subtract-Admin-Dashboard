import { marked } from "marked";
import { sanitizeEmailHtml } from "~/lib/email/sanitize-email-html";

marked.setOptions({
  gfm: true,
  breaks: false,
});

export function renderEmailMarkdownToHtml(markdown: string): string {
  const raw = marked.parse(markdown.trim() || "", { async: false }) as string;
  return sanitizeEmailHtml(raw);
}
