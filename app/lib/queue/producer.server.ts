import { PgBoss } from "pg-boss";
import { DEFAULT_RETRY_OPTIONS, QUEUES, type MockJobPayload } from "./types";

let producerPromise: Promise<PgBoss> | null = null;

function getProducer(): Promise<PgBoss> {
  if (!producerPromise) {
    producerPromise = initProducer();
  }
  return producerPromise;
}

async function initProducer(): Promise<PgBoss> {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    throw new Error("[PgBoss:Producer] DATABASE_URL is not set");
  }

  const boss = new PgBoss({
    connectionString,
    ssl: { rejectUnauthorized: false },
    application_name: "subtract-producer",
    schema: "pgboss",
    // Producer-only: no background maintenance, no migrations, no scheduling.
    // start() is still required to populate the queue cache that send() depends on.
    supervise: false,
    migrate: false,
    schedule: false,
  });

  boss.on("error", (err: Error) => {
    console.error("[PgBoss:Producer] Error:", err);
  });

  await boss.start();
  return boss;
}

export async function sendMockJob(payload: MockJobPayload): Promise<string | null> {
  const producer = await getProducer();
  return producer.send(QUEUES.MOCK_JOB, payload, {
    ...DEFAULT_RETRY_OPTIONS,
  });
}
