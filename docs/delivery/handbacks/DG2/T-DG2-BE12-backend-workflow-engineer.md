# Handback T-DG2-BE12: router-level errors answer the declared problem+json 400 (backend-workflow-engineer)

- **Stage:** P2 / DG2 (FIXING), branch `claude/mobily-transformation-platform-regate`.
- **Assignment:** `docs/delivery/assignments/DG2/round-7/T-DG2-BE12.md`. Its sha256 `741c772a7e2ccf91d039e4819c057a4c2c77b4eeff12b0ab672615872c7ed65f` was verified before starting.
- **Base:** `HEAD` = `d819e7e8399c5a58e814b9e1c48e934d856f799e`. The tree was clean apart from the sandbox-masked dotfiles.
- **Invocation:** `DG2-T-DG2-BE12-backend-workflow-engineer-20261006T131316Z-bc912793`, session `bc912793-95cb-49c5-bd21-6933dffeb32b`.
- **Not changed:**
  - no migrations, no new API endpoints;
  - no change to `docs/api/openapi.yaml`, `tools/**`, `.claude/**` or `docs/source/**`.
- G1–G6 are product business approvals and are unrelated to DG0–DG7. All test data is synthetic.

## 1. The fix

### 1.1 `frameworkErrors` (router-level errors)

`apps/api/src/server.ts` now passes `frameworkErrors: createFrameworkErrorHandler(securityHeaders)` to `Fastify()`. The handler lives in the new `apps/api/src/modules/platform/framework-errors.ts` and is exported from the platform module.

It answers every router-level error through the same `sendProblem` / `problems` helpers as the rest of the API, so each answer is `application/problem+json` with a `requestId` and no internals:

| Fastify code | Answer |
|---|---|
| `FST_ERR_BAD_URL` | 400 `urn:mth:problem:validation`. Detail: "The request URL contains an invalid percent-encoding." `errors: [{ pointer: "", code: "validation.format" }]` |
| `FST_ERR_ASYNC_CONSTRAINT` | 500 `internal`, with no message from the strategy. No async constraint is registered today; this is unit-tested on a real Fastify router with a failing async strategy |
| any other code | `problemForError(error)`: the **same** mapping as `setErrorHandler` (newly exported from `hooks.ts`), otherwise 500 `internal`. Never a plain body |

**Where `validation.format` appears.** As in every other 400 this API sends (`problems.badRequest`, for example `validation.json` or `validation.body_too_large`), the top-level `code` is `validation`. `validation.format` is `errors[0].code`. I kept that existing convention rather than introduce a second shape for 400s. The tests assert both fields.

**Pointer.** The pointer is `""`. The router fails before it matches a route, so the server cannot name the offending path parameter.

**Security headers (confirmed).** `frameworkErrors` runs in Fastify's bare `onBadUrlContext`, where **no** `onRequest` or `onSend` hook runs.

- Before this change, the bad-URL answer had **no** helmet headers and **no** `X-Request-Id`. The probe output was `content-type, content-length, date, connection` only.
- The handler now sets both itself. The helmet headers come from `captureSecurityHeaders()`, which reads them **once** at build time from a throwaway Fastify instance that has only `@fastify/helmet` registered with the same `HELMET_OPTIONS`. Those options are now a shared constant in `server.ts`, so the values cannot drift from the plugin's.
- The integration tests assert that the framework-error headers **equal** those of a routed 404 problem.
- Fastify's own `genReqId` still runs for these requests, so a well-formed inbound `X-Request-Id` is kept (tested).

### 1.2 `clientErrorHandler` (found in the sweep)

A header block or request line over Node's limit, and a malformed request, are refused by Node's HTTP parser (`clientError`) before any request object exists. Fastify's default answer is a plain-JSON `431` or `400`. The new `createClientErrorHandler(securityHeaders)`, passed as `clientErrorHandler`, writes this instead:

- **`HPE_HEADER_OVERFLOW`** gives 400 problem, `errors[0].code` `validation.headers_too_large`. Node counts the URL against the same limit, so a URL that is too long also lands here. I chose 400, not 431, because 431 is undeclared on every operation and 400 is declared on all of them. It follows the existing precedent of an oversized body giving 400 `validation.body_too_large`, not 413.
- **`ERR_HTTP_REQUEST_TIMEOUT`** gives 408 problem `request_timeout` (see §3).
- **Anything else** gives 400 problem `validation.malformed_request`.

