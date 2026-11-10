/**
 * The Quote detail action's interface: authenticated request in, Response out.
 *
 * `runQuoteIntent` is the testable core (no Request, no cookies); the route's
 * `action` is a thin adapter around it (see `./action.server.ts`).
 */
import { actorFromAuth, dispatchIntent, serverError } from "~/lib/route-actions/core";
import type { QuoteAuth, QuoteCtx, QuoteEntity } from "./context";
import { quoteIntents } from "./intents";
import type { QuoteDeps } from "./ports";

export async function runQuoteIntent(input: {
  quote: QuoteEntity;
  auth: QuoteAuth;
  formData: FormData;
  /** Form `intent`, already defaulted for bare multipart uploads. */
  intent: FormDataEntryValue | null;
  deps: QuoteDeps;
  /** Part-asset admin actions (CAD revisions, thumbnails) are claimed before the table. */
  partAssetAdmin?: (formData: FormData) => Promise<Response | null>;
}): Promise<Response> {
  const { quote, auth, formData, intent, deps } = input;

  const ctx: QuoteCtx = {
    quote,
    auth,
    actor: actorFromAuth(auth),
    entityRef: { type: "quote", id: String(quote.id) },
    deps,
  };

  try {
    const claimed = await input.partAssetAdmin?.(formData);
    if (claimed) return claimed;
  } catch (error) {
    console.error("Action error:", error);
    return serverError("An error occurred");
  }

  return dispatchIntent({
    table: quoteIntents,
    intent,
    ctx,
    formData,
    messages: { unknownIntent: "Invalid action", failure: "An error occurred" },
  });
}
