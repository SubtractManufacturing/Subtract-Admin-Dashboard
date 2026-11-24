/**
 * Plumbing for the cutover browser run (see README.md): a fake Supabase auth
 * server, the production app server behind the local-only guard, a database
 * connection for seeding and asserting, and Puppeteer helpers.
 */
import { spawn } from "node:child_process";
import { existsSync, mkdirSync } from "node:fs";
import http from "node:http";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import postgres from "postgres";
import puppeteer from "puppeteer";

export const HERE = path.dirname(fileURLToPath(import.meta.url));
export const ROOT = path.resolve(HERE, "../..");

export const WEB_PORT = Number(process.env.E2E_WEB_PORT ?? 15480);
export const AUTH_PORT = Number(process.env.E2E_AUTH_PORT ?? 15481);
export const BASE = `http://127.0.0.1:${WEB_PORT}`;
const AUTH_URL = `http://127.0.0.1:${AUTH_PORT}`;

const LOCAL_HOSTS = new Set(["127.0.0.1", "localhost"]);

/** The throwaway database. Refuses anything that is not on this machine. */
export function databaseUrl() {
  const raw = process.env.E2E_DATABASE_URL;
  if (!raw) throw new Error("Set E2E_DATABASE_URL to a throwaway local Postgres database.");
  const url = new URL(raw);
  if (!LOCAL_HOSTS.has(url.hostname)) {
    throw new Error(`E2E_DATABASE_URL points at ${url.hostname}; only a local throwaway database is allowed.`);
  }
  if (existsSync(path.join(ROOT, ".env"))) {
    throw new Error("A .env file is present in the repository root; move it away before running.");
  }
  console.log(`Database: ${url.hostname}:${url.port}${url.pathname}`);
  return raw;
}

export function connect(url) {
  return postgres(url, { ssl: false, max: 2, onnotice: () => {} });
}

/** Empties every table. Only ever called on the throwaway database. */
export async function resetDatabase(sql) {
  const tables = await sql`select tablename from pg_tables where schemaname = 'public'`;
  if (tables.length === 0) throw new Error("The database has no tables; run db:push against it first.");
  const names = tables.map((row) => `"public"."${row.tablename}"`).join(", ");
  await sql.unsafe(`truncate ${names} restart identity cascade`);
}

// ---------------------------------------------------------------------------
// Fake Supabase auth: the app asks it who a session belongs to.
// ---------------------------------------------------------------------------

const b64url = (value) => Buffer.from(JSON.stringify(value)).toString("base64url");

function authUser(user) {
  return {
    id: user.id,
    aud: "authenticated",
    role: "authenticated",
    email: user.email,
    user_metadata: { name: user.name },
    app_metadata: {},
    created_at: "2026-01-01T00:00:00.000Z",
  };
}

export function startFakeAuth(users) {
  const byId = new Map(users.map((user) => [user.id, user]));
  const server = http.createServer((request, response) => {
    const send = (status, body) => {
      response.writeHead(status, { "content-type": "application/json" });
      response.end(JSON.stringify(body));
    };
    const url = new URL(request.url ?? "/", AUTH_URL);
    if (url.pathname === "/auth/v1/user") {
      const token = (request.headers.authorization ?? "").replace(/^Bearer\s+/i, "");
      try {
        const claims = JSON.parse(Buffer.from(token.split(".")[1] ?? "", "base64url").toString("utf8"));
        const user = byId.get(claims.sub);
        if (user) return send(200, authUser(user));
      } catch {
        // fall through
      }
      return send(401, { message: "invalid token" });
    }
    if (url.pathname === "/auth/v1/logout") return send(204, {});
    return send(404, { message: `fake auth has no ${url.pathname}` });
  });
  return new Promise((resolve) => {
    server.listen(AUTH_PORT, "127.0.0.1", () => resolve(server));
  });
}

/** The cookie @supabase/ssr reads for SUPABASE_URL=http://127.0.0.1:<port>. */
export function sessionCookie(user) {
  const expiresAt = Math.floor(Date.now() / 1000) + 24 * 3600;
  const accessToken = [
    b64url({ alg: "HS256", typ: "JWT" }),
    b64url({ sub: user.id, email: user.email, role: "authenticated", aud: "authenticated", exp: expiresAt }),
    "signature",
  ].join(".");
  const session = {
    access_token: accessToken,
    refresh_token: "e2e-refresh-token",
    token_type: "bearer",
    expires_in: 24 * 3600,
    expires_at: expiresAt,
    user: authUser(user),
  };
  return {
    name: "sb-127-auth-token",
    value: `base64-${Buffer.from(JSON.stringify(session)).toString("base64url")}`,
    url: BASE,
  };
}

// ---------------------------------------------------------------------------
// The app: the production build, with only local settings in its environment.
// ---------------------------------------------------------------------------

