/**
 * Builds the pg-boss worker bundle. Keep `alias['~']` in sync with
 * tsconfig.json compilerOptions.paths ("~/*" -> "./app/*").
 */
import * as esbuild from "esbuild";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, "..");

try {
  await esbuild.build({
    entryPoints: [path.join(repoRoot, "scripts", "worker.ts")],
    bundle: true,
    platform: "node",
    packages: "external",
    format: "esm",
    sourcemap: true,
    outfile: path.join(repoRoot, "build", "worker.js"),
    alias: {
      "~": path.join(repoRoot, "app"),
    },
  });
} catch (err) {
  console.error("[build-worker]", err);
  process.exit(1);
}
