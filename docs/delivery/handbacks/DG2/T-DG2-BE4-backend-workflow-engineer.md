# Handback T-DG2-BE4: DG2 round-2 repairs (backend-workflow-engineer)

- **Stage:** P2 / DG2 (FIXING). **Assignment:** `docs/delivery/assignments/DG2/round-3/T-DG2-BE4.md` (sha256 `649b1410…7c74a`, verified before starting).
- **Invocation:** run `DG2-T-DG2-BE4-backend-workflow-engineer-20261006T050531Z-9f2d6d44`, session `9f2d6d44-31c3-40ae-bdb9-07d90b4e4af7`.
- **Base:** `HEAD` = `e9b14ca7523d7a1c120284ebce7365efa8979a53`, branch `claude/mobily-transformation-platform-regate`. Uncommitted working-tree changes; the orchestrator integrates them.
- **Not touched:** `docs/api/openapi.yaml`, migrations 0010-0019, `apps/web/**`, `requirements.csv`, `tools/gates/**`, `tools/agents/**`, `.claude/agents/**`, `docs/source/**`, reviews and gate records.
- **No migrations, no new endpoints, no contract change.** The pre-check result enum (`pass | attention | not_applicable | unknown`) is unchanged.

## 1. F-DG2-150 (Medium, mandatory; REQ-PB-031 A01 / B0041): the exclusions pre-check now fails

### Fix

- **New helper.** `hasExclusions(outOfScope)` in `charter.ts` (exported through `transformations/index.ts`). It returns true only when `out_of_scope` is non-null **and** its trimmed length is greater than 0.
- **`scopeCheckPrechecks`, `case "exclusions_present"`:**
  - A null, empty or whitespace-only value gives `result: "attention"`, with the detail `No explicit exclusions (out of scope) are documented; this check fails until Out of scope is completed.`
  - A non-blank value gives `pass` ("Explicit exclusions are documented.").
  - The case can no longer return `unknown` on a saved charter. The pre-checks are computed only for an existing charter, because GET returns `charter_not_found` otherwise.
- **Consistency check: other readers.** I searched for readers of `scopeCheckPrechecks`, `exclusions_present` and `out_of_scope` in `apps/api` and `packages`:
  - The pre-check itself is read only by the charter view.
  - The G1 criterion `g1.initial_charter` (`workflows/criteria.ts`) independently tested `out_of_scope !== null`, so a whitespace-only Out of scope counted as present there. It now uses `hasExclusions(...)`, so the pre-check and the G1 readiness agree: a blank Out of scope is the missing part "scope out" (`/charter/outOfScope`).
  - No other gate criterion reads it.
  - The web fixture `apps/web/src/test/p2fixtures.ts:453` still has `exclusions_documented: "unknown"`. It is FE scope (T-DG2-FE4) and I did not edit it.
- **ADR-0017 §2 updated.**
  - The table row now reads "`out_of_scope` is non-empty after trimming; otherwise `attention`".
  - A new paragraph says that on a saved charter an empty, null or whitespace-only Out of scope is a definite, failing answer (`attention`), not missing data. It is never `unknown` and never `pass`. The paragraph cites B0041 and REQ-PB-031 A01 and notes that `g1.initial_charter` uses the same rule.

### Tests

- **Updated: `apps/api/test/integration/registers.test.ts`, test "404 charter_not_found until created…".** The create assertion `["exclusions_documented","unknown"]` became `"attention"`.
- **New `describe` block in the same file: "F-DG2-150: the exclusions pre-check fails on an empty or blank Out of scope".** It uses a real PostgreSQL. Each step also checks the live G1 `g1.initial_charter` missing pointer `/charter/outOfScope`.

  | Step | Request | Pre-check result | G1 still lacks "scope out"? |
  |---|---|---|---|
  | Empty, never set | create | `attention` with the exact detail | yes |
  | Whitespace-only | `"   \n\t "`, PATCH with If-Match 1 → version 2 | `attention` | yes |
  | Real exclusion text | PATCH with If-Match 2 → version 3 | `pass`, also on GET | no |
  | Clear again | PATCH `outOfScope: null` with If-Match 3 → version 4 | `attention` | yes |

  - **Negative concurrency case:** a stale If-Match 2 gets 409 with `currentVersion` 3 and changes nothing.
  - **Audit trail:** `charter.create` (version 1) followed by `charter.update` for versions 2, 3 and 4.
  - **Authorization:** unchanged. The existing negative test (auditor gets 403 on charter POST/PATCH) still passes.
- **New unit test: `apps/api/src/modules/transformations/exclusions.test.ts`.** `hasExclusions` returns false for null, `""`, spaces and tabs/CRLF, and true for non-blank text.

## 2. F-DG2-143 (Low; REQ-S16-001): the flaky architecture unit check

### Fix

