import { downloadFromS3 } from "./s3.server";
import { getEnv } from "./env.server";

const TOOLPATH_API_BASE = "https://app.toolpath.com/api/public/v0";
/** Toolpath allows one POST /parts every 2 seconds per team. */
export const TOOLPATH_PART_CREATION_INTERVAL_MS = 2000;
const MAX_RATE_LIMIT_RETRIES = 5;
const TOOLPATH_FETCH_TIMEOUT_MS = 30_000;
const TOOLPATH_PART_ID_PATTERN = /^[a-z0-9]{8}$/;

let nextPartCreationSlotAt = 0;
let pacingQueue: Promise<void> = Promise.resolve();

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function parseRetryAfterSeconds(header: string | null): number {
  if (!header) return TOOLPATH_PART_CREATION_INTERVAL_MS / 1000;

  const seconds = Number(header);
  if (!Number.isNaN(seconds) && seconds >= 0) return seconds;

  const dateMs = Date.parse(header);
  if (!Number.isNaN(dateMs)) {
    return Math.max(0, Math.ceil((dateMs - Date.now()) / 1000));
  }

  return TOOLPATH_PART_CREATION_INTERVAL_MS / 1000;
}

async function waitForPartCreationSlot(): Promise<void> {
  pacingQueue = pacingQueue.then(async () => {
    const waitMs = Math.max(0, nextPartCreationSlotAt - Date.now());
    if (waitMs > 0) {
      await sleep(waitMs);
    }
    nextPartCreationSlotAt = Date.now() + TOOLPATH_PART_CREATION_INTERVAL_MS;
  });
  await pacingQueue;
}

function reservePartCreationSlotAfterRetry(retryAfterSeconds: number): void {
  const earliestNextSlot =
    Date.now() + retryAfterSeconds * 1000 + TOOLPATH_PART_CREATION_INTERVAL_MS;
  nextPartCreationSlotAt = Math.max(nextPartCreationSlotAt, earliestNextSlot);
}

export function resetPartCreationPacingForTests(): void {
  nextPartCreationSlotAt = 0;
  pacingQueue = Promise.resolve();
}

function assertValidToolpathPartId(partId: string): void {
  if (!TOOLPATH_PART_ID_PATTERN.test(partId)) {
    throw new Error("Invalid Toolpath part ID");
  }
}

export function isValidToolpathPartId(partId: string): boolean {
  return TOOLPATH_PART_ID_PATTERN.test(partId);
}

function toolpathPartPath(partId: string, suffix = ""): string {
  assertValidToolpathPartId(partId);
  return `/parts/${encodeURIComponent(partId)}${suffix}`;
}

function fetchWithTimeout(
  input: RequestInfo | URL,
  init: RequestInit = {},
): Promise<Response> {
  return fetch(input, {
    ...init,
    signal: AbortSignal.timeout(TOOLPATH_FETCH_TIMEOUT_MS),
  });
}

export interface PublicCutConfig {
  id: string;
  name: string;
  createdAt: string;
  updatedAt: string;
  isDefault: boolean;
  readOnly: boolean;
  generic: boolean;
  toolLibraries: number;
  tools: number;
}

interface CutConfigsEnvelope {
  data: {
    cutConfigs: PublicCutConfig[];
  };
}

interface PublicPart {
  id: string;
  status: "ready" | "processing" | "failed";
  name: string;
  units: "in" | "mm";
  currentProgramId: string | null;
  failureCode: string | null;
  failureReason: string | null;
  createdAt: string;
}

interface CreatePartResponse {
  data: PublicPart;
  upload: {
    url: string;
    method: "PUT";
    expiresAt: string;
  };
}

interface ToolpathErrorEnvelope {
  error?: {
    code?: string;
    message?: string;
    requestId?: string;
  };
  code?: string;
  message?: string;
  requestId?: string;
}

type ToolpathRequestInit = RequestInit & {
  idempotencyKey?: string;
};

export function isToolpathEnabled(): boolean {
  return !!getEnv("TOOLPATH_API_KEY");
}

