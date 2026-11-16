# Handback T-DG7-AN-P7C (transformation-analyst): register pass 3 before the freeze

- **Stage:** DG7 (P7 "Independent transfer and release", BUILDING), branch `claude/mobily-transformation-platform-dg6-regate`.
- **Base:** `HEAD` `7f828e046` (full id in `T-DG7-AN-P7C-evidence/00-base.txt`). At the start the working tree was clean apart from this run's own `docs/delivery/runs/` directory.
- **Assignment:** `docs/delivery/assignments/DG7/T-DG7-AN-P7C.md`. I verified its sha256 `e5b36e0f…e1cf` with `sha256sum` at the start.
- **Invocation:** run `DG7-T-DG7-AN-P7C-transformation-analyst-20261114T221536Z-45fdc2a2`, session `45fdc2a2-dac5-4a01-b8d9-344a1143dd33`.
- **Time:** started 2026-11-14T22:15:47Z (`date -u`). The end time is in §3.
- **What I read:**
  - `CLAUDE.md`, `agent-protocol.md`, and p7-work-split §1, §2, §D.6, §H.4–H.6, §I.6, §J, §K, §L and §M.3/M.6;
  - ADR-0065 Amendment 1 (A1.1–A1.3), and the ADR-0071 §9 test owner table (T-I10–T-I14);
  - the A26 and A27 drill reports and the release-notes `run.log`;
  - the FE-B2, DO-K1, ARCH-R7 (Q5), BE-F2 and QA-D handbacks;
  - `progress.md`, D-262 to D-267, and the D-243 Q19/Q20 text.
- **Not read in full:** `docs/architecture/p7-plan.md`. I read only what the sections above cite. That plan's register-relevant decisions (Q11, Q19, Q20) are quoted in D-243.
- **Scope.** Analysis only: no product code, no tests and no `p7-pending` entries.
  - The register status records engineering completion. Nothing here grants a business, Finance or IT approval.
  - Product gate G6 does not imply DG7, and DG7 does not imply any product gate.

## 1. Files changed

| File | Purpose |
| --- | --- |
| `docs/delivery/requirements.csv` | Pass 3 over the 22 rows that were not IMPLEMENTED:<br>- each row gets an appended note: "DG7 analyst pass 3 (T-DG7-AN-P7C, base 7f828e0, 2026-11-14): …";<br>- 2 rows are promoted to IMPLEMENTED;<br>- evidence lists are extended (every added path is an existing file, checked by the script);<br>- in REQ-DLV-039 the unchanged `completes-after-gate:` sentence is moved to the end of the notes (see §2).<br>No other row, column or field changed. The CSV round-trips byte-for-byte through the writer apart from these edits. |
| `docs/delivery/handbacks/DG7/T-DG7-AN-P7C-transformation-analyst.md` | This handback. |
| `docs/delivery/handbacks/DG7/T-DG7-AN-P7C-evidence/*` | The logs of every check in §3. |

**Counts.**

| | Before | After |
| --- | --- | --- |
| IMPLEMENTED | 390 / 412 | **392 / 412** |
| Release blockers (all DG7-final, status SPECIFIED, each note naming its exact missing item) | 22 | **20** |

No row was removed, deferred or re-scoped. Classes, increments and final gates are unchanged.

## 2. Behaviour per requirement

### Promoted to IMPLEMENTED (on evidence that ran)

- **REQ-S20-026 (A26 repair and re-review).** The orchestrator's drill passed all four clauses (`test-evidence/DG7/orchestrator/a26/drill-report.md`):
  - **Introduce:** K1–K3. A neutral commit `c3bbc780c` made PATCH `/business-units/:id` check `business_unit.read`.
  - **Identify:** K4–K5. Both reviewers, run without the card, named the file, line and behaviour as Critical on the first attempt.
  - **Fix:** K6. The regression tests exit 1 on the defect and 0 on the fix.
  - **Prove closure:** K7. The independent re-run is recorded `CLOSED_VERIFIED`.

  I cross-checked it myself (`07-a26-crosscheck.log`):
  - the card's sha256 equals the recorded `33eea29a…df23b2`;
  - the hash commit `867a3ba2a` (19:18:16Z) precedes the first reviewer run (19:18:33Z);
  - all four run folders have `meta.json`;
  - `drill/dg7-a26` is not an ancestor of HEAD.

  The report's three disclosures are copied into the note: the K7 candidate drifted, K7 did not rerun typecheck/lint, and qa's High was not separately verified by qa.
