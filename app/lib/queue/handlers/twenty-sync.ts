import type { Job } from "pg-boss";

import { setDeveloperSetting, TWENTY_SETTINGS } from "../../developerSettings";
import { buildTwentyClient, getTwentySettings } from "../../twenty/settings.server";
import { postgresTwentySyncStore, withTwentySyncLock } from "../../twenty/store.server";
import { runTwentySync } from "../../twenty/sync.server";
import type { TwentySyncPayload } from "../types";

const LOCK_ATTEMPTS = 3;
const LOCK_RETRY_MS = 5_000;

/**
 * A single-quote sync from the admin page can briefly hold the lock. Waiting keeps
 * a hook-driven run from being dropped until the next sweep.
 */
async function withLockRetries<T>(run: () => Promise<T>) {
  for (let attempt = 1; ; attempt += 1) {
    const result = await withTwentySyncLock(run);
    if (result.ran || attempt === LOCK_ATTEMPTS) return result;
    await new Promise((resolve) => setTimeout(resolve, LOCK_RETRY_MS));
  }
}

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

    const { syncStartedAt } = settings;
    const run = await withLockRetries(() =>
      runTwentySync({ store: postgresTwentySyncStore, twenty, syncStartedAt }),
    );
    // Still busy: the running sync or the next sweep picks this work up.
    if (!run.ran) continue;
    const result = run.value;
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
