import type { FC } from "react";
import type { EmailLayoutDefinition } from "./layout-definition";
import {
  getDefaultBodyCopyFromDefinition,
  parseAndValidateBodyCopyForDefinition,
} from "./layout-definition";
import {
  QuoteSendEmail,
  quoteSendLayoutDefinition,
  type QuoteSendBodyCopy,
  type QuoteSendEmailProps,
} from "./layouts/quote-send";
import {
  ExampleKitchenSinkEmail,
  exampleKitchenSinkLayoutDefinition,
  type ExampleKitchenSinkBodyCopy,
  type ExampleKitchenSinkEmailProps,
} from "./layouts/example-kitchen-sink";

export type PropsBySlug = {
  "quote-send": QuoteSendEmailProps;
  "example-kitchen-sink": ExampleKitchenSinkEmailProps;
};

export type TemplateSlug = keyof PropsBySlug;

export type LayoutCopy<K extends TemplateSlug> = K extends "quote-send"
  ? QuoteSendBodyCopy
  : K extends "example-kitchen-sink"
    ? ExampleKitchenSinkBodyCopy
    : never;

export type { QuoteSendBodyCopy, ExampleKitchenSinkBodyCopy };

type RegistryEntry<K extends TemplateSlug> = {
  component: FC<PropsBySlug[K]>;
  defaultSubject: string;
  definition: EmailLayoutDefinition;
  isExample?: boolean;
};

const quoteSendEntry: RegistryEntry<"quote-send"> = {
  component: QuoteSendEmail,
  defaultSubject: "Your Quote {{quoteNumber}} from Subtract Manufacturing",
  definition: quoteSendLayoutDefinition,
};

const exampleKitchenSinkEntry: RegistryEntry<"example-kitchen-sink"> = {
  component: ExampleKitchenSinkEmail,
  defaultSubject: "Example layout {{quoteNumber}}",
  definition: exampleKitchenSinkLayoutDefinition,
  isExample: true,
};

export const runtimeEmailLayoutRegistry = {
  "quote-send": quoteSendEntry,
  "example-kitchen-sink": exampleKitchenSinkEntry,
} as const satisfies { [K in TemplateSlug]: RegistryEntry<K> };

/** Alias for render path — includes every layout slug (incl. examples for legacy rows). */
export const emailTemplateRegistry = runtimeEmailLayoutRegistry;

export function isRegisteredEmailLayoutSlug(
  slug: string,
): slug is TemplateSlug {
  return slug in runtimeEmailLayoutRegistry;
}

/** When `includeExampleLayouts` is false, slugs with `isExample` are not selectable in Admin. */
export function isSelectableEmailLayoutSlug(
  slug: string,
  includeExampleLayouts: boolean,
): slug is TemplateSlug {
  if (!isRegisteredEmailLayoutSlug(slug)) return false;
  const entry = runtimeEmailLayoutRegistry[slug as TemplateSlug];
  if (entry.isExample && !includeExampleLayouts) return false;
  return true;
}

export function getSelectableEmailLayoutSlugs(
  includeExampleLayouts: boolean,
): TemplateSlug[] {
  return (Object.keys(runtimeEmailLayoutRegistry) as TemplateSlug[]).filter(
    (s) => isSelectableEmailLayoutSlug(s, includeExampleLayouts),
  );
}

export function getLayoutDefinition<K extends TemplateSlug>(
  slug: K,
): EmailLayoutDefinition {
  return runtimeEmailLayoutRegistry[slug].definition;
}

export function parseBodyCopyForLayout<K extends TemplateSlug>(
  slug: K,
  raw: unknown,
):
  | { ok: true; data: LayoutCopy<K> }
  | { ok: false; errors: Record<string, string> } {
  const definition = getLayoutDefinition(slug);
  const parsed = parseAndValidateBodyCopyForDefinition<LayoutCopy<K>>(
    definition,
    raw,
  );
  if (!parsed.ok) {
    return { ok: false, errors: parsed.errors };
  }
  return { ok: true, data: parsed.value };
}

export function getDefaultBodyCopyForLayout<K extends TemplateSlug>(
  slug: K,
): LayoutCopy<K> {
  return getDefaultBodyCopyFromDefinition(getLayoutDefinition(slug)) as LayoutCopy<K>;
}
