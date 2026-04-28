import React from "react";
import type { EmailLayoutDefinition } from "../layout-definition";
import { renderEmailMarkdownToHtml } from "../markdown-email";

export type BrandedMarkdownBodyCopy = {
  body: string;
};

export type BrandedMarkdownEmailProps = {
  logoUrl: string;
  copy: BrandedMarkdownBodyCopy;
};

const bodyMarkdownSlotHelp =
  "Supports headings, bold, italic, lists, and links. A single line break in the editor becomes a new line in the email.";

export const brandedMarkdownLayoutDefinition = {
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

const bodyTextStyle = {
  fontSize: "16px",
  lineHeight: "1.65",
  color: "#333333",
} as const;

export const BrandedMarkdownEmail: React.FC<BrandedMarkdownEmailProps> = ({
  logoUrl,
  copy,
}) => {
  const bodyHtml = renderEmailMarkdownToHtml(copy.body);
  return (
    <div
      style={{
        margin: 0,
        padding: "32px 16px",
        width: "100%",
        backgroundColor: "#f7f7f5",
        fontFamily:
          "Inter, -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif",
        color: "#262626",
      }}
    >
      <div
        style={{
          boxSizing: "border-box",
          width: "100%",
          maxWidth: "720px",
          margin: "0 auto",
          padding: "36px 32px",
          backgroundColor: "#ffffff",
          border: "1px solid #ecebe7",
          borderRadius: "16px",
          boxShadow: "0 10px 30px rgba(17, 24, 39, 0.06)",
        }}
      >
        <div style={{ textAlign: "left", marginBottom: "32px" }}>
          <img
            src={logoUrl}
            alt="Subtract Manufacturing"
            width="100"
            style={{
              display: "inline-block",
              width: "100px",
              maxWidth: "100%",
              height: "auto",
              border: 0,
              outline: "none",
              textDecoration: "none",
            }}
          />
        </div>

        <div
          data-slot-id="body"
          style={bodyTextStyle}
          dangerouslySetInnerHTML={{
            __html: copy.body.trim().length > 0 ? bodyHtml : "",
          }}
        />
      </div>
    </div>
  );
};
