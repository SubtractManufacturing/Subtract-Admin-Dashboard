import { existsSync } from "node:fs";
import { spawnSync } from "node:child_process";

if (!existsSync("node_modules/husky")) {
  process.exit(0);
}

const result = spawnSync("husky", { stdio: "inherit", shell: true });
process.exit(result.status === null ? 1 : result.status);
