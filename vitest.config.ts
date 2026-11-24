import path from "path";
import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    alias: {
      "~": path.resolve(__dirname, "./app"),
    },
  },
  test: {
    environment: "node",
    globals: true,
    env: {
      // CI has no .env; email layout rendering requires a base URL for assets
      PUBLIC_APP_URL: "http://localhost:3000",
    },
    // Load .env before each worker's module graph is built
    setupFiles: ["dotenv/config"],
    include: ["app/**/*.test.ts", "app/**/*.test.tsx", "app/**/*.integration.test.ts"],
    // `*.serial.integration.test.ts` files run the cutover's Sync, which works
    // on every Customer and Vendor row. They run on their own, one file at a
    // time, through vitest.serial.config.ts (`npm run test:serial`).
    exclude: [
      "**/node_modules/**",
      "**/build/**",
      "**/*.serial.integration.test.ts",
    ],
    pool: "forks",
    coverage: {
      provider: "v8",
      reporter: ["text", "html"],
      include: ["app/lib/email/**/*.ts"],
      exclude: [
        "**/*.test.ts",
        "**/*.integration.test.ts",
        "**/schema.ts",
      ],
    },
  },
});
