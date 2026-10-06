# Handback T-DG2-BE13: ill-formed UTF-8 input gets the declared 400 (backend-workflow-engineer)

- **Stage:** P2 / DG2 (FIXING), branch `claude/mobily-transformation-platform-regate`.
- **Assignment:** `docs/delivery/assignments/DG2/round-8/T-DG2-BE13.md`. I checked its sha256 `7b725e83eb69abce3a64f8faab9077da344d3d52f6bc8bdc496375d574ade6d3` before starting.
- **Base:** `HEAD` = `4e3c44625ca030bfff7052003476955f2dec3e1e`. The tree was clean apart from the sandbox-masked dotfiles.
- **Invocation:** `DG2-T-DG2-BE13-backend-workflow-engineer-20261006T161202Z-0ab93e55`, session `0ab93e55-9286-4dfe-9ab9-2cc0ad05181d`.
- **Finding repaired:** F-DG2-290 (Low, REQ-DLV-034). The orchestrator records `import-findings --fix`. I don't close my own finding.
- **Not changed:**
  - no migrations and no new API endpoints;
  - no change to `docs/api/openapi.yaml`, migrations 0001–0019, `tools/**`, `.claude/**` or `docs/source/**`;
  - no new error codes: every code used already has EN and AR strings in `apps/web/src/i18n/{en,ar}/problems.json` (`validation__json`, `validation__format`, `validation__file_name`, `validation__malformed_request`).
- G1–G6 are product business approvals and are unrelated to DG0–DG7. All test data is synthetic.

## 1. Changed files

| File | Purpose |
|---|---|
| `apps/api/src/modules/platform/request-encoding.ts` (new) | Strict UTF-8 body decoder, the `application/json` parser factory, the strict query-string parser and the query check |
| `apps/api/src/modules/platform/hooks.ts` | Maps `FST_ERR_CTP_INVALID_CONTENT_LENGTH` to 400. The central `preHandler` check now runs `assertDecodableQuery` before the U+0000/lone-surrogate check |
| `apps/api/src/modules/platform/index.ts` | Exports the new platform functions |
| `apps/api/src/server.ts` | Registers the JSON parser (`parseAs: "buffer"`) and `routerOptions.querystringParser`. Adds the test-only `ServerOptions.logStream`, the logger destination |
| `apps/api/src/modules/evidence/routes.ts` | `decodeFileName`: an X-File-Name holding a percent escape that is not UTF-8 is now 400 `validation.file_name`, not stored literally (exported for unit tests) |
| `apps/api/test/support/harness.ts` | `startApi({ logStream })` captures server log lines |
| `apps/api/src/modules/platform/request-encoding.test.ts` (new) | Unit tests of the pure functions |
| `apps/api/src/request-encoding.test.ts` (new) | Unit tests: the parser and query check wired into a bare Fastify instance, plus `decodeFileName`. It sits at the src root, like `server.test.ts`, because it needs a `node:stream` body, which module source may not import (ADR-0002 / D-055) |
| `apps/api/test/integration/invalid-utf8.test.ts` (new) | Integration tests on real PostgreSQL (14 tests) |
| `docs/delivery/handbacks/DG2/T-DG2-BE13-evidence/*.log` | Check logs |

## 2. The fix (F-DG2-290, REQ-DLV-034)

### 2.1 JSON bodies

`server.ts` registers, on the root instance, this parser for every module:

```ts
app.addContentTypeParser("application/json", { parseAs: "buffer" }, createJsonBodyParser(app.getDefaultJsonParser("error", "error")));
```

1. **Raw bytes.** Fastify now counts raw bytes against `Content-Length`, so a well-framed body never trips `FST_ERR_CTP_INVALID_CONTENT_LENGTH` because of decoding.
2. **Strict decoding.** `decodeUtf8Body` uses a fresh `new TextDecoder("utf-8", { fatal: true, ignoreBOM: true })` per request. It rejects every ill-formed sequence: invalid bytes, truncated sequences, overlong forms, CESU-8 surrogates and values above U+10FFFF.
3. **On failure:** 400 problem, `errors: [{ pointer: "", code: "validation.json", message: "The request body is not valid UTF-8 JSON." }]`. The handler never runs, so nothing is written and no audit row is created.
4. **On success:** the text goes to **Fastify's own default JSON parser** (secure-json-parse with `onProtoPoisoning`/`onConstructorPoisoning: "error"`, the Fastify defaults). Empty-body and invalid-JSON errors and prototype-poisoning protection are therefore the same code as before.

