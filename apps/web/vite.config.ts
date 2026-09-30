// Vite config (ADR-0009). Everything is bundled locally: no CDN URLs at build or runtime.
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

export default defineConfig({
  plugins: [react()],
  resolve: {
    // Resolve workspace packages to their TypeScript sources (same condition as tsconfig.base.json).
    conditions: ["@mth/source"],
  },
  build: {
    outDir: "dist",
    sourcemap: true,
    // Fonts and images are emitted as hashed local assets; never inlined from or linked to a remote host.
    assetsInlineLimit: 0,
  },
  server: {
    // Dev only: the API runs on 3000 and serves the SPA itself in production (single origin, ADR-0005).
    proxy: { "/api": "http://localhost:3000", "/healthz": "http://localhost:3000", "/readyz": "http://localhost:3000" },
  },
});