- **Shared constant.** `AST_TEST_TIMEOUT_MS = 30_000` in `apps/api/src/architecture.testkit.ts`, with a doc comment that cites F-DG2-143.
- **Where it is applied** (each with an F-DG2-143 comment):
  - `architecture.test.ts`, "every import respects dependsOn, public surfaces and allowed packages": per-test timeout of 30 000 ms.
  - `architecture.test.ts`, `describe("package dependency direction …", { timeout: AST_TEST_TIMEOUT_MS })`: each of its five tests parses a whole source tree. `apps/web` alone takes 0.5-0.8 s.
  - The five per-module boundary tests, which also walk module sources through the same lint (`moduleViolations`): `kpi.test.ts`, `workflows.test.ts`, `evidence.test.ts`, `methodology.test.ts` and `reporting.test.ts`.
- **The global unit default is not raised.** `vitest.config.ts` is unchanged.
- **"Make them cheaper": evaluated, deliberately not changed.**
  - **Profile.** Over 79 module files (one isolated run): `scanSource` took 401 ms and `ts.transpileModule` (the rule-4 syntax check) took 638 ms.
  - **Nothing to share between tests.** No two boundary tests in `architecture.test.ts` scan the same files. Only the "every import" test walks `src/modules`; the others walk different trees. The per-module tests live in separate test files, so they run in separate workers with isolated module state, and a shared cache wouldn't survive between them.
  - **Why the parse is not reused.** The remaining saving would be to reuse `scanSource`'s parse for the syntax check instead of `transpileModule`. That isn't behaviour-preserving. `transpileModule` parses with the file's own ScriptKind: JS files get JS-only syntactic diagnostics, which `scanSource` doesn't see because it parses them as TS. It also adds options and emit diagnostics. This fail-closed rule-4 behaviour is what F-DG1-137, F-DG1-217 and F-DG1-218 hardened, so a speed-up isn't worth weakening it. With 30 s against roughly 2 s under full parallel load, the headroom is about 15x.

### Slow unit tests (requirement: list every unit test slower than 2.5 s)

Command: `pnpm vitest run --project unit-node --project unit-web --reporter=verbose` (Node v24.21.0). All 504 tests listed. Tests ≥ 1.5 s:

```
 ✓ |unit-web| src/pages/transformations/transformations.test.tsx > effective permissions refresh after create (F-DG1-210) > a failed /me refresh never blocks the navigation; the UI stays fail-safe (no controls offered) 3194ms
 ✓ |unit-node| apps/api/src/architecture.test.ts > API module boundaries (ADR-0002) > every import respects dependsOn, public surfaces and allowed packages 1954ms
```

- **Only one test is slower than 2.5 s:** the unit-web test above. It was 3151-3228 ms across five runs (Node 22 and 24).
  - It runs within 2x of vitest's 5 s default, and `apps/web/vitest.config.ts` sets no `testTimeout`.
  - **It is not fixed (open gap).** The file is under `apps/web/**`, which this assignment forbids me to touch. It needs an explicit per-test timeout with F-DG2-143 headroom, for example `30_000`, from frontend-ux-engineer or a follow-up assignment.
- **unit-node.** The slowest unit-node test is the architecture boundary test (1.8-1.95 s in a full parallel run), now with a 30 s timeout. No other unit-node test exceeds 1.1 s (`kpi.test.ts` boundary test: 1034 ms on Node 22). That is outside 2x of 5 s, but it gets the 30 s timeout anyway as an AST-walking test.

## Changed files

| File | Purpose |
|---|---|
| `apps/api/src/modules/transformations/charter.ts` | `hasExclusions` helper; the `exclusions_present` pre-check returns `attention` for null, empty or blank and `pass` only for non-blank text (F-DG2-150) |
| `apps/api/src/modules/transformations/index.ts` | Exports `hasExclusions` on the module's public surface |
| `apps/api/src/modules/workflows/criteria.ts` | `g1.initial_charter` `hasOutOfScope` now uses `hasExclusions`, so a blank Out of scope is consistent with the pre-check |
| `apps/api/src/modules/transformations/exclusions.test.ts` | New unit test for `hasExclusions` |
| `apps/api/test/integration/registers.test.ts` | Create assertion changed to `attention`; new F-DG2-150 regression block (empty, blank, pass, cleared again with If-Match, stale 409, audit, G1 consistency) |
| `docs/architecture/adr/ADR-0017-charter-versioning-and-direction.md` | §2: blank Out of scope is a failing answer (`attention`), not missing data; cites B0041 and REQ-PB-031 A01 |
| `apps/api/src/architecture.testkit.ts` | `AST_TEST_TIMEOUT_MS = 30_000` (F-DG2-143) |
| `apps/api/src/architecture.test.ts` | Explicit timeout on the full boundary test and on the package-direction block |
| `apps/api/src/modules/{kpi,workflows,evidence,methodology,reporting}/*.test.ts` | Explicit timeout on each AST-walking boundary test. Prettier re-indented each test body; the logic is unchanged. |

