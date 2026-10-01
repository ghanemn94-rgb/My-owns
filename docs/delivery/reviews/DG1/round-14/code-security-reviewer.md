# DG1 round 14 — code-security-reviewer narrative

- **Candidate:** `sha256:dd747fe1df62d876a74101caa826542b90d3eb36cedb1de14f299b0b6de8c559` (freeze commit `985d0fa`). The ID was recomputed in the real repo and in a full disposable clone.
- **Invocation:** `DG1-T-DG1-REV-SEC-R14-code-security-reviewer-20261001T170044Z-21949e8c` (session `21949e8c-6b61-47fd-ab89-c291255fc65d`).
- **Verdict: PASS.** F-DG1-135 is verified fixed. One new Low, non-mandatory finding was raised (F-DG1-136).

## Identity and scope
At start the real-repo HEAD was `6a3e3b2`, a direct child of the freeze commit that adds only candidate-excluded metadata (round-14 assignments, the manifest and `stages.json`). The candidate ID is identical, so I proceeded; the commit is a traceability pointer. The source delta since round 13 (`08cbd12..985d0fa`) covers only `apps/api/src/architecture.testkit.ts` and `apps/api/src/architecture.test.ts`. There is no change to authorization, data, injection, secrets or portability surfaces, so this round's security re-review concentrates on the lint change, and the full check battery guards against regressions.

## F-DG1-135: verified (CLOSED_VERIFIED)
- `architecture.testkit.ts:183`: `TEST_FILE = /\.test\.tsx?$/`. `:182` `CODE_FILE = /\.[cm]?[jt]sx?$/` is unchanged, so `walk()` still scans every buildable file. `:467` `isTest` gates both exemptions, `:477` (composition-root files) and `:486` (`vitest`).
- `apps/api/tsconfig.build.json:10` excludes `src/**/*.test.ts` and `src/**/*.test.tsx`, which is exactly `TEST_FILE`. `vitest.config.ts:21` collects `apps/api/src/**/*.test.ts`. A `.test.tsx` gets the exemption but is build-excluded, so it never ships. That is consistent with the finding's criterion.
- **Re-proof** (`01-F-DG1-135-reproof-probe.log`): the probe ran the fixed testkit against the round-13 testkit.
  - `zz.test.mts` importing `../../modules.ts` gives `imports ../../modules.ts outside src/modules (composition root)`, and importing `vitest` gives `imports package vitest`. The round-13 testkit gave `[]` for both.
  - `zz.test.ts` and `zz.test.tsx` with the same imports give `[]`.
  - All other test-looking extensions are flagged.
  - Planted on disk, `moduleViolations("kpi")` flags only the `.mts` file.
  - All 13 real modules have 0 violations.
- **Dist side** (`03-dist-ship-check.log`): `zz.test.mts` ships as `dist/.../zz.test.mjs` and is not collected by vitest; `zz.test.ts` is collected and not shipped.
- `architecture.test.ts` passes 128/128. Module test files: all 7 are `.test.ts`, and the `find` for other names is empty.

## F-DG1-136 (new, Low, non-mandatory): integration teardown hook budget
In full integration run 1, all 200 tests passed but the file `apps/api/test/integration/access-derived-race.test.ts` failed with `Hook timed out in 10000ms` in `afterAll` (`:73`). The run took 221 s; the other runs took about 28–32 s. The host was shared with the other reviewers' concurrent runs (4 CPUs, load about 10).

The hook runs three DDL statements, `api.close()` and `dropScratchDatabase()`. That helper has its own 10 s wait budget (`packages/db/test/global-setup.ts:116`), while the integration project sets only `testTimeout: 30_000` (`vitest.config.ts:49`). There is no `hookTimeout`, so the default of 10 s applies. The same teardown pattern is in 6 integration files.

What I observed:
- Runs 2 and 3 on Node 22 passed, and so did the Node 24 run.
- Ten isolated runs of the file passed, 5 unloaded and 5 under CPU burn, so the failure did not reproduce on demand.

Product behaviour is unaffected. This is check-repeatability in the F-DG1-009 area, by a different mechanism. Suggested fix: set `hookTimeout` (e.g. 30 000) on the integration project.

## Checks
- **Node 22:** all pass.
  - typecheck, build, lint, `openapi:lint` (33 operations), `check:no-cdn`, `format:check`.
  - Unit tests: 321/321, and 321/321 again on Node 24.
  - Gates and agents tests: 105/105. Deploy tests: 59/59.
  - SBOM: OK. DG0 historical: PASS. The three `ci.yml` copies are byte-identical, and `check-ci-needs` is OK.
- **Install sandbox:** AC-1 (read-only) and AC-2..AC-10 pass.
- **BLOCKED (no registry or network):** AC-1 (effect) and a real-repo install against the registry. A frozen sandboxed install from the local store passes.
- **Requirements:** all 8 assigned requirements are IMPLEMENTED with existing evidence.

All execution happened in disposable clones under `$TMPDIR`, which I removed afterwards, along with the disposable PostgreSQL clusters. No implementation source was modified, and I opened no other reviewer's round-14 record.
