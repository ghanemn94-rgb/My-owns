# DG2 round 7 — code-security-reviewer (T-DG2-REV-SEC-R7)

**Verdict: PASS.** F-DG2-260 is CLOSED_VERIFIED. There is one new Low, non-mandatory finding: F-DG2-290.

- **Candidate:** `sha256:ede1a936…016de` (532 files), source `90439483`. I recomputed it in the working tree and in a disposable clone, at both `90439483` and HEAD `36524e54`. HEAD is the freeze commit and adds only delivery metadata.
- **Independence:** I authored no DG2 implementation. I did not read any other reviewer's round-7 record or evidence.
- **Data:** synthetic only.
- **Gates:** this review grants no business approval. G1–G6 are product gates; this is engineering gate DG2.

## F-DG2-260: verified fixed

- **Round-6 repro.** `zz-sec-r6-surrogate.test.ts`, rerun unchanged, passes 3/3 with LANG unset and with C.UTF-8.
  - A lone surrogate in `sub`, on both the JIT and the bind path, gets the declared `302 /login?error=token_invalid`.
  - Each attempt leaves exactly one `session.login_failed` row and creates no identity and no session.
  - A jsonb-bound journey step name gets `400 validation.invalid_character` at `/steps/0/name`.
- **Code.** One rule (`hasInvalidCharacter` = NUL or `\p{Cs}`) feeds the central check, the shared schemas and the OIDC claim checks.
  - `identityClaimsStorable` also enforces the 1..512 / 1..255 code-point column limits.
  - The callback's new catch maps only SQLSTATE class 22 and 23514, and rethrows everything else.
  - `truncateText` is correct at every boundary (182 exhaustive lengths).
- **Adversarial probe** (`zz-sec-r7-probe.test.ts`, both locales). No lone-surrogate residual in any of these:
  - OIDC claims other than iss/sub, including an astral `sub` at 255 and 256 code points;
  - the callback query (values and keys);
  - headers: Latin-1 decoding means no surrogate is possible, and a User-Agent is stored byte-faithfully as Latin-1;
  - the path;
  - `audit_event`: no U+FFFD in identity, user, session or audit tables.

## Regression review of BE11 and BE12 (product diff 51a692b1..90439483, 27 files)

- **BE11** only replaces `.slice` with `truncateText`, plus an additive X-File-Name refine. No other behaviour change.
- **BE12:**
  - `HELMET_OPTIONS` gives exactly the previous CSP.
  - `captureSecurityHeaders` takes helmet's own output, so the values cannot drift.
  - Over a real socket, every pre-routing error (bad URL, header or URL overflow, NUL in a header, garbage line) is a 400 problem+json. It carries the 12 routed security headers and a requestId, and echoes nothing.
  - `%0d%0a` in the path injects no header.
  - No route, hook or database access runs on these paths, so authorization cannot be bypassed. The global rate limiter (`onRequest`) is unaffected.
  - Pipelined garbage behaves like Fastify's default, and BE12's handler is stricter.
- **D-067 (408):** acceptable. Node's request timeout fires before any operation is matched, Fastify already answered 408, and the treatment matches the shared 404 and 500.

## New finding

**F-DG2-290 (Low, non-mandatory, REQ-DLV-034, owner backend-workflow-engineer).** A JSON body containing raw invalid UTF-8 *bytes* (not a `\u` escape) is mishandled.

- **With a Content-Length:** an undeclared **500 internal**, returned even before authentication (500 instead of 401) and logged at error level.
  - Cause: Fastify decodes the body to U+FFFD, the byte count then mismatches, and Fastify raises `FST_ERR_CTP_INVALID_CONTENT_LENGTH`. `mapError` does not map that code.
- **Chunked:** the request is accepted, and U+FFFD is stored and audited.
- **Impact:** nothing is written on the 500 path, nothing leaks, rate limits apply, and a non-browser client is needed.
- **Fix:** a fatal UTF-8 decode in the JSON parser that answers 400, plus a 400 mapping for the error code. Details are in the findings sidecar and `test-evidence/DG2/code-security/round-7/probes/README.md`.

## Checks: all ran and passed

| Check | Result |
|---|---|
| `pnpm -r build`, `pnpm -r typecheck`, `pnpm lint`, `pnpm format:check` | exit 0 |
| `pnpm openapi:lint` | 161 operations |
| `pnpm check:no-cdn` | PASS |
| `pnpm test` on Node 22 and Node 24 | 673/673 each |
| `pnpm test` under CPU load (load average up to 15 on 4 vCPU) | 673/673 on both versions |
| Integration, LANG unset (SQL_ASCII cluster) | 531/531 |
| Integration, C.UTF-8 (UTF8 cluster) | 531/531 |
| AUD-403 sweep | 146/146 in both runs |
| `validate.mjs --historical` DG0 and DG1 | PASS |

The integration runs include `contract.test.ts` (161-operation assertion), `blank-text`, `oidc`, `invalid-character`, `framework-errors`, `encoding` and migrations 0001→0019.

**Environmental residuals.** These are recorded on the offline and config surface, as the assignment directs: live registry (D-057), live CI (D-058) and Keycloak (D-049).
