# Handback T-DG7-QA-D (qa-verifier): A23–A25 re-run, T-I12, and the REQ-S20-031 test-level index

- **Stage:** P7 / DG7 (BUILDING). **Assignment:** `docs/delivery/assignments/DG7/T-DG7-QA-D.md` (sha256 `91208da5…54de`, verified at start).
- **Invocation:** run `DG7-T-DG7-QA-D-qa-verifier-20261114T141158Z-e71b6576`, session `e71b6576-d313-479a-b6a3-f11b3fcfbf57`.
- **Time:** start 2026-11-14T14:12:11Z, end about 14:46Z (about 34 minutes).
- **Tree:** started at `ce05d1e6307b7946c8fba7db20b1b70194bc4723`. The orchestrator committed `12229e6b69c11105bde0d1693093c608254e1fef` (the AN-P7 output: `requirements.csv` and delivery records only) at 14:19:51Z, during this run. Every check from 14:24Z on ran on `12229e6b6`, and the earlier ones were re-run there (`06-rerun-on-12229e6.log`). Not a frozen candidate.
- **What this is:** an implementation-phase (W12) QA task, not a review of a frozen candidate. There is no review record, and nothing here approves DG7 or any product gate G1–G6.

All log paths below are relative to `docs/delivery/test-evidence/DG7/qa/T-DG7-QA-D/`.

## 1. Files changed

| File | Purpose |
| --- | --- |
| `tests/qa/integration/a24-register-rules.test.ts` (new) | T-I12 (ADR-0071 §6.2, p7-work-split §I.4): imports `checkRegister` read-only from `tools/gates/lib/rules.mjs`. On disposable fixture registers it proves the two A24 messages of REQ-S02-005, each on its own row with a negative control. |
| `docs/delivery/test-evidence/DG7/qa/test-level-index.md` (new) | REQ-S20-031's per-gate index, DG0–DG7. It is the seal's `--evidence test-level-index=` input (p7-work-split §K.0, §L.1). |
| `docs/delivery/test-evidence/DG7/qa/test-level-index.json` (new) | The machine-readable form of the DG0–DG6 part. |
| `build_index.py`, `render.py`, `dg7-section.md` | The generator (reads gate and review records read-only) and the hand-written DG7 section. |
| `00`–`15-*.log` | The logs of every command below. |
| This file | The handback. |

No product code, `p7-pending*` file, gate tooling, register, findings or stage record was edited. T-I12 has no `p7-pending` entry: it is not an API operation, and none of the `apps/api/test/support/p7-pending*.ts` files names it.

## 2. Behaviour per requirement

- **REQ-S20-023 / A23 (real independent stage reviews).**
  - The validator mechanism was re-run on the merged tree: `node --test tools/gates/tests/validator.test.mjs`, 60/60. This includes "A23: a reviewer who authored the scope, or who is an owner, is rejected" and "A23: reviewers sharing one invocation are not independent".
  - DG0–DG6 each have three PASS specialist records on the gate candidate plus a release audit. The index lists them and confirms each candidate equals the gate's.
  - **A23 is not complete:** its DG7 part needs the DG7 review round and audit, which do not exist yet (`validate --stage DG7` exits 1 for want of a gate record). That is expected while DG7 is BUILDING.
- **REQ-S20-024 / A24 (enforced advancement).**
  - Validator self-tests (the missing-reviewer, failed/BLOCKED-check, unresolved-finding, incomplete-requirement and pipeline tests) pass.
  - `validate --pipeline` reports `PASS pipeline (active stage: DG7 BUILDING)`, and `--historical --stage DG6` passes.
  - T-I12 adds the REQ-S02-005 clause outside the protected tree, with 8 tests:
    - `BLOCKED without the missing dependency in notes` (empty and whitespace-only notes);
    - `IMPLEMENTED for DG0 without evidence`;
    - a missing evidence file is refused;
    - negative controls: notes present, evidence an existing file, and a later final gate.
