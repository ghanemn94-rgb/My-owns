# Handback T-DG7-DO-D4 (devops-engineer): run T-B11 to the end

- **Stage:** P7, gate DG7 (BUILDING). Task "B.8 DO-D4" of `docs/architecture/p7-work-split.md` (D-260). ADR-0064 Amendment 3 (A3.4, A3.6, A3.9, A3.10), ADR-0069 §4.
- **Invocation:** `{"kind":"claude-code-cli-session","run_id":"DG7-T-DG7-DO-D4-devops-engineer-20261113T165955Z-2d20bdba","session_id":"2d20bdba-f32f-4cae-a3a1-428cc7fbdc93"}`.
- **Assignment:** `docs/delivery/assignments/DG7/T-DG7-DO-D4.md`, sha256 verified as `9a46601f7719aa2e0ba8c4bcd4224913637cbe19adb950aa27b2df8999906be3`.
- **Base:** `bd3df35e2eeb620545ce9ef5fac0424b15b377e3` on `claude/mobily-transformation-platform-dg6-regate`. The tree was clean apart from my run folder. Nothing was committed.
- **Time (`date -u`, sandbox clock):** start 17:00:04Z, last stamp before this file 17:51:16Z. **I stopped at the time limit.** §4 lists what remains.
- **Environment:**
  - Node v24.21.0, PostgreSQL 16.15 (disposable clusters from `tests/qa/support/with-pg.sh`), bubblewrap 0.9.0, uid 0;
  - offline (`MTH_PNPM_OFFLINE=1`), no Docker daemon (D-243 Q1);
  - 3551 MB of free disk at the end (`df -Pm`). All my temporary trees (`$TMPDIR/b11/{arch,store,export}`) are deleted.
- **Two gate systems.** Every user, secret, origin, KPI value, evidence note, deferral and gate decision here is SYNTHETIC. Nothing grants or implies a G1–G6, Finance or IT approval. Nothing reads or writes a DG0–DG7 record.
- **A container-free local drill is not evidence of high-availability production readiness.**

## Headline

1. **Both preconditions hold.**
   - BE-R3 is merged: `ALLOWANCE_SCHEMA_VERSION = "mth-recheck-allowance/3"` and `RECHECK_COUNTER_TABLES` are in `recheck.ts`.
   - T-R16 exits **0** (`precondition-register-snapshot.log`).
2. **The full A3.6 chain cannot run on seed-demo data. This needs the architect (Q1).**
   - At C0, G5's missing items (measured, `t-b17-measurement.json` `gateChain.c0Missing`) are:
     - `g5.performance_kpi_not_known` ×3;
     - `g5.performance_pilot_evidence_missing`;
     - **`g5.adoption_none`** (no pointer);
     - `g5.decision_overdue`.
   - A3.6 gives `g5.adoption_none` no remedy ("needs configuration, which D8 does not create"). D8 therefore stops at C1 with `D8 FAIL: no API remedy for g5.adoption_none at (no pointer)`.
   - DO-D3 recorded only the label "Adoption". This is the item A3.9 residual 5 asked me to record. It is `adoption_none`, not an assessment-fed indicator.
   - I did not create configuration and did not change seed-demo.
3. **T-B17 test 1 fails, for that reason only.** The rest of T-B17 passes on the real fixture:
   - mode 2 with the generated `/3` allowance exits **0**;
   - the JSON report's `automationChain` has 1 link (`transformation.created` → the outbox row → the worker's execution);
   - the RAID counter step is `explained` (A3.3);
   - the negative case exits 4.
   - The measured residue equals the three D8 lists exactly (18 = 18, `t-b17-residue-check.log`). Those lists cover only sign-in, `createTransformation` and the RAID item.
4. **T-B18 passes.** With every outcome-KPI link archived (a fixture change), the chain stops at C1 with `D8 FAIL: no API remedy for g5.performance_no_kpi at (no pointer)`. `gateChain.writes` is `[]`, and no remedy table changed.
5. **T-B11 was RUN on an archive built from HEAD `bd3df35e`.** Attempt 9 is the one that counts:
   - **D0–D7 PASS** inside the no-network namespace;
   - **D8 FAIL**;
   - D9–D11 **NOT_RUN**.
   - The real runs found and fixed **six drill bugs** (§1). Attempt 9 also showed four D8 problems that I did not fix in time (§4).
   - `result: FAIL`. **T-B11 is not satisfied.**

