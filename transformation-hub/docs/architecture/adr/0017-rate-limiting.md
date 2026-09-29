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
