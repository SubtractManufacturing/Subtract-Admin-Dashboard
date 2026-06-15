import { vitePlugin as remix } from "@remix-run/dev";
import { defineConfig } from "vite";
import path from "path";
import { flatRoutes } from "remix-flat-routes";

export default defineConfig({
  plugins: [
    remix({
      ignoredRouteFiles: ["**/*.css"],
      future: {
        v3_relativeSplatPath: true,
      },
      routes(defineRoutes) {
        return flatRoutes("routes", defineRoutes, {
          ignoredRouteFiles: ["**/*.css", "**/.*"],
        });
      },
    }),
  ],
  resolve: {
    alias: {
      "~": path.resolve(__dirname, "./app"),
    },
    extensions: [".mjs", ".js", ".mts", ".ts", ".jsx", ".tsx", ".json"],
  },
  // Exclude server-only packages from client bundling
  optimizeDeps: {
    exclude: ["mupdf"],
    esbuildOptions: {
      // esbuild 0.28+ errors on destructuring for legacy browser targets unless explicitly allowed
      supported: {
        destructuring: true,
      },
    },
  },
  esbuild: {
    supported: {
      destructuring: true,
    },
  },
  build: {
    target: "es2022",
  },
});
