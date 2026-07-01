import { PgBoss } from "pg-boss";
import { getQueueDatabaseUrl, PGBOSS_MAX_CONNECTIONS } from "../db/connection-string.server";
import { QUEUES } from "./types";

let boss: PgBoss | null = null;

export async function startWorkerQueue(): Promise<PgBoss> {
  if (boss) {
    return boss;
  }

  const connectionString = getQueueDatabaseUrl();
  if (!connectionString) {
    throw new Error("[PgBoss:Worker] DATABASE_URL or DATABASE_DIRECT_URL must be set");
  }

  boss = new PgBoss({
    connectionString,
    ssl: { rejectUnauthorized: false },
    application_name: "subtract-worker",
    schema: "pgboss",
    max: PGBOSS_MAX_CONNECTIONS,
  });

  boss.on("error", (err: Error) => {
    console.error("[PgBoss:Worker] Error:", err);
  });

  await boss.start();
  console.log("[PgBoss:Worker] Started");

  for (const name of Object.values(QUEUES)) {
    if (name === QUEUES.TOOLPATH_UPLOAD) {
      await boss.createQueue(name, { policy: "key_strict_fifo" });
    } else {
      await boss.createQueue(name);
    }
    console.log(`[PgBoss:Worker] Queue ensured: ${name}`);
  }

  return boss;
}

export async function stopWorkerQueue(): Promise<void> {
  if (!boss) {
    return;
  }

  console.log("[PgBoss:Worker] Stopping...");
  await boss.stop({ graceful: true, timeout: 30_000 });
  boss = null;
  console.log("[PgBoss:Worker] Stopped");
}
