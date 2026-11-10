import { redirect } from "@remix-run/node";
import type { getQuote } from "~/lib/quotes";
import type { Actor } from "~/lib/route-actions/core";
import type { EmailEnqueueAuth } from "~/lib/email/handlers/quote-send-email.server";
import type { QuoteDeps } from "./ports";

export type QuoteEntity = NonNullable<Awaited<ReturnType<typeof getQuote>>>;
export type QuoteStatus = QuoteEntity["status"];

/** Signed-in user, as the email handlers also expect it. */
export type QuoteAuth = EmailEnqueueAuth;

/** What every Quote intent handler receives. `D` narrows to the ports it needs. */
export type QuoteCtx<D extends Partial<QuoteDeps> = QuoteDeps> = {
  quote: QuoteEntity;
  actor: Actor;
  auth: QuoteAuth;
  entityRef: { type: "quote"; id: string };
  deps: D;
};

export const quoteHref = (quote: { id: number }) => `/quotes/${quote.id}`;

export const redirectToQuote = (quote: { id: number }) => redirect(quoteHref(quote));

/** An RFQ becomes a Draft the moment someone starts editing it. */
export async function ensureDraft(
  ctx: QuoteCtx<Pick<QuoteDeps, "quotes">>,
): Promise<void> {
  if (ctx.quote.status === "RFQ") {
    await ctx.deps.quotes.update(ctx.quote.id, { status: "Draft" }, ctx.actor);
  }
}

export const canDeleteProtectedAttachments = (auth: QuoteAuth) =>
  auth.userDetails.role === "Admin" || auth.userDetails.role === "Dev";