async function parseToolpathError(response: Response): Promise<string> {
  try {
    const body = (await response.json()) as ToolpathErrorEnvelope;
    return (
      body.error?.message ??
      body.message ??
      `Request failed with status ${response.status}`
    );
  } catch {
    return `Request failed with status ${response.status}`;
  }
}

async function toolpathFetch(
  path: string,
  init: ToolpathRequestInit = {},
  options: { pacePartCreation?: boolean } = {},
): Promise<Response> {
  const key = getEnv("TOOLPATH_API_KEY");
  if (!key) throw new Error("Toolpath API not configured");

  const method = (init.method ?? "GET").toUpperCase();
  const isWrite = ["POST", "PUT", "DELETE", "PATCH"].includes(method);
  if (isWrite && !init.idempotencyKey) {
    throw new Error("Idempotency-Key is required for Toolpath write requests");
  }

  const { idempotencyKey, headers, ...fetchInit } = init;

  for (let attempt = 0; attempt <= MAX_RATE_LIMIT_RETRIES; attempt++) {
    if (options.pacePartCreation && attempt === 0) {
      await waitForPartCreationSlot();
    }

    const response = await fetchWithTimeout(`${TOOLPATH_API_BASE}${path}`, {
      ...fetchInit,
      method,
      headers: {
        Authorization: `Bearer ${key}`,
        ...(isWrite ? { "Content-Type": "application/json" } : {}),
        ...(idempotencyKey ? { "Idempotency-Key": idempotencyKey } : {}),
        ...headers,
      },
    });

    if (response.status === 429) {
      const retryAfterSeconds = parseRetryAfterSeconds(
        response.headers.get("Retry-After"),
      );
      reservePartCreationSlotAfterRetry(retryAfterSeconds);

      if (attempt >= MAX_RATE_LIMIT_RETRIES) {
        throw new Error(`Toolpath API error: ${await parseToolpathError(response)}`);
      }

      await sleep(retryAfterSeconds * 1000);
      continue;
    }

    if (!response.ok) {
      throw new Error(`Toolpath API error: ${await parseToolpathError(response)}`);
    }

    return response;
  }

  throw new Error("Toolpath API error: Too many requests");
}

function getFileNameFromS3Path(pathOrUrl: string): string {
  const path = pathOrUrl.startsWith("http")
    ? new URL(pathOrUrl).pathname
    : pathOrUrl;
  const fileName = path.split("/").filter(Boolean).pop();
  return decodeURIComponent(fileName || "part.step");
}

interface PublicProgramListItem {
  id: string;
  url: string;
  partId: string;
  status: "ready" | "processing" | "failed";
  cutConfigId: string | null;
  cutConfigName: string | null;
  createdAt: string;
  updatedAt: string;
}

interface PublicProgramListEnvelope {
  data: {
    programs: PublicProgramListItem[];
  };
}

interface PublicPartEnvelope {
  data: PublicPart;
}

export async function getToolpathPart(partId: string): Promise<PublicPart> {
  const response = await toolpathFetch(toolpathPartPath(partId), {
    method: "GET",
  });
  const body = (await response.json()) as PublicPartEnvelope;
  return body.data;
}

export async function listToolpathProgramsForPart(
  partId: string,
): Promise<PublicProgramListItem[]> {
  const response = await toolpathFetch(`${toolpathPartPath(partId)}/programs`, {
    method: "GET",
  });
  const body = (await response.json()) as PublicProgramListEnvelope;
  return body.data.programs;
}

export async function resolveToolpathReportUrl(opts: {
  partId: string;
  cutConfigId?: string | null;
}): Promise<string | null> {
  const part = await getToolpathPart(opts.partId);
  if (part.status !== "ready") return null;

  const programs = await listToolpathProgramsForPart(opts.partId);
  const program =
    programs.find(
      (entry) =>
        entry.status === "ready" && entry.cutConfigId === opts.cutConfigId,
    ) ??
    programs.find(
      (entry) => entry.status === "ready" && entry.id === part.currentProgramId,
    ) ??
    programs.find((entry) => entry.status === "ready");

  return program?.url ?? null;
}

