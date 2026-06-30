import { downloadFromS3 } from "./s3.server";

const TOOLPATH_API_BASE = "https://app.toolpath.com/api/public/v0";

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
): Promise<Response> {
  const key = process.env.TOOLPATH_API_KEY;
  if (!key) throw new Error("Toolpath API not configured");

  const method = (init.method ?? "GET").toUpperCase();
  const isWrite = ["POST", "PUT", "DELETE", "PATCH"].includes(method);
  if (isWrite && !init.idempotencyKey) {
    throw new Error("Idempotency-Key is required for Toolpath write requests");
  }

  const { idempotencyKey, headers, ...fetchInit } = init;
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

  if (!response.ok) {
    throw new Error(`Toolpath API error: ${await parseToolpathError(response)}`);
  }

  return response;
}

function getFileNameFromS3Path(pathOrUrl: string): string {
  const path = pathOrUrl.startsWith("http")
    ? new URL(pathOrUrl).pathname
    : pathOrUrl;
  const fileName = path.split("/").filter(Boolean).pop();
  return decodeURIComponent(fileName || "part.step");
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
}): Promise<{ toolpathPartId: string }> {
  const idempotencyKey = crypto.randomUUID();
  const units = opts.units ?? "in";
  const stepFileName = getFileNameFromS3Path(opts.partFileUrl);

  const createResponse = await toolpathFetch("/parts", {
    method: "POST",
    idempotencyKey,
    body: JSON.stringify({
      name: opts.name,
      units,
      stepFileName,
      autoCreateProgram: true,
      cutConfigIds: [opts.cutConfigId],
    }),
  });
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

  return { toolpathPartId: createBody.data.id };
}