function appEnv(url) {
  const keep = ["PATH", "Path", "SystemRoot", "SYSTEMROOT", "TEMP", "TMP", "HOME", "USERPROFILE", "APPDATA", "LOCALAPPDATA", "ComSpec", "PATHEXT", "windir"];
  const env = Object.fromEntries(keep.filter((key) => process.env[key]).map((key) => [key, process.env[key]]));
  return {
    ...env,
    NODE_ENV: "production",
    PORT: String(WEB_PORT),
    DATABASE_URL: url,
    SUPABASE_URL: AUTH_URL,
    SUPABASE_ANON_KEY: "e2e-anon-key",
    SUPABASE_SERVICE_ROLE_KEY: "e2e-service-role-key",
    PUBLIC_APP_URL: BASE,
    S3_ENDPOINT: "http://127.0.0.1:19090",
    S3_REGION: "us-east-1",
    S3_ACCESS_KEY_ID: "test",
    S3_SECRET_ACCESS_KEY: "test",
    S3_BUCKET: "rfq-contract",
    CUTOVER_STARTUP_WAIT_MS: "0",
  };
}

const guard = pathToFileURL(path.join(HERE, "guard.mjs")).href;

function runNode(args, url, { wait }) {
  const child = spawn(process.execPath, ["--import", guard, ...args], {
    cwd: ROOT,
    env: appEnv(url),
    stdio: ["ignore", "pipe", "pipe"],
  });
  let output = "";
  child.stdout.on("data", (chunk) => (output += chunk));
  child.stderr.on("data", (chunk) => (output += chunk));
  const exited = new Promise((resolve) => child.on("exit", (code) => resolve(code)));
  return wait ? exited.then((code) => ({ code, output })) : { child, exited, output: () => output };
}

/** The step `prestart` runs before the web server (after the migration). */
export function runStartupStep(url) {
  if (!existsSync(path.join(ROOT, "build/cutover-startup.js"))) {
    throw new Error("build/cutover-startup.js is missing; run `npm run build` first.");
  }
  return runNode(["build/cutover-startup.js"], url, { wait: true });
}

export async function startApp(url) {
  if (!existsSync(path.join(ROOT, "build/server/index.js"))) {
    throw new Error("build/server/index.js is missing; run `npm run build` first.");
  }
  const app = runNode(["node_modules/@remix-run/serve/dist/cli.js", "build/server/index.js"], url, { wait: false });
  const deadline = Date.now() + 60_000;
  for (;;) {
    try {
      const response = await fetch(`${BASE}/health`);
      if (response.ok) return app;
    } catch {
      // not listening yet
    }
    if (Date.now() > deadline) throw new Error(`The app did not start:\n${app.output()}`);
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
}

// ---------------------------------------------------------------------------
// Browser
// ---------------------------------------------------------------------------

export async function launchBrowser() {
  return puppeteer.launch({
    headless: true,
    defaultViewport: { width: 1600, height: 1000 },
    args: ["--no-sandbox"],
  });
}

/**
 * A signed-in page that records every console error, page error, failed
 * request and 4xx/5xx response. Nothing is filtered out here.
 */
export async function openSession(browser, user, label, problems) {
  const context = await browser.createBrowserContext();
  if (user) await context.setCookie(sessionCookie(user));
  const page = await context.newPage();
  page.setDefaultTimeout(20_000);
  const note = (kind, detail) => problems.push({ label, kind, detail, at: page.url() });
  page.on("console", (message) => {
    if (message.type() === "error") note("console", message.text());
  });
  page.on("pageerror", (error) => note("pageerror", String(error?.message ?? error)));
  page.on("requestfailed", (request) => {
    // A navigation cancels requests still in flight; that is not a failure.
    const reason = request.failure()?.errorText ?? "";
    if (reason !== "net::ERR_ABORTED") note("requestfailed", `${request.method()} ${request.url()} ${reason}`);
  });
  page.on("response", (response) => {
    if (response.status() >= 400) note("response", `${response.status()} ${response.request().method()} ${response.url()}`);
  });
  return { context, page };
}

export async function goto(page, pathname) {
  const response = await page.goto(`${BASE}${pathname}`, { waitUntil: "networkidle0" });
  return response;
}

export async function text(page, selector) {
  return page.$eval(selector, (element) => element.textContent.replace(/\s+/g, " ").trim());
}

export async function texts(page, selector) {
  return page.$$eval(selector, (elements) =>
    elements.map((element) => element.textContent.replace(/\s+/g, " ").trim()),
  );
}

/** Type into a React-controlled input, replacing what is there. */
export async function fill(page, selector, value) {
  await page.click(selector, { clickCount: 3 });
  await page.keyboard.press("Backspace");
  if (value) await page.type(selector, value);
}

export async function clickButton(page, name, scope = "body") {
  const clicked = await page.evaluate(
    (buttonName, scopeSelector) => {
      const root = document.querySelector(scopeSelector);
      const button = [...(root?.querySelectorAll("button, a[role=button]") ?? [])].find(
        (element) => element.textContent.replace(/\s+/g, " ").trim() === buttonName && !element.disabled,
      );
      if (!button) return false;
      button.click();
      return true;
    },
    name,
    scope,
  );
  if (!clicked) throw new Error(`No enabled button "${name}" in ${scope}`);
}

export function shotsDir() {
  const dir = process.env.E2E_SHOTS ?? path.join(HERE, "shots");
  mkdirSync(dir, { recursive: true });
  return dir;
}
