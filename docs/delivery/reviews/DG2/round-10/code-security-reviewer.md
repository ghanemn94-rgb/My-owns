# DG2 round 10: code-security-reviewer narrative

**Verdict: PASS.** I reviewed candidate `sha256:7fd1a89c…cb9d484a` (source `fe22d759`, 544 files; HEAD `68fe3394` adds only delivery metadata). I recomputed it in the working tree and in a disposable clone. I authored no DG2 implementation. I formed this verdict without reading any other round-10 record.

## Verifications

| Finding | Result | Basis |
|---|---|---|
| F-DG2-350 (Low): unmatched route + octet-stream gave 400 | **CLOSED_VERIFIED** | r9 S10 now 404 everywhere. My new probes P4a–P4d give 404 + `Connection: close` for every spelling, method and framing: a 10 GB Content-Length, `Expect: 100-continue`, never-ending chunked bodies and duplicate Content-Type lines. A signed-in logout hidden in the body never runs (`/me` still 200). In code, `decideMediaType` returns `unmatched-route` before any check, the Content-Type is deleted, and fastify 5.6.1 `run()` hands `is404` straight to the handler (no catch-all parser exists). |
| F-DG2-351 (Low): HTAB before `;` refused naming application/json | **CLOSED_VERIFIED** | The spelling is now **accepted** and stored byte-exact (the finding's second remedy). So the round-9 S11 assertion, which expected a refusal, fails by design. Every refusal names the declared set (P1, P1b, P4d), and so does the `FST_ERR_CTP_INVALID_MEDIA_TYPE` backstop (P6b). A 20,000-string fuzz of `decideMediaType` against getParser's prefix rule found **0 mismatches**. |

## No-regression review of BE15/BE15B

- **`parseContentType`** is a linear RFC 9110 §8.3.1 tokenizer. It is bounded by the OWS-trimmed end and has no backtracking regex.
- **The canonical rewrite.** The rewrite is written to `raw.headers`, which is what `handleRequest` reads. It is the only writer of request headers in `apps/api/src`.
- **Protections unchanged.** bodyLimit (P2c), strict UTF-8 and prototype poisoning (P2b), CSRF/Origin/session (P3), rate-limit order (P3b, r9 S7), the 25 MiB streaming limit and raw sha256 (P5, P5s) are all unchanged.
- **D-069 (a)/(b)** still stand: r9 S4 and S6 pass.
- **D-070 tightenings.** These are refusal of malformed parameters, of duplicate Content-Type lines and of a non-UTF-8 JSON charset (including `utf8`, which is not an IANA name for UTF-8). They don't affect the web client, which sends only bare `application/json` and `application/octet-stream` (`apps/web/src/api/client.ts:106-107`). Java-style `application/json;charset=UTF-8` is accepted (P2).

## Observations (not raised as findings)

1. **Unmatched-route 404s aren't counted by `@fastify/rate-limit` (P3c).**
   - **Cause.** The plugin hooks routes through `onRoute`, and the not-found handler is not a route.
   - **Scope.** This predates BE15, and ADR-0007 §5b scopes the limiter to "every operation". Unmatched URLs have no operation, run no database query, and now never read the body.
   - **Suggestion.** Worth a hardening ticket for P6 (e.g. `preHandler: app.rateLimit()` on the not-found handler). It isn't a DG2 defect.
2. **An over-limit chunked upload through `inject` throws an AbortError (P5c).**
   - **Behaviour.** The `inject` promise rejects with AbortError and Fastify logs one `request errored` line.
   - **Not a regression.** The behaviour is identical at the round-9 candidate `041478cb`.
   - **Real socket is clean.** Over a real socket (P5s) the client gets a clean 413 `evidence.too_large` and no error log. So this is a light-my-request transport artifact.

## Checks

All of these ran with exit 0:
- build, typecheck, lint, openapi-lint (161 ops), no-cdn and format;
- unit tests 765/765 on Node 22 and on Node 24, and again on both under concurrent load (load average ≈ 8 on 4 vCPU);
- integration 570/570 with LANG unset (SQL_ASCII cluster) and with LANG=C.UTF-8 (UTF8 cluster), both applying 19 migrations;
- the AUD-403 sweep (146/146 per run);
- historical validation of DG0 and DG1.

Environmental residuals (D-057 registry, D-058 CI, D-049 Keycloak) are PASS on the offline/config surface.

Evidence: `docs/delivery/test-evidence/DG2/code-security/round-10/`.
