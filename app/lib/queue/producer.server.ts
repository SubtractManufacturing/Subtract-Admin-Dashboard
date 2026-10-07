import { PgBoss } from "pg-boss";
import { getQueueDatabaseUrl, PGBOSS_MAX_CONNECTIONS } from "../db/connection-string.server";
import {
  CAD_CONVERSION_OPTIONS,
  DRAWING_THUMBNAIL_OPTIONS,
  DEFAULT_RETRY_OPTIONS,
  SEND_EMAIL_OPTIONS,
  QUEUES,
  type CadConversionPayload,
  type DrawingThumbnailPayload,
  type MockJobPayload,
  type SendEmailPayload,
  RFQ_IMPORT_OPTIONS,
  type RfqImportPayload,
} from "./types";

declare global {
  // eslint-disable-next-line no-var
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
  const connectionString = getQueueDatabaseUrl();
  if (!connectionString) {
    throw new Error(
      "[PgBoss:Producer] DATABASE_URL or DATABASE_DIRECT_URL must be set",
    );
  }

  const boss = new PgBoss({
    connectionString,
    ssl: { rejectUnauthorized: false },
    application_name: "subtract-producer",
    schema: "pgboss",
    max: PGBOSS_MAX_CONNECTIONS,
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

export async function sendMockJob(
  payload: MockJobPayload,
): Promise<string | null> {
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

export async function sendEmailJob(
  payload: SendEmailPayload,
  delayMinutes: number = 0
): Promise<string | null> {
  const producer = await getProducer();
  const options: Record<string, unknown> = { ...SEND_EMAIL_OPTIONS };
  if (delayMinutes > 0) {
    options.startAfter = delayMinutes * 60; // pg-boss startAfter is in seconds
  }
  return producer.send(QUEUES.SEND_EMAIL, payload, options);
}

export async function sendRfqImportJob(
  payload: RfqImportPayload,
): Promise<string | null> {
  const producer = await getProducer();
  const result = await ensureRfqImportJob(producer, payload);
  if (result.disposition === "retried_failed") {
    console.warn(
      `[RFQ Intake] ${JSON.stringify({
        event: "failed_head_retried",
        receiptKey: payload.receiptKey,
        jobId: result.jobId,
      })}`,
    );
  } else if (result.disposition === "already_queued") {
    console.log(
      `[RFQ Intake] ${JSON.stringify({
        event: "existing_job_reused",
        receiptKey: payload.receiptKey,
        jobId: result.jobId,
      })}`,
    );
  }
  return result.jobId;
}

type RfqImportJobClient = {
  findJobs(
    name: string,
    options: { key: string },
  ): Promise<Array<{ id: string; state: string }>>;
  retry(name: string, id: string): Promise<unknown>;
  send(
    name: string,
    data: RfqImportPayload,
    options: typeof RFQ_IMPORT_OPTIONS & { singletonKey: string },
  ): Promise<string | null>;
};

export async function ensureRfqImportJob(
  client: RfqImportJobClient,
  payload: RfqImportPayload,
): Promise<{
  disposition: "created" | "retried_failed" | "already_queued";
  jobId: string | null;
}> {
  const jobs = await client.findJobs(QUEUES.RFQ_IMPORT, {
    key: payload.receiptKey,
  });
  const failedHead = jobs.find((job) => job.state === "failed");
  if (failedHead) {
    await client.retry(QUEUES.RFQ_IMPORT, failedHead.id);
    return { disposition: "retried_failed", jobId: failedHead.id };
  }

  const runnableJob = jobs.find(
    (job) =>
      job.state === "created" || job.state === "retry" || job.state === "active",
  );
  if (runnableJob) {
    return { disposition: "already_queued", jobId: runnableJob.id };
  }

  const jobId = await client.send(QUEUES.RFQ_IMPORT, payload, {
    ...RFQ_IMPORT_OPTIONS,
    singletonKey: payload.receiptKey,
  });
  return { disposition: "created", jobId };
}

export async function sendDrawingThumbnailJob(
  payload: DrawingThumbnailPayload,
): Promise<string | null> {
  const producer = await getProducer();
  return producer.send(QUEUES.DRAWING_THUMBNAIL, payload, {
    ...DRAWING_THUMBNAIL_OPTIONS,
    singletonKey: payload.attachmentId,
  });
}
