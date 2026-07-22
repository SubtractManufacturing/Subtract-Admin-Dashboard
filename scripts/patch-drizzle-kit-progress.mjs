/**
 * drizzle-kit bundles TaskTerminal.reject(err) but ProgressView / MigrateProgress
 * render("rejected") like "pending" and ignore `err`, then process.exit(1) — so failures look "silent".
 * Re-apply after every `npm install` (see package.json postinstall).
 */
import { readFileSync, writeFileSync } from "node:fs";
import { join, dirname } from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const binPath = join(root, "node_modules", "drizzle-kit", "bin.cjs");

let bin;
try {
  bin = readFileSync(binPath, "utf8");
} catch (error) {
  const detail = error instanceof Error ? error.message : String(error);
  console.error(`Failed to read drizzle-kit bin at ${binPath}: ${detail}`);
  process.exit(1);
}

const migrateFrom = `      render(status) {
        if (status === "pending" || status === "rejected") {
          const spin = this.spinner.value();
          return \`[\${spin}] applying migrations...\`;
        }
        return \`[\${source_default.green("\\u2713")}] migrations applied successfully!\`;
      }`;

const migrateTo = `      render(status, err2) {
        if (status === "rejected" && err2) {
          const msg =
            err2 instanceof Error ? err2.message || String(err2) : String(err2);
          return \`[\${source_default.red("x")}] \${msg}\`;
        }
        if (status === "pending") {
          const spin = this.spinner.value();
          return \`[\${spin}] applying migrations...\`;
        }
        return \`[\${source_default.green("\\u2713")}] migrations applied successfully!\`;
      }`;

const pushFrom = `      render(status) {
        if (status === "pending" || status === "rejected") {
          const spin = this.spinner.value();
          return \`[\${spin}] \${this.progressText}
\`;
        }
        return \`[\${source_default.green("\\u2713")}] \${this.successText}
\`;
      }`;

const pushTo = `      render(status, err2) {
        if (status === "rejected" && err2) {
          const msg =
            err2 instanceof Error ? err2.message || String(err2) : String(err2);
          return \`[\${source_default.red("x")}] \${msg}
\`;
        }
        if (status === "pending") {
          const spin = this.spinner.value();
          return \`[\${spin}] \${this.progressText}
\`;
        }
        return \`[\${source_default.green("\\u2713")}] \${this.successText}
\`;
      }`;

let next = bin;
let changed = false;

if (next.includes(migrateFrom)) {
  next = next.replace(migrateFrom, migrateTo);
  changed = true;
} else if (!next.includes(migrateTo)) {
  console.error(
    "Could not find migrate progress render block in drizzle-kit bin.cjs (neither original nor already patched).",
  );
  process.exit(1);
}

if (next.includes(pushFrom)) {
  next = next.replace(pushFrom, pushTo);
  changed = true;
} else if (!next.includes(pushTo)) {
  console.error(
    "Could not find push progress render block in drizzle-kit bin.cjs (neither original nor already patched).",
  );
  process.exit(1);
}

if (changed) {
  writeFileSync(binPath, next, "utf8");
}
