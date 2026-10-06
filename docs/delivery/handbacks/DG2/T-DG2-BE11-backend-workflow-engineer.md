# Handback T-DG2-BE11: DG2 round-6 repair, lone UTF-16 surrogates (backend-workflow-engineer)

- **Stage:** P2 / DG2 (FIXING).
- **Assignment:** `docs/delivery/assignments/DG2/round-7/T-DG2-BE11.md`. Its sha256 `2facb8e136d10ae8de2e9fb9aa64d78654893bca876f22494e7849140ac80219` was verified before starting.
- **Base:** `HEAD` = `f4cc48321f0c6ec0fd4c5925c56f6c343e60179b` on `claude/mobily-transformation-platform-regate`. The tree was clean apart from the sandbox-masked dotfiles.
- **Invocation:** `DG2-T-DG2-BE11-backend-workflow-engineer-20261006T122507Z-6b12da95`, session `6b12da95-4380-4e6a-bcba-12eb6a55e40d`.
- **Finding repaired:** F-DG2-260 (Low, REQ-DLV-034). I do not close my own finding. The orchestrator records `import-findings --fix`.
- **Not changed:**
  - no migrations, no new API endpoints;
  - no change to `docs/api/openapi.yaml`, `tools/**`, `.claude/**` or `docs/source/**`.
- G1–G6 are product business approvals and are unrelated to DG0–DG7. The gate decision in the new test is synthetic demo data and approves nothing real.

## 1. The fix

### 1.1 Detection (root cause)

`hasInvalidCharacter(value)` (`packages/shared/src/schemas/common.ts`) is now:

```ts
return value.includes("\u0000") || /\p{Cs}/u.test(value);
```

In `/u` mode, `\p{Cs}` matches only an *unpaired* surrogate. A valid astral pair (an emoji such as U+1F600) is one code point and does not match, so emoji and Arabic text still pass. The JSDoc cites F-DG2-231 and F-DG2-260.

### 1.2 Coverage through the existing users of the helper

Everything that already called the helper picks up the change automatically:

- **Central request check** (`findInvalidCharacter` / `assertNoInvalidCharacters` in `apps/api/src/modules/platform/validation.ts`). It covers body, query and params, values and object keys. The answer is 400 `validation.invalid_character` at the **field's** pointer (for example `/outOfScope`, `/steps/0/name`, `/k\ud800`).
  - Before, a step name reached jsonb and failed there with `validation.format` at pointer `''`.
  - Before, text columns silently received U+FFFD.
  - The problem message now reads "The text contains an unsupported character (U+0000 or an unpaired UTF-16 surrogate)."
- **Shared `freeText`, `name` and `reason` schemas.** They give exactly one error, `validation.invalid_character`, and never `validation.blank` as well, so the web client catches it before sending.
  - The EN web string was "Remove the unsupported invisible character …". It is now "Remove the unsupported character from this text.", because a lone surrogate renders as a replacement glyph. The AR string already said "unsupported character" (`أزِل الحرف غير المدعوم من هذا النص.`) and is unchanged.
- **`identityClaimsStorable`** (OIDC). A lone surrogate in `iss` or `sub` now follows the declared callback contract: **302 `/login?error=token_invalid` plus a `session.login_failed` audit row**, exactly like the NUL case. No user, identity or session is created.

### 1.3 OIDC claims that get stored (`apps/api/src/modules/identity/oidc.ts`, `routes.ts`)

- **Display-name claims.** `displayNameCandidate` (used for `name`, then `preferred_username`, then `email`) treats a claim containing an invalid character as absent, so the next claim is used and U+FFFD is never stored silently.
- **`email` / `email_at_binding`.** An e-mail claim with an invalid character is treated as absent: it is not stored and not used to bind.
- **`iss` / `sub`.** `identityClaimsStorable` now also refuses an **empty** value and one **longer than its `user_identity` column** (issuer 512, subject 255 *code points*).
  - I found this during the sweep: a 256-character `sub` used to reach the CHECK constraint and return an **undeclared 422** from the callback. The negative-control log below shows it.
  - The audit reason now reads "OIDC sign-in refused: the ID token's issuer or subject cannot be stored (unsupported character, empty or too long)". The existing NUL test was updated to match.
- **Defence in depth.** If `resolveOidcUser` still raises a SQLSTATE class-22 data exception or a 23514 check violation, the callback audits `session.login_failed` ("… an ID-token claim value could not be stored") and redirects 302 `token_invalid`. It no longer emits an undeclared 400/422 problem from a browser-navigation endpoint, and the transaction has already rolled back. With the checks above this path is unreachable today, so it has no dedicated test.

