import sanitizeHtml from "sanitize-html";

/** Safe on client and server (used by email previews and outbound HTML). */
export function sanitizeEmailHtml(html: string): string {
  return sanitizeHtml(html, {
    allowedTags: [
      ...sanitizeHtml.defaults.allowedTags,
      "img",
      "table",
      "thead",
      "tbody",
      "tr",
      "td",
      "th",
    ],
    allowedAttributes: {
      ...sanitizeHtml.defaults.allowedAttributes,
      img: ["src", "alt", "width", "height"],
      "*": ["style", "class"],
    },
    allowedSchemes: ["https", "http", "mailto", "data"],
    // strips all on* handlers, <script>, <iframe>, <form>, javascript: href
  });
}