## 1. Files changed

| File | Purpose |
| --- | --- |
| `deploy/scripts/drill/pick-actors.sql` | Chooses the A3.6 actors from rebound active users only. A grant counts in the transformation's scope or its organization's scope.<br>• `P` is the gate's `approver_user_id` when set, otherwise a holder of the approver role with `gate.decide`; `P ≠ S`.<br>• `kpis{defId: {user K, reviewer V, reviewerParty, valueNature}}` covers every active KPI. V is the active version's reviewer party resolved through `role_mapping` (person, or current group members) holding `kpi_actual.accept`, with `V ≠ K`.<br>• `evidenceReviewer` W (≠ S), `decisionOwner` O, `decisionOwners{decisionId: owner}`, `trainer` L, `riskEditor` X.<br>• The old keys are kept. A role nobody fills is `null`. |
| `deploy/scripts/drill/journey.mjs` | **A3.6 C0–C6** by operation id.<br>• `writes` = create transformation + RAID item + C0–C3. `approve` = C4–C6, then a ≥ 30 s wait (`SETTLE_MS`; `MTH_DRILL_SETTLE_MS` can only raise it). New step `gatechain` = C0–C3 alone, for T-B18.<br>• The remedy table: KPI (period list → `listKpiActuals` → `submitKpiActual`/`addKpiActualValue` with `action: submit` → `submitKpiActualDraft` if still a draft → `acceptKpiActual` by V), pilot evidence (note → `reviewEvidence` by W → `listPhaseSteps` → `linkPhaseStepEvidence`), adoption link (KPI remedy if `kpiDefinitionId` is set, otherwise `no API remedy`), `createExecutiveDecision`, `recordExecutiveDecisionOutcome` (deferred, business date + 14), `closeRaidEntry`.<br>• `REMEDY_CODES` is closed. **Before C1 writes anything, every missing code is checked for a remedy row and an actor**, so an unremediable gate writes nothing.<br>• The exact A3.6 failure lines. Every actor signs in as `<--sub-prefix><user id>` and is journalled. Every created text starts with `SYNTHETIC`.<br>• The report gains `gateChain {gate, c0Missing, writes}`.<br>• CLI: `--actors <pick-actors.json>` and `--sub-prefix`. `--kpi-user`, `--kpi-definition` and `--kpi-value-nature` are removed. |
| `deploy/scripts/drill/allowance.mjs` | Writes **`/3`**: `schemaVersion` comes from `ALLOWANCE_SCHEMA_VERSION`, plus `counters` = `D8_TOUCHED_COUNTERS`. The constants come only from `recheck.ts` (adds `RECHECK_COUNTER_TABLES` and `ALLOWANCE_SCHEMA_VERSION` to the required exports).<br>A counter table is refused in children, audited, the journal, or when it is not in `RECHECK_COUNTER_TABLES`. Reasons file `/3` with `counters`.<br>**The lists are replaced by the T-B17 measurement** (run 3/4):<br>• `D8_TOUCHED_AUDITED`: 15 tables, including `automation_execution` and `automation_action_result`;<br>• `D8_TOUCHED_CHILDREN`: `scoped_assignment` and `scoring_weight` (`kpi_actual_value` was dropped because the partial chain does not touch it);<br>• `D8_TOUCHED_COUNTERS`: `record_code_counter` (moved out of children).<br>The header says they are measured on a **partial** chain. |
| `deploy/scripts/transfer-drill.sh` | D8 passes `--actors "$WORK/actors.json" --sub-prefix drill-`. D9 gets the `/3` file `allowance.mjs` writes. Six bug fixes from the real runs, each commented with its failing line:<br>1. **`pg_start`**: `-k "$dir"` → `-c unix_socket_directories=''`. Attempts 2–3: D1 failed after 31.7 s with an empty log. Reproduced: `could not create Unix socket … Operation not permitted`, then `FATAL: could not create any Unix-domain sockets`. A failed start now prints the `pg.log` tail.<br>2. **`reconcile`** passes T's evidence store. Attempt 4: `BLOCKED: transfer-attachments verify: EVIDENCE_STORAGE_PATH is not set`.<br>3. **D1 seed-demo without `AUTH_MODE=dev`.** Attempts 5–6: `line 15: user 01995000-1001-7000-8000-000000000002 has 2 carried identities; exactly 1 is needed`. With `AUTH_MODE=dev`, seed-demo also binds demo users to the dev issuer (D-165), and D1 signs in on S only as seed-dev users.<br>4. **D6 maps only users with exactly 1 carried identity.** Others are listed by id and left unbound, never forced. In attempt 9, one user with 0 identities (`01920000-0000-7000-9000-000000000200`) stayed unbound.<br>5. **D6's rebind delta check** reads the latest recheck's `migration_reconciliation_delta` row (`basis = 'rebind'`, `allowed true`). Attempt 6: mode 1 prints only `identity.rebound` audit lines, so the grep for `rebind` could never match. Written to `reconcile-d6-delta.txt`.<br>6. **`downloads`** maps `evidence_content` parents (the export's `parentTable`) to their evidence and transformation. Attempt 8: `the download count 0 differs from the manifest count 2`. |
| `deploy/scripts/tests/transfer-drill.test.mjs` | **T-B15 on `/3`** (7 cases, including the new "a counter table appears only in counters" case).<br>**T-B17 on the A3.6 chain:** journey with `actors`, at least 30 s for the worker even when the chain stops early, residue = audited ∪ children ∪ counters, `decideGate` reached, mode 2 with `--report` and a non-empty `automationChain`.<br>**T-B18** (new, on the T-B17 fixture). |
| `docs/delivery/handbacks/DG7/T-DG7-DO-D4-evidence/*` | Logs, measurements, T-B11 attempts 1–9 (`t-b11-attempt*.log`, `transfer-attempt*/`; attempt 9 is `t-b11-run.log` and `transfer/`), the driver `t-b11-driver.sh`, `final-exits.log` |

