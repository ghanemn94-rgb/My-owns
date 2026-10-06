# Handback T-DG2-BE5 (backend-workflow-engineer): blank free text; F-DG2-143 web residual

- **Stage:** DG2 (FIXING), round 3. **Branch:** `claude/mobily-transformation-platform-regate`.
- **Base:** `4b81a918b8af9dcb3cba1aa959f2a470051c908f`. Verified with `git rev-parse HEAD` before writing. The tree was clean apart from untracked, sandbox-masked dotfiles.
- **Invocation:** `DG2-T-DG2-BE5-backend-workflow-engineer-20261006T051748Z-f7ee9e37` (session `f7ee9e37-87bc-4d15-a0af-f61ec68ed78e`).
- **Assignment:** `docs/delivery/assignments/DG2/round-3/T-DG2-BE5.md`, sha256 `029715676ecc6df97ff6248625785d4d1ec3b258ad9366f2ac16854025807e54` (verified).
- **Commit state:** nothing is committed. The changes are in the working tree for the orchestrator to integrate.
- **Frozen files:** `docs/api/openapi.yaml` and migrations 0010-0019 are untouched.
- **New in this task:** no migrations, no API endpoints.

## 1. Changed files

| File | Purpose |
|---|---|
| `packages/shared/src/schemas/common.ts` | New shared helpers. `hasText(v)` is the single trimmed-non-empty "is present" test. `freeText(min, max)` is a string with min/max that rejects whitespace-only text with `validation.blank` (`BLANK_TEXT_CODE`). An empty string fails only `min`, so a value never gets two errors. No trimming transform. |
| `packages/shared/src/schemas/{charter,decision,design,diagnose,direction,evidence,kpi,methodology}.ts` | Each local `text(min, max)` helper is now `freeText`. In charter it is `freeText(...).nullable()`. Charter `changeSummary` also uses `freeText`. Design `actor`/`handoffTo` (no minimum) are now `freeText(0, 200)`: `""` is still accepted, spaces alone are not. |
| `packages/shared/src/schemas/gate.ts` | `submissionNote`, `rationale` (`freeText(3, 8000)`) and `comments`, both in the read mirror and in the create bodies. |
| `packages/shared/src/schemas/team.ts` | `accountabilityEn/Ar` and `sourceRef` use `freeText`. |
| `packages/shared/src/schemas/schemas.test.ts` | Unit tests for `hasText` and `freeText`, a per-kind schema sweep, the null-clear case and a blank thesis part. |
| `apps/api/src/modules/workflows/criteria.ts` | G1-G3 facts use `hasText` for T01 `current_state`, `root_cause` and `impact_text`, and for charter `case_for_change`, `transformation_name` and `in_scope`. They no longer use `!== null`. The thesis already goes through `composeThesis`. |
| `apps/api/src/modules/transformations/charter.ts` | `hasExclusions` now delegates to `hasText`. The `scope_items_traced` pre-check treats a blank `in_scope` as not recorded (`unknown`). `baseline_measurable` uses `hasText(source)`. |
| `apps/api/src/modules/kpi/gate-facts.ts`, `apps/api/src/modules/kpi/baselines.ts` | A baseline `source` counts only when `hasText` is true (G1 `hasSource` and the validated-baseline measurability check). |
| `apps/api/src/modules/transformations/good-outcome.ts` | The causal-chain check uses the shared `hasText`. Behaviour is the same as before (it already trimmed). |
| `apps/api/src/modules/transformations/exclusions.test.ts` | Adds a check that `hasExclusions` equals `hasText` for every case. |
| `apps/api/test/integration/blank-text.test.ts` (new) | Integration tests on PostgreSQL; see section 2. |
| `apps/api/test/integration/registers.test.ts` | The BE4 test that PATCHed a whitespace-only Out of scope (expecting 200) now expects **400** `validation.blank` at `/outOfScope`, with nothing written. The later If-Match steps are renumbered (1→2→3), and the audit trail is `create 1, update 2, update 3`. |
| `apps/web/src/i18n/{en,ar}/problems.json` | New key `validation__blank`. EN: "Enter some text; spaces alone are not a value." AR: "أدخِل نصاً؛ المسافات وحدها ليست قيمة." |
| `apps/web/src/lib/lib.test.ts` | Client-side check: the shared schema yields `validation.blank` through `issueCode`, and it is localized in EN and AR. |
| `apps/web/src/pages/p2.test.tsx` | Rendered T01 edit dialog in EN and AR: a server 400 `validation.blank` at `/rootCause` shows the localized message on that field, with `aria-invalid`. |
| `apps/web/src/test/fixtures.tsx` | `renderApp(..., { retryDelayMs })`: an optional query `retryDelay` for tests (Part B). |
| `apps/web/src/pages/transformations/transformations.test.tsx` | Part B: an explicit `30_000` timeout with an F-DG2-143 comment, `retryDelayMs: 0`, and a new assertion that the three failing `/me` reads really happen. |
| `docs/architecture/adr/ADR-0017-charter-versioning-and-direction.md` §2 | Records the rule "blank free text is rejected; null clears", citing F-DG2-150. |
| `docs/delivery/handbacks/DG2/T-DG2-BE5-evidence/**` | Small logs, the axe summaries and 2 screenshots (692 KB). |

