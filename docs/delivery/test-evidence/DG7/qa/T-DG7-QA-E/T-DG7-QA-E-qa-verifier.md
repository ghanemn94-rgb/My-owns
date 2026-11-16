# Handback T-DG7-QA-E (qa-verifier): A18 harness reports BLOCKED without inputs

- Stage DG7 (BUILDING), base `HEAD` 567164b1da6ce6d8679a1977afeaf9e985daf221 (verified with `git rev-parse HEAD` at start; working tree clean except this run's own run folder).
- Invocation reference: `{"kind":"claude-code-cli-session","run_id":"DG7-T-DG7-QA-E-qa-verifier-20261115T020404Z-2826e9e5","session_id":"2826e9e5-e10d-4bfa-b1ce-ae02f39d308d"}`.
- Time: start `Sun Nov 15 02:04:15 UTC 2026`, end about `02:28 UTC` (about 24 minutes).
- **Location deviation:** the assignment names `docs/delivery/handbacks/DG7/T-DG7-QA-E-qa-verifier.md` and `…/T-DG7-QA-E-evidence/`. In this run the shell sandbox makes `docs/delivery/handbacks/DG7/` read-only (`mkdir: cannot create directory …: Read-only file system`). So this handback and its logs are under `docs/delivery/test-evidence/DG7/qa/T-DG7-QA-E/`, as with QA-C and QA-D (D-266: the orchestrator copied those handbacks). Please copy this file to the assigned path.
- No product implementation file was modified. All data used is SYNTHETIC.

## 1. Files changed

| File | Purpose |
| --- | --- |
| `tests/qa/support/a18-inputs.ts` (new) | `classifyA18Inputs(env)` returns `absent` (none of the three inputs set: a `BLOCKED:` reason naming them), `invalid` (some set but incomplete or wrong, or `QA_A18_REQUIRE=1` without inputs: a message naming each problem) or `ready`. |
| `tests/qa/integration/a18-transfer-drill.test.ts` (modified) | Part 2 now uses the classifier. **Absent:** the drill block is `describe.skipIf`-skipped. A skipped test titled with the BLOCKED reason is registered, and the same line goes to stderr. **Invalid:** every drill test and an input check fail. **Ready:** unchanged (same spawn, env, timeouts, `QA_A18_OUT`, assertions). A new always-run test checks DO-D's drill files and DOC-B's guide, so a missing file still fails without inputs. Part 1 is unchanged. Most of the diff is re-indentation from the `describe.skipIf(...)( … )` wrapper. |
| `tests/qa/support/a18-harness.vitest.config.ts` (new) | A Vitest config used only by the new unit test. It runs the harness file with `-t "A18 transfer drill"` (part 2 only, which needs no database), with no global setup and resolve conditions mirroring the root `integration` project. |
| `tests/qa/unit/a18-harness-blocked.test.ts` (new, joins `unit-node`, so it runs in `pnpm test`) | (a) 11 classifier cases on synthetic environments. (b) 3 child-Vitest runs of the real harness file, asserting JSON-report statuses per test: absent gives exit 0 with the 6 drill tests skipped, 1 skipped `BLOCKED:` test naming the 3 inputs, 0 failed and only the drill-files test passed. Incomplete (archive only) gives exit 1 with 7 failures naming `QA_A18_ARCHIVE_SHA256, QA_A18_STORE not set`. Present but wrong (a well-formed SHA of a non-archive file) makes the real drill run and fail at D0, so the drill tests fail with exit 1. |

`apps/api/test/support/p7-pending*.ts`: there are no entries for this task (`grep -rn a18 apps/api/test/support/p7-pending*.ts` finds nothing), so nothing was removed.

## 2. Behaviour per requirement

- **REQ-S20-018 / A18 (harness behaviour only; the transfer itself was not re-proved in this run).**
  - Default `pnpm test:integration` with no `QA_A18_*`: part 1 passes; part 2 shows 7 skipped and 1 passed (the drill-files check). The run output contains `BLOCKED: A18 transfer drill not run: input missing: QA_A18_ARCHIVE, QA_A18_ARCHIVE_SHA256, QA_A18_STORE (the DO-A release archive, its SHA-256 and the offline pnpm store); skipped, not passed`. A18 is **not** shown as passed by such a run.
  - Inputs present but wrong:
    - an archive path that is missing or not a file, a store that is missing or not a directory, a checksum that is not 64 lowercase hex digits, or a partial set: hard FAIL naming each problem;
    - well-formed values the drill rejects (wrong checksum, not an archive): the drill runs and its tests fail, as before.
  - `QA_A18_REQUIRE=1` (new, optional): absent inputs FAIL instead of skipping, for gate or evidence runs that must prove A18.
  - QA-C's invocation with inputs is unchanged: the same three variables and `QA_A18_OUT`. Values are now trimmed of surrounding whitespace.
- **Tightening, disclosed:** the earlier check was `existsSync` for archive and store. It now requires the archive to be a file and the store a directory. Both hold for DO-A's real archive (`.tar.gz`) and pnpm store.

## 3. Checks run (real exit codes; logs in `docs/delivery/test-evidence/DG7/qa/T-DG7-QA-E/`)

Environment for all checks:
- Node 24.21.0 (`/opt/nvm/versions/node/v24.21.0/bin` first in PATH), `MTH_PNPM_OFFLINE=1`, offline sandbox, uid 0.
- Vitest 3.2.7. The `--configLoader runner` flag is needed because `node_modules/.vite-temp` is read-only in this sandbox; with the default loader, Vite cannot write its bundled config (EROFS).

| Check | Command | Exit | Result / log |
| --- | --- | --- | --- |
| New unit test | `vitest run --configLoader runner --project unit-node tests/qa/unit/a18-harness-blocked.test.ts` | 0 | 13/13 passed (`unit-a18-harness-blocked.log`) |
| Mutation: old harness put back temporarily, new test run, new harness restored | same command | 1 | 2 failed (absent, incomplete), 11 passed: the new test detects the old behaviour (`mutation-old-harness.log`) |
| A18 harness + contract test on a disposable PostgreSQL, no `QA_A18_*` | `env -u QA_A18_ARCHIVE -u QA_A18_ARCHIVE_SHA256 -u QA_A18_STORE tests/qa/support/with-pg.sh vitest run --configLoader runner --project integration tests/qa/integration/a18-transfer-drill.test.ts apps/api/test/integration/contract` | 0 | 4 files passed; 234 passed, 7 skipped (the 6 drill tests and the BLOCKED marker); the BLOCKED line is printed (`integration-a18-contract.log`) |
| Typecheck | `pnpm -r typecheck` | 0 | `typecheck.log`. No workspace tsconfig includes `tests/qa`, so I also checked the 3 changed/new `.ts` files with `tsc --noEmit` through a throwaway tsconfig extending `tsconfig.base.json` (exit 0, `tsc-new-files.log`). |
| Lint | `pnpm lint` | 0 | `lint.log` |
| OpenAPI lint | `pnpm openapi:lint` | 0 | PASS, 965 operations (`openapi-lint.log`) |
| `pnpm test` literal | `pnpm test` | 1 | **BLOCKED (environment):** 6× EROFS writing `node_modules/.vite-temp` (`pnpm-test-literal.log`) |
| `pnpm test` equivalent | the script's three invocations with `--configLoader runner` | 1 | unit-node: 3035 passed, 1 failed. unit-web: 2179 passed. nocodegen: 259 passed, 2 skipped. The 1 failure is `tests/qa/unit/a20-p6-token-contrast.test.ts`: `EROFS … test-results/qa-a20/contrast-pairs.txt`. `test-results/` is read-only in this sandbox, so this is environmental and not caused by this change; the test passes in the orchestrator's `prefreeze/unit.log`. For this run that check is **BLOCKED**. unit-node grew from 3022 to 3036 tests = this task's 13 plus 1. (`pnpm-test-equivalent.log`) |
| Prettier | `git ls-files -co --exclude-standard -z \| xargs -0 npx prettier --check --ignore-unknown` | 0 | `prettier.log` |
| Validator | `node tools/gates/validate.mjs --historical --stage DG6` | 0 | `PASS gate DG6 (historical)` (`validate-historical-DG6.log`) |

Not run: the full `pnpm test:integration`. Only the touched file and the contract test were run, as the acceptance asks.

## 4. Known gaps

1. **Ready path with a real archive was not re-run (BLOCKED):** no DO-A archive or offline store exists in this run. Building one needs the candidate commit and the demo export, and disk is tight. The ready path's code is unchanged apart from where the input values come from. QA-C's evidence remains the latest real run.
2. **Pre-existing weakness, not changed:** the drill test "the drill log names no builder-hosted or public service it reached" **passes even when the drill failed**. Observed in the present-but-wrong run: the drill failed at D0, but its log still contains `network isolation` / `probe`. It does not call `drill()`'s status check. I left it unchanged because the assignment says to keep QA-C's assertions unchanged. Proposed finding (Low): make it also require `drill().status === 0`. Its siblings already fail in that case, so the suite as a whole never passes on a failed drill.
3. The new unit test runs the real `deploy/scripts/transfer-drill.sh` for about 10 s, failing at D0, and adds about 30 s in total to `unit-node`. It needs `bash`. On a host without bubblewrap the drill exits 3, and the test accepts `BLOCKED (exit 3)` as the drill test's failure message.
4. Two checks are BLOCKED here only because of the sandbox: the literal `pnpm test`, and the a20 contrast test that writes `test-results/`. They should be re-run by the orchestrator outside this sandbox.

## 5. Open questions

1. Should the gate or evidence run of A18 set `QA_A18_REQUIRE=1`, so a missing archive fails there instead of skipping?
2. Should the orchestrator take on gap 2 (the drill-log test) as a follow-up QA task?
3. Merge: no migrations or ordering constraints. The four files under `tests/qa/**` are self-contained. Copy this handback to `docs/delivery/handbacks/DG7/` (see the location deviation above).