export async function listCutConfigs(): Promise<PublicCutConfig[]> {
  const response = await toolpathFetch("/cut-configs", { method: "GET" });
  const body = (await response.json()) as CutConfigsEnvelope;
  return body.data.cutConfigs;
}

export async function uploadQuotePartToToolpath(opts: {
  quotePartId: string;
  name: string;
  partFileUrl: string;
  cutConfigId: string;
  units?: "in" | "mm";
  resolveReport?: boolean;
}): Promise<{ toolpathPartId: string; toolpathReportUrl: string | null }> {
  const idempotencyKey = opts.quotePartId;
  const units = opts.units ?? "in";
  const resolveReport = opts.resolveReport ?? true;
  const stepFileName = getFileNameFromS3Path(opts.partFileUrl);

  const createResponse = await toolpathFetch(
    "/parts",
    {
      method: "POST",
      idempotencyKey,
      body: JSON.stringify({
        name: opts.name,
        units,
        stepFileName,
        autoCreateProgram: true,
        cutConfigIds: [opts.cutConfigId],
      }),
    },
    { pacePartCreation: true },
  );
  const createBody = (await createResponse.json()) as CreatePartResponse;
  const fileBuffer = await downloadFromS3(opts.partFileUrl);

  const uploadResponse = await fetchWithTimeout(createBody.upload.url, {
    method: createBody.upload.method,
    body: new Uint8Array(fileBuffer),
  });
  if (!uploadResponse.ok) {
    throw new Error(
      `Toolpath upload failed with status ${uploadResponse.status}`,
    );
  }

  await toolpathFetch(`${toolpathPartPath(createBody.data.id)}/complete`, {
    method: "POST",
    idempotencyKey,
  });

  if (!resolveReport) {
    return {
      toolpathPartId: createBody.data.id,
      toolpathReportUrl: null,
    };
  }

  let toolpathReportUrl: string | null = null;
  try {
    toolpathReportUrl = await resolveToolpathReportUrl({
      partId: createBody.data.id,
      cutConfigId: opts.cutConfigId,
    });
  } catch (error) {
    console.error("Failed to resolve Toolpath report URL after upload:", error);
  }

  return {
    toolpathPartId: createBody.data.id,
    toolpathReportUrl,
  };
}

export async function pollToolpathReportUrl(opts: {
  partId: string;
  cutConfigId: string;
  intervalMs?: number;
  maxWaitMs?: number;
  sleepFn?: (ms: number) => Promise<void>;
}): Promise<string | null> {
  const intervalMs = opts.intervalMs ?? 5_000;
  const maxWaitMs = opts.maxWaitMs ?? 10 * 60 * 1000;
  const sleepFn = opts.sleepFn ?? sleep;
  const deadline = Date.now() + maxWaitMs;

  while (Date.now() < deadline) {
    try {
      const part = await getToolpathPart(opts.partId);

      if (part.status === "failed") {
        throw new Error(
          part.failureReason ||
            part.failureCode ||
            "Toolpath part processing failed",
        );
      }

      if (part.status === "ready") {
        const reportUrl = await resolveToolpathReportUrl({
          partId: opts.partId,
          cutConfigId: opts.cutConfigId,
        });
        if (reportUrl) {
          return reportUrl;
        }
      }
    } catch (error) {
      if (!isTransientToolpathPollError(error)) {
        throw error;
      }

      console.warn(
        `[ToolpathPoll] Transient error polling part ${opts.partId}; will retry`,
        error,
      );
    }

    await sleepFn(intervalMs);
  }

  return null;
}

function isTransientToolpathPollError(error: unknown): boolean {
  if (!(error instanceof Error)) {
    return true;
  }

  if (error.name === "TimeoutError" || error.name === "AbortError") {
    return true;
  }

  const message = error.message.toLowerCase();
  if (
    message.includes("fetch failed") ||
    message.includes("network") ||
    message.includes("econnreset") ||
    message.includes("etimedout") ||
    message.includes("socket")
  ) {
    return true;
  }

  if (message.includes("toolpath api error")) {
    return /status 5\d\d/.test(message) || message.includes("too many requests");
  }

  return false;
}
