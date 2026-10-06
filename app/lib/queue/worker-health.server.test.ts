import { afterEach, describe, expect, it, vi } from "vitest";

import {
  DEFAULT_WORKER_HEALTH_PORT,
  createWorkerHealthServer,
  getWorkerHealthPort,
  type WorkerHealthServer,
} from "./worker-health.server";

describe("getWorkerHealthPort", () => {
  it("defaults when unset", () => {
    expect(getWorkerHealthPort({})).toBe(DEFAULT_WORKER_HEALTH_PORT);
  });

  it("parses a valid port", () => {
    expect(getWorkerHealthPort({ WORKER_HEALTH_PORT: "4100" })).toBe(4100);
  });

  it("falls back on invalid values", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    expect(getWorkerHealthPort({ WORKER_HEALTH_PORT: "nope" })).toBe(
      DEFAULT_WORKER_HEALTH_PORT,
    );
    expect(getWorkerHealthPort({ WORKER_HEALTH_PORT: "70000" })).toBe(
      DEFAULT_WORKER_HEALTH_PORT,
    );
    warn.mockRestore();
  });
});

describe("createWorkerHealthServer", () => {
  let server: WorkerHealthServer | undefined;

  afterEach(async () => {
    await server?.stop();
    server = undefined;
    vi.restoreAllMocks();
  });

  async function startServer(
    checkDatabase: () => Promise<void> = async () => {},
    extra: { now?: () => number } = {},
  ) {
    server = createWorkerHealthServer({ port: 0, checkDatabase, ...extra });
    await server.start();
    return `http://127.0.0.1:${server.port()}`;
  }

  it("returns 503 while starting without probing the database", async () => {
    const checkDatabase = vi.fn(async () => {});
    const base = await startServer(checkDatabase);

    const res = await fetch(`${base}/health`);
    expect(res.status).toBe(503);
    expect(await res.json()).toMatchObject({ status: "starting" });
    expect(checkDatabase).not.toHaveBeenCalled();
  });

  it("returns 200 when ready and the database is reachable", async () => {
    const base = await startServer();
    server!.setPhase("ready");

    const res = await fetch(`${base}/health`);
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({
      status: "healthy",
      service: "subtract-worker",
      database: "ok",
    });
  });

  it("returns 503 when ready but the database check fails", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const base = await startServer(async () => {
      throw new Error("connection refused");
    });
    server!.setPhase("ready");

    const res = await fetch(`${base}/health`);
    expect(res.status).toBe(503);
    expect(await res.json()).toMatchObject({
      status: "unhealthy",
      database: "error",
    });
  });

  it("returns 503 once shutting down", async () => {
    const base = await startServer();
    server!.setPhase("ready");
    server!.setPhase("shutting_down");

    const res = await fetch(`${base}/health`);
    expect(res.status).toBe(503);
    expect(await res.json()).toMatchObject({ status: "shutting_down" });
  });

  it("caches the database result within the TTL", async () => {
    const checkDatabase = vi.fn(async () => {});
    let clock = 1_000;
    const base = await startServer(checkDatabase, { now: () => clock });
    server!.setPhase("ready");

    await fetch(`${base}/health`);
    await fetch(`${base}/health`);
    expect(checkDatabase).toHaveBeenCalledTimes(1);

    clock += 11_000;
    await fetch(`${base}/health`);
    expect(checkDatabase).toHaveBeenCalledTimes(2);
  });

  it("returns 404 for other paths", async () => {
    const base = await startServer();

    const res = await fetch(`${base}/`);
    expect(res.status).toBe(404);
  });
});