**Code choice: `validation.json`, not `validation.invalid_character`.**

- RFC 8259 §8.1 requires JSON exchanged between systems to be UTF-8. A body that is not UTF-8 is not a JSON text, which is the same classification and code as every other undecodable body (invalid or empty JSON).
- `validation.invalid_character` means a *decoded* U+0000 or lone surrogate at a *field* pointer. A raw-byte failure happens before any field exists, so it has no field to point at.

**BOM: accepted and stripped.**

- One leading UTF-8 BOM (EF BB BF) is stripped. RFC 8259 §8.1 lets a parser ignore it, and the old default parser stripped one too (secure-json-parse), so behaviour is unchanged.
- A second U+FEFF is not JSON whitespace, so it is refused as `validation.json`. I check this explicitly, because secure-json-parse would otherwise silently strip a second one.
- A body that is only a BOM is empty after stripping, so it gets `validation.json`.

**Unchanged:**

- `JSON_BODY_LIMIT_BYTES`: the same limit for both framings (tested).
- Media-type checks (`FST_ERR_CTP_INVALID_MEDIA_TYPE`).
- The central U+0000/lone-surrogate check, which still runs after parsing in `preHandler` (tested).
- The evidence `application/octet-stream` parser, which is separate and untouched.

**Precedence.** Body parsing runs before identity's `preValidation` hook, so an unauthenticated request with such a body gets the declared 400. Invalid JSON already behaved this way. Never 500.

**Defence in depth.** `mapError` now maps `FST_ERR_CTP_INVALID_CONTENT_LENGTH` to 400 `validation.malformed_request` ("The request body does not match its Content-Length."). Before, it was an unmapped 500 logged as `unhandled error`.

### 2.2 Query strings

`routerOptions.querystringParser: parseQueryString` replaces fast-querystring:

- **Same shape:** a null-prototype object; `&` pairs; the first `=` splits key and value; `+` is a space; `key` alone gives `""`; repeated keys become arrays; empty segments are skipped.
- **Strict decoding.** Each component is decoded with `decodeURIComponent`, which throws on invalid UTF-8 and on CESU-8 surrogates.
- **Undecodable components.** One keeps its raw text, so routes exempt from the central check behave as before. The object is also recorded in a module-private `WeakMap` with the pointer of the first bad component: `/query/<key>`, or `/query` when the key itself is undecodable, because the raw key is never echoed.
- **Never throws:** it runs inside the router, before any hook.
- **The check.** The central `preHandler` hook calls `assertDecodableQuery`, which gives 400 `validation.format` "The query string contains an invalid percent-encoding." at that pointer. This is the same code as the path's `FST_ERR_BAD_URL`.
- **Precedence.** It runs after authentication and CSRF, so 401/403 keep their precedence (tested), and the rate limiter, which runs at `onRequest`, still applies.
- **Exempt route.** The OIDC callback (`invalidCharacters: "route"`), whose contract declares only its redirect, keeps its 302 behaviour (tested).

### 2.3 X-File-Name (found in the sweep)

The web client sends `encodeURIComponent(file.name)`. Before, a malformed encoding was "taken literally", so `report%FF.csv` was **stored** as that raw percent text. Now:

- a name that contains a percent escape (`%HH`) but does not decode as UTF-8 gets 400 `validation.file_name` at `/header/X-File-Name`, with no revision and no audit row;
- a name with a stray `%` and no escape at all (`50%.csv`) is still taken literally.

## 3. Sweep: every place where client bytes become strings