- **REQ-S20-025 / A25 (candidate integrity).** The A25 tests pass: "a source change invalidates the approval; review metadata does not", symlinks/submodules, and "a tampered manifest or a stale review candidate is detected". The live effect showed during the run: the mid-run commit changed the working-tree candidate from `sha256:b436cffc…` to `sha256:c3fd5d9c…`.
- **REQ-S20-031 (test evidence per gate).** `test-level-index.md` is written:
  - per gate DG0–DG6, the unit, integration, e2e, visual and other checks of the approving round, with result, exit, command and evidence, each evidence file checked to exist (0 missing);
  - the gate record's audit tests;
  - every check that could not run: BLOCKED in an earlier round, or the approving-round disclosures of skipped or not-run items, with the reason;
  - the standing environmental residuals (D-049, D-057, D-058, D-243 Q1);
  - a DG7 section with QA-D's executed checks and the pending inputs: QA-B, QA-C, the A23 DG7 round, the A26 and A27 drill reports at `docs/delivery/test-evidence/DG7/orchestrator/{a26,a27}/drill-report.md` (both absent, not run by QA-D), the full e2e at the freeze, protocol-audit, and A28.
  - DG0 has no e2e row (P0 had no UI).
  - The DG0–DG6 results are **as recorded** in the approving records. QA-D did not re-execute them.
- **A26, A27:** orchestrator drills, referenced as pending and not run (per the assignment).

## 3. Checks actually run (Node 24.21.0, `MTH_PNPM_OFFLINE=1`, agent sandbox, `HEAD` as stated)

| # | Command | Exit | Result | Log |
| --- | --- | --- | --- | --- |
| 1 | `node tools/gates/candidate.mjs --stage DG7` (at `ce05d1e6`; again at `12229e6b`) | 0 / 0 | `sha256:b436cffc…` / `sha256:c3fd5d9c…` (working tree, not frozen) | `00-env-candidate.log`, `06-rerun-on-12229e6.log` |
| 2 | `node --test tools/gates/tests/validator.test.mjs` (twice: on each tree) | 0 / 0 | 60/60 PASS each | `01-…`, `06-…` |
| 3 | `node tools/gates/validate.mjs --historical --stage DG6` (twice) | 0 / 0 | `PASS gate DG6 (historical)` | `02-validate--historical_--stage_DG6.log`, `06-…` |
| 4 | `node tools/gates/validate.mjs --pipeline` | 0 | `PASS pipeline (active stage: DG7 BUILDING)` | `02-validate--pipeline.log` |
| 5 | `node tools/gates/validate.mjs --reconcile` | 0 | `active stage: DG7 (BUILDING)`, `no frozen candidate yet` | `02-validate--reconcile.log` |
| 6 | `node tools/gates/validate.mjs --stage DG7` | 1 | expected FAIL: no `gates/DG7.json` | `02-validate--stage_DG7.log` |
| 7 | `tests/qa/support/with-pg.sh npx vitest run --project integration tests/qa/integration/a24-register-rules.test.ts` | 1 | **BLOCKED** (environment): EROFS on `node_modules/.vite-temp` at config load, so no test ran | `03a-t-i12-attempt1-EROFS.log` |
| 8 | the same command with `--configLoader runner`, on the final file (sha256 `c020f2a0…0a0f`), plus strict `tsc` and `eslint --max-warnings=0` on the file | 0, 0, 0 | 8/8 PASS; PostgreSQL 16.15 disposable cluster, 135 migrations | `03-t-i12.log` (the earlier pre-format run: `03b-…`, also 8/8; the first `tsc` attempt: `04a-…`, exit 2, fixed by `Row` annotations) |
| 9 | `pnpm -r typecheck` | 0 | PASS | `10-typecheck.log` |
| 10 | `pnpm lint` | 0 | PASS | `11-lint.log` |
| 11 | `pnpm openapi:lint` | 0 | `PASS … OpenAPI 3.1.1, 965 operations` | `12-openapi-lint.log` |
| 12 | `pnpm test` (as is) | 1 | **BLOCKED** (environment): EROFS `.vite-temp` in all three projects; no test ran | `13-pnpm-test.log` |
| 13 | `npx vitest run --configLoader runner --project` for unit-node, unit-web and unit-formula-nocodegen | 1 | unit-web 130 files / 2175 PASS; nocodegen 259 PASS + 2 skipped by design; unit-node 3021/3022. The 1 failure is EROFS writing `test-results/qa-a20/contrast-pairs.txt`, not an assertion | `13b-unit-configloader-runner.log` |
| 14 | `QA_EVIDENCE_DIR=$TMPDIR/qa-a20 npx vitest run --configLoader runner --project unit-node tests/qa/unit/a20-p6-token-contrast.test.ts` | 0 | 4/4 PASS | `13c-a20-contrast-rerun.log` |
| 15 | `git ls-files -co --exclude-standard -z \| xargs -0 npx prettier --check --ignore-unknown` | 0 | PASS | `14-prettier.log` |
| 16 | `tests/qa/support/with-pg.sh npx vitest run --configLoader runner --project integration apps/api/test/integration/contract/contract.test.ts` | 0 | 111/111 PASS | `15-contract.log` |
| 17 | `python3 -I T-DG7-QA-D/build_index.py docs/delivery/test-evidence/DG7/qa/test-level-index.json`, then `render.py` | 0 | 7 gates, 389 checks, 0 missing evidence files | `05-build-index.log` |

