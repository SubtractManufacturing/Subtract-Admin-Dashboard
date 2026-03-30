import { render } from "@react-email/render";
import {
  emailTemplateRegistry,
  type PropsBySlug,
  type TemplateSlug,
} from "./registry";
import React from "react";

export async function renderEmailTemplate<K extends TemplateSlug>(
  slug: K,
  props: PropsBySlug[K],
): Promise<{ html: string; text: string }> {
  const { component: Component } = emailTemplateRegistry[slug];
  const element = React.createElement(
    Component as React.ComponentType<Record<string, unknown>>,
    props as Record<string, unknown>,
  );
  const html = await render(element);
  const text = await render(element, { plainText: true });
  return { html, text };
}

/** Substitute `{{key}}` placeholders (matches `\w+` keys). */
export function interpolateTemplateString(
  template: string,
  props: Record<string, string>,
): string {
  return template.replace(/\{\{(\w+)\}\}/g, (_, key) => props[key] ?? "");
}

/** Use interpolateTemplateString for non-subject strings; name kept for readability at call sites. */
export function interpolateSubject(
  template: string,
  props: Record<string, string>,
): string {
  return interpolateTemplateString(template, props);
}

export function interpolateLayoutCopy<T extends Record<string, unknown>>(
  copy: T,
  props: Record<string, string>,
): T {
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(copy)) {
    if (typeof value === "string") {
      out[key] = interpolateTemplateString(value, props);
      continue;
    }
    if (
      value &&
      typeof value === "object" &&
      "buttonLabel" in value &&
      "link" in value
    ) {
      const button = value as { buttonLabel: string; link: string };
      out[key] = {
        buttonLabel: interpolateTemplateString(button.buttonLabel, props),
        link: interpolateTemplateString(button.link, props),
      };
      continue;
    }
    out[key] = value;
  }
  return out as T;
}
