import React from "react";
import type { EmailLayoutDefinition } from "../layout-definition";
import { renderEmailMarkdownToHtml } from "../markdown-email";

export type SimpleMarkdownBodyCopy = {
  body: string;
};

export type SimpleMarkdownEmailProps = {
  copy: SimpleMarkdownBodyCopy;
};

const bodyMarkdownSlotHelp =
  "Supports headings, bold, italic, lists, and links while editing; the delivered message reads like a plain text email (no rich layout). Line breaks match the editor.";

export const simpleMarkdownLayoutDefinition = {
  slots: [
    {
      id: "body",
      type: "markdown",
      required: false,
      emptyBehavior: "renderEmpty",
      adminLabel: "Body",
      adminHelpText: bodyMarkdownSlotHelp,
      placeholder: "Write your message…",
      defaultValue:
        "Hi {{customerName}},\n\n{{default_signature}}",
      allowPerSendEdit: true,
    },
  ],
} as const satisfies EmailLayoutDefinition;

/**
 * Markdown rendering drives the plain-text MIME part from `@react-email/render`.
 * Outbound `HtmlBody` is replaced in `build-email-content` with a minimal
 * plain-text-as-HTML wrapper for a Gmail-like look in the inbox.
 */
export const SimpleMarkdownEmail: React.FC<SimpleMarkdownEmailProps> = ({
  copy,
}) => {
  const bodyHtml = renderEmailMarkdownToHtml(copy.body);
  return (
    <div
      data-slot-id="body"
      style={{
        margin: 0,
        padding: 0,
        fontSize: "14px",
        lineHeight: "1.5",
        color: "#222222",
        fontFamily:
          "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif",
        wordBreak: "break-word",
        overflowWrap: "anywhere",
      }}
      dangerouslySetInnerHTML={{
        __html: copy.body.trim().length > 0 ? bodyHtml : "",
      }}
    />
  );
};
