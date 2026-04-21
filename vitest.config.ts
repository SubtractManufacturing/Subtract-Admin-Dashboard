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
    // Load .env before each worker's module graph is built
    setupFiles: ["dotenv/config"],
    include: ["app/**/*.test.ts", "app/**/*.integration.test.ts"],
    exclude: ["**/node_modules/**", "**/build/**"],
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
