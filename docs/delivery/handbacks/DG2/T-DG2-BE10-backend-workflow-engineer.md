# Handback T-DG2-BE10: DG2 round-5 repairs (F-DG2-230, F-DG2-231)

- **Role:** backend-workflow-engineer
- **Stage:** P2 / DG2 (FIXING)
- **Assignment:** `docs/delivery/assignments/DG2/round-6/T-DG2-BE10.md` (sha256 `e2cd9f75…7d71`, verified)
- **Invocation reference:** `{"kind":"claude-code-cli-session","run_id":"DG2-T-DG2-BE10-backend-workflow-engineer-20261006T102003Z-06536928","session_id":"06536928-8a6d-4b97-9276-d082cd604d60"}`
- **Base:** `HEAD` = `cf3e7d7f1ba20cfcde61bd299013c352da18d9de` on `claude/mobily-transformation-platform-regate`. Changes are uncommitted in the working tree.
- **Data:** all test data is SYNTHETIC. Product gates G1–G6 are business approvals inside the product. They are unrelated to the engineering gates DG0–DG7, and nothing here grants or implies any approval.
- **Migrations:** none. No new API endpoints. `docs/api/openapi.yaml`, migrations 0001–0019, `tools/**`, `.claude/**`, `docs/source/**`, reviews and gate records are untouched.

## 1. Fixes

### F-DG2-230 (Low, REQ-PB-031): two placeholder characters counted as visible content

The single shared predicate in `packages/shared/src/schemas/common.ts` now also excludes two placeholder characters:

```ts
const VISIBLE_CONTENT = /[^\p{White_Space}\p{Cc}\p{Cf}\p{Cs}\p{Default_Ignorable_Code_Point}⠀\u{16FE4}\u{1D159}]/u;
```

- `⠀` is the escaped form of the assignment's literal `⠀`.
- The comment now names U+2800, U+16FE4 KHITAN SMALL SCRIPT FILLER and U+1D159 MUSICAL SYMBOL NULL NOTEHEAD, and cites F-DG2-230.
- It also records what is deliberately **not** treated as blank: private-use, unassigned and noncharacter code points, and lone combining marks. This matches the finding's scope.
- `hasVisibleContent`, `hasText`, `freeText`, `trimmedText` (`name`, `reason`), the API pre-checks/G1 readiness and the web all use this one predicate, so the change applies everywhere at once.

### F-DG2-231 (Low, REQ-DLV-034): U+0000 in free text gave an undeclared 500

Each numbered item below matches the assignment's numbered requirement.

1. **Central request check**
   - `assertNoInvalidCharacters` / `findInvalidCharacter` in `apps/api/src/modules/platform/validation.ts` run in **one global `preHandler` hook** registered by `registerPlatformHooks` (`hooks.ts`). Every route goes through it.
   - It rejects U+0000 anywhere in the JSON body (values **and** object keys, at any depth), the query string or the path parameters.
   - The response is 400 `urn:mth:problem:validation`, `code: "validation"`, with one field error `{pointer, code: "validation.invalid_character"}`.
   - Pointer style is the same as `parse()`: `/field/…` for the body, `/query/<key>` and `/params/<key>` otherwise. Pointers are RFC 6901-escaped.
   - The hook runs before every handler, so nothing is read or written and no audit row is created.
   - `preHandler` runs after identity's `preValidation` hook, so 401 (no session) and 403 csrf keep their precedence. Integration tests cover both.
   - The walk is iterative (a 100 000-deep array is a unit test, so there is no stack overflow). It reports the first offender in document order.
   - It walks Fastify's query/params objects, which have a non-`Object` prototype. That was a real bug in my first draft, caught by the integration test.
   - It never reads a streamed or binary body (the `application/octet-stream` evidence upload).
   - A route can opt out only with `config.invalidCharacters: "route"`, and then it must refuse such input itself. The only route that does is `GET /api/v1/auth/callback`: its contract declares only 302/429, so it redirects to `/login?error=invalid_request` instead of answering with a 400 problem.
2. **Shared schemas**
   - `freeText` and `trimmedText` (`name`, `reason`) reject U+0000 with `validation.invalid_character` (new exports `INVALID_CHARACTER_CODE` and `hasInvalidCharacter`).
   - A value gets exactly one error: NUL wins over `validation.blank`, and the existing `min` rule (`too_small` only) is unchanged.
   - The web therefore catches it before sending. A web test proves that the archive `ReasonDialog` sends nothing.