No migration, contract, permission or product-code change. `apps/api/test/support/p7-pending*.ts` has no entry for this task, so none were removed. `docs/handover/` is unchanged.

## 2. Behaviour per requirement

| Requirement / clause | Test | Status |
| --- | --- | --- |
| A3.4 `/3` allowance with `counters` | T-B15 | **PASS (7/7)** |
| B.8 "the D8 lists are measured on the **full** chain"; mode 2 `/3` exit 0 with a non-empty `automationChain` | T-B17 | **FAIL (3/4)**. Test 1 fails: the chain stops at C1 (`g5.adoption_none`, Q1), so `decideGate` 201 is never reached. Mode 2 exit 0 with `automationChain` 1: **PASS**. Negative case: **PASS**. T-B18 (in the same describe): **PASS**. |
| A3.6 "the remedy table is closed" | T-B18 | **PASS** |
| REQ-S01-001 "installs and runs in a clean environment without builder-hosted services" | T-B11 D0, D3–D7 | **D0 PASS:**<br>• `archive-verify` 7/7;<br>• offline install 1.1 s;<br>• build ≈ 129–140 s;<br>• `check-no-cdn` and `scan-assets` exit 0 (the R2 hit DO-D2 saw is gone after AN-R1).<br>**D3–D7 PASS** in the namespace. |
| REQ-S01-006 "a different base URL" | T-B11 D7 | **PASS:** `getDeploymentStatus` origin `http://127.0.0.1:25302`, `environmentKind demo`. The D8 key workflows are not proven (§4). |
| REQ-S19-009 template and guides | T-B11 D3, D7 | **PASS** (`config-trace.json`) |
| REQ-S19-010 ready state | T-B11 D7 | **PASS:** `readyz-D7.json` ready, storage ok, worker alive |
| REQ-S19-017 counts/checksums | T-B11 D5, D6 | **D5 PASS:** import of 5064 rows in 335 tables and 2 attachments; 45 shared migration events recorded and none inserted twice; mode 1 `matched`.<br>**D6 PASS:** 13 users rebound and 2 left unbound; mode 1 `matched`; recorded delta `rebind user_identity changed 13 allowed true`.<br>**Not verified by me:** the `audit_already_present` delta in `reconcile-d5.json`. The printed output does not list deltas (§4 item 6). |
| REQ-S19-017 downloads, key workflows, jobs/approvals after restart | T-B11 D8, D9 | **D8 FAIL** (§4). **D9 NOT_RUN.** |
| REQ-S20-018 | T-B11 | D0–D7 PASS; **not complete** |

