# ADR-0017 — API rate limiting

- Status: Accepted · Date: 2026-09-29
- Requirements: REQ-DAT-016 (rate limits), spec §14; ARCH-20

## Decision
In-process fixed-window limiter (`RateLimiter`) applied by the global guard: per session for reads
(`HUB_RATE_LIMIT_PER_MINUTE`, default 600) and mutations (`HUB_RATE_LIMIT_MUTATIONS_PER_MINUTE`, default 120), and per
IP for public routes (`HUB_RATE_LIMIT_PUBLIC_PER_MINUTE`, default 60). Exceeding returns 429 problem+json.

## Consequences
With several API replicas the effective limit multiplies; production deployments should add an ingress/gateway limiter
(documented in the deployment guide). Values are proposals to be tuned from load tests (P7).

## Caveat (P0 architecture re-review)
The public-route limiter keys on `req.ip`. Behind an ingress/reverse proxy, set `HUB_TRUST_PROXY=true` (and configure
the proxy to overwrite `X-Forwarded-For`); otherwise all clients share the proxy's address and one 60/min bucket.

## Amendment (P1 security review SEC-P1-04)
- `HUB_TRUST_PROXY` accepts `false` (default), a hop count (`true` = 1) or a comma list of trusted proxy
  addresses/CIDRs; it is never "trust everyone". Set it to exactly the ingress/route in front of the API.
- **Supported production topology:** the ingress/route sends `/api` straight to the API service (Helm chart) and appends
  the client address to `X-Forwarded-For`; the API trusts that one hop. The web tier's same-origin `/api` rewrite is for
  development/evaluation; its proxy (`apps/web/src/proxy.ts`) strips client-supplied `X-Forwarded-For`, `X-Real-IP` and
  `Forwarded`, so a browser cannot spoof its address through it. Residual (dev/eval only): behind the rewrite all clients
  share the web server's public-route bucket.
- An ingress-level limiter remains recommended in production (multi-replica API).