In every case the response carries the same security headers, a generated UUIDv7 `X-Request-Id` (equal to the body's `requestId`) and `connection: close`.

It mirrors Fastify's default behaviour:

- it does not answer on `ECONNRESET` or a destroyed socket;
- it never writes into a response that has already started;
- it then destroys the socket.

The module uses a structural socket type and a small reason-phrase function, so it imports no extra `node:` built-in. That keeps the ADR-0002 / D-055 architecture rule, which denies non-allow-listed built-ins and computed members.

### 1.3 Smaller changes

- **`problems.requestTimeout()`:** 408, type `validation`, code `request_timeout`.
- **i18n:** EN and AR strings for `request_timeout`, `validation__headers_too_large` and `validation__malformed_request` in `apps/web/src/i18n/{en,ar}/problems.json`. The key-parity test passes.

## 2. Sweep: framework-level paths that produced non-problem bodies

**How this was measured:**

- The "before" column comes from a probe against `HEAD` code (`inject`, plus a real socket for parser errors) and from the negative-control log.
- The "now" column comes from the new integration tests in `framework-errors.test.ts` and `invalid-character.test.ts`.
- **Declared** means the contract assertion (`assertContract`) passes for the operation the request targets.

| Case | Before (HEAD) | Now | Declared and problem-shaped now? |
|---|---|---|---|
| `GET /api/v1/transformations/%ZZ` | 400 `application/json` `{"error":"Bad Request","code":"FST_ERR_BAD_URL","message":"'/api/…/%ZZ' is not a valid url component"}`. No security headers and no X-Request-Id. The raw path is echoed | 400 `application/problem+json`, `validation.format`, `requestId`, helmet headers | **Yes** (getTransformation 400 ValidationError) |
| GET-by-id with `%ED%A0%80` (`/transformations/%ED%A0%80`, `/transformations/abc%ED%A0%80`, `…/tom-gaps/%ED%A0%80`) | same plain JSON 400 | same problem | **Yes** |
| Unsafe method, bad path (`POST …/tom-gaps/abc%ZZ/archive`) | plain JSON 400 | problem 400; no audit row; the record is unchanged | **Yes** (archiveTomGap 400) |
| Unsupported method on a known path (`DELETE /api/v1/transformations`, `PATCH /api/v1/me`) | 404 `application/problem+json` `not_found` (Fastify never answers 405) | unchanged | Problem-shaped, **yes**. "Declared" does not apply: the method/path pair is not an operation in the contract. A 405 would need a contract decision; none is proposed |
| `OPTIONS` / CORS preflight on `/api/**` | 404 problem `not_found`, **no** `access-control-*` headers (same-origin only, no CORS plugin) | unchanged | Problem-shaped, **yes**. OPTIONS is not a contract operation |
| Request header too large (20 kB) | **431** `application/json` `{"error":"Request Header Fields Too Large",…}`, written raw by Fastify's default `clientErrorHandler`; no security headers | 400 problem `validation.headers_too_large`, security headers, `X-Request-Id`, `connection: close` | **Yes** (asserted against getMe's 400) |
| URL too long (20 kB query) | **431** plain JSON (the same `HPE_HEADER_OVERFLOW`) | 400 problem `validation.headers_too_large` | **Yes** (asserted against listTransformations' 400) |
| Malformed request line (`NOT A REQUEST`) | 400 plain JSON `{"error":"Bad Request","message":"Client Error"}` | 400 problem `validation.malformed_request` | Problem-shaped, **yes**. There is no path, so no operation to declare against |
| Request timeout (`ERR_HTTP_REQUEST_TIMEOUT`) | 408 plain JSON | 408 problem `request_timeout`. Unit-tested mapping only, see §5 | Problem-shaped, yes. **408 is not declared** (see §3) |
| Long path parameter (> `maxParamLength` 100) | 404 problem `not_found` (no route match) | unchanged | Yes, where the operation declares 404 |
| Non-API SPA fallback with a bad URL (`GET /transformations/%ZZ`, `webRoot` set) | 400 plain JSON (`FST_ERR_BAD_URL`) | 400 problem `validation.format` with the same security headers. Good SPA paths still serve `index.html` (tested) | Problem-shaped. Outside `/api/**`, so no contract applies |

**Precedence note.** A bad URL is answered **before** authentication, because the router runs first. An anonymous `GET /api/v1/transformations/%ZZ` therefore gets 400, not 401. Both are declared, and nothing is read or written. This is tested.

The bad-URL path also bypasses the rate limiter (an `onRequest` hook). It is a constant-cost answer with no database access.

## 3. Needs a contract decision (not changed; `openapi.yaml` untouched)

1. **408 `request_timeout`:** connection-level and not declared on any operation.
   - Options: declare a shared 408 response, or decide that connection-level answers before a request exists are outside the per-operation contract.
   - Until then it is problem-shaped but undeclared.
2. **405 for a wrong method on a known path:** Fastify answers 404 problem `not_found`.
   - A 405 with `Allow` would need a declaration on all 161 operations.
   - No change is proposed; it is recorded for completeness.
3. **The OIDC callback (`GET /api/v1/auth/callback`)** is the one operation without a declared 400 (its contract is 302 / 429).
   - It has no path parameter, so `FST_ERR_BAD_URL` cannot occur on it. Its query is parsed after routing, and its existing route schema already maps bad values to the 302.
   - It could still receive a **header-overflow** 400 problem from the parser, because that happens before any path is known.
   - Making that case contractual would need either a 400 declaration on the callback or an exemption for connection-level answers. I recommend routing this to the contract owner together with item 1.

## 4. Changed files

| File | Purpose |
|---|---|
| `apps/api/src/modules/platform/framework-errors.ts` (new) | `frameworkProblem`, `createFrameworkErrorHandler`, `clientErrorProblem`, `createClientErrorHandler`, `SecurityHeaders` |
| `apps/api/src/modules/platform/hooks.ts` | New exported `problemForError` (the mapping, else 500 `internal`), used by `setErrorHandler` and the framework handler |
| `apps/api/src/modules/platform/problem.ts` | `problems.requestTimeout()` (408) |
| `apps/api/src/modules/platform/index.ts` | Exports the new functions and types |
| `apps/api/src/server.ts` | `HELMET_OPTIONS` constant; `captureSecurityHeaders()`; `frameworkErrors` and `clientErrorHandler` server options; header comment |
| `apps/web/src/i18n/en/problems.json`, `apps/web/src/i18n/ar/problems.json` | EN/AR strings for the three new codes |
| `apps/api/src/modules/platform/framework-errors.test.ts` (new) | Unit tests (6), listed in §5 |
| `apps/api/test/integration/framework-errors.test.ts` (new) | Integration tests (11), listed in §5 |
| `apps/api/test/integration/invalid-character.test.ts` | BE11's `%ED%A0%80` / `%ZZ` path case: the **contract assertion is back on** (the `contract: false` is removed). It asserts 400 problem+json, `validation.format`, `requestId` = `X-Request-Id`, no audit row, and the TOM-gap list unchanged |
| `docs/delivery/handbacks/DG2/T-DG2-BE12-evidence/*` | `checks.sh`, check logs, negative-control logs, `final-tree.sha256` |

## 5. Tests added

**Unit** (`framework-errors.test.ts`, no database):

- **`FST_ERR_BAD_URL`:** the exact problem body.
- **`FST_ERR_ASYNC_CONSTRAINT`:** 500 `internal`, no internals.
- **Generic fallback:**
  - `FST_ERR_CTP_INVALID_MEDIA_TYPE` gives `validation.content_type`;
  - an unknown `FST_ERR_*` gives 500 `internal`;
  - a 429 gives `rate_limited`.
- **`clientErrorProblem`:** header overflow gives 400 `headers_too_large`; timeout gives 408; `HPE_INVALID_METHOD` or no code gives 400 `malformed_request`.
- **On a real Fastify router:**
  - a failing **async constraint** gives a 500 problem with the given security headers and `requestId` = `X-Request-Id`, and the strategy's error message is not leaked;
  - a bad URL gives a 400 problem with headers.

**Integration** (real PostgreSQL 16.13, disposable cluster; requests through `call` are contract-asserted):

1. **`GET /api/v1/transformations/%ZZ`:**
   - 400 `application/problem+json`; `code: validation`; `errors[0].code: validation.format`; the exact detail;
   - `requestId` equals `X-Request-Id`;
   - no `FST_ERR`, raw path or `statusCode` in the body;
   - security headers equal the routed ones;
   - no audit row; the transformation is unchanged.
2. **GET-by-id with `%ED%A0%80`** (3 URLs): the same assertions, and the TOM-gap list is unchanged.
3. **`POST …/tom-gaps/%ZZ/archive`:** the same assertions, and no audit row.
4. **Inbound `X-Request-Id`:** it is kept. Without a session, the answer is still 400.
5. **SPA fallback (`webRoot` set):** a bad URL gives a 400 problem with the routed security headers, and a good path still serves `index.html`.
6. **Unsupported method** (`DELETE` / `PATCH`): 404 problem.
7. **`OPTIONS` preflight:** 404 problem, and no `access-control-allow-origin`.
8. **Real socket** (`listen` on 127.0.0.1:0):
   - header too large gives 400 `headers_too_large`, contract-asserted against getMe;
   - URL too long gives the same, contract-asserted against listTransformations;
   - a malformed request line gives 400 `malformed_request`;
   - a bad path over a real socket gives the same problem as through `inject`, contract-asserted.

   Each one has the security headers, `requestId` = `X-Request-Id`, and no audit row.

**Not tested end to end:** the 408 request timeout. Node's request timeout defaults to 300 s, so a socket test would need a server option this task did not add. The mapping is unit-tested.

### Negative control (the new tests fail on the old code)

**Method:**

- I wrote the 7 product files back to their `HEAD` content: `server.ts`, `hooks.ts`, `index.ts` and `problem.ts` via `git show HEAD:<path> > <path>`, plus the two i18n files; the new `framework-errors.ts` was removed.
- I kept the new tests.
- I restored my versions from a tar backup afterwards. `sha256sum -c` reported 7/7 OK.
- Both runs used Node 22.22.2, `env -u LANG -u LC_ALL` and disposable PostgreSQL.

**Integration** (`negative-control-integration.log`, `framework-errors.test.ts invalid-character.test.ts`): exit 1, `Tests 10 failed | 21 passed (31)`.

- All 9 framework-error behaviour tests fail. Only the unsupported-method and OPTIONS tests pass, because that behaviour was already problem-shaped and is unchanged.
- **BE11's re-enabled case** fails with `contract: archiveTomGap 400 returned application/json, declared application/problem+json`.
- **The GET cases** fail with `contract: getTransformation 400 returned application/json, declared application/problem+json`.
- **Header too large and URL too long** fail with `expected 431 to be 400`.
- **Malformed request, SPA and socket bad path** fail with `expected 'application/json' to match /^application\/problem\+json/`.

**Unit** (`negative-control-unit.log`): exit 1. The test file cannot import the missing `framework-errors.ts`.

The negative control ran before one later edit to `framework-errors.ts`, which removed the `node:http` / `node:net` imports for the architecture rule (see §7). It ran with that module **absent**, so the edit does not affect its validity.

## 6. Checks actually run

**Environment:**

- Sandbox, offline, `/home/user/My-owns`.
- PostgreSQL 16.13 in disposable clusters (`tests/qa/support/with-pg.sh`, UTF8/C).
- Node 24.21.0 unless stated; Node 22.22.2 for check 07.
- Chromium from `/opt/pw-browsers`. `playwright install` was not run.

**Locale modes:**

- `nolocale` = `env -u LANG -u LC_ALL -u LC_CTYPE -u LC_COLLATE -u LC_MESSAGES -u LC_NUMERIC -u LC_TIME -u LC_MONETARY`.
- `cutf8` = the same unsets, plus `LANG=C.UTF-8`.

The runner is `docs/delivery/handbacks/DG2/T-DG2-BE12-evidence/checks.sh`, BE11's runner with only the paths changed. Each log's second line holds the exact command, and the third line the node version and locale.

**Final run:** 13:41:00Z to 13:54:26Z, nolocale and then cutf8, sequentially, with nothing else running. The 10 changed files were pinned in `final-tree.sha256` beforehand. Afterwards, `sha256sum -c` reported **0 mismatches**.

| # | Check (command) | nolocale | cutf8 |
|---|---|---|---|
| 01 | `pnpm -r typecheck` | exit 0 | exit 0 |
| 02 | `pnpm -r build` | exit 0 | exit 0 |
| 03 | `pnpm lint` (`eslint . --max-warnings=0`) | exit 0 | exit 0 |
| 04 | `pnpm format:check` | exit 2: 12 `EACCES: permission denied` errors, **only** for the sandbox-masked dotfiles (`.bash_profile` … `.zshrc`, `CLAUDE.local.md`), then `All matched files use Prettier code style!` | exit 2, the same 12 EACCES only, same line |
| 05 | `npx prettier --check . '!.bash_profile' … '!CLAUDE.local.md'` (the `--ignore` variant for the masked files) | exit 0, `All matched files use Prettier code style!` | exit 0, same |
| 06 | `pnpm openapi:lint` | exit 0, `PASS docs/api/openapi.yaml: OpenAPI 3.1.1, 161 operations` | exit 0, same |
| 07 | `pnpm test` on Node 22.22.2 | exit 0, `Test Files 36 passed (36)`, `Tests 673 passed (673)` | exit 0, 36/36, 673/673 |
| 08 | `pnpm test` on Node 24.21.0 | exit 0, 36/36, 673/673 | exit 0, 36/36, 673/673 |
| 09 | `QA_PG_PORT=55471 tests/qa/support/with-pg.sh pnpm test:integration` | exit 0, `Test Files 32 passed (32)`, `Tests 531 passed (531)` | exit 0, 32/32, 531/531 |
| 10 | `E2E_PG_PORT=55481/55482 E2E_API_PORT=3591/3592 PLAYWRIGHT_BROWSERS_PATH=/opt/pw-browsers apps/web/e2e/support/with-stack.sh npx playwright test apps/web/e2e/journeys.spec.ts apps/web/e2e/p2-journeys.spec.ts apps/web/e2e/p2-blank-text.spec.ts --project=chromium-en --project=chromium-ar --workers=1` | exit 0, `Running 58 tests using 1 worker`, `58 passed (3.7m)` | exit 0, `58 passed (3.6m)` |
| 11 | `node tools/gates/validate.mjs --historical --stage DG1` | exit 0, `PASS gate DG1 (historical)` | exit 0, same |

The integration files named in the assignment passed in both modes:

- `contract/contract.test.ts` (14 tests);
- `invalid-character.test.ts` (20);
- `framework-errors.test.ts` (11, new).

The counts against BE11 are: unit 667 → 673 (+6 new), integration 520 → 531 (+11 new).

## 7. Known gaps / not done

- **Contract decisions (§3)** are not made: the 408 declaration, 405, and the callback's connection-level 400. `openapi.yaml` is untouched, as instructed.
- **The 408 timeout** is unit-tested only (§5).
- **Run note (discarded attempts):**
  - My first matrix run failed at check 07: the ADR-0002 architecture test flagged the first version of `framework-errors.ts`, which imported `node:http` / `node:net` and used a computed member. I fixed that (§1.2).
  - My attempt to stop that run with `pkill` failed. Each sandboxed shell has its own PID namespace, so the process was invisible and kept running. A second run I had started then overlapped with it.
  - I discarded every matrix log from both runs, waited until both background tasks had reported completion, deleted the untracked `test-results/` and ran the whole matrix again, alone.
  - All results in §6 come from that final run.
  - An empty `.claude/.cc-writes` directory that the tool harness had created inside the evidence directory was removed. It contained nothing.

## 8. Merge instructions

- **Commit:**
  - the 7 modified files and 3 new files (`framework-errors.ts`, its unit test, the integration test);
  - this handback and `docs/delivery/handbacks/DG2/T-DG2-BE12-evidence/`.
- **No migrations, no new endpoints, no dependency changes.**
- **API behaviour changes:**
  - An undecodable percent escape in any path (API or SPA) now gets 400 `application/problem+json` (`validation` / `validation.format`) with security headers and `X-Request-Id`, instead of plain JSON.
  - An oversized header block or request line now gets **400** problem `validation.headers_too_large` instead of a plain-JSON **431**.
  - A malformed request now gets a 400 problem `validation.malformed_request`.
  - A request timeout now gets a 408 problem.
- **No conflicts expected.** No other agent ran during this task.
