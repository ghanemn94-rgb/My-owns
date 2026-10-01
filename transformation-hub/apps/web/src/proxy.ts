import { NextResponse, type NextRequest } from 'next/server';

/**
 * Request proxy of the web tier (Next.js 16 "proxy", formerly middleware).
 *
 * 1. SEC-P1-04: client-supplied forwarding headers never travel through the web tier to the API, so a browser cannot
 *    spoof its IP address for the API's per-IP rate limiter by sending X-Forwarded-For through the same-origin `/api`
 *    rewrite. In production the ingress/route sends `/api` straight to the API service and is the only trusted hop
 *    (HUB_TRUST_PROXY, ADR-0017); this rewrite exists for local development and evaluation.
 * 2. Nonce-based Content-Security-Policy for every page (P7 hardening): a fresh random nonce per request; scripts run only
 *    when they carry it ('strict-dynamic' lets those scripts load the app's chunks) — no 'unsafe-inline' for scripts.
 *    Next.js reads the nonce from the request's CSP header and puts it on its framework scripts and inline flight data;
 *    every page is rendered per request (the root layout reads cookies), which a nonce requires.
 *    Styles keep 'unsafe-inline': React `style` attributes cannot carry a nonce. Fonts, images and connections stay
 *    same-origin (private mode, AT-22). The static security headers are in next.config.ts.
 */
const FORWARDING_HEADERS = ['x-forwarded-for', 'x-real-ip', 'forwarded', 'true-client-ip', 'cf-connecting-ip'];

export function contentSecurityPolicy(nonce: string, dev = process.env.NODE_ENV !== 'production'): string {
  return [
    "default-src 'self'",
    `script-src 'self' 'nonce-${nonce}' 'strict-dynamic'${dev ? " 'unsafe-eval'" : ''}`,
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: blob:",
    "font-src 'self' data:",
    `connect-src 'self'${dev ? ' ws: wss:' : ''}`,
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "frame-ancestors 'none'",
  ].join('; ');
}

export function proxy(request: NextRequest) {
  const headers = new Headers(request.headers);
  if (request.nextUrl.pathname === '/api' || request.nextUrl.pathname.startsWith('/api/')) {
    for (const h of FORWARDING_HEADERS) headers.delete(h);
    return NextResponse.next({ request: { headers } });
  }
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  const nonce = btoa(String.fromCharCode(...bytes));
  const csp = contentSecurityPolicy(nonce);
  headers.set('content-security-policy', csp);
  headers.set('x-nonce', nonce);
  const response = NextResponse.next({ request: { headers } });
  response.headers.set('Content-Security-Policy', csp);
  return response;
}

// Pages and the API rewrite; never the immutable build assets.
export const config = { matcher: ['/api/:path*', '/((?!_next/static|_next/image|favicon.ico).*)'] };
