/**
 * The Order detail action's interface: authenticated request in, Response out.
 * `runOrderIntent` is the testable core; the route's `action` adapts to it
 * (see `./action.server.ts`).
 */
import { actorFromAuth, dispatchIntent, serverError } from "~/lib/route-actions/core";
import type { OrderAuth, OrderCtx, OrderEntity } from "./context";
import { orderIntents } from "./intents";
import type { OrderDeps } from "./ports";

export async function runOrderIntent(input: {
  order: OrderEntity;
  auth: OrderAuth;
  formData: FormData;
  /** Form `intent`, already defaulted for bare multipart uploads. */
  intent: FormDataEntryValue | null;
  deps: OrderDeps;
  /** Part-asset admin actions (CAD revisions, thumbnails) are claimed before the table. */
  partAssetAdmin?: (formData: FormData) => Promise<Response | null>;
}): Promise<Response> {
  const { order, auth, formData, intent, deps } = input;

  const ctx: OrderCtx = {
    order,
    auth,
    actor: actorFromAuth(auth),
    entityRef: { type: "order", id: String(order.id) },
    deps,
  };

  try {
    const claimed = await input.partAssetAdmin?.(formData);
    if (claimed) return claimed;
  } catch (error) {
    console.error("Action error:", error);
    return serverError("Failed to process request");
  }

  return dispatchIntent({
    table: orderIntents,
    intent,
    ctx,
    formData,
    messages: { unknownIntent: "Invalid intent", failure: "Failed to process request" },
  });
}