| Place | Before | After | Status declared? |
|---|---|---|---|
| JSON body, with `Content-Length` | Invalid bytes became U+FFFD, then a length mismatch, then **500 `internal`** (pre-auth), logged `unhandled error` | **400** `validation.json`, pointer `""`; no write, no audit, no error log | Yes: 400 ValidationError on every JSON operation |
| JSON body, chunked | Invalid bytes became U+FFFD, then **201, stored and audited** | **400** `validation.json`; no write, no audit | Yes |
| JSON body, BOM | One BOM stripped (secure-json-parse) | One BOM stripped (explicit); a second one gives 400 `validation.json` | Yes |
| Body length mismatch (`FST_ERR_CTP_INVALID_CONTENT_LENGTH`) | Unmapped, **500** | 400 `validation.malformed_request` | Yes |
| Query string (`?q=%FF`, `?q=%ED%A0%80`, `?q=%C3`) | Reached the handler as the **literal raw text** (`GET /transformations?q=%FF` gave 200 and searched for "%FF") | **400** `validation.format` at `/query/q`, after auth | Yes: every operation except the callback declares 400 |
| Query string on the OIDC callback (exempt) | Raw text, declared 302 (`state_invalid`/`invalid_request`) | Unchanged: raw-text fallback, declared 302 | Yes (302) |
| Path parameters | `FST_ERR_BAD_URL`, then 400 `validation.format` (BE12) | **Unchanged, confirmed.** find-my-way raises `FST_ERR_BAD_URL` for `%FF`, `%C3` and `%ED%A0%80`; `%C3%A9` decodes to `é` (`path-params-bad-url-probe.log`). BE12's `framework-errors.test.ts` passes in all four runs | Yes |
| Session cookie | `cookie` decodes with `decodeURIComponent` and **keeps the raw text** on failure (never U+FFFD). `resolveSession` accepts only `^[A-Za-z0-9_-]{43}$` before any query; the limiter uses it only as a map key | Unchanged. An undecodable or high-byte cookie is no session: **401**, never reaches PostgreSQL (new test) | Yes (401) |
| CSRF token (`X-CSRF-Token`) | Header values are Latin-1 decoded (byte-faithful, never U+FFFD or surrogates). Compared only as a SHA-256 hash, max 256 | Unchanged. High bytes or `%FF` give **403 `csrf`** (new test) | Yes (403) |
| User-Agent (stored on `session`) | Latin-1, byte-faithful (reviewer C1 confirmed: no U+FFFD); U+0000/surrogate guard; NUL refused by Node | Unchanged. HTTP header semantics (obs-text), not a rewrite | n/a (stored, not answered) |
| `X-Request-Id` | Adopted only if `^[A-Za-z0-9._-]{1,128}$`, otherwise UUIDv7 | Unchanged. High bytes or `%FF` are never adopted (new test) | n/a |
| `X-File-Name` (stored on evidence) | `decodeURIComponent`, falling back to the **raw percent text stored** | Escape that is not UTF-8 gives **400** `validation.file_name`; stray `%` without escapes is literal | Yes: the upload operation declares 400 |
| `If-Match`, `Idempotency-Key` | ASCII regex / zod schema; anything else is 400 | Unchanged | Yes |
| `Origin`, `Referer` | Exact compare / `new URL` in try | Unchanged; mismatch gives 403 `csrf` | Yes |
| `application/octet-stream` (evidence content) | Binary, never decoded | Unchanged | — |

## 4. Tests

### Integration: `apps/api/test/integration/invalid-utf8.test.ts` (real PostgreSQL 16, 14 tests)

Every response is asserted against the OpenAPI contract, except where noted under the rate limit.

- **Charter create (POST), `Content-Length` and chunked.** Sequences tested: `FF`, `C3` and `ED A0 80`.
  - Result: 400 `validation.json`.
  - Nothing is written (charter GET gives 404), and there is no audit row for the request id.
  - **No log line at level ≥ 50 and no `unhandled error`** for the request id. The server runs with a live logger captured through `logStream`, and the test asserts that lines were logged.
  - No audit row anywhere in the transformation contains U+FFFD.
  - Control: byte `0x41` gives 201.
