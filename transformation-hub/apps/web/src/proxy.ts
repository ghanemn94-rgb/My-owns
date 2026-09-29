import { NextResponse, type NextRequest } from 'next/server';

/**
 * SEC-P1-04: client-supplied forwarding headers never travel through the web tier to the API, so a browser cannot spoof
 * its IP address for the API's per-IP rate limiter by sending X-Forwarded-For through the same-origin `/api` rewrite.
 * In production the ingress/route sends `/api` straight to the API service and is the only trusted hop
 * (HUB_TRUST_PROXY, ADR-0017); this rewrite exists for local development and evaluation.
 */
export function proxy(request: NextRequest) {
  const headers = new Headers(request.headers);
  for (const h of ['x-forwarded-for', 'x-real-ip', 'forwarded', 'true-client-ip', 'cf-connecting-ip']) headers.delete(h);
  return NextResponse.next({ request: { headers } });
}

export const config = { matcher: '/api/:path*' };
