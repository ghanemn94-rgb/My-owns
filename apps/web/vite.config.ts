// Vite config (ADR-0009). Everything is bundled locally: no CDN URLs at build or runtime.
import react from "@vitejs/plugin-react";
import { defineConfig, type Plugin } from "vite";
// Relative source import (not the package name): the config loader resolves bare packages to built dist/, and the
// token CSS must come from the one token source even before `@mth/design-tokens` is built.
import { generateTokensCss } from "../../packages/design-tokens/src/index.ts";

const TOKENS_ID = "virtual:mth-tokens.css";
const RESOLVED_TOKENS_ID = "\0mth-tokens.css";

/** Serves the generated `--mth-*` custom properties (REQ-S15-002) as a regular, bundled CSS module. */
function designTokens(): Plugin {
  return {
    name: "mth-design-tokens",
    resolveId(id) {
      return id === TOKENS_ID ? RESOLVED_TOKENS_ID : null;
    },
    load(id) {
      return id === RESOLVED_TOKENS_ID ? generateTokensCss() : null;
    },
  };
}

export default defineConfig({
  plugins: [react(), designTokens()],
  resolve: {
    // Resolve workspace packages to their TypeScript sources (same condition as tsconfig.base.json).
    conditions: ["@mth/source"],
  },
  build: {
    outDir: "dist",
    sourcemap: true,
    // Fonts and images are emitted as hashed local assets; never inlined from or linked to a remote host.
    assetsInlineLimit: 0,
    rollupOptions: {
      output: {
        // Stable vendor chunks (better caching, no single >500 kB bundle).
        manualChunks(id) {
          if (!id.includes("node_modules")) return undefined;
          if (/[\\/](react|react-dom|scheduler|react-router)[\\/]/.test(id)) return "vendor-react";
          if (/[\\/]@tanstack[\\/]/.test(id)) return "vendor-tanstack";
          if (/[\\/](i18next|react-i18next)[\\/]/.test(id)) return "vendor-i18n";
          if (/[\\/](zod|react-hook-form|@hookform|decimal\.js)[\\/]/.test(id)) return "vendor-forms";
          return "vendor";
        },
      },
    },
  },
  server: {
    // Dev only: the API runs on 3000 and serves the SPA itself in production (single origin, ADR-0005).
    proxy: { "/api": "http://localhost:3000", "/healthz": "http://localhost:3000", "/readyz": "http://localhost:3000" },
  },
});
