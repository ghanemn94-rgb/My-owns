import path from 'node:path';
import type { NextConfig } from 'next';
import { PHASE_PRODUCTION_BUILD } from 'next/constants';

/**
 * Web client configuration.
 *
 * - The API is proxied same-origin through a rewrite so the session cookie (`hub_session`, httpOnly) and the
 *   CSRF double-submit cookie (`hub_csrf`) work without CORS. `HUB_API_URL` is read at BUILD time (rewrites are compiled
 *   into the routes manifest of the standalone output); in containers the ingress/route sends `/api` straight to the API
 *   service (see deploy/helm), so the baked-in target is only used for local development.
 * - QA-P1-09: a PRODUCTION build without HUB_API_URL is refused (it used to fall back silently to 127.0.0.1:4000, an
 *   address that only exists on a developer machine). `next dev` keeps the local default.
 * - Content-Security-Policy is set per request by `src/proxy.ts` (nonce-based, no 'unsafe-inline' scripts); the other
 *   security headers are static and set here.
 * - Telemetry: run with `NEXT_TELEMETRY_DISABLED=1` (private mode) — see README.
 */
const monorepoRoot = path.join(__dirname, '../..');

export function apiUrlFor(phase: string, env: NodeJS.ProcessEnv = process.env): string {
  const configured = env.HUB_API_URL?.trim();
  if (!configured && phase === PHASE_PRODUCTION_BUILD) {
    throw new Error(
      'HUB_API_URL is required for a production build (the /api rewrite target is fixed at build time), e.g. ' +
        'HUB_API_URL=http://hub-api:4000 pnpm --filter @hub/web build (QA-P1-09; the container build passes it as a build argument)',
    );
  }
  return (configured || 'http://127.0.0.1:4000').replace(/\/+$/, '');
}

export default function config(phase: string): NextConfig {
  const apiUrl = apiUrlFor(phase);
  return {
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
}
