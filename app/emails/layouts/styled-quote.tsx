import React from "react";
import type { ButtonValue, EmailLayoutDefinition } from "../layout-definition";
import { renderEmailMarkdownToHtml } from "../markdown-email";

export type StyledQuoteBodyCopy = {
  /** Markdown before the button (intro / lead-in). */
  intro: string;
  cta: ButtonValue;
  /** Markdown after the button (wrap-up). Hidden when empty. */
  wrapUp: string;
  /** Optional markdown (e.g. shipping policy, payment terms, legal disclaimers). */
  footerNotice: string;
};

export type StyledQuoteEmailProps = {
  logoUrl: string;
  copy: StyledQuoteBodyCopy;
};

/**
 * Templates saved before the intro / wrap-up split may still use `content`.
 * Maps that to `intro` so parsing and sends keep working until edited in Admin.
 */
function normalizeLegacyContentSlotBodyCopy(raw: unknown): unknown {
  if (
    raw === null ||
    raw === undefined ||
    typeof raw !== "object" ||
    Array.isArray(raw)
  ) {
    return raw;
  }
  const o = raw as Record<string, unknown>;
  if (!("content" in o) || "intro" in o) {
    return raw;
  }
  const { content, ...rest } = o;
  const wrapExisting = rest.wrapUp;
  return {
    ...rest,
    intro: typeof content === "string" ? content : "",
    wrapUp: typeof wrapExisting === "string" ? wrapExisting : "",
  };
}

function migrateQuoteSendBodyCopyToStyledQuote(
  o: Record<string, unknown>,
): Record<string, unknown> {
  const greeting = typeof o.greeting === "string" ? o.greeting : "";
  const introMd = typeof o.intro === "string" ? o.intro : "";
  const totalLabel =
    typeof o.totalLabel === "string" && o.totalLabel.trim().length > 0
      ? o.totalLabel.trim()
      : "Total:";
  const payBtn = o.payNowButton as { buttonLabel?: string; link?: string } | undefined;
  const signOff = typeof o.signOff === "string" ? o.signOff : "";
  const signature = typeof o.signature === "string" ? o.signature : "";
  const footer = typeof o.footer === "string" ? o.footer : "";

  const introBlocks: string[] = [];
  if (greeting.trim()) introBlocks.push(greeting.trim());
  if (introMd.trim()) introBlocks.push(introMd.trim());
  introBlocks.push(`${totalLabel} {{total}}`);
  const intro = introBlocks.join("\n\n");

  const wrapParts = [signOff.trim(), signature.trim(), footer.trim()].filter(
    Boolean,
  );
  const wrapUp = wrapParts.join("\n\n");

  return {
    intro,
    cta: {
      buttonLabel: typeof payBtn?.buttonLabel === "string" ? payBtn.buttonLabel : "",
      link: typeof payBtn?.link === "string" ? payBtn.link : "",
    },
    wrapUp,
    footerNotice: "",
  };
}

/**
 * Normalizes stored body copy for the styled-quote layout: legacy `quote-send`
 * slot shapes, old single `content` slot, then markdown validation.
 */
export function normalizeStyledQuoteBodyCopyRaw(raw: unknown): unknown {
  if (
    raw === null ||
    raw === undefined ||
    typeof raw !== "object" ||
    Array.isArray(raw)
  ) {
    return raw;
  }
  const o = raw as Record<string, unknown>;
  if ("payNowButton" in o || "totalLabel" in o) {
    return migrateQuoteSendBodyCopyToStyledQuote(o);
  }
  return normalizeLegacyContentSlotBodyCopy(raw);
}

const bodyMarkdownSlotHelp =
  "Supports headings, bold, italic, lists, and links. A single line break in the editor becomes a new line in the email.";

