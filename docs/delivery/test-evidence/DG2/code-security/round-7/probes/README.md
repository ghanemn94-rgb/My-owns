# code-security-reviewer DG2 round-7 probes (T-DG2-REV-SEC-R7)

I used two disposable clones, both at `90439483`: `$TMPDIR/rev` (checks) and `$TMPDIR/probe` (probes and load generator). The candidate is `sha256:ede1a936…` (532 files). I recomputed it in the clone at `90439483` and again at HEAD `36524e54`, which differs only by delivery metadata.

- **Setup.** Offline `pnpm install --frozen-lockfile` from a scratch copy of the host pnpm store, then `pnpm -r build`.
- **Where the probes ran.** Probe files were copied into `apps/api/test/integration/` of the probe clone only, never into the candidate.
- **Database.** Disposable PostgreSQL 16 clusters (`../with-pg.sh`, ports 55771–55773 and 55781, deleted afterwards).
  - Run 1: LANG unset (SQL_ASCII cluster default).
  - Run 2: LANG=C.UTF-8 (UTF8 cluster).
- **Data.** All data is SYNTHETIC.
- **Reading results.** Each assertion states the secure or declared expectation, so a failing test means a defect was shown. Raw observations are logged as `PROBE <key>: <json>`.

## Logs

- `../probe-run1-lang-unset.log` and `../probe-run2-lang-c-utf8.log`: the final runs. Both give 15 pass and 2 fail, with identical observations.
- `../probe-run0-exploratory-lang-unset.log`: the first exploratory run, before I fixed my probe's Origin header (C1) and before B gained its control rows. It is kept for honesty.
- `../fastify-errcode.log`: shows the root cause (`fastify-invalid-utf8-errcode.mjs`).
- `../truncate-text-edges.log`: `truncate-text-edges.mts`.

## Round-6 repro of F-DG2-260, rerun unchanged: `../../round-6/probes/zz-sec-r6-surrogate.test.ts`

All 3 tests pass in both runs. The fix holds.

| Case | Observed |
|---|---|
| JIT, sub `r6s-jit-\ud800` | 302 `/login?error=token_invalid`, declared by the contract. One `session.login_failed` row, with the reason "issuer or subject cannot be stored". Identities: 0. Login cookie cleared. |
| Bind, sub `r6s-bind-\udfff` + verified e-mail | 302 `token_invalid`, declared. One `session.login_failed` row. Not bound. |
| Journey step name `Synthetic\ud800step` (jsonb) | 400 `validation.invalid_character` at `/steps/0/name`. In round 6 this was `validation.format` at `''`. |

## Round-7 probe: `zz-sec-r7-probe.test.ts`

| Id | Probe | Result |
|---|---|---|
| A1 | sub of exactly 255 astral code points (510 UTF-16 units) | PASS. Signs in; stored verbatim with `char_length` 255. `storableIdentifier` counts code points, as the column CHECK does. |
| A2 | sub of 256 astral code points | PASS. 302 `token_invalid` plus `session.login_failed`; nothing stored. |
| A3 | `name`, `preferred_username` and `email` all carry lone surrogates | PASS. Generated display name `User xxxxxx`; email and `email_at_binding` are null. No U+FFFD. |
| A4 | email `r7-bind@example.invalid\uD800` with `email_verified`, next to a pre-provisioned `r7-bind@example.invalid` | PASS. The pre-provisioned user is not bound. |
| A5 | callback query with `%ED%A0%80` / `%FF%FE` in state, code, error, or a key | PASS. Always a declared 302 (`state_invalid` / `invalid_request`). |
| **B1** | charter create with raw invalid UTF-8 bytes in the JSON body (Content-Length) | **FAIL → F-DG2-290.** The control byte `0x41` gives 201. `ED A0 80`, `FF` and `C3` give **500 `internal`**, which is undeclared. Nothing is stored or audited. |
| **B2** | the same, unauthenticated, over a real socket | **FAIL → F-DG2-290.** The control gives 401. Invalid bytes give **500 before 401**. |
| B3 | the same, chunked (no Content-Length), authenticated | Observed **201**. `out_of_scope` is stored as `Synthetic� text`, and the `charter.create` audit row's `changes` holds U+FFFD too. The bytes are silently rewritten (part of F-DG2-290). |
| C1 | dev-login over a real socket, User-Agent bytes `ED A0 80` + UTF-8 Arabic | PASS. 204. `session.user_agent` is the exact Latin-1 reading of the bytes (`í \u0080 Ø§`): well-formed, no U+FFFD. This is HTTP header semantics (obs-text), byte-faithful. Not a defect. |
| C2 | X-Request-Id with high bytes, markup, or 129 characters | PASS. Never reflected; a UUIDv7 is generated. |
| D1 | pre-routing errors over a real socket: CESU path, unauthenticated POST with `%ZZ`, header overflow, URL overflow, NUL in a header, garbage request line, `%0d%0a` in the path | PASS. Each is a 400 `application/problem+json` with `validation.format` / `headers_too_large` / `malformed_request`. The security headers are identical to a routed 404's, CSP unchanged. `requestId` equals X-Request-Id. No echo of the input (no FST_ERR/HPE_/%ED/%ZZ/payload). The `%0d%0a` case gets no injected header. |
| D2 | bad URL on a protected mutation, as a signed-in user without permission | PASS. 400 `validation.format`; no audit row and no write. Nothing past the router runs, so this is no authorization bypass. |
| D3 | pipelined valid request + garbage on one socket | Observation: one 400, then close. This is the same outcome as Fastify's default `clientErrorHandler`, which writes whenever the socket is writable. BE12's handler is stricter: it never writes into a started response. No 5xx and no interleaving. |
| E1 | sweep of `user_identity`, `app_user`, `session` and `audit_event` for U+FFFD in both databases, after A–D | PASS. 0 everywhere. B3's row is in `charter`/`audit_event` of the main DB, which this sweep does not assert; it is reported by B3. |

## Root cause of F-DG2-290 (`../fastify-errcode.log`)

Fastify 5.6.1 `lib/contentTypeParser.js` `rawBody` reads a JSON body with `payload.setEncoding('utf8')`, so every invalid byte sequence becomes U+FFFD. It then counts `Buffer.byteLength` of the decoded chunks, where U+FFFD counts 3 bytes. When a Content-Length is present, the count no longer matches, and Fastify raises `FST_ERR_CTP_INVALID_CONTENT_LENGTH` (statusCode 400, "Request body size did not match Content-Length").

The product's `mapError` (`apps/api/src/modules/platform/hooks.ts:54-80`) has no case for that code, so `setErrorHandler` (`:142-149`) logs "unhandled error" at error level and answers 500 `internal`.

Body parsing runs before the `preValidation` authentication hook (`apps/api/src/modules/identity/routes.ts:120`), so no session is needed. Without Content-Length (chunked), no length check runs, and the U+FFFD text is parsed and stored.

This is pre-existing by code inspection, not executed. `git grep INVALID_CONTENT_LENGTH` finds nothing at either 51a692b1 or 90439483, and the default JSON parser and the unmapped-error 500 path are unchanged, so it is not a regression of BE11/BE12. It is newly found in this round's assigned well-formedness probe.