- **REQ-S19-008 (configuration bundles).** IMPLEMENTED, with the `automation_rule` limitation disclosed.
  - **Scope.** ADR-0065 Amendment 1 A1.2 puts individual automation rules out of scope for this release. 11 of the 12 kinds travel, and `automation_rule_set` does.
  - **Disclosure.** DO-K1 added the known-limitations row and its Arabic summary line.
  - **Screen.** FE-B2 hides the kind on the export screen, with an EN/AR note.
  - **Re-run on base 7f828e0 by this pass:**
    - component tests 28/28 (`02-…`);
    - config-bundle 23 + round trip 2 (T-D6, T-D7) + contract 111 = 136/136 on a disposable PostgreSQL (`04-…`);
    - the row and the Arabic line are present (`03-…`).
  - **Caveat.** No `decisions.md` entry adopts the amendment (ARCH-R7 Q5). I counted the orchestrator's routing of A1.2 item 6 (the FE-B2 and DO-K1 assignments, `9822f666d`) and this assignment's instruction as acting on it, and said so in the note. See Q1.

### Still release blockers (20), each with the exact missing item

| Row | Missing at base 7f828e0 |
| --- | --- |
| DLV-005, DLV-014, DLV-040, S21-002, S21-004 | The DG7 gate: `validate --stage DG7` with the DG7 round and audit. DLV-014 also needs C9 at the freeze, DLV-040 `--pipeline` after DG7, S21-002 the auditor's reopen check, and S21-004 A23 on the DG7 candidate. D-266 (d) stands. |
| DLV-008, 009, 011, 018, 024, 027 | The freeze-time `protocol-audit.mjs --all --json`: C4, C1, C2, C7, C5 and C8/C9 respectively. There is no such log in `test-evidence/DG7/orchestrator/`. |
| DLV-012 | C3 and C6 at the freeze, plus the auditor's reading of `progress.md` (observation below). |
| DLV-028 | C6 at the freeze, plus the DG7 gate update in `progress.md`. |
| DLV-030 | A27 K11 stays PARTIAL. `progress.md` was refreshed, but no K11 re-drill has run against it. Needed: a passing re-drill, or the release-auditor's decision. |
| DLV-031 | The final delivery report (seal, V18). Since pass 2, T-M12 passes strictly (28/28, `06-…`). |
| DLV-039 | DLV-030's K11, A23 for DG7, and the full e2e and visual runs on the frozen candidate. The release notes must be re-written after this pass. Closed since pass 2: A26 and `release-notes.md`. |
| S02-005 | **Correction:** T-I13 on the frozen register (QA-D, at the freeze; §I.6). Passes 1–2 named only `release-notes.md`, which now exists. |
| S19-015 | (1) The H.4 suite runs 65/67, exit 1 (`05-…`): T-H1 "missing release-notes.md" and T-H5 "no guides yet" fail, because their fixtures copy the real `docs/handover` (DO-K1 gap 3, owner DOC-B). (2) `check-handover` `generated` needs the DG7 protocol-audit report. (3) T-I10 is needed at the freeze, and the A28 listing and byte check at the seal. |
| S20-031 | The DG7 section of QA-D's test-level index, after the freeze. |
| S21-003 | **Correction:** QA-D's release-blocker check (T-I10, T-I13 on the frozen register) and the auditor (§I.6). The listing and its handover-text secret scan now exist and pass (`run.log`). |

**Inputs that changed no row.**

- **The CI-fragment merge (`36cc51a15`).** It is supporting evidence for the release tooling and evidences none of the 22 rows' missing items.
- **The refreshed `progress.md`.** It is a step update, not a gate update and not a K11 re-drill.

**Observation for the release-auditor (DLV-012/030).** The refreshed `progress.md` still contains, in its "Current checkpoint" section, the stale lines l.36–37: "DG6: FIXING after round 8 on 6cda8b33 (D-226)" and "Next action: BE-Z13 repair, then V12, then freeze round 9". A27 K11 found exactly these lines stale.

**REQ-DLV-039 marker move.** The generator quotes everything after `completes-after-gate:` as the later clause. With pass 3 appended after it, the release-notes line would have carried the whole pass-3 text. I moved the unchanged marker sentence to the end of the notes, and the dry run shows the line exactly as before (`09b-…`). The other five Q19 rows are untouched, and the register still has 6 markers.

## 3. Checks run (real exit codes)

