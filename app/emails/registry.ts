import { QuoteSendEmail, type QuoteSendEmailProps } from "./templates/quote-send";
import type { FC } from "react";

export type EmailTemplateProps = QuoteSendEmailProps;

export const emailTemplateRegistry = {
  "quote-send": {
    component: QuoteSendEmail as FC<EmailTemplateProps>,
    defaultSubject: "Your Quote {{quoteNumber}} from Subtract Manufacturing",
  },
} as const satisfies Record<
  string,
  { component: FC<EmailTemplateProps>; defaultSubject: string }
>;

export type TemplateSlug = keyof typeof emailTemplateRegistry;