3. **Web message**
   - `problems.validation__invalid_character` is added in `apps/web/src/i18n/en/problems.json` ("Remove the unsupported invisible character from this text.") and `ar/problems.json` ("أزِل الحرف غير المدعوم من هذا النص.").
   - Web tests in EN and AR check that it lands on the field, with aria-invalid and aria-describedby, both for the client-side refusal and for a server 400 at `/reason`.
4. **Defense in depth**
   - `apps/api/src/modules/platform/db-errors.ts` maps SQLSTATE `22021` (character_not_in_repertoire) and `22P05` (untranslatable_character) to the same 400 `validation.invalid_character` problem, with pointer `""`, because PostgreSQL reports no column. They are no longer a 500. Unit test in `platform.test.ts`.
   - Observed working: in my first draft the hook missed query objects, and `GET /transformations?q=a%00b` came back as a 400 through this mapping instead of a 500.
5. **Sweep:** see §3.

## 2. Changed files

| File | Purpose |
|---|---|
| `packages/shared/src/schemas/common.ts` | F-DG2-230: predicate and comment. F-DG2-231: `INVALID_CHARACTER_CODE`, `hasInvalidCharacter`, NUL refine in `freeText`/`trimmedText` (one error per value) |
| `apps/api/src/modules/platform/validation.ts` | F-DG2-231: `findInvalidCharacter`, `invalidCharacterProblem`, `assertNoInvalidCharacters`; shared RFC 6901 `escapeToken` |
| `apps/api/src/modules/platform/hooks.ts` | F-DG2-231: global `preHandler` central check; `config.invalidCharacters: "route"` opt-out type |
| `apps/api/src/modules/platform/db-errors.ts` | F-DG2-231: 22021/22P05 → 400 `validation.invalid_character` |
| `apps/api/src/modules/platform/index.ts` | Export the new helpers |
| `apps/api/src/modules/identity/routes.ts` | OIDC callback opts out of the central check and refuses NUL in `state`/`code`/`error` with the declared 302 `invalid_request`. An `iss`/`sub` claim with NUL is refused as `token_invalid` and audited (`session.login_failed`). A User-Agent with NUL is not stored |
| `apps/api/src/modules/identity/oidc.ts` | `identityClaimsStorable`; a `name`/`preferred_username`/`email` claim with NUL is treated as absent (the next claim is used) |
| `apps/web/src/i18n/en/problems.json`, `apps/web/src/i18n/ar/problems.json` | `validation__invalid_character` EN/AR |
| `packages/shared/src/schemas/schemas.test.ts` | Unit matrix: U+16FE4/U+1D159 alone, repeated (×3), mixed with whitespace and mixed with every other invisible code point; `${ch}a${ch}` accepted verbatim; name/reason sets. NUL: code, predicate, freeText/name/reason, pointers, one-error rule, unaffected text |
| `apps/api/src/modules/platform/platform.test.ts` | db-errors 22021/22P05 unit test; `findInvalidCharacter` (order, keys, escaping, Fastify-style prototypes, stream/buffer skipped, deep nesting); `assertNoInvalidCharacters` |
| `apps/api/test/integration/invalid-character.test.ts` (new) | F-DG2-231 integration on real PostgreSQL. Every call goes through the harness's OpenAPI contract assertion, so an undeclared 500 fails the test |
| `apps/api/test/integration/blank-text.test.ts` | F-DG2-230: Out of scope `"\u{16FE4}"`, `"\u{1D159}"`, `"\u{1D159}\u{1D159}"` and `" \u{16FE4}\t\u{1D159} "` each give 400 `validation.blank` at `/outOfScope` on create and update, with nothing written and no audit. Visible text containing them is accepted verbatim and the exclusions pre-check reads `pass` |
| `apps/api/test/integration/oidc.test.ts` | NUL in callback query gives 302 `invalid_request`; NUL `sub` gives `token_invalid` plus an audited failure and no user; NUL `name`/`email` claims are absent |
| `apps/web/src/pages/p2-blank-forms.test.tsx` | EN+AR: a reason with NUL is refused inline with the localized message and nothing is sent; a server 400 `validation.invalid_character` on `/reason` is the field message |
| `docs/delivery/handbacks/DG2/T-DG2-BE10-evidence/*.log` | Check logs (logs only) |

