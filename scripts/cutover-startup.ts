/**
 * Runs before the web server and before the worker start (`prestart`,
 * `prestart:worker`, `predev` in package.json).
 *
 * This release serves the old Customer and Vendor tables only, so every start
 * records the cutover stage as Shadow (ADR-0014). After a rollback from
 * Switch that is what tells a still-running Switch release to stop writing,
 * and what makes its next start wait for a Sync and a Check.
 *
 * The step must not be skipped: if the stage cannot be recorded, this exits
 * non-zero and the process it guards does not start. It keeps trying for a
 * while first, because a worker container can start before the web container
 * has run the migration that creates `cutover_state`.
 */
import "dotenv/config";

import { client } from "../app/lib/db/client";
import { recordShadowStage } from "../app/lib/organizations/stage.server";

const RETRY_EVERY_MS = 2_000;

function waitBudgetMs(): number {
  const configured = Number(process.env.CUTOVER_STARTUP_WAIT_MS);
  return Number.isFinite(configured) && configured >= 0 ? configured : 120_000;
}

async function main(): Promise<void> {
  const deadline = Date.now() + waitBudgetMs();
  for (;;) {
    try {
      const change = await recordShadowStage();
      console.log(
        change.changed
          ? `[cutover] Stage recorded as Shadow (was ${change.from ?? "not recorded"}).`
          : "[cutover] Stage is Shadow.",
      );
      return;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (Date.now() >= deadline) {
        throw new Error(`could not record the cutover stage: ${message}`);
      }
      console.warn(`[cutover] Stage not recorded yet (${message}); retrying.`);
      await new Promise((resolve) => setTimeout(resolve, RETRY_EVERY_MS));
    }
  }
}

main()
  .then(() => client.end({ timeout: 5 }))
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(
      "[cutover] Refusing to start:",
      error instanceof Error ? error.message : error,
    );
    process.exit(1);
  });