### 1.4 New shared helper: `truncateText(value, max)`

It cuts a string to at most `max` UTF-16 code units without splitting a surrogate pair. The sweep found that a plain `.slice(0, n)` on valid text can *create* a lone surrogate whenever an emoji straddles the boundary (see §2).

## 2. Sweep: client- or IdP-supplied strings that reach storage or audit

| Source | Reaches | Path before | Now |
|---|---|---|---|
| JSON body, query, path params (all routes except the callback) | text/jsonb columns, audit `changes` | central check (NUL only) | central check: NUL **and lone surrogate** → 400 `validation.invalid_character` at the field pointer |
| OIDC callback query (`state`, `code`, `error`) | `state` hashed only; `code` sent to the IdP; `error` never stored | route schema `storable()` with `hasInvalidCharacter` | same helper, so lone surrogates are covered. Percent-decoding never yields one (CESU-8 bytes are not valid UTF-8). Declared 302 `invalid_request` |
| ID-token `iss`, `sub` | `user_identity`, audit `changes` (jsonb) | `identityClaimsStorable` (NUL only) | helper, plus non-empty and column-length checks; DB-error fallback (§1.3) |
| ID-token `name`, `preferred_username` | `app_user.display_name` | `displayNameCandidate` (NUL only) | helper: treated as absent, falls back to the next claim |
| ID-token `email` | `app_user.email`, `user_identity.email_at_binding`, bind lookup | NUL-only guard | helper: treated as absent |
| `User-Agent` header | `session.user_agent` | helper (NUL); `.slice(0, 512)` | helper (now also lone surrogates); **`truncateText(…, 512)`**. Node decodes header values as Latin-1, so a surrogate cannot arrive over HTTP; this is defence in depth |
| `X-File-Name` header | `evidence_content.file_name` | regex `^[^\\/\x00-\x1f]+$` after `decodeURIComponent` | **added** `.refine(!hasInvalidCharacter, validation.invalid_character)`. `decodeURIComponent` throws on CESU-8 surrogate bytes, and the raw fallback is Latin-1, so no surrogate can arrive today; this is defence in depth |
| `X-Request-Id` (audit `request_id`), `Idempotency-Key`, `If-Match` | audit, idempotency table | strict ASCII regexes | unchanged: already safe (ASCII only) |
| Derived revoke reason `Source assignment … revoked: <reason>` (`access/assignments.ts`) | `scoped_assignment.revoke_reason`, audit | `.slice(0, 1000)` could split an emoji in a valid reason | **`truncateText(…, 1000)`** |
| Gate decision `outcome_text` = `<outcome>: <rationale>` (`workflows/gates.ts`) | `decision.outcome_text` | `.slice(0, 8000)`: a rationale of 7989 `x` plus an emoji gave a lone high surrogate, **stored as U+FFFD** (negative control) | **`truncateText(…, 8000)`**; integration-tested |
| Good-outcome readiness message quoting an outcome statement (`workflows/criteria.ts`) | API response / gate readiness | `.slice(0, 77)` | **`truncateText(…, 77)`** |
| Outbox relay `last_error` (`apps/worker/src/relay.ts`) | `outbox_event.last_error` | `.slice(0, 2000)` | **`truncateText(…, 2000)`** |
| `displayNameCandidate` truncation | `display_name` | `Array.from` (code points) | unchanged: already pair-safe (F-DG2-181) |

I searched `apps/api/src`, `apps/worker/src`, `packages/db/src` and `packages/shared/src` for `.slice(`, `.substring(`, `.substr(` and `request.headers[`. The remaining `.slice` calls work on hashes, arrays or ASCII values.

### Observation outside this assignment's scope (not changed)

A path segment with an **undecodable** percent escape (`%ED%A0%80`, but equally `%ZZ`) is refused by Fastify's router (`FST_ERR_BAD_URL`) before any hook runs. The response is a **plain `application/json` 400, not `application/problem+json`**. This predates F-DG2-260 and is unrelated to surrogates. No lone surrogate is ever decoded, nothing is written and no audit row is created.