### Tests required by the assignment

All of these are in the new `invalid-character.test.ts`, run on a real PostgreSQL. Each case asserts 400 `validation.invalid_character` at the pointer, that nothing was written (row/version/value/count unchanged) and that the request left no audit row (`auditOfRequest`, plus `auditOf(record)` unchanged).

- **Charter field:** create `/outOfScope` (3 NUL positions); update `/inScope`; and `/changeSummary`.
- **T03 TOM gap:** create and update `/gap`.
- **Archive reason:** `/reason` on a TOM gap. After that, a valid reason still archives with exactly one new audit row.
- **Query/filter parameter:**
  - `GET /api/v1/transformations?q=…%00…` gives `/query/q`. Before the fix this was a 500: the database queries the filter.
  - `GET /api/v1/users?q=…` gives `/query/q`.
  - Path parameter: `POST …/tom-gaps/abc%00def/archive` gives `/params/tomGapId`.
- **Other cases:**
  - P1 transformation `/name`.
  - An object key with NUL.
  - Authorization precedence: no session gives 401; a missing CSRF token gives 403 csrf.
  - A user without write permission gets the 400 and nothing is written. Without the NUL the same user is denied (403/404), so the check is no bypass.
  - Text with U+0001 inside visible text and RLM marks is accepted verbatim.
- **Contract check (no 500):** `call()` asserts every response against `docs/api/openapi.yaml` (`assertContract`). In the negative control the old code fails with `contract: archiveTomGap does not declare status 500`, `createTransformation does not declare status 500`, `listTransformations …`, `listUsers …`. The full `contract.test.ts` (161 operations) passes.

## 3. Sweep: where client strings reach the database outside `parseBody`

| Path | Covered by | Notes |
|---|---|---|
| JSON bodies (every route, including routes using `parse(..., "body")` or reading `request.body` directly, such as `decisions.ts`, `gates.ts`, `kpi/outcome-kpis.ts`) | (1) central hook | The hook runs before the handler regardless of how the handler parses |
| Query strings / filters (`q` on `/transformations` and `/users`, `cursor`, enums, ids) | (1) | `q` is the only free-text filter the DB queries; integration-tested for both |
| Path parameters (`register-kit` `paramsOf`, `kpi` `parseRecordParams`, `methodology` `dimensionCode`, `gateCode`, `versionNo`, …) | (1), and the routes' own uuid/regex validation | Integration-tested (`/params/tomGapId`) |
| `User-Agent` (stored in `session.user_agent`) | Node HTTP parser + explicit filter + (4) | A real socket with a NUL header gets `400 Bad Request` from Node itself (22.22.2 and 24.21.0) before any handler (`sweep-node-http-parser-nul-header.log`). The explicit filter in `startSession` covers `inject`/in-process callers |
| `X-File-Name` (evidence upload, stored as `file_name`) | Node HTTP parser; regex `^[^\\/\x00-\x1f]+$` after percent-decoding, so `%00` gives `validation.file_name`; (4) | Already safe |
| `Idempotency-Key`, `If-Match`, `X-Request-Id` (stored as audit `request_id`) | Strict regexes (`[A-Za-z0-9_-]`, `"<n>"`, `[A-Za-z0-9._-]`); an invalid request id is replaced by a UUIDv7 | Already safe |
| `X-CSRF-Token`, session cookie | Compared by hash only. The cookie token must match `^[A-Za-z0-9_-]{43}$` before any query | Never stored raw |
| `Origin` | Compared only | Never stored |
| Client IP / `X-Forwarded-For` | Rate-limit key only | Never stored |
| OIDC callback query (`state`, `code`, `error`) | Route's own schema (exempt from (1)); (4) | `state` is only ever stored or looked up hashed; `code` goes to the IdP; `error` is never stored or rendered. Declared 302 `invalid_request`; integration-tested |
| OIDC claims `iss`/`sub` (`user_identity`) | `identityClaimsStorable` refuses login as `token_invalid`, audited | Integration-tested (`sub`). `iss` is also bound to the configured issuer by openid-client |
| OIDC claims `name`/`preferred_username`/`email` (`app_user.display_name`, `email`, `email_at_binding`) | `displayNameCandidate` and the `email` guard treat a NUL value as absent | Integration-tested |
| Evidence content bytes | Stored in the object store as bytes, not PostgreSQL text | Not applicable |
| Worker / outbox payloads | Built by the server from already validated data | Not client input |
| Anything else | (4) 22021/22P05 → 400 | Last line of defence; never a 500 |

