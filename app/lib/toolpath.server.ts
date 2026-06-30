import { downloadFromS3 } from "./s3.server";

const TOOLPATH_API_BASE = "https://app.toolpath.com/api/public/v0";
/** Toolpath allows one POST /parts every 2 seconds per team. */
export const TOOLPATH_PART_CREATION_INTERVAL_MS = 2000;
const MAX_RATE_LIMIT_RETRIES = 5;

let nextPartCreationSlotAt = 0;

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
  const now = Date.now();
  const waitMs = Math.max(0, nextPartCreationSlotAt - now);
  if (waitMs > 0) {
    await sleep(waitMs);
  }
  nextPartCreationSlotAt = Date.now() + TOOLPATH_PART_CREATION_INTERVAL_MS;
}

function reservePartCreationSlotAfterRetry(retryAfterSeconds: number): void {
  const earliestNextSlot =
    Date.now() + retryAfterSeconds * 1000 + TOOLPATH_PART_CREATION_INTERVAL_MS;
  nextPartCreationSlotAt = Math.max(nextPartCreationSlotAt, earliestNextSlot);
}

export function resetPartCreationPacingForTests(): void {
  nextPartCreationSlotAt = 0;
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
  return !!process.env.TOOLPATH_API_KEY;
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
  const key = process.env.TOOLPATH_API_KEY;
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

    const response = await fetch(`${TOOLPATH_API_BASE}${path}`, {
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

const TOOLPATH_REPORT_POLL_INTERVAL_MS = 3000;
const TOOLPATH_REPORT_POLL_TIMEOUT_MS = 120_000;

export async function getToolpathPart(partId: string): Promise<PublicPart> {
  const response = await toolpathFetch(`/parts/${partId}`, { method: "GET" });
  const body = (await response.json()) as PublicPartEnvelope;
  return body.data;
}

export async function listToolpathProgramsForPart(
  partId: string,
): Promise<PublicProgramListItem[]> {
  const response = await toolpathFetch(`/parts/${partId}/programs`, {
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

async function waitForToolpathReportUrl(opts: {
  partId: string;
  cutConfigId: string;
}): Promise<string | null> {
  const deadline = Date.now() + TOOLPATH_REPORT_POLL_TIMEOUT_MS;

  while (Date.now() < deadline) {
    const reportUrl = await resolveToolpathReportUrl(opts);
    if (reportUrl) return reportUrl;
    await sleep(TOOLPATH_REPORT_POLL_INTERVAL_MS);
  }

  return null;
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
}): Promise<{ toolpathPartId: string; toolpathReportUrl: string | null }> {
  const idempotencyKey = crypto.randomUUID();
  const units = opts.units ?? "in";
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

  const uploadResponse = await fetch(createBody.upload.url, {
    method: createBody.upload.method,
    body: new Uint8Array(fileBuffer),
  });
  if (!uploadResponse.ok) {
    throw new Error(
      `Toolpath upload failed with status ${uploadResponse.status}`,
    );
  }

  await toolpathFetch(`/parts/${createBody.data.id}/complete`, {
    method: "POST",
    idempotencyKey,
  });

  const toolpathReportUrl = await waitForToolpathReportUrl({
    partId: createBody.data.id,
    cutConfigId: opts.cutConfigId,
  });

  return {
    toolpathPartId: createBody.data.id,
    toolpathReportUrl,
  };
}