The new test asserts exactly that, with the contract assertion turned off and an explanatory comment. Mapping it would mean a Fastify `frameworkErrors` handler, and for GET item routes a contract decision (the BE10 handback already noted those routes don't declare 400). I suggest the orchestrator route it to the contract owner if wanted.

## 3. Changed files

| File | Purpose |
|---|---|
| `packages/shared/src/schemas/common.ts` | `hasInvalidCharacter` adds `\p{Cs}` (F-DG2-260); new `truncateText`; doc comments updated |
| `apps/api/src/modules/platform/validation.ts` | Comments; problem message names the unpaired surrogate |
| `apps/api/src/modules/identity/oidc.ts` | `identityClaimsStorable`: helper plus non-empty and column-length (code-point) checks; comments |
| `apps/api/src/modules/identity/routes.ts` | Callback: new audit reason; DB-error fallback to 302 `token_invalid` plus audit; comments |
| `apps/api/src/modules/identity/sessions.ts` | `user_agent` uses `truncateText` |
| `apps/api/src/modules/access/assignments.ts` | Derived revoke reason uses `truncateText` |
| `apps/api/src/modules/workflows/gates.ts` | `outcome_text` uses `truncateText` |
| `apps/api/src/modules/workflows/criteria.ts` | Quoted outcome statement uses `truncateText` |
| `apps/api/src/modules/evidence/routes.ts` | `X-File-Name` refine with the helper |
| `apps/worker/src/relay.ts` | `last_error` uses `truncateText` |
| `apps/web/src/i18n/en/problems.json` | EN message no longer says "invisible" |
| `packages/shared/src/schemas/schemas.test.ts` | New F-DG2-260 block (§4); F-DG2-180 lone-surrogate cases moved from "blank" to "invalid character" |
| `apps/api/src/modules/platform/platform.test.ts` | `findInvalidCharacter` lone-surrogate case; new message |
| `apps/api/src/modules/identity/oidc-claims.test.ts` (new) | Unit tests of `identityClaimsStorable` / `displayNameCandidate` |
| `apps/api/test/integration/invalid-character.test.ts` | New F-DG2-260 block |
| `apps/api/test/integration/oidc.test.ts` | New F-DG2-260 block; NUL test's audit reason updated |
| `apps/api/test/integration/gates.test.ts` | `outcome_text` emoji-boundary test |
| `apps/api/test/integration/blank-text.test.ts` | `"\ud800"` removed from the blank matrix (now `invalid_character`; comment explains) |
| `apps/api/test/support/fake-idp.ts` | Optional `iss` claim override for tests |
| `docs/delivery/handbacks/DG2/T-DG2-BE11-evidence/*` | Logs, `checks.sh`, `final-tree.sha256` |

## 4. Tests added

**Shared unit** (`schemas.test.ts`, `oidc-claims.test.ts`, `platform.test.ts`):

- `hasInvalidCharacter` is true for:
  - `"a\uD800"`, `"\uDC00b"`, `"\uD800\uD800"`;
  - `"\uDFFF"`, a surrogate next to an emoji, and a surrogate inside Arabic.
- It is false for:
  - `"\u{1F600}"`, `"😀"`, Arabic text;
  - a ZWJ family emoji, CJK astral text and `""`.
- `freeText`, `name` and `reason` refuse those values with `validation.invalid_character` only. A value that is only a lone surrogate is invalid, not blank.
- Pointers are `outOfScope`, `steps/0/name` (`journeyCreate`) and `reason`.
- Emoji and Arabic are kept verbatim.
- `truncateText` never splits a pair.
- `identityClaimsStorable` refuses NUL or a lone surrogate in `iss`/`sub`, an empty value, `sub` > 255 and `iss` > 512 code points. It counts code points: 255 emoji fit.
- `displayNameCandidate` treats lone-surrogate values as absent and keeps emoji and Arabic.
- `findInvalidCharacter` finds lone surrogates in values and keys, but not pairs.

**Integration** (real PostgreSQL 16.13; every call goes through the harness's OpenAPI contract assertion):

- A lone surrogate in a **charter field** (create `/outOfScope`, update `/inScope`), a **journey step name** (`/steps/0/name`, jsonb) and a step's `systems[1]` gives 400 `validation.invalid_character` at the field pointer.
  - The same holds for a TOM-gap archive **reason** (`/reason`) and an **object key**.
  - Each one **writes nothing and creates no audit row**: no charter or journey, the version and value are unchanged, and the audit trail is unchanged.
- **OIDC:**
  - A lone surrogate in **`sub`** gives 302 `token_invalid` plus a `session.login_failed` row on both paths: the JIT path (3 variants) and the bind path (a pre-provisioned user with a verified e-mail is not bound).
  - The same holds for a lone surrogate in **`iss`**, and for a 256-code-point `sub`.
  - In every case **no user, identity or session** is created.
  - A lone surrogate in **`name` falls back to `email`**, and in `name` to `preferred_username`. One in `email` makes the e-mail absent.
- **Valid emoji and Arabic still pass:**
  - charter `outOfScope` and journey name/step name are stored verbatim (text and jsonb);
  - an OIDC `sub` with emoji and Arabic, and an Arabic name with an emoji, sign in and are stored verbatim.
- **Gate decision:** a rationale with an emoji at the 8000 boundary is recorded (201), and `outcome_text` is `approved: ` plus 7989 `x`, with no U+FFFD.

## 5. Checks actually run

**Environment:**

- Sandbox, offline, `/home/user/My-owns`.
- PostgreSQL 16.13 in disposable clusters via `tests/qa/support/with-pg.sh`: `server_encoding UTF8, lc_collate C, lc_ctype C`.
- Node 24.21.0 (`/opt/nvm/versions/node/v24.21.0/bin`) unless stated; Node 22.22.2 (`/opt/node22/bin`) for check 07.
- Chromium from `/opt/pw-browsers`. `playwright install` was not run.

**Locale modes:**

- `nolocale` = `env -u LANG -u LC_ALL -u LC_CTYPE -u LC_COLLATE -u LC_MESSAGES -u LC_NUMERIC -u LC_TIME -u LC_MONETARY`.
- `cutf8` = the same unsets, plus `LANG=C.UTF-8`.

The runner is `docs/delivery/handbacks/DG2/T-DG2-BE11-evidence/checks.sh`. Each log's second line holds the exact command, and the third line the node version and locale variables.

The final run started 12:56Z (nolocale), then cutf8 ran, ending 13:10:05Z, with nothing else running. Before it, the changed files were pinned in `final-tree.sha256` (19 files). Afterwards, `sha256sum -c` reported 0 mismatches.

| # | Check (command) | nolocale | cutf8 |
|---|---|---|---|
| 01 | `pnpm -r typecheck` | exit 0 | exit 0 |
| 02 | `pnpm -r build` | exit 0 | exit 0 |
| 03 | `pnpm lint` (`eslint . --max-warnings=0`) | exit 0 | exit 0 |
| 04 | `pnpm format:check` | exit 2: 12 `EACCES … Unable to read file` errors, **only** for the sandbox-masked dotfiles (`.bash_profile` … `CLAUDE.local.md`), then `All matched files use Prettier code style!` | exit 2, same 12 EACCES only, same line |
| 05 | `npx prettier --check . '!.bash_profile' '!.bashrc' '!.gitconfig' '!.gitmodules' '!.idea' '!.mcp.json' '!.profile' '!.ripgreprc' '!.vscode' '!.zprofile' '!.zshrc' '!CLAUDE.local.md'` | exit 0, `All matched files use Prettier code style!` | exit 0, same |
| 06 | `pnpm openapi:lint` | exit 0, `PASS docs/api/openapi.yaml: OpenAPI 3.1.1, 161 operations` | exit 0, same |
| 07 | `pnpm test` on Node 22.22.2 | exit 0, `Test Files 35 passed (35)`, `Tests 667 passed (667)` | exit 0, 35/35, 667/667 |
| 08 | `pnpm test` on Node 24.21.0 | exit 0, 35/35, 667/667 | exit 0, 35/35, 667/667 |
| 09 | `QA_PG_PORT=55471 tests/qa/support/with-pg.sh pnpm test:integration` | exit 0, `Test Files 31 passed (31)`, `Tests 520 passed (520)` | exit 0, 31/31, 520/520 |
| 10 | `E2E_PG_PORT=55481/55482 E2E_API_PORT=3591/3592 PLAYWRIGHT_BROWSERS_PATH=/opt/pw-browsers apps/web/e2e/support/with-stack.sh npx playwright test apps/web/e2e/journeys.spec.ts apps/web/e2e/p2-journeys.spec.ts apps/web/e2e/p2-blank-text.spec.ts --project=chromium-en --project=chromium-ar --workers=1` | exit 0, `Running 58 tests using 1 worker`, `58 passed (3.7m)` | exit 0, `58 passed (3.7m)` |
| 11 | `node tools/gates/validate.mjs --historical --stage DG1` | exit 0, `PASS gate DG1 (historical)` | exit 0, same |

The integration files named in the assignment passed in both modes:

- `contract/contract.test.ts` (14 tests);
- `invalid-character.test.ts` (20);
- `oidc.test.ts` (33);
- `blank-text.test.ts` (29);
- also `gates.test.ts` (12).

### Negative control (the new tests fail on the old code)

I wrote the 11 product files back to their `HEAD` content with `git show HEAD:<path> > <path>` and kept the new tests. (`git checkout` is impossible here because `.git` is read-only.) After the runs I restored my versions from a tar backup, and `sha256sum -c` reported 11/11 OK. Both runs used Node 22.22.2, nolocale and disposable PostgreSQL 16.13 (UTF8).

**Unit** (`negative-control-unit.log`): exit 1, `Tests 12 failed | 81 passed (93)`.

- All F-DG2-260 schema cases fail.
- The `identityClaimsStorable` and `displayNameCandidate` cases fail.
- The `findInvalidCharacter` surrogate case fails.
- The message test fails.
- `truncateText` fails with "not a function".

**Integration** (`negative-control-integration.log`, `invalid-character.test.ts oidc.test.ts gates.test.ts`): exit 1, `Tests 11 failed | 54 passed (65)`. These failures reproduce the finding:

- **OIDC `sub`, JIT and bind paths:** `contract: completeOidcLogin does not declare status 400 (declared: 302, 429)`, body `validation.format` at pointer `""`.
- **Charter create/update and archive reason:** 201/200 with the value **stored as `Synthetic�exclusion`** (U+FFFD).
- **Journey step name and object key:** 400 at pointer `''` instead of the field's pointer.
- **Gate decision:** `outcome_text` ends in U+FFFD.
- **256-code-point `sub`:** `completeOidcLogin does not declare status 422`.
- **`name` with a lone surrogate:** stored instead of falling back.
- **The existing NUL `sub` test:** fails only on its updated audit-reason text.

These pass on the old code too, as expected:

- the emoji/Arabic positive controls;
- the percent-encoded test (pre-existing router behaviour, §2);
- the **`iss`** case. openid-client already rejects an `iss` that differs from the configured issuer, so it was 302 `token_invalid` and audited before this change as well. `identityClaimsStorable`'s `iss` branch is covered by the unit test.

## 6. Known gaps / not done

- **Pre-existing, not changed:** the router's plain-JSON 400 for undecodable path escapes (§2 observation).
- **Untested fallback:** the defence-in-depth DB-error fallback in the callback (§1.3) has no dedicated test, because no claim value can reach it with the new checks in place.
- **e2e not extended:** `p2-blank-text.spec.ts` was run in both locales but not extended with lone-surrogate input. Browser input cannot produce an unpaired surrogate through normal typing. The web-side refusal comes from the shared schemas (unit-tested), and the API refusal is integration-tested.
- **Run note:**
  - My first full-matrix attempt was invalid. It hit a `blank-text.test.ts` case that still expected `"\ud800"` to be blank. I then stopped that run with `pkill`, but the stop was incomplete: its outer shell went on to start the cutf8 phase, which overlapped my second attempt. That overlap deleted shared Playwright trace files in that attempt's nolocale e2e (`ENOENT … .playwright-artifacts-0/traces`; 1 failed, 53 passed).
  - I discarded every check log from both attempts, waited until no checks, vitest, playwright or postgres processes remained, deleted the untracked `test-results/` and ran the whole matrix again, sequentially.
  - All results in §5 come from that final run. The negative-control logs come from an earlier, separate run with no overlap.

## 7. Merge instructions

- **Commit:**
  - the 18 modified files and the new `apps/api/src/modules/identity/oidc-claims.test.ts`;
  - this handback and `docs/delivery/handbacks/DG2/T-DG2-BE11-evidence/`.
- **No migrations, no new endpoints.** `packages/shared` must be rebuilt (`pnpm -r build`) for consumers of `dist`.
- **API behaviour changes:**
  - A request whose body, query or params contain a lone UTF-16 surrogate now gets 400 `validation.invalid_character` at the field pointer. Before, it was stored as U+FFFD, or answered 400 `validation.format` at `''` for jsonb values.
  - At the OIDC callback, a lone surrogate (or an empty or over-long value) in `iss`/`sub` gives 302 `token_invalid` plus a `session.login_failed` row. The audit reason text changed to "… cannot be stored (unsupported character, empty or too long)".
- **No conflicts expected.** No other agent ran during this task.
