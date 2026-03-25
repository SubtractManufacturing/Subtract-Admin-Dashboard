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

export function replaceGlobalPlaceholders(
  content: string,
  signature: string,
  footer: string
): string {
  return content
    .replace(/\{\{default_signature\}\}/g, signature)
    .replace(/\{\{default_footer\}\}/g, footer);
}

export function interpolateSubject(
  template: string,
  props: Record<string, string>
): string {
  return template.replace(/\{\{(\w+)\}\}/g, (_, key) => props[key] ?? "");
}

export function interpolateCopy<T extends Record<string, string>>(
  copy: T,
  props: Record<string, string>
): T {
  const result = { ...copy };
  for (const key in result) {
    if (typeof result[key] === "string") {
      result[key] = interpolateSubject(result[key] as string, props) as T[Extract<keyof T, string>];
    }
  }
  return result;
}
