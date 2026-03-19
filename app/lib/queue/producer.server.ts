import { PgBoss } from "pg-boss";
import {
  CAD_CONVERSION_OPTIONS,
  DEFAULT_RETRY_OPTIONS,
  QUEUES,
  type CadConversionPayload,
  type MockJobPayload,
} from "./types";

declare global {
  var __pgBossProducer: Promise<PgBoss> | undefined;
}

let producerPromise: Promise<PgBoss> | null = global.__pgBossProducer ?? null;

function getProducer(): Promise<PgBoss> {
  if (!producerPromise) {
    producerPromise = initProducer();
    if (process.env.NODE_ENV !== "production") {
      global.__pgBossProducer = producerPromise;
    }
  }
  return producerPromise;
}

async function initProducer(): Promise<PgBoss> {
  const connectionString = process.env.DATABASE_DIRECT_URL || process.env.DATABASE_URL;
  if (!connectionString) {
    throw new Error("[PgBoss:Producer] DATABASE_DIRECT_URL or DATABASE_URL must be set");
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

export async function sendCadConversionJob(
  payload: CadConversionPayload,
): Promise<string | null> {
  const producer = await getProducer();
  return producer.send(QUEUES.CAD_CONVERSION, payload, {
    ...CAD_CONVERSION_OPTIONS,
  });
}
