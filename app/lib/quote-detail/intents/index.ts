import { mergeIntentTables } from "~/lib/route-actions/core";
import { noteIntents } from "~/lib/route-actions/note-intents";
import type { QuoteCtx } from "../context";
import { attachmentIntents } from "./attachments";
import { documentIntents, emailIntents, priceCalculationIntents } from "./documents-email";
import { lifecycleIntents } from "./lifecycle";
import { lineItemIntents } from "./line-items";
import { partIntents } from "./parts";
import { receivePoIntents } from "./receive-po";

/** Every intent the Quote detail route understands. */
export const quoteIntents = mergeIntentTables<QuoteCtx>(
  lifecycleIntents,
  lineItemIntents,
  partIntents,
  attachmentIntents,
  receivePoIntents,
  documentIntents,
  emailIntents,
  priceCalculationIntents,
  noteIntents,
);
