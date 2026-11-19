import { getDeveloperSetting, TWENTY_SETTINGS } from "../developerSettings";
import { sendTwentySyncJob } from "../queue/producer.server";

export type TwentySyncReason =
  | "quote.created"
  | "quote.updated"
  | "quote.totals_changed"
  | "quote.duplicated"
  | "quote.converted"
  | "quote.revised"
  | "quote.expired"
  | "quote.archived"
  | "quote.restored"
  | "quote.email_delivered"
  | "rfq.imported"
  | "customer.created"
  | "customer.updated"
  | "customer.archived"
  | "customer.merged";

async function queueSync(reason: TwentySyncReason): Promise<void> {
  if ((await getDeveloperSetting(TWENTY_SETTINGS.ENABLED)) !== "true") return;
  await sendTwentySyncJob({ triggeredAt: new Date().toISOString(), reason });
}

/**
 * Hook for anything mirrored in Twenty: call it after the change has committed.
 * It queues a sync and returns at once, so it can never slow down or fail the
 * work that called it. The queue holds one active and one waiting run, so a burst
 * of changes collapses. A missed hook is only delayed: the scheduled sweep compares
 * the tables and catches anything this did not.
 */
export function notifyTwentySync(reason: TwentySyncReason): void {
  void queueSync(reason).catch((error) => {
    console.error(`[Twenty] Could not queue a sync for ${reason}`, error);
  });
}