- **Charter update (PATCH, If-Match), both framings:** 400. Version, value and audit trail are unchanged.
- **T03 TOM gap create, both framings:** 400. The gap count is unchanged.
- **Unauthenticated (no cookie, no CSRF), both framings:** 400, never 500. Control: a valid body without a session gives 401.
- **Real socket**, the reviewer's framing (`Content-Length` and `Transfer-Encoding: chunked`), anonymous and signed in: 400 `validation.json`, nothing stored, no error log.
- **Valid UTF-8 round-trip.** Arabic and emoji (including a ZWJ sequence), both framings: 201. The stored `charter.out_of_scope` is byte-identical, and the audit row holds the exact text.
- **BOM.** A leading EF BB BF, both framings: 201 with the exact text.
- **Query.**
  - `?q=%FF`, `%ED%A0%80` and `%C3` on `GET /transformations`: 400 `validation.format` at `/query/q`; the raw text is not echoed. Control: a well-formed `q` gives 200.
  - Without a session: 401.
  - The OIDC callback with bad escapes: not 400 and not 5xx.
- **X-File-Name `report%FF.csv`:** 400 `validation.file_name`. Version and audit are unchanged. Control: the encoded Arabic name gives 200 and is stored decoded.
- **Cookie/header sweep:** undecodable session cookies give 401; a CSRF token with high bytes gives 403 `csrf`; an `X-Request-Id` with high bytes or escapes is never adopted.
- **Rate limit.** With `RATE_LIMIT_PER_MINUTE=3`, invalid-UTF-8 bodies give `[400, 400, 400, 429, 429]`.
  - This call alone skips the contract assertion, because `createCharter` does not declare 429 (see §6).
  - The 400 and 429 bodies are asserted directly.

### Unit tests (38 files, 691 tests in total)

- **`modules/platform/request-encoding.test.ts`** (7 tests):
  - `decodeUtf8Body`: verbatim for valid input, including U+FFFD itself; null for nine ill-formed classes; exactly one BOM stripped;
  - `parseQueryString`: shape parity, strict marking, pointer escaping, a bad key gives `/query`;
  - foreign objects are never marked.
- **`src/request-encoding.test.ts`** (11 tests): a bare Fastify instance with `registerPlatformHooks`:
  - invalid UTF-8 gives the same 400 with `Content-Length` and streamed;
  - valid Arabic/emoji round-trip;
  - BOM accepted once, refused twice;
  - empty, invalid JSON, `__proto__` poisoning and the body limit (both framings) all unchanged;
  - a Content-Length mismatch is 400, not 500;
  - the lone-surrogate central check still runs;
  - the query check;
  - exempt-route fallback;
  - `decodeFileName`.

### Negative control (the new tests fail on the old code)

The production files were restored to `HEAD` 4e3c4462 with `git show HEAD:<file> > <file>`, keeping only the test-only `logStream` option. I ran the new tests, then restored the fix (`git diff --stat` is in each log).

- **`negative-control-integration.log`: 8 failed, 4 passed (exit 1).**
  - The undeclared **500** is reproduced on charter create, charter PATCH, TOM-gap create, unauthenticated and over the real socket.
  - `?q=%FF` gave **200** `{"items":[]}`.
  - X-File-Name was stored as `"fileName":"report%FF.csv"`.
  - The rate-limit test failed (500, not 400).
  - The 4 tests that pass are regression guards: round-trip, BOM, 401 precedence, callback.
  - This run predates the later cookie/header sweep `describe`. Those 2 tests are regression guards too, and I expect them to pass on the old code.
- **`negative-control-unit.log`: both new unit files fail (exit 1).** `request-encoding.ts` does not exist at HEAD.

## 5. Checks actually run

The matrix is in `matrix-commands.log`, which is the `checks.sh` I ran. Each mode ran **sequentially and alone**:

- **nolocale** (`env -u LANG -u LC_ALL -u LC_*`): 16:47–16:55Z;
- **cutf8** (`LANG=C.UTF-8`): 16:39–16:47Z.

Setup: Node 24.21.0, with Node 22.22.2 for check 07. PostgreSQL 16.13 disposable clusters (`server_encoding UTF8`). Playwright uses the pre-installed Chromium (`PLAYWRIGHT_BROWSERS_PATH=/opt/pw-browsers`). Each log holds the full output, its command and its exit status.