## 4. Checks actually run

**Environment:**

- Sandbox, offline, `/home/user/My-owns`, PostgreSQL 16.13 (disposable clusters via `tests/qa/support/with-pg.sh`: UTF8, C locale).
- Node 24.21.0 (`/opt/nvm/versions/node/v24.21.0/bin`) unless stated; Node 22.22.2 (`/opt/node22/bin`).
- Chromium from `/opt/pw-browsers` (`playwright install` was not run).

**Locale modes:**

- `nolocale` = `env -u LANG -u LC_ALL -u LC_CTYPE -u LC_COLLATE -u LC_MESSAGES -u LC_NUMERIC -u LC_TIME -u LC_MONETARY`.
- `cutf8` = the same unsets, plus `LANG=C.UTF-8`.

The exact command for each check is the second line of its log. All logs are in `docs/delivery/handbacks/DG2/T-DG2-BE10-evidence/`. The final tree was hash-pinned before the final run, and `sha256sum -c` confirmed it unchanged afterwards.

| # | Check (command) | nolocale | cutf8 |
|---|---|---|---|
| 01 | `pnpm -r typecheck` | exit 0 | exit 0 |
| 02 | `pnpm -r build` | exit 0 | exit 0 |
| 03 | `pnpm lint` (`eslint . --max-warnings=0`) | exit 0 | exit 0 |
| 04 | `pnpm format:check` | exit 0, `All matched files use Prettier code style!` | exit 0, same |
| 05 | `npx prettier --check . '!.bash_profile' … '!CLAUDE.local.md'` (sandbox-masked dotfiles excluded) | exit 0 | exit 0 |
| 06 | `pnpm openapi:lint` | exit 0, `PASS docs/api/openapi.yaml: OpenAPI 3.1.1, 161 operations` | exit 0, same |
| 07 | `pnpm test` on Node 22.22.2 | exit 0, `Test Files 34 passed (34)`, `Tests 656 passed (656)` | exit 0, 34/34, 656/656 |
| 08 | `pnpm test` on Node 24.21.0 | exit 0, 34/34, 656/656 | exit 0, 34/34, 656/656 |
| 09 | `QA_PG_PORT=55471 tests/qa/support/with-pg.sh pnpm test:integration` | exit 0, `Test Files 31 passed (31)`, `Tests 504 passed (504)`; `server_encoding UTF8, lc_collate C, lc_ctype C` | exit 0, 31/31, 504/504 |
| 10 | `E2E_PG_PORT=55481/55482 E2E_API_PORT=3591/3592 PLAYWRIGHT_BROWSERS_PATH=/opt/pw-browsers apps/web/e2e/support/with-stack.sh npx playwright test apps/web/e2e/journeys.spec.ts apps/web/e2e/p2-journeys.spec.ts apps/web/e2e/p2-blank-text.spec.ts --project=chromium-en --project=chromium-ar --workers=1` | exit 0, `Running 58 tests using 1 worker`, `58 passed (3.9m)` | exit 0, `58 passed (3.6m)` |
| 11 | `node tools/gates/validate.mjs --historical --stage DG1` | exit 0, `PASS gate DG1 (historical)` | exit 0, same |

The integration files named in the assignment passed in both modes:

- `contract/contract.test.ts` (11 tests; every one of the 161 operations exercised and validated against the contract)
- `blank-text.test.ts` (30)
- `oidc.test.ts` (27)
- `packages/db/test/integration/encoding.test.ts` (8)
- the new `invalid-character.test.ts` (13)

The unit-web project is part of `pnpm test`, and covers the EN/AR web tests above.

### Negative control (new tests fail on the old code)

