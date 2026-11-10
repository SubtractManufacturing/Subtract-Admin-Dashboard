import { mergeIntentTables } from "~/lib/route-actions/core";
import { noteIntents } from "~/lib/route-actions/note-intents";
import type { OrderCtx } from "../context";
import { attachmentIntents } from "./attachments";
import { checkoutAddressIntents, documentIntents, emailIntents } from "./documents-email";
import { jobBoardIntents } from "./job-board";
import { lifecycleIntents } from "./lifecycle";
import { lineItemIntents } from "./line-items";
import { partIntents } from "./parts";
import { trackingIntents } from "./tracking";

/** Every intent the Order detail route understands. */
export const orderIntents = mergeIntentTables<OrderCtx>(
  lifecycleIntents,
  lineItemIntents,
  partIntents,
  attachmentIntents,
  trackingIntents,
  jobBoardIntents,
  documentIntents,
  emailIntents,
  checkoutAddressIntents,
  noteIntents,
);
