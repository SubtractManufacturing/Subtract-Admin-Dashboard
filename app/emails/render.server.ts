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

export function interpolateSubject(
  template: string,
  props: Record<string, string>
): string {
  return template.replace(/\{\{(\w+)\}\}/g, (_, key) => props[key] ?? "");
}
