import path from 'node:path';
import type { NextConfig } from 'next';

/**
 * Web client configuration.
 *
 * - The API is proxied same-origin through a rewrite so the session cookie (`hub_session`, httpOnly) and the
 *   CSRF double-submit cookie (`hub_csrf`) work without CORS. `HUB_API_URL` is read at BUILD time (rewrites are compiled
 *   into the routes manifest of the standalone output); in containers the ingress/route sends `/api` straight to the API
 *   service (see deploy/helm), so the baked-in target is only used for local development.
 * - Security headers are static. The CSP allows `'unsafe-inline'` scripts because the App Router inlines its
 *   flight payload; a nonce-based CSP (via `proxy.ts`) is a documented follow-up (see apps/web/README.md).
 * - Telemetry: run with `NEXT_TELEMETRY_DISABLED=1` (private mode) — see README.
 */
const apiUrl = (process.env.HUB_API_URL ?? 'http://127.0.0.1:4000').replace(/\/+$/, '');
const isDev = process.env.NODE_ENV !== 'production';
const monorepoRoot = path.join(__dirname, '../..');

const csp = [
  "default-src 'self'",
  `script-src 'self' 'unsafe-inline'${isDev ? " 'unsafe-eval'" : ''}`,
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob:",
  "font-src 'self' data:",
  `connect-src 'self'${isDev ? ' ws: wss:' : ''}`,
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  "frame-ancestors 'none'",
].join('; ');

const nextConfig: NextConfig = {
  output: 'standalone',
  reactStrictMode: true,
  poweredByHeader: false,
  // Do not let `next dev` write AGENTS.md/CLAUDE.md into the app (repo agent guidance lives in the root CLAUDE.md).
  agentRules: false,
  // Dev only: the e2e suite and local tooling use http://127.0.0.1:3000 (localhost is allowed by default).
  allowedDevOrigins: ['127.0.0.1'],
  outputFileTracingRoot: monorepoRoot,
  turbopack: { root: monorepoRoot },
  async rewrites() {
    return [{ source: '/api/:path*', destination: `${apiUrl}/api/:path*` }];
  },
  async headers() {
    return [
      {
        source: '/:path*',
        headers: [
          { key: 'Content-Security-Policy', value: csp },
          { key: 'X-Content-Type-Options', value: 'nosniff' },
          { key: 'Referrer-Policy', value: 'no-referrer' },
          { key: 'X-Frame-Options', value: 'DENY' },
          { key: 'Permissions-Policy', value: 'camera=(), microphone=(), geolocation=(), payment=()' },
          { key: 'Cross-Origin-Opener-Policy', value: 'same-origin' },
        ],
      },
    ];
  },
};

export default nextConfig;