## Checks actually run

Environment: offline sandbox, Linux. Node v24.21.0 (`/opt/nvm/versions/node/v24.21.0/bin`) unless stated. Node v22.22.2 is at `/opt/node22/bin`; it isn't under `/opt/nvm` as the assignment said.

| Command | Result |
|---|---|
| `pnpm -r typecheck` | **exit 0** on rerun: all 7 packages `Done`. The first run failed with exit 2 in `apps/web` while T-DG2-FE4 was editing `apps/web` at the same time (`apps/web/src/pages/p2.test.tsx` etc. modified mid-run). I re-ran once, as the assignment allows. |
| `pnpm -r build` | **exit 0** on rerun: all 7 packages `Done`. The first run failed with exit 2 in `apps/web` for the same reason (concurrent FE edits). I re-ran once. |
| `pnpm lint` | **exit 0** (`eslint . --max-warnings=0`) |
| `pnpm format:check` | **exit 2**, environmental: `[error] Unable to read file "CLAUDE.local.md": EACCES`. That file and `.zshrc`, `.bashrc` etc. are untracked sandbox-masked mounts (a character device), not repository files, and every readable file matched ("All matched files use Prettier code style!"). |
| `pnpm exec prettier --check . --ignore-path .prettierignore --ignore-path <untracked list>` | **exit 0**: "All matched files use Prettier code style!" |
| `prettier --check` + `eslint` on the new, untracked `exclusions.test.ts` | **exit 0** / **exit 0** |
| `pnpm openapi:lint` | **exit 0**: `PASS docs/api/openapi.yaml: OpenAPI 3.1.1, 161 operations` |
| `pnpm test`, Node v24.21.0 | **exit 0**: `Test Files 31 passed (31)`, `Tests 504 passed (504)` |
| `pnpm test`, Node v22.22.2 | **exit 0**: `Test Files 31 passed (31)`, `Tests 504 passed (504)` |
| `QA_PG_PORT=55471 tests/qa/support/with-pg.sh pnpm test:integration` (disposable PostgreSQL 16.13) | **exit 0**: `Test Files 28 passed (28)`, `Tests 444 passed (444)`. Includes `registers.test.ts` (23 tests), `gates.test.ts` (11) and `contract/contract.test.ts` (11). |
| `QA_PG_PORT=55471 … vitest run --project integration apps/api/test/integration/registers.test.ts --reporter=verbose` | **exit 0**: 23 passed, including the 4 new F-DG2-150 tests |
| `QA_PG_PORT=55471 … vitest run --project integration apps/api/test/integration/contract/contract.test.ts --reporter=verbose` | **exit 0**: 11 passed, including "covers every operation with at least one success…" against the 161-operation contract |
| `node tools/gates/validate.mjs --historical --stage DG1` | **exit 0**: `PASS gate DG1 (historical)` |

One unit-web test failed (`p2.test.tsx > Gates … gate list titles`, `TypeError … textContent`) in a pre-change baseline run made while T-DG2-FE4 was mid-edit. Every later unit run, including both `pnpm test` runs, passed 504/504.

## Known gaps / not done

1. **unit-web timeout headroom.** `apps/web/src/pages/transformations/transformations.test.tsx` "a failed /me refresh never blocks the navigation…" runs in about 3.2 s, within 2x of the 5 s default. It needs an explicit timeout, but `apps/web/**` is outside my scope. This is an open part of F-DG2-143 for the FE owner.
2. **Web fixture.** `apps/web/src/test/p2fixtures.ts` still models `exclusions_documented` as `unknown`. It is in FE scope; the API no longer returns `unknown` for that check on a saved charter.
3. **Same whitespace pattern elsewhere.** `in_scope` and the other G1 initial-charter text fields still use a `!== null` presence test, so whitespace-only text counts as present. That is outside F-DG2-150 and was left unchanged. It's raised here for the reviewers.
4. **The architecture lint was not made cheaper.** The reason is in §2; only the timeouts changed.

## Merge instructions

- No migrations and no OpenAPI change. Integrate the working-tree changes listed above, including the new file `apps/api/src/modules/transformations/exclusions.test.ts`.
- **Expected conflicts:** none with T-DG2-FE4 (`apps/web/**`) or T-DG2-AN3 (`requirements.csv`).
- **Note for the orchestrator** (`import-findings --fix`):
  - **F-DG2-150:** fixed in `charter.ts`, `criteria.ts`, `index.ts` and ADR-0017. Tests are in `registers.test.ts` and `exclusions.test.ts`.
  - **F-DG2-143:** the API side is fixed (timeouts). The unit-web residual in gap 1 stays open.