The product files were reverted to `HEAD` while the new tests were kept, then my changes were restored. These runs used Node 22.22.2 and disposable PostgreSQL 16.13 (UTF8). Reverted files: `common.ts`, `validation.ts`, `hooks.ts`, `db-errors.ts`, `index.ts`, `oidc.ts`, `routes.ts`, and both `problems.json`.

- **Integration** (`negative-control-integration.log`): `QA_PG_PORT=55471 tests/qa/support/with-pg.sh npx vitest run --project integration invalid-character.test.ts blank-text.test.ts oidc.test.ts` gave exit 1, `Tests 17 failed | 53 passed (70)`:
  - All four new F-DG2-230 placeholder cases in `blank-text`: the old code returns 201.
  - Ten of the 13 `invalid-character` cases. Several fail with an undeclared 500, for example `contract: archiveTomGap does not declare status 500`, `createTransformation …`, `listTransformations …`, `listUsers …`.
  - All three OIDC NUL cases.
  - The three that still pass are the 401 and CSRF precedence cases and the accepted-text case, which hold on the old code too.
- **Unit** (`negative-control-unit.log`): `npx vitest run --project unit-node --project unit-web schemas.test.ts platform.test.ts p2-blank-forms.test.tsx` gave exit 1, `Tests 18 failed | 116 passed (134)`:
  - The db-errors case fails with `22021: expected null not to be null`.
  - The helper cases fail with "not a function".
  - The placeholder matrix fails.
  - The NUL schema cases fail.
  - The EN/AR web cases fail because the message is missing or the request is sent.

### Other evidence

- `sweep-node-http-parser-nul-header.log`: a raw socket sends `User-Agent: a\0b`. Node answers `HTTP/1.1 400 Bad Request` and the handler is not reached (Node 24.21.0 and 22.22.2).
- `probe-get-item-malformed-param.log`: see §5. Its "head" half is annotated as **not** a valid control: the test file failed to load because of a partial revert.

## 5. Known gaps / not done

- **Pre-existing contract gap, not introduced here (OpenAPI is outside my write scope):**
  - GET item operations (for example `GET …/tom-gaps/{tomGapId}`) declare only 200/401/404, yet a malformed path id has always returned 400. The probe shows `GET tom-gaps/not-a-uuid` gives 400 via the unchanged `paramsOf` with pointer `/params/`. Note the pointer also lacks the parameter name, which is another pre-existing issue.
  - A NUL path parameter on those GET routes now also gives 400 `validation.invalid_character` at `/params/<name>`, consistent with the malformed-id behaviour. Before, it was a 400 for a non-uuid too.
  - Suggest that the contract owner either declares 400 on those operations or maps malformed ids to 404. My new tests use only operations that declare 400.
- `p2-blank-text.spec.ts` (e2e) was run (passes in both locales) but **not extended** with U+16FE4/U+1D159 or NUL cases. Web coverage for the new message is in unit-web (EN+AR); the API behaviour is integration-tested. If the orchestrator wants browser-level coverage of these characters, that is a follow-up for the frontend owner of the spec.
- **Run note:** during my first full run, a stale cutf8 check sequence kept running after I believed I had stopped it, alongside the start of the final run, until 10:44Z. I deleted all `nolocale-*`/`cutf8-*` check logs before the final run. The final cutf8 sequence started after both earlier runs had finished (10:46:21Z) and overwrote every cutf8 log. The nolocale logs come from the final run, after a fresh build. The integration runs never overlapped in time, and the e2e runs used different ports. All results in §4 are from the final run.
- An empty harness artifact directory (`.claude/.cc-writes`) briefly appeared in the evidence folder when my shell cwd was there. I removed it; it was never in git.

## 6. Merge instructions

- No migrations and no new endpoints. Commit the 14 modified files, the new `apps/api/test/integration/invalid-character.test.ts` and `docs/delivery/handbacks/DG2/T-DG2-BE10-evidence/`.
- **API behaviour change:**
  - Any request with U+0000 in its body/query/params now gets 400 `validation.invalid_character` (previously 500, or a 400 for malformed ids).
  - A route that must answer differently has to set `config.invalidCharacters: "route"` and validate the input itself (only the OIDC callback does).
- No conflicts expected. `packages/shared` must be rebuilt (`pnpm -r build`) for consumers of `dist`.
- The orchestrator records `import-findings --fix` for F-DG2-230 and F-DG2-231. I do not close my own findings.