## 2. Behaviour delivered

### Part A: blank free text is never stored as content (F-DG2-150 root cause)

**A1. Validation.** Every P2 free-text field rejects a whitespace-only value. This covers spaces, tabs, line breaks, NBSP and the ideographic space.
- The API returns the standard 400 problem: `code: "validation"`, with `errors[] = {pointer: "/<field>", code: "validation.blank"}`.
- Nothing is written and the request has no audit event.
- `null` still clears nullable fields.
- Accepted text is stored exactly as entered. For example, `"  Retail onboarding (synthetic)  "` round-trips unchanged.
- The helper types stay usable: `freeText(...)` is a `ZodString`, so `.nullable()`, `.optional()` and `z.infer` work at every call site, and typecheck passes.

**A2. Readiness (defense in depth).** Every free-text "is present" test in G1-G3 readiness and the charter pre-checks uses `hasText`. `hasExclusions` is now a named alias of it.
- `composeThesis` already treated a blank part as missing. A unit test covers this, and so does the integration test (a blank `thesis_because` gives a `charter.thesis_incomplete` warning at `/charter/thesisBecause`).
- I also applied `hasText` to KPI baseline `source` presence (G1 `hasSource`, the `baseline_measurable` pre-check, and the measurability check that un-validates a baseline). These are the same kind of check, in the kpi module.

**A3. Web.**
- `RecordForm` already sends blank input as `null`. On a nullable field that clears it; on a required field the shared schema flags it client-side as `validation.required`.
- The shared schemas, which the forms use client-side, now also reject whitespace-only text with `validation.blank` (tested).
- A server `validation.blank` lands on its field with the new EN/AR message (rendered test in both languages).
- The gate decision dialog trims before validating, so a blank rationale gives the localized `validation.too_small`/`required` message.

**A4. ADR.** ADR-0017 §2 now states the rule.

**A5. Tests** (all pass; output in section 3):
- **`blank-text.test.ts`** (12 tests). Each kind below gets a whitespace-only value and returns 400 with its pointer and `validation.blank`. Each test also checks that the request has no audit row and that nothing was written (the version, value and audit trail of the record are unchanged, or the row count is unchanged for creates).
  - charter `inScope`, `caseForChange`, `thesisBecause` (three blank variants each), and a charter create;
  - T01 `currentState`;
  - T03 TOM gap (create `gap`, update `targetState`);
  - T04 decision (create `title`, update `context`);
  - KPI definition `name`;
  - evidence note `noteBody`.
- **Valid text and `null`.** Valid text with surrounding spaces is stored verbatim. `null` clears charter `inScope` and T01 `currentState`, and each change is audited exactly once.
- **Defense in depth.** Blank text is written directly to the database as an audited system write (the record guards require version + 1, an audit event and a charter snapshot). G1 then reports `case_for_change.missing`, `initial_charter` In scope and Out of scope missing, `current_state_missing`, `root_cause_missing`, `impact_missing` and `t01_root_cause_missing`. The thesis warning lists `thesisBecause`; `problem_traceability` is `unknown`; `exclusions_documented` is `attention`.
- **Mutation check.** With `criteria.ts` temporarily reverted to `HEAD`, the defense-in-depth test **fails** (`expected false to be true`). With the fix restored it passes.

### Part B: F-DG2-143 residual (web unit-test timeout headroom)

- **Cause.** The ~3.2 s was not the assertion. `useMeQuery` sets `retry: shouldRetry` (two retries for a 5xx), which overrides the test client's `retry: false`. TanStack Query's default exponential back-off then waited 1 s + 2 s in real time. The create page races that refetch against `ME_REFRESH_TIMEOUT_MS` (5 s).
- **Fix.** The test renders with `retryDelayMs: 0`, so the same retries run immediately, and it has an explicit `30_000` timeout with an F-DG2-143 comment.
- **The assertion is not weakened.** It now also checks that at least three `GET /api/v1/me` calls follow the POST (the first read plus two retries, all 503).
- **Result.** The test runs in **163 ms** on Node 24 and **182 ms** on Node 22 (was ~3.2 s).
- **Sweep.** I re-ran both unit projects with `--reporter=verbose`. All 520 tests report a duration, and **no unit test takes 1.5 s or more**, so the list of tests over 1.5 s is empty on both Node versions. The slowest is `architecture.test.ts > every import respects dependsOn…` at 1403 ms (Node 24) and 1494 ms (Node 22); it already has an explicit 30 s timeout (`AST_TEST_TIMEOUT_MS`, BE4). The slowest test on the 5 s default is `p2.test.tsx > Diagnose > shows the six T01 dimensions…` at 629/645 ms, well short of 2.5 s. So no test without an explicit timeout is within 2x of its timeout.

## 3. Checks run (real output)

