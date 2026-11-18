import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Remix runs every matched loader/action, not just the layout's, so each
 * `_protected` route module that serves data must call the staff gate itself.
 */
const ROUTES_DIR = path.resolve(__dirname, "../../routes");

function protectedRouteFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const full = path.join(dir, name);
    if (statSync(full).isDirectory()) {
      return name.startsWith("_protected") ? protectedRouteFiles(full) : [];
    }
    return /^_protected.*\.(ts|tsx)$/.test(name) || dir !== ROUTES_DIR
      ? [full]
      : [];
  });
}

const HANDLER = /export\s+(async\s+)?function\s+(loader|action)\b|export\s+const\s+(loader|action)\b/;
const GATE = /\brequire(Staff|Auth)\(/;

describe("protected routes", () => {
  const files = protectedRouteFiles(ROUTES_DIR);

  it("finds the protected route files", () => {
    expect(files.length).toBeGreaterThan(20);
  });

  it.each(files.map((f) => [path.relative(ROUTES_DIR, f), f]))(
    "%s gates its loader/action behind requireStaff",
    (_name, file) => {
      const source = readFileSync(file, "utf8");
      if (HANDLER.test(source)) {
        expect(source).toMatch(GATE);
      }
    },
  );

  it("keeps test files out of the routes directory", () => {
    const stray = readdirSync(ROUTES_DIR).filter((n) => /\.test\.tsx?$/.test(n));
    expect(stray).toEqual([]);
  });
});