export const styledQuoteLayoutDefinition = {
  slots: [
    {
      id: "intro",
      type: "markdown",
      required: false,
      emptyBehavior: "renderEmpty",
      adminLabel: "Intro",
      adminHelpText: bodyMarkdownSlotHelp,
      placeholder: "Lead-in text before the button…",
      defaultValue:
        "Hi {{customerName}},\n\nPlease find your quote **{{quoteNumber}}** attached.",
      allowPerSendEdit: true,
    },
    {
      id: "cta",
      type: "button",
      required: false,
      emptyBehavior: "hideBlock",
      adminLabel: "Button",
      adminHelpText:
        "Use {{paymentLinkUrl}} in the link for Stripe checkout when applicable.",
      defaultValue: {
        buttonLabel: "Pay Now",
        link: "{{paymentLinkUrl}}",
      },
    },
    {
      id: "wrapUp",
      type: "markdown",
      required: false,
      emptyBehavior: "hideBlock",
      adminLabel: "Wrap-up",
      adminHelpText: bodyMarkdownSlotHelp,
      placeholder: "Closing thoughts after the button (optional)…",
      defaultValue:
        "Best regards,\n\nSubtract Manufacturing\n\n{{default_signature}}",
      allowPerSendEdit: true,
    },
    {
      id: "footerNotice",
      type: "markdown",
      required: false,
      emptyBehavior: "hideBlock",
      adminLabel: "Legal / compliance notice",
      adminHelpText:
        "Optional fine print after intro, button, and wrap-up—shipping, payment terms, disclaimers. Less prominent styling than the body text.",
      placeholder:
        "e.g. Estimated ship dates are subject to change. Full policy: https://…",
      defaultValue: "{{default_footer}}",
      allowPerSendEdit: true,
    },
  ],
} as const satisfies EmailLayoutDefinition;

const bodyTextStyle = {
  fontSize: "16px",
  lineHeight: "1.65",
  color: "#333333",
} as const;

export const StyledQuoteEmail: React.FC<StyledQuoteEmailProps> = ({
  logoUrl,
  copy,
}) => {
  const introHtml = renderEmailMarkdownToHtml(copy.intro);
  const wrapUpHtml = renderEmailMarkdownToHtml(copy.wrapUp);
  const footerHtml = renderEmailMarkdownToHtml(copy.footerNotice);
  const ctaLabel = copy.cta.buttonLabel.trim();
  const ctaHref = copy.cta.link.trim();
  const showCta = ctaLabel.length > 0 && ctaHref.length > 0;
  const showWrapUp = copy.wrapUp.trim().length > 0;
  const showFooterNotice = copy.footerNotice.trim().length > 0;
  const footerMarginTop =
    showFooterNotice && (showWrapUp || showCta) ? "24px" : "28px";

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
          data-slot-id="intro"
          style={bodyTextStyle}
          dangerouslySetInnerHTML={{
            __html: copy.intro.trim().length > 0 ? introHtml : "",
          }}
        />

        {showCta ? (
          <div data-slot-id="cta" style={{ marginTop: "28px" }}>
            <a
              href={ctaHref}
              style={{
                display: "inline-block",
                padding: "12px 22px",
                backgroundColor: "#ef4444",
                color: "#ffffff",
                fontSize: "15px",
                fontWeight: 700,
                lineHeight: "1.2",
                textDecoration: "none",
                borderRadius: "999px",
              }}
            >
              {ctaLabel}
            </a>
          </div>
        ) : null}

        {showWrapUp ? (
          <div
            data-slot-id="wrapUp"
            style={{ ...bodyTextStyle, marginTop: "28px" }}
            dangerouslySetInnerHTML={{ __html: wrapUpHtml }}
          />
        ) : null}

        {showFooterNotice ? (
          <div
            data-slot-id="footerNotice"
            style={{
              marginTop: footerMarginTop,
              paddingTop: "20px",
              borderTop: "1px solid #ecebe7",
              fontSize: "13px",
              lineHeight: "1.55",
              fontWeight: 400,
              color: "#6b7280",
            }}
            dangerouslySetInnerHTML={{ __html: footerHtml }}
          />
        ) : null}
      </div>
    </div>
  );
};
