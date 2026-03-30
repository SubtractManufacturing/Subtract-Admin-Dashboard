import React from "react";
import type { ButtonValue, EmailLayoutDefinition } from "../layout-definition";
import { renderEmailMarkdownToHtml } from "../markdown-email";

export type ExampleKitchenSinkBodyCopy = {
  /** plainText + hideBlock */
  optionalHide: string;
  /** plainText + renderEmpty */
  optionalShowEmpty: string;
  /** plainText + reject + required */
  requiredReject: string;
  /** markdown */
  prose: string;
  /** button + hideBlock */
  cta: ButtonValue;
};

export type ExampleKitchenSinkEmailProps = {
  copy: ExampleKitchenSinkBodyCopy;
};

export const exampleKitchenSinkLayoutDefinition = {
  slots: [
    {
      id: "optionalHide",
      type: "plainText",
      required: false,
      emptyBehavior: "hideBlock",
      adminLabel: "Optional (hidden when empty)",
      defaultValue: "",
    },
    {
      id: "optionalShowEmpty",
      type: "plainText",
      required: false,
      emptyBehavior: "renderEmpty",
      adminLabel: "Optional (empty paragraph shown)",
      defaultValue: "",
    },
    {
      id: "requiredReject",
      type: "plainText",
      required: true,
      emptyBehavior: "reject",
      adminLabel: "Required headline",
      defaultValue: "Example required line",
    },
    {
      id: "prose",
      type: "markdown",
      required: false,
      emptyBehavior: "hideBlock",
      adminLabel: "Markdown block",
      defaultValue:
        "## Kitchen sink\n\n- **bold** and *italic*\n- [link](https://example.com)",
    },
    {
      id: "cta",
      type: "button",
      required: false,
      emptyBehavior: "hideBlock",
      adminLabel: "Call to action",
      defaultValue: {
        buttonLabel: "Example",
        link: "https://example.com",
      },
    },
  ],
} as const satisfies EmailLayoutDefinition;

export const ExampleKitchenSinkEmail: React.FC<
  ExampleKitchenSinkEmailProps
> = ({ copy }) => {
  const proseHtml = renderEmailMarkdownToHtml(copy.prose);
  const ctaLabel = copy.cta.buttonLabel.trim();
  const ctaHref = copy.cta.link.trim();
  const showCta = ctaLabel.length > 0 && ctaHref.length > 0;

  return (
    <div style={{ fontFamily: "sans-serif", color: "#222" }}>
      <h1 style={{ fontSize: "20px" }}>Example layout (kitchen sink)</h1>
      {copy.optionalHide.trim().length > 0 ? (
        <p data-slot="optionalHide">{copy.optionalHide}</p>
      ) : null}
      <p data-slot="optionalShowEmpty">{copy.optionalShowEmpty}</p>
      <p data-slot="requiredReject">
        <strong>{copy.requiredReject}</strong>
      </p>
      {copy.prose.trim().length > 0 ? (
        <div
          data-slot="prose"
          dangerouslySetInnerHTML={{ __html: proseHtml }}
        />
      ) : null}
      {showCta ? (
        <p>
          <a
            href={ctaHref}
            style={{
              display: "inline-block",
              padding: "8px 16px",
              backgroundColor: "#111",
              color: "#fff",
              textDecoration: "none",
              borderRadius: "4px",
            }}
          >
            {ctaLabel}
          </a>
        </p>
      ) : null}
    </div>
  );
};