| # | Command | nolocale | cutf8 |
|---|---|---|---|
| 01 | `pnpm -r typecheck` | exit 0 | exit 0 |
| 02 | `pnpm -r build` | exit 0 | exit 0 |
| 03 | `pnpm lint` | exit 0 | exit 0 |
| 04 | `pnpm format:check` | exit 2: only the 12 sandbox-masked dotfiles (`EACCES` on `.bash_profile` … `CLAUDE.local.md`); "All matched files use Prettier code style!" | exit 0, "All matched files use Prettier code style!" |
| 05 | `npx prettier --check . !.bash_profile … !CLAUDE.local.md` (the masked-dotfile variant) | exit 0 | exit 0 |
| 06 | `pnpm openapi:lint` | exit 0, `PASS docs/api/openapi.yaml: OpenAPI 3.1.1, 161 operations` | exit 0, same |
| 07 | `pnpm test` (Node 22.22.2) | exit 0, `Test Files 38 passed (38)`, `Tests 691 passed (691)` | exit 0, 38/38, 691/691 |
| 08 | `pnpm test` (Node 24.21.0) | exit 0, 38/38, 691/691 | exit 0, 38/38, 691/691 |
| 09a | `QA_PG_PORT=55471 tests/qa/support/with-pg.sh pnpm test:integration` (run 1) | exit 0, `Test Files 33 passed (33)`, `Tests 545 passed (545)` | exit 0, 33/33, 545/545 |
| 09b | the same (run 2) | exit 0, 33/33, 545/545 | exit 0, 33/33, 545/545 |
| 10 | `with-stack.sh npx playwright test journeys.spec.ts p2-journeys.spec.ts p2-blank-text.spec.ts --project=chromium-en --project=chromium-ar --workers=1` (ports 55491/3601 and 55492/3602) | exit 0, `58 passed (3.6m)` | exit 0, `58 passed (3.6m)` |
| 11 | `node tools/gates/validate.mjs --historical --stage DG1` | exit 0, `PASS gate DG1 (historical)` | exit 0, same |

In all four integration runs, `contract.test.ts` (14), `invalid-utf8.test.ts` (14), `invalid-character.test.ts` (20) and `framework-errors.test.ts` (11) pass.

**Superseded runs, kept for honesty and not counted.**

- **`superseded-matrix-1/`:** the first matrix. Unit tests failed in both modes on the ADR-0002 architecture test:
  - computed members in `parseQueryString`;
  - `node:stream`, reflection and a platform→evidence import in the unit test.

  I fixed this by building the result from a `Map`, splitting the unit tests and moving the Fastify-wired part to the src root. The folder also holds the first unit negative control (`negative-control-unit-before-split.log`).
- **`superseded-matrix-2-nolocale-overlapped/`:** a full nolocale pass (all exit 0 except the dotfile-only 04). My `pkill` of the first matrix killed my own shell rather than the run, so the old cutf8 run kept going and overlapped it in time. I reran nolocale alone. The cutf8 logs in the root folder come from the new run, which had no overlap.

## 6. Known gaps and observations

1. **429 is undeclared on most operations (pre-existing, outside my write scope).** The global rate limiter answers 429 on every operation, but 158 of the 161 operations in `docs/api/openapi.yaml` do not declare `"429"`. `createCharter` is one of them. My rate-limit test therefore skips the contract assertion on that call only. Fixing it needs an `openapi.yaml` change, which this assignment forbids. I recommend the orchestrator track it as a separate item.
2. **User-Agent is stored as its Latin-1 reading of the bytes.** It is byte-faithful under HTTP header semantics, as the reviewer noted in C1. I made no change: decoding header bytes as UTF-8 would itself be a reinterpretation.
3. **X-File-Name with mixed content.** A name that contains both a stray `%` and a valid escape (`50% %C3%A9.csv`) is now refused, not taken literally. It is ambiguous, and refusing it avoids a silent rewrite either way. The browser client always sends `encodeURIComponent`, so it never produces this.

## 7. Merge instructions

- No migrations and no ordering constraints. The changes are confined to `apps/api`, plus the test harness option.
- **Possible conflict:** anyone else editing the `preHandler` hook in `platform/hooks.ts`, or the `Fastify({...})` options in `server.ts`.
- `ServerOptions.logStream` is optional, and production behaviour is unchanged when it is absent.