Acceptance status against the assignment:

| Acceptance check | Status |
| --- | --- |
| `pnpm -r typecheck` | exit 0 |
| `pnpm lint` | exit 0 |
| `pnpm openapi:lint` | exit 0 |
| `pnpm test` as is | **BLOCKED** in this sandbox (read-only `node_modules`). The equivalent runner-loader run passes, apart from 1 environment-only write failure, whose file passes when re-run |
| T-I12 and the contract test on a disposable PostgreSQL | exit 0 |
| prettier | exit 0 |
| `validate --historical --stage DG6` | exit 0 |

## 4. Known gaps / not done

1. **`pnpm test` as is was not run to completion.** The sandbox mounts `node_modules` and `test-results/` read-only. It should be re-run on a writable checkout, which is the freeze verification's job.
2. **The DG0–DG6 index rows are the recorded results, not re-executions.**
   - Test levels are classified by text patterns (`build_index.py`), so a few rows may be tagged imprecisely; the `other` column is the residue.
   - The "could not run" scan is a text scan and includes PASS checks that disclose skips.
3. **A23 for DG7, A26, A27, the full e2e and visual/axe runs on the merged DG7 tree, protocol-audit, and A28:** pending, owned by others, not claimed.
4. **The index needs a refresh after the freeze:** the DG7 rows (the review round, the e2e results, the A26/A27 reports) should be filled in. The generator re-runs in one command, and `dg7-section.md` is the hand-maintained part.
5. **Not done by this assignment:** QA-D's other p7-plan items, the release-blocker check (T-I10) and T-I13 on the frozen register (ADR-0071 §9). This assignment named only A23–A25, the index and T-I12.
6. **T-I12 has no mutation run against a modified `rules.mjs`.** Its failing direction is shown by the paired positive and negative fixtures only.

## 5. Merge instructions and open questions

- **Merge:** the test file is self-contained, and no migration is needed. The integration project needs `TEST_DATABASE_ADMIN_URL` (its global setup) even though T-I12 itself does not use the database, so run it through `tests/qa/support/with-pg.sh`. In a sandbox with a read-only `node_modules`, add `--configLoader runner`.
- **O1 (the assignment contract):**
  - The assignment names the handback path `docs/delivery/handbacks/DG7/T-DG7-QA-D-qa-verifier.md` and logs in `docs/delivery/handbacks/DG7/T-DG7-QA-D-evidence/`. Both are outside the qa-verifier write scope (`tools/agents/write-scopes.json`). The handback and logs are therefore here, under `test-evidence/DG7/qa/T-DG7-QA-D/`, which the assignment also names. The orchestrator may copy this file.
  - The environment paragraph says the guard forbids `test-evidence/**`. For qa-verifier, `docs/delivery/test-evidence/*/qa/**` is allowed.
  - The generic "Deliverables" paragraph (mutations, authorization, `p7-pending` removals) does not apply to a QA task that must not edit product code. Nothing was done under it.
  - The assignment names no candidate ID, which is consistent with a pre-freeze task.
- **O2:** should T-I12 stay in `tests/qa/integration/` or move to `tools/gates/tests/` (ADR-0071 §6.2's alternative)? It runs in the integration project only because of its directory. It would also run in `unit-node` if moved to `tests/qa/unit/`, without needing PostgreSQL.
- **O3:** the `--configLoader runner` workaround is environment-specific. Should the freeze verification also run `pnpm test` exactly as written, on a writable tree?