Environment: Node v24.21.0 unless stated otherwise, offline sandbox, disposable PostgreSQL 16.13 (`/usr/lib/postgresql/16`).

| Command | Result |
|---|---|
| `pnpm -r typecheck` | **exit 0** (shared, web, db, api, worker: Done) |
| `pnpm -r build` | **exit 0** (`apps/api build: Done`, `apps/worker build: Done`) |
| `pnpm lint` (`eslint . --max-warnings=0`; covers the new untracked test file) | **exit 0** |
| `pnpm format:check` | **exit 2**, only because of the 12 sandbox-masked, unreadable untracked files (`.bash_profile`, `.bashrc`, `.gitconfig`, `.gitmodules`, `.idea`, `.mcp.json`, `.profile`, `.ripgreprc`, `.vscode`, `.zprofile`, `.zshrc`, `CLAUDE.local.md`: `EACCES`). Otherwise: "All matched files use Prettier code style!" |
| `pnpm exec prettier --check . --ignore-path .prettierignore --ignore-path <list of those 12 masked paths>` | **exit 0**: "All matched files use Prettier code style!" |
| `pnpm openapi:lint` | **exit 0**: `PASS docs/api/openapi.yaml: OpenAPI 3.1.1, 161 operations` |
| `pnpm test --reporter=verbose`, Node v24.21.0 | **exit 0**: `Test Files 31 passed (31)`, `Tests 520 passed (520)` (was 504; +16 new) |
| `pnpm test --reporter=verbose`, Node v22.22.2 (`/opt/node22/bin`) | **exit 0**: `Test Files 31 passed (31)`, `Tests 520 passed (520)` |
| `QA_PG_PORT=55471 tests/qa/support/with-pg.sh pnpm test:integration` | **exit 0**: `Test Files 29 passed (29)`, `Tests 456 passed (456)` (was 444; +12 in `blank-text.test.ts`). `contract/contract.test.ts` passed 11/11, including the 161-operation length assertion. `registers.test.ts` passed 23/23. PostgreSQL 16.13, 19 migrations applied to a fresh database. |
| `E2E_PG_PORT=54481 E2E_API_PORT=3481 PLAYWRIGHT_BROWSERS_PATH=/opt/pw-browsers E2E_SCREENSHOT_DIR=… apps/web/e2e/support/with-stack.sh npx playwright test apps/web/e2e/journeys.spec.ts apps/web/e2e/p2-journeys.spec.ts --project=chromium-en --project=chromium-ar --workers=1` | **exit 0**: `42 passed (2.8m)`. axe: 116 page checks (P1 17 + P2 41, in each of EN and AR), **0 violations of any impact**, so 0 serious or critical. Pre-installed Chromium; `playwright install` was not run. |
| `node tools/gates/validate.mjs --historical --stage DG1` | **exit 0**: `PASS gate DG1 (historical)` |

Evidence (small), under `docs/delivery/handbacks/DG2/T-DG2-BE5-evidence/`:
- **Logs:** `unit-runs.log` (both Node tails plus the 5 slowest tests per run), `targeted-unit-tests.log`, `integration-run.log`, `e2e-run.log`, `validate-dg1-historical.log`.
- **axe:** `axe/{en,ar}-axe-summary{,-p2}.json`.
- **Screenshots:** `screenshots/{en,ar}-p2-04a-charter-no-exclusions.png`.

## 4. Known gaps / not done

- **The OpenAPI contract cannot express the rule.** `docs/api/openapi.yaml` is frozen, so it still says only `minLength: 1` for these fields. It does not document "not blank" or the `validation.blank` code. The contract test still passes, because a refinement is stricter than the contract and every exercise uses real text. Recommend a doc-only contract note when the file unfreezes.
- **Trimmed minimum length is not enforced.** The rule is exactly what the assignment asked for: trimmed length > 0. A minimum above 1 is still checked against the untrimmed length, so a gate `rationale` of `"  a"` (3 characters) is accepted.
- **Design fields `actor` and `handoffTo`.** These had no minimum. They now reject whitespace-only text but still accept `""`, as the contract allows.
- **P1 fields are out of scope.** For example, transformation `description` (`z.string().max(4000)`) is unchanged. P1 `name`/`reason` already trim before checking their minimum.
- **Existing blank rows are not migrated.** Blank text already in a database stays as stored; it is treated as missing by readiness (A2). It cannot be re-saved blank through the API.

## 5. Merge instructions

- No migrations and no new endpoints. Rebuild `@mth/shared` (`pnpm -r build`) before running the API or worker from `dist`.
- `blank-text.test.ts` is a new integration file in the existing `integration` project. No config change is needed.
- **Behaviour change for API clients:** a whitespace-only string on any P2 free-text field is now 400 instead of 200. The repository's tests and e2e send no such values, apart from the BE4 test I updated in `registers.test.ts`.
- **Expected conflicts:** none. Only `registers.test.ts` (the F-DG2-150 block) and `transformations.test.tsx` (one test) are touched among shared test files.
- Product gates G1-G6 here are business approvals inside the product; this work grants none and implies nothing about DG0-DG7.
