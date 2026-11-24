/**
 * Builds the pg-boss worker bundle and the cutover startup step (ADR-0014),
 * which records the stage before the web server or the worker starts. Keep
 * `alias['~']` in sync with tsconfig.json compilerOptions.paths
 * ("~/*" -> "./app/*").
 */
import * as esbuild from "esbuild";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, "..");

try {
  for (const name of ["worker", "cutover-startup"]) {
    await esbuild.build({
      entryPoints: [path.join(repoRoot, "scripts", `${name}.ts`)],
      bundle: true,
      platform: "node",
      packages: "external",
      format: "esm",
      sourcemap: true,
      outfile: path.join(repoRoot, "build", `${name}.js`),
      alias: {
        "~": path.join(repoRoot, "app"),
      },
    });
  }
} catch (err) {
  console.error("[build-worker]", err);
  process.exit(1);
}