Environment: Node 24.21.0 (`/opt/nvm/versions/node/v24.21.0/bin`), `MTH_PNPM_OFFLINE=1`, the analyst's bubblewrap sandbox (no network, no Docker), PostgreSQL through `tests/qa/support/with-pg.sh`. Logs are in `docs/delivery/handbacks/DG7/T-DG7-AN-P7C-evidence/`.

| # | Command | Exit | Result | Log |
| --- | --- | --- | --- | --- |
| 1 | `node tools/gates/validate.mjs --historical --stage DG6` (before the register edit) | 0 | `PASS gate DG6 (historical)` | `01-…` |
| 2a | `npx vitest run --project unit-web apps/web/src/pages/admin/migration/transfer-screens.test.tsx` | 1 | BLOCKED by the sandbox, not a test failure: EROFS writing `node_modules/.vite-temp` | `02a-…` |
| 2 | the same with `--configLoader runner` | 0 | 1 file, 28/28 | `02-…` |
| 3 | `grep automation_rule` in `known-limitations.md`, `known-limitations.ar-summary.md` and `release-notes.md` | 0 | the row (l.162) and the Arabic item 6 are present | `03-…` |
| 4 | `QA_PG_PORT=27861 tests/qa/support/with-pg.sh npx vitest run --configLoader runner --project integration …/transfer/config-bundle.test.ts …/transfer/config-bundle-roundtrip.test.ts …/contract/contract.test.ts` | 0 | 3 files, 136/136 | `04-…` |
| 5 | `node --test tools/release/tests/check-handover.test.mjs tools/release/tests/role-matrix.test.mjs tools/release/tests/automation-guide.test.mjs` (§H.4) | **1** | 67 tests: 65 pass, **2 fail** (T-H1 and T-H5 fixture cases; pre-existing, DO-K1 gap 3) | `05-…` |
| 6 | `MTH_STRICT_GUIDES=1 node --test tools/release/tests/verify-seal.test.mjs tools/release/tests/release-notes.test.mjs` | 0 | 28/28 | `06-…` |
| 7 | A26 cross-check (sha256sum, git log, run folders, `merge-base --is-ancestor`) | — | hash equal; hash committed before K4; 4 run folders; branch not merged (the ancestor check's exit 1 is the expected answer) | `07-…` |
| 8 | `checkRegister` imported read-only from `tools/gates/lib/rules.mjs`, stages DG6 and DG7, on the edited register | 0 | DG6: 0 errors. DG7: exactly 20, each "final gate DG7 requires IMPLEMENTED at DG7 (is SPECIFIED)" for the 20 blockers. No missing-evidence or empty-notes error. | `08-…` |
| 9a | `node tools/release/release-notes.mjs --check` (no arguments) | 2 | my usage error, kept | `09a-…` |
| 9 | `release-notes.mjs --csv … --deps … --provisional apps/web/src/i18n --out docs/handover/release-notes.md --check` | **1** | "out of date (run with --write)": **expected**, since two rows changed status; the orchestrator reruns `--write` | `09-…` |
| 9b | the same with `--write` and `--out $TMPDIR/rn.md` (dry run; the analyst may not write `docs/handover/`) | 0 | "20 unfinished item(s), 6 later clause(s)"; the DLV-039 later-clause line is unchanged; scratch file deleted | `09b-…` |
| 10–13 | `pnpm -r typecheck`, `pnpm lint`, `pnpm openapi:lint`, `pnpm test` | see §3.1 | | `10-…`–`13-…` |
| 14 | `git ls-files -co --exclude-standard -z \| xargs -0 npx prettier --check --ignore-unknown` | see §3.1 | | `14-…` |
| 15 | `node tools/gates/validate.mjs --historical --stage DG6` (after the edit) | see §3.1 | | `15-…` |

### 3.1 Final checks

All of these ran on the edited register.

| # | Command | Exit | Result | Log |
| --- | --- | --- | --- | --- |
| 10 | `pnpm -r typecheck` | 0 | all packages Done | `10-typecheck.log` |
| 11 | `pnpm lint` | 0 | eslint `--max-warnings=0` clean | `11-lint.log` |
| 12 | `pnpm openapi:lint` | 0 | OpenAPI 3.1.1, 965 operations | `12-openapi-lint.log` |
| 13a | `pnpm test` (plain) | 1 | **BLOCKED in this sandbox**, not a test result. Vitest fails at startup with EROFS writing `node_modules/.vite-temp`, before any test runs. | `13a-pnpm-test-BLOCKED-EROFS.log` |
| 13 | the same three projects as the `test` script, each `npx vitest run --configLoader runner --project <p>` | 1 | unit-node 204/205 files, 3021/3022 tests: the one failure is EROFS writing `test-results/qa-a20/contrast-pairs.txt` (a sandbox write, not an assertion). unit-web 130 files / 2179 tests. nocodegen 3 files / 259 tests (+2 skipped, pre-existing). | `13-pnpm-test-equivalent-configloader-runner.log` |
| 13b | `QA_EVIDENCE_DIR=$TMPDIR/qa-a20 npx vitest run --configLoader runner --project unit-node tests/qa/unit/a20-p6-token-contrast.test.ts` | 0 | 4/4 (QA-D's precedent, `13c-a20-contrast-rerun.log`); scratch dir deleted | `13b-a20-contrast-rerun.log` |
| 14 | `git ls-files -co --exclude-standard -z \| xargs -0 npx prettier --check --ignore-unknown` (this handback included) | 0 | "All matched files use Prettier code style!" | `14-prettier.log` |
| 15 | `node tools/gates/validate.mjs --historical --stage DG6` (after the edit) | 0 | `PASS gate DG6 (historical)` | `15-validate-historical-DG6-after.log` |

**Reading of 13/13b.** With the sandbox's two write limits worked around (the config loader, and the A20 evidence directory), every test of the `pnpm test` projects passed on the edited register: 3022 + 2179 + 259. The plain `pnpm test` command itself did not complete here, so it is **not** reported as exit 0. The orchestrator's run outside the analyst sandbox is the plain-command evidence.

Integration (check 4, plus the contract test) ran on a disposable PostgreSQL that the harness removed.

No extra checkout was made. My scratch files (`$TMPDIR/rn.md`, `$TMPDIR/chk.mjs`, `$TMPDIR/qa-a20`) were deleted.

After this section was filled in, `npx prettier --check` on this handback alone exited 0 (`14b-prettier-handback-after-final-edit.log`).

**End:** 2026-11-14T22:37Z (`date -u` 22:36:47 before this edit; about 22 minutes in total).

## 4. Known gaps

1. **20 DG7 rows stay release blockers.** Each depends on the freeze, the protocol audit, the DG7 round, the audit or the seal, or (DLV-030) on a re-drill or an auditor decision. None can be closed by the analyst before the freeze.
2. **`docs/handover/release-notes.md` is stale against the new register** (check 9, exit 1). The orchestrator must run `release-notes.mjs --write`, then `--check`, its secret scan and `check-handover` (with the freeze-time protocol-audit report).
3. **Two corrections to earlier passes:**
   - S02-005 now also names T-I13 on the frozen register;
   - S21-003 now also names QA-D's release-blocker check and the auditor.

   Both follow from p7-work-split §I.6 and the ADR-0071 §9 owner table, which passes 1 and 2 under-read.
4. **H.4 fixture failures (S19-015).** They are DOC-B's to repair, and the routing is undecided (DO-K1 Q2).
5. **`progress.md` l.36–37** still carry the stale DG6/BE-Z13 lines (observation above). The analyst cannot write `progress.md`.
6. **Sandbox limit.** Plain `pnpm test` is BLOCKED in the analyst sandbox: EROFS on `node_modules/.vite-temp`, and the A20 test's write to `test-results/` (§3.1). The equivalent runs passed, but the plain command's exit 0 is not claimed.
7. **I did not read `p7-plan.md` in full.**

## 5. Open questions (and merge instructions)

- **Q1 (orchestrator).** Record a decision that adopts ADR-0065 Amendment 1 (ARCH-R7 Q5), so that REQ-S19-008's promotion rests on a decision entry, not only on the routed assignments. If the orchestrator does not adopt it, REQ-S19-008 should go back to a release blocker. The release-auditor may still judge the 11-of-12 scope against the literal title.
- **Q2 (orchestrator).** Should the two stale `progress.md` lines (l.36–37) be removed before the freeze? DLV-012's auditor reading and any K11 re-drill both depend on it.
- **Q3 (orchestrator).** Will a K11 re-drill run against the current `progress.md` (DLV-030), or does the release-auditor decide the partial?
- **Q4 (orchestrator).** Should the T-H1/T-H5 fixture repair (DOC-B) be routed before the freeze? Otherwise S19-015 cannot close.
- **Merge.** One data file, plus this handback and its evidence. There are no migrations, code, contract or `p7-pending` changes. After merging, run `release-notes.mjs --write` and `--check`.
