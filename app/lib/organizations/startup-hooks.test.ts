/**
 * The cutover stage is recorded before the web server and before the worker
 * start (ADR-0014). That depends on three lines of package.json and one of
 * the build script; this pins them.
 */
import { readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

const root = path.resolve(__dirname, "../../..");
const scripts = JSON.parse(readFileSync(path.join(root, "package.json"), "utf8")).scripts as Record<string, string>;

describe("the startup step is wired in", () => {
  it("runs before the web server, after the migration", () => {
    expect(scripts.start).toBe("remix-serve build/server/index.js");
    expect(scripts.prestart).toBe("drizzle-kit migrate && node build/cutover-startup.js");
  });

  it("runs before the worker, which does not migrate", () => {
    expect(scripts["start:worker"]).toBe("node build/worker.js");
    expect(scripts["prestart:worker"]).toBe("node build/cutover-startup.js");
  });

  it("runs before the dev servers", () => {
    expect(scripts.predev).toBe("drizzle-kit push && tsx scripts/cutover-startup.ts");
  });

  it("is built with the worker", () => {
    expect(scripts.build).toContain("npm run build:worker");
    expect(readFileSync(path.join(root, "scripts/build-worker.mjs"), "utf8")).toContain('"cutover-startup"');
  });

  it("is started by the container through npm, so the hooks apply", () => {
    const entrypoint = readFileSync(path.join(root, "start.sh"), "utf8");
    expect(entrypoint).toMatch(/npm run start\s/);
    expect(entrypoint).toContain("npm run start:worker");
    expect(entrypoint).not.toMatch(/node build\/(worker|server)/);
  });
});
