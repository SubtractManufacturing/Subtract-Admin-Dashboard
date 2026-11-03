import type { Job } from "pg-boss";

import { setDeveloperSetting, TWENTY_SETTINGS } from "../../developerSettings";
import { buildTwentyClient, getTwentySettings } from "../../twenty/settings.server";
import { postgresTwentySyncStore } from "../../twenty/store.server";
import { runTwentySync } from "../../twenty/sync.server";
import type { TwentySyncPayload } from "../types";

/** Logs counts only: customer details and the API key stay out of worker logs. */
export async function handleTwentySync(jobs: Job<TwentySyncPayload>[]) {
  for (const job of jobs) {
    const settings = await getTwentySettings();
    if (!settings.enabled || !settings.syncStartedAt) continue;

    const twenty = buildTwentyClient(settings.workspaceUrl);
    if (!twenty) {
      console.warn("[Worker:TwentySync] Enabled but the URL or API key is missing");
      continue;
    }

    const result = await runTwentySync({
      store: postgresTwentySyncStore,
      twenty,
      syncStartedAt: settings.syncStartedAt,
    });
    await setDeveloperSetting(
      TWENTY_SETTINGS.LAST_RUN_AT,
      new Date().toISOString(),
      "twenty-sync",
    );

    if (result.synced > 0 || result.failed > 0) {
      console.log(`[Worker:TwentySync] Job ${job.id} finished`, result);
    }
  }
}
