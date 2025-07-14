import { vitePlugin as remix } from "@remix-run/dev";
import { defineConfig } from "vite";
import path from "path";

// Custom plugin to resolve TypeScript files
const tsResolverPlugin = () => {
  return {
    name: 'ts-resolver',
    resolveId(source, importer) {
      // Handle ~ alias for lib imports
      if (source.startsWith('~/lib/') && !source.endsWith('.js')) {
        const resolvedPath = source.replace('~/', './app/');
        return path.resolve(__dirname, resolvedPath + '.ts');
      }
      // Handle relative imports in lib directory
      if (importer && importer.includes('/app/lib/') && source.startsWith('./') && !source.endsWith('.js')) {
        const importerDir = path.dirname(importer);
        const resolvedPath = path.resolve(importerDir, source + '.ts');
        return resolvedPath;
      }
      return null;
    },
  };
};

export default defineConfig({
  plugins: [
    remix({
      ignoredRouteFiles: ["**/*.css"],
    }),
    tsResolverPlugin(),
  ],
  resolve: {
    alias: {
      "~": path.resolve(__dirname, "./app"),
    },
    extensions: ['.mjs', '.js', '.mts', '.ts', '.jsx', '.tsx', '.json'],
  },
  ssr: {
    external: [],
  },
  optimizeDeps: {
    include: [],
  },
  build: {
    rollupOptions: {
      external: [],
    },
  },
});
