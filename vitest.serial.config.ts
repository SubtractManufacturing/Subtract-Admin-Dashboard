import { defineConfig } from "vitest/config";

import base from "./vitest.config";

/**
 * The integration tests that run the cutover's Sync (ADR-0014). Sync works on
 * every Customer and Vendor row in the database, so these files must not run
 * beside the other integration tests: `npm run test:ci` runs them afterwards,
 * one file at a time.
 */
export default defineConfig({
  ...base,
  test: {
    ...base.test,
    include: ["app/**/*.serial.integration.test.ts"],
    exclude: ["**/node_modules/**", "**/build/**"],
    fileParallelism: false,
  },
});
