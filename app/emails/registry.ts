import type { FC } from "react";
import type { EmailLayoutDefinition } from "./layout-definition";
import {
  getDefaultBodyCopyFromDefinition,
  parseAndValidateBodyCopyForDefinition,
} from "./layout-definition";
import {
  ExampleKitchenSinkEmail,
  exampleKitchenSinkLayoutDefinition,
  type ExampleKitchenSinkBodyCopy,
  type ExampleKitchenSinkEmailProps,
} from "./layouts/example-kitchen-sink";
import {
  StyledQuoteEmail,
  styledQuoteLayoutDefinition,
  normalizeStyledQuoteBodyCopyRaw,
  type StyledQuoteBodyCopy,
  type StyledQuoteEmailProps,
} from "./layouts/styled-quote";

const LEGACY_LAYOUT_SLUG_MAP: Record<string, string> = {
  "quote-send": "styled-quote",
  "branded-content": "styled-quote",
};

/** Maps removed / renamed layout keys so stored `email_templates.layout_slug` rows keep working. */
export function coerceLegacyEmailLayoutSlug(slug: string): string {
  return LEGACY_LAYOUT_SLUG_MAP[slug] ?? slug;
}

export type PropsBySlug = {
  "styled-quote": StyledQuoteEmailProps;
  "example-kitchen-sink": ExampleKitchenSinkEmailProps;
};

export type TemplateSlug = keyof PropsBySlug;

export type LayoutCopy<K extends TemplateSlug> = K extends "styled-quote"
  ? StyledQuoteBodyCopy
  : K extends "example-kitchen-sink"
    ? ExampleKitchenSinkBodyCopy
    : never;

export type { StyledQuoteBodyCopy, ExampleKitchenSinkBodyCopy };

type RegistryEntry<K extends TemplateSlug> = {
  component: FC<PropsBySlug[K]>;
  defaultSubject: string;
  definition: EmailLayoutDefinition;
  isExample?: boolean;
};

const styledQuoteEntry: RegistryEntry<"styled-quote"> = {
  component: StyledQuoteEmail,
  defaultSubject: "Your Quote {{quoteNumber}} from Subtract Manufacturing",
  definition: styledQuoteLayoutDefinition,
};

const exampleKitchenSinkEntry: RegistryEntry<"example-kitchen-sink"> = {
  component: ExampleKitchenSinkEmail,
  defaultSubject: "Example layout {{quoteNumber}}",
  definition: exampleKitchenSinkLayoutDefinition,
  isExample: true,
};

export const runtimeEmailLayoutRegistry = {
  "styled-quote": styledQuoteEntry,
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

export function getLayoutDefinition(slug: string): EmailLayoutDefinition {
  const canonical = coerceLegacyEmailLayoutSlug(slug);
  if (!isRegisteredEmailLayoutSlug(canonical)) {
    throw new Error(`Unknown email layout: ${slug}`);
  }
  return runtimeEmailLayoutRegistry[canonical].definition;
}

export function parseBodyCopyForLayout<K extends TemplateSlug>(
  slugInput: K | string,
  raw: unknown,
):
  | { ok: true; data: LayoutCopy<K> }
  | { ok: false; errors: Record<string, string> } {
  const slug = coerceLegacyEmailLayoutSlug(String(slugInput));
  if (!isRegisteredEmailLayoutSlug(slug)) {
    return {
      ok: false,
      errors: { _root: `Unknown layout "${String(slugInput)}".` },
    };
  }
  const definition = getLayoutDefinition(slug);
  const normalizedRaw =
    slug === "styled-quote" ? normalizeStyledQuoteBodyCopyRaw(raw) : raw;
  const parsed = parseAndValidateBodyCopyForDefinition<LayoutCopy<K>>(
    definition,
    normalizedRaw,
  );
  if (!parsed.ok) {
    return { ok: false, errors: parsed.errors };
  }
  return { ok: true, data: parsed.value };
}

export function getDefaultBodyCopyForLayout<K extends TemplateSlug>(
  slug: K,
): LayoutCopy<K> {
  return getDefaultBodyCopyFromDefinition(
    getLayoutDefinition(slug),
  ) as LayoutCopy<K>;
}