## 3. Checks run (real exit codes; `final-exits.log` is authoritative)

| Command | Exit | Result / log |
| --- | --- | --- |
| `node tools/gates/validate.mjs --historical --stage DG6` (**first**) | **0** | `PASS gate DG6 (historical)`, `validate-historical-DG6-before.log` |
| `node --test apps/api/scripts/register-snapshot.test.mjs` (precondition) | **0** | `precondition-register-snapshot.log` |
| `MTH_DRILL_D8_MEASURE_OUT=… tests/qa/support/with-pg.sh node --test --test-name-pattern=… deploy/scripts/tests/transfer-drill.test.mjs` (iterations) | 1 (×4) | `t-b17-run1.log` … `t-b17-run4.log`.<br>• Run 1: T-B15 fixture error, and `listPhaseSteps HTTP 400 validation` (limit 200 → 100).<br>• Run 2: worker rows not yet measured (no wait).<br>• Runs 3–4: test 1 only. |
| `tests/qa/support/with-pg.sh node --test --test-reporter=spec deploy/scripts/tests/transfer-drill.test.mjs` (final, on the final files) | **1** | **41 tests: 40 pass, 1 fail** (T-B17 test 1, Q1). 91 s. `transfer-drill-test-final.log` |
| T-B11: `tests/qa/support/with-pg.sh bash $TMPDIR/b11/run.sh` (driver copied to `t-b11-driver.sh`): demo export → `build-archive.mjs --commit bd3df35e…` → store copy to `<dir>/v10` → `transfer-drill.sh` | **1** | **Attempt 9:**<br>• demo export `01a1d603-…`: 335 tables, 4771 rows, manifest sha256 `d84538c5…cf9fb`;<br>• archive `mth-transformation-hub-0.1.0-e95dc681ed49.tar.gz`, 14 343 649 bytes, sha256 `fb09f881…44e5`, candidate `sha256:e95dc681ed49…8076`;<br>• probe: `tcp 1.1.1.1:443 ENETUNREACH`, `dns registry.npmjs.org EAI_AGAIN`;<br>• D0 163.8 s, D1 10.9, D2 1.6, D3 0.3, D4 6.7, D5 11.8, D6 3.0, D7 2.2: all PASS;<br>• D8 FAIL; D9–D11 NOT_RUN;<br>• the drill took 206 s; report sha256 `d9e91a40…b44e`.<br>The archive is HEAD, so its `source/` has none of this task's changes. The drill scripts ran from the working tree, as in DO-D2.<br>**Attempts 1–8** failed on, in order: my driver's store layout (no `v10` level), then drill bugs 1, 1, 2, 3, 3/4, 5 and 6. |
| `npx eslint deploy/scripts/drill deploy/scripts/tests/transfer-drill.test.mjs` | **0** | `eslint-own.log` |
| `bash -n deploy/scripts/transfer-drill.sh` | **0** | after every edit; last at the end |
| `pnpm -r typecheck` | **0** | 195 s, `typecheck.log` |
| `pnpm lint` | **0** | 35 s, `lint.log` |
| `pnpm openapi:lint` | **0** | `openapi-lint.log` |
| `pnpm test` | **0** | 340 s, `pnpm-test.log` |
| `git ls-files -co --exclude-standard -z \| xargs -0 npx prettier --check --ignore-unknown` | **0** | `All matched files use Prettier code style!`, 93 s, `prettier.log`. Run after this file was written. |
| `node tools/gates/validate.mjs --historical --stage DG6` (end) | **0** | `PASS gate DG6 (historical)`, `validate-historical-DG6-end.log` |

`pnpm -r typecheck`, `lint` and `test` ran after the last edits to `journey.mjs`, `allowance.mjs` and the test file. The later edits are to `transfer-drill.sh` only, which none of those checks reads. The vitest integration tests and the contract test were not run, because I changed no product code.

