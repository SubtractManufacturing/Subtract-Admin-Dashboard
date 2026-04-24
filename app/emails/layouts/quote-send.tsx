import React from "react";
import type { ButtonValue, EmailLayoutDefinition } from "../layout-definition";
import { renderEmailMarkdownToHtml } from "../markdown-email";

export type QuoteSendBodyCopy = {
  greeting: string;
  intro: string;
  totalLabel: string;
  payNowButton: ButtonValue;
  signOff: string;
  signature: string;
  footer: string;
};

export interface QuoteSendEmailProps {
  quoteNumber: string;
  customerName: string;
  total: string;
  paymentLinkUrl?: string;
  copy: QuoteSendBodyCopy;
}

export const quoteSendLayoutDefinition = {
  slots: [
    {
      id: "greeting",
      type: "plainText",
      required: false,
      emptyBehavior: "renderEmpty",
      adminLabel: "Greeting",
      defaultValue: "Hi {{customerName}},",
      allowPerSendEdit: true,
    },
    {
      id: "intro",
      type: "markdown",
      required: false,
      emptyBehavior: "renderEmpty",
      adminLabel: "Introduction",
      adminHelpText: "Supports headings, bold, italic, lists, and links.",
      defaultValue:
        "Please find your quote **{{quoteNumber}}** attached.",
      allowPerSendEdit: true,
    },
    {
      id: "totalLabel",
      type: "plainText",
      required: false,
      emptyBehavior: "renderEmpty",
      adminLabel: "Total label",
      defaultValue: "Total:",
    },
    {
      id: "payNowButton",
      type: "button",
      required: false,
      emptyBehavior: "hideBlock",
      adminLabel: "Pay now button",
      adminHelpText:
        "Use {{paymentLinkUrl}} in the link to use the quote payment URL.",
      defaultValue: {
        buttonLabel: "Pay Now",
        link: "{{paymentLinkUrl}}",
      },
    },
    {
      id: "signOff",
      type: "plainText",
      required: false,
      emptyBehavior: "renderEmpty",
      adminLabel: "Sign-off",
      defaultValue: "Best regards,\nSubtract Manufacturing",
    },
    {
      id: "signature",
      type: "plainText",
      required: false,
      emptyBehavior: "renderEmpty",
      adminLabel: "Signature",
      defaultValue: "{{default_signature}}",
    },
    {
      id: "footer",
      type: "plainText",
      required: false,
      emptyBehavior: "renderEmpty",
      adminLabel: "Footer",
      defaultValue: "{{default_footer}}",
    },
  ],
} as const satisfies EmailLayoutDefinition;

function resolvePayNowHref(
  linkFromCopy: string,
  paymentLinkUrl?: string,
): string | undefined {
  const t = linkFromCopy.trim();
  if (paymentLinkUrl?.trim()) {
    return paymentLinkUrl.trim();
  }
  if (!t || /\{\{paymentLinkUrl\}\}/.test(t)) {
    return undefined;
  }
  return t;
}

export const QuoteSendEmail: React.FC<QuoteSendEmailProps> = ({
  total,
  paymentLinkUrl,
  copy,
}) => {
  const payHref = resolvePayNowHref(copy.payNowButton.link, paymentLinkUrl);
  const payLabel = copy.payNowButton.buttonLabel.trim();
  const showPayButton =
    payLabel.length > 0 &&
    payHref != null &&
    payHref.length > 0;

  const introHtml = renderEmailMarkdownToHtml(copy.intro);

  return (
    <div style={{ fontFamily: "sans-serif", color: "#333" }}>
      <p data-slot-id="greeting">{copy.greeting}</p>
      <div
        data-slot-id="intro"
        dangerouslySetInnerHTML={{
          __html: copy.intro.trim().length > 0 ? introHtml : "",
        }}
      />
      <p>
        <span data-slot-id="totalLabel" style={{ fontWeight: 700 }}>
          {copy.totalLabel}
        </span>{" "}
        {total}
      </p>
      {showPayButton ? (
        <p>
          <a
            href={payHref}
            style={{
              display: "inline-block",
              padding: "10px 20px",
              backgroundColor: "#007bff",
              color: "#fff",
              textDecoration: "none",
              borderRadius: "5px",
            }}
          >
            {payLabel}
          </a>
        </p>
      ) : null}
      <p data-slot-id="signOff" style={{ whiteSpace: "pre-wrap" }}>
        {copy.signOff}
      </p>
      <div
        data-slot-id="signature"
        style={{ marginTop: "20px", whiteSpace: "pre-wrap" }}
      >
        {copy.signature}
      </div>
      <div
        data-slot-id="footer"
        style={{
          marginTop: "20px",
          fontSize: "12px",
          color: "#666",
          whiteSpace: "pre-wrap",
        }}
      >
        {copy.footer}
      </div>
    </div>
  );
};
