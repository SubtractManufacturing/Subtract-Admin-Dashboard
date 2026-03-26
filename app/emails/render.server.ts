import { render } from "@react-email/render";
import {
  emailTemplateRegistry,
  type TemplateSlug,
  type EmailTemplateProps,
} from "./registry";
import React from "react";

export async function renderEmailTemplate(
  slug: TemplateSlug,
  props: EmailTemplateProps
): Promise<{ html: string; text: string }> {
  const { component: Component } = emailTemplateRegistry[slug];
  // render expects a React element
  const element = React.createElement(Component, props);
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

export function interpolateCopy<T extends Record<string, string>>(
  copy: T,
  props: Record<string, string>,
): T {
  const result = { ...copy };
  for (const key in result) {
    if (typeof result[key] === "string") {
      result[key] = interpolateTemplateString(
        result[key] as string,
        props,
      ) as T[Extract<keyof T, string>];
    }
  }
  return result;
}
