import { vitePlugin as remix } from "@remix-run/dev";
import { defineConfig } from "vite";
import path from "path";

export default defineConfig({
  plugins: [
    remix({
      ignoredRouteFiles: ["**/*.css"],
      future: {
        v3_relativeSplatPath: true,
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
  },
  ssr: {
    // Don't externalize mupdf in SSR - let it be bundled
    noExternal: ["mupdf"],
  },
  build: {
    target: "es2022",
  },
});