## 4. Known gaps / not done

1. **T-B11 is not PASS: D8 FAIL, D9–D11 NOT_RUN.** Attempt 9's D8 lines (`transfer/journey-D8.json`, `step-D8.log`):
   - **(a) `writes`:** `D8 FAIL: no API remedy for g5.adoption_none at (no pointer)`. This is the A3.6 design gap on demo data (Q1). `approve` and `deeplink` follow from it.
   - **(b) `unbound`:** `refused with /login?error=not_provisioned, expected identity_unbound`. Not investigated. Likely because after fix 4 the user left unbound is a different user: the last user with one identity, whose drill-IdP entry or email does not match the carried one. **Unfixed.**
   - **(c) `status`:** `no --expect-origin or --expect-environment given`. D8 runs the default step list, which includes `status`, but `d8()` does not pass those flags. This drill bug was already there. **Unfixed** (pass the D7 values, or drop `status` from D8's list).
   - **(d) `downloads`:** both files `HTTP 404` for the D8 user (submitter `…0012`). The files are on the D1 transformation, which dev.office created, and the demo submitter has no role there, so a 404 is the product's access rule. **Unfixed:** the download needs an actor who can read that transformation (for example the rebound `dev.office`).
2. **The D8 lists are measured on a partial chain.** The remedies, the submission, the decision and the gate routing are not measured. `D8_TOUCHED_*` will change when the chain runs to the end, and T-B17 test 1 fails until then.
3. **Remedy paths never run against a real API:**
   - the pilot evidence, decision, adoption and risk remedies;
   - V's `acceptKpiActual` (in T-B17 run 1 all three KPIs have `reviewer: null`, the KPI remedy's three `addKpiActualValue` calls succeeded, and no accept was needed);
   - C2, C4 and C6.

   In T-B17 run 1 the pilot evidence's `createEvidence` and `reviewEvidence` returned 2xx, and the run then stopped at `listPhaseSteps` (fixed). Run 1 wrote before the pre-check existed, which is why its log shows those writes.
4. **The worker wait.** T-B17 waits 30 s. No worker row arrived later in the measured window, but nothing past 30 s was measured.
5. **No scheduled automation row** (A3.9 residual 1) appeared in T-B17's window. Mode 2 matched.
6. **The `audit_already_present` delta of `reconcile-d5.json`** is not checked by the drill or by me. Mode 1 prints no delta lines, the same way the rebind delta was missing before fix 5. A check like fix 5's is needed.
7. **Seam (BE-D / data owner):** a source that ran with `AUTH_MODE=dev` carries demo users with 2 identities, and `rebind-identity` cannot map them. The drill now avoids it by seeding differently (fix 3), but a real source installation in that state could not rebind those users.
8. Not run: the A18 harness `tests/qa/integration/a18-transfer-drill.test.ts`, which needs a PASS drill report.

## 5. Open questions and merge instructions

- **Q1 (architect, A3.6):** G5 on seed-demo misses `g5.adoption_none`: no adoption indicator is linked to the transformation. A3.6 rejects changing seed-demo and gives this code no remedy. Choices:
  - add a remedy row, for example `createAdoptionMetricLink` on an existing KPI-backed template, then the KPI remedy;
  - or allow a seed-demo change;
  - or choose another gate.

  Until then, T-B17 test 1 and T-B11 D8 cannot pass.
- **Q2 (orchestrator):** D8 problems (b)–(d) in §4.1 are drill work for the next DO task, about 30 minutes plus one T-B11 run (≈ 3.5 min each).
- **Q3 (BE-D owner):** §4.7. Should `rebind-identity` accept a carried user with several identities, for example by a `--from-issuer` choice?
- **Merge:**
  - No migration and no contract change.
  - The CI fragment `deploy/scripts/ci/transfer-drill.job.yml` (DO-D3) is unchanged. It fails until Q1 is settled (T-B17 test 1).
  - `journey.mjs` no longer accepts `--kpi-user`, `--kpi-definition` or `--kpi-value-nature`. The only caller (`transfer-drill.sh`) is updated.
