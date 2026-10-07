import http from "node:http";
import type { AddressInfo } from "node:net";

/**
 * Minimal HTTP health endpoint for the pg-boss worker process.
 *
 * The worker has no web server, so container healthchecks (Docker,
 * Coolify, ECS, Kubernetes, ...) need something to probe. `GET /health`
 * returns 200 only when the worker has finished starting, is not shutting
 * down, and can reach the database.
 */

export const DEFAULT_WORKER_HEALTH_PORT = 3001;

const DB_CHECK_TTL_MS = 10_000;
const DB_CHECK_TIMEOUT_MS = 2_000;

export type WorkerHealthPhase = "starting" | "ready" | "shutting_down";

type DatabaseStatus = "ok" | "error" | "unknown";

export interface WorkerHealthOptions {
  /** Port to listen on. Use 0 to let the OS pick one (tests). */
  port: number;
  /** Resolves when the database is reachable, rejects otherwise. */
  checkDatabase: () => Promise<void>;
  /** How long a database check result is reused. */
  dbCheckTtlMs?: number;
  dbCheckTimeoutMs?: number;
  now?: () => number;
}

export interface WorkerHealthServer {
  start(): Promise<void>;
  stop(): Promise<void>;
  setPhase(phase: WorkerHealthPhase): void;
  /** Bound port; only valid after `start()` resolves. */
  port(): number;
}

export function getWorkerHealthPort(
  env: Record<string, string | undefined> = process.env,
): number {
  const raw = env.WORKER_HEALTH_PORT;
  if (!raw) return DEFAULT_WORKER_HEALTH_PORT;

  const parsed = Number(raw);
  if (!Number.isInteger(parsed) || parsed < 1 || parsed > 65535) {
    console.warn(
      `[Worker] Invalid WORKER_HEALTH_PORT "${raw}", using ${DEFAULT_WORKER_HEALTH_PORT}`,
    );
    return DEFAULT_WORKER_HEALTH_PORT;
  }
  return parsed;
}

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  let timer: NodeJS.Timeout | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(
      () => reject(new Error(`Timed out after ${ms}ms`)),
      ms,
    );
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

export function createWorkerHealthServer(
  options: WorkerHealthOptions,
): WorkerHealthServer {
  const {
    checkDatabase,
    dbCheckTtlMs = DB_CHECK_TTL_MS,
    dbCheckTimeoutMs = DB_CHECK_TIMEOUT_MS,
    now = Date.now,
  } = options;

  const startedAt = now();
  let phase: WorkerHealthPhase = "starting";
  let cachedDb: { status: DatabaseStatus; checkedAt: number } | null = null;
  let inFlightDbCheck: Promise<DatabaseStatus> | null = null;

  async function getDatabaseStatus(): Promise<DatabaseStatus> {
    if (cachedDb && now() - cachedDb.checkedAt < dbCheckTtlMs) {
      return cachedDb.status;
    }

    // Share one check between concurrent probes.
    inFlightDbCheck ??= withTimeout(checkDatabase(), dbCheckTimeoutMs)
      .then((): DatabaseStatus => "ok")
      .catch((error: unknown): DatabaseStatus => {
        console.error("[Worker] Health check database probe failed:", error);
        return "error";
      })
      .then((status) => {
        cachedDb = { status, checkedAt: now() };
        inFlightDbCheck = null;
        return status;
      });

    return inFlightDbCheck;
  }

  async function buildResponse(): Promise<{
    statusCode: number;
    body: Record<string, unknown>;
  }> {
    let database: DatabaseStatus = "unknown";
    let status: "healthy" | "starting" | "shutting_down" | "unhealthy";

    if (phase === "ready") {
      database = await getDatabaseStatus();
      status = database === "ok" ? "healthy" : "unhealthy";
    } else {
      status = phase;
    }

    return {
      statusCode: status === "healthy" ? 200 : 503,
      body: {
        status,
        service: "subtract-worker",
        database,
        uptimeSeconds: Math.floor((now() - startedAt) / 1000),
      },
    };
  }

  const server = http.createServer((req, res) => {
    const path = (req.url ?? "").split("?")[0];

    if (path !== "/health" || (req.method !== "GET" && req.method !== "HEAD")) {
      res.writeHead(404, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "Not found" }));
      return;
    }

    buildResponse()
      .then(({ statusCode, body }) => {
        res.writeHead(statusCode, {
          "Content-Type": "application/json",
          "Cache-Control": "no-cache, no-store, must-revalidate",
        });
        res.end(req.method === "HEAD" ? undefined : JSON.stringify(body));
      })
      .catch((error: unknown) => {
        console.error("[Worker] Health endpoint error:", error);
        res.writeHead(503, { "Content-Type": "application/json" });
        res.end(
          JSON.stringify({ status: "unhealthy", service: "subtract-worker" }),
        );
      });
  });

  return {
    start() {
      return new Promise<void>((resolve, reject) => {
        server.once("error", reject);
        server.listen(options.port, "0.0.0.0", () => {
          server.off("error", reject);
          resolve();
        });
      });
    },

    stop() {
      return new Promise<void>((resolve) => {
        if (!server.listening) {
          resolve();
          return;
        }
        server.close(() => resolve());
        server.closeAllConnections();
      });
    },

    setPhase(next) {
      phase = next;
    },

    port() {
      return (server.address() as AddressInfo).port;
    },
  };
}
