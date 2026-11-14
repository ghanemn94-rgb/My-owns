# Handback T-DG7-AN-P7: final register pass before the freeze (transformation-analyst)

- **Stage:** P7, gate DG7 (BUILDING). Branch `claude/mobily-transformation-platform-dg6-regate`.
- **Base:** `HEAD` `3386b90921b7ff7cb54096419aeaa4eec125ce7b`. The tree was clean apart from two `runs/` directories, this run's and QA-C's.
- **Assignment:** `docs/delivery/assignments/DG7/T-DG7-AN-P7.md`, sha256 `3d5ee9c2…dec3a79` (verified with `sha256sum`).
- **Invocation:** `DG7-T-DG7-AN-P7-transformation-analyst-20261114T134324Z-13ecec6e`, session `13ecec6e-0f40-41c8-ad97-143ee3065b89`.
- **Time:** start `2026-11-14T13:43:34Z` (`date -u`); end recorded in §3.
- **Evidence:** `docs/delivery/handbacks/DG7/T-DG7-AN-P7-evidence/`.
- **Not "run alone":** QA-C (`DG7-T-DG7-QA-C-…-23c9a774`) was active in the same working tree during this run. It modified `tests/qa/integration/a18-transfer-drill.test.ts` and its own evidence, so my checks in §3 ran on a tree that contains QA-C's in-flight edits. I did not touch those files.
- **Gate systems:** the register status is an engineering delivery state. Nothing in this pass grants or implies DG7, or any business approval G1–G6.

## 1. Files changed

| File                                                                    | Purpose                                                                                                                                                                                                                                                       |
| ----------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `docs/delivery/requirements.csv`                                        | All 54 DG7 rows that were `SPECIFIED`. Fields touched: `status` (20 rows), `evidence` (52 rows, appended), `notes` (54 rows, appended and never replaced), `screen_api` (4 rows: Q10 and D-250 O6). No other row or field changed (field-level diff in §3, C3). |
| `docs/delivery/handbacks/DG7/T-DG7-AN-P7-transformation-analyst.md`     | This handback.                                                                                                                                                                                                                                                |
| `docs/delivery/handbacks/DG7/T-DG7-AN-P7-evidence/*`                    | Check logs, and `release-notes.preview.md`: the generator's output from the updated register, written to scratch and copied here. It is **not** `docs/handover/release-notes.md`.                                                                              |

I made no change to `docs/handover/**`, code, tests, `p7-pending*.ts` (no entry belongs to the analyst) or delivery records.

## 2. Behaviour per requirement

**Result:** 412 rows. 378 are `IMPLEMENTED`; 358 were before this pass. 34 are `SPECIFIED`, and every one is a DG7 row whose notes start with "RELEASE BLOCKER at this pass, not IMPLEMENTED. Missing dependency: …". Of the 54 DG7 rows, 20 are now `IMPLEMENTED` and 34 are release blockers. No row was removed, deferred or reworded outside the fields above.

**Rule applied.** A row is `IMPLEMENTED` only when each acceptance clause has a check that ran and passed, recorded in a DG7 handback log or QA evidence file (D-243–D-265). A clause that is still pending (an orchestrator-host half, a freeze-time run, a drill, a QA verdict, an ungenerated file or an open defect) keeps its row `SPECIFIED`, and the row's notes name that clause. The evidence column lists only files that exist now (checked by the update script). I wrote my own logs only in this handback, never in the register.

### 2.1 Now IMPLEMENTED (20)

| Row                                       | Basis (evidence in the row)                                                                                                                                                                                         |
| ----------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| REQ-S19-001                               | Archive with recorded checksum (DO-A/A2). T-B11 D0 from the archive (DO-E, D-265). Layout by artefact: `source/` has role `app` (D-244 O1); a reviewer may judge this against the literal text.                       |
| REQ-S19-002                               | `build-from-archive: PASS` (DO-A2). T-B11 D0 in the namespace with no network.                                                                                                                                      |
| REQ-S19-003, REQ-S16-009                  | `checks.log`: SBOM/inventory OK with the procurement flag (required=0, review=59) and `direct-dependency-problems=0`. `service-list: OK … matches the Compose files`.                                                  |
| REQ-S19-019                               | `scan-assets: PASS` on the tree built from the archive. DO-E offline drill run 2 exit 0.                                                                                                                            |
| REQ-S19-009                               | T-B9/T-B11 D3/D7 (DO-E rerun PASS). Payload secret scan PASS. **Q10 applied:** `screen_api` now names the repository-root `.env.example`.                                                                             |
| REQ-S19-017                               | T-B11 D0–D10 PASS (DO-D7, D-264; DO-E rerun, D-265). `screen_api` corrected (D-250 O6). Disclosures in the notes: `corrective_case`, A4.9 residuals, and QA-C's re-run still in progress.                             |
| REQ-S19-014, REQ-S19-016                  | BE-C/D/E/R4 integration suites, KBE-A round-trip, T-B11 D5/D9 counts and checksums. The notes say the tools are the `mth-db` transfer commands, not a `tools/migration/` directory.                                     |
| REQ-S19-013                               | DO-G: a dry run on a restored copy, then the real migrate. Catalogue test, and catalogue `--check` re-run by BE-R4.                                                                                                  |
| REQ-S16-024                               | BE-G integration 195/195 exit 0. Defaults `retain` (D-243 Q3). Disclosures: stuck `running` run; S3 driver.                                                                                                          |
| REQ-S19-005                               | `dictionary-coverage: PASS` (365 tables, 5776 columns; BE-R4). T-B11 D4 production init.                                                                                                                            |
| REQ-S19-007                               | `openapi-coverage: PASS` (965 operations, no pending entry, no skip; ARCH-R1). Contract test 111/111 (ARCH-R6). `connector-handover: PASS`.                                                                            |
| REQ-S17-004                               | The A17 tests pass in QA-C `a17-a22-run3.log`. That log's exit 1 comes from one A19 test only, and the notes say so. `connectors.md` is generated and checked.                                                         |
| REQ-S16-033                               | Claims scan PASS (DO-B, DOC-C). T-G7 matrix-to-test links (DO-B self-tests 191/191).                                                                                                                                |
| REQ-S19-011                               | check-handover `deployment PASS` (T-H2, DOC-A run). T-B9 config-trace in T-B11.                                                                                                                                     |
| REQ-S02-003                               | BE-H T-I1/T-I4/T-I5 passed (its run's single failure is route-inventory case 4 on BE-F's route). FE-C screen tests. `build-archive.mjs` ships the register. The role set is wider than ADM, AUD, TO (D-252 O1, disclosed). |
| REQ-DLV-010, REQ-DLV-021, REQ-S20-023     | **D-243 Q19:** IMPLEMENTED on DG0–DG6 evidence and tooling, with `completes-after-gate:` naming the DG7 gate-time clause. Each note says no DG7 approval is granted or implied.                                       |

### 2.2 Release blockers at this pass (34), grouped by missing dependency

1. **Orchestrator-host halves** (D-243 Q1; D-265 lists them pending; no Docker daemon here): REQ-S01-001 (§7 Compose up), REQ-S01-006 (no-egress Compose run), REQ-S16-008 (Compose up `--pull never --wait`), REQ-S19-010 (Compose healthcheck; `screen_api` corrected to `/healthz`, `/readyz`), REQ-S19-018 (image save/load on a containerd store, plus DO-E's ARCH-R6 code follow-ups; `screen_api` corrected). Each note records the agent half as done, with its evidence.
2. **QA-C verdicts in progress:** REQ-S20-018 (A18 re-run: run 2 exit 1 on a vitest RPC timeout with 8/8 tests passed); REQ-S19-012 and REQ-S20-019 (the A19 backup test failed in QA-C runs 2 and 3 and passed alone in run 4, so it is unstable).
3. **Configuration bundle:** REQ-S19-008. The `automation_rule` kind has no adapter (BE-F gap 1), T-D7 is not written, and route-inventory case 4 (422 vs 400) has no later run recorded. The A06 replay passes.
4. **Repository secret scan fails at base 3386b90:** REQ-S16-031. I had first marked it IMPLEMENTED on DO-B's and DOC-C's passing scans, and reverted that when my own re-run of `secret-scan.mjs --scope payload` (§3.1) exited 1 with 3 hits in committed files: `deploy/scripts/drill/guide-keys.json` l.14 and l.30 (S3; the values are guide anchors) and `packages/db/test/integration/transfer-load.test.ts` l.104 (S2; an unreachable `postgres://` URL on `127.0.0.1:1`). They look like false positives, but the check fails. It needs DO-B allow-list entries with reasons, or a rewording by the owners. REQ-S21-003's note also names it.
5. **Generated file missing:** REQ-S19-015, REQ-S02-005 and REQ-S21-003. `docs/handover/release-notes.md` does not exist (check-handover `index BLOCKED`). This pass gives every non-IMPLEMENTED row a missing dependency, so the generator now succeeds (§3 C4). Writing the file is outside the analyst's write scope, so the orchestrator must run `--write`.
6. **Freeze-time protocol-audit run** (p7-work-split §J.1; no `test-evidence/DG7/orchestrator/` log yet): REQ-DLV-008 (C4), 009 (C1), 011 (C2), 012 (C3/C6), 018 (C7), 024 (C5), 027 (C8/C9), 028 (C6). Each note carries its D-249 disclosure (H1–H11).
7. **Clauses that only the DG7 gate can show, not listed in Q19:** REQ-DLV-005, REQ-DLV-014, REQ-DLV-040 and REQ-S21-002 (`validate --stage DG7`, `--pipeline`), plus REQ-S21-004 (A18 and A23).
8. **Drills and index:** REQ-S20-026 (A26), REQ-S20-027 and REQ-DLV-030 (A27), and REQ-S20-031 (QA-D's test-level index).
9. **Seal (Q19 rows that I did not mark IMPLEMENTED):**
   - REQ-DLV-041 and REQ-S20-028: DO-J's O1 (the L3 hit on the approved `gates/DG3.json` notes) and O2 (the envelope allow-list entry for `reviews/DG6/round-7/code-security-reviewer.json` l.220) are unresolved. DO-J states that "a real A28 run would FAIL". Q19's "IMPLEMENTED with the tooling, the rehearsal" assumes working tooling. The rehearsal passed only with two scratch-only adjustments.
   - REQ-DLV-039: A01–A27 on the candidate and the host halves are still open.
   - REQ-DLV-031: the final report exists only at sealing. T-M12 is TODO.
   - All three Q19 rows carry the marker anyway, so T-I13's marker half holds.

**`completes-after-gate:` marker:** written into exactly the six Q19 rows (REQ-DLV-010, DLV-021, S20-023, DLV-039, DLV-041, S20-028). Only three of them are `IMPLEMENTED`, so About's `laterClauses` lists three. T-I13 ("appear in `laterClauses`") **fails for DLV-039, DLV-041 and S20-028** until their blockers close. The release notes' "Clauses that complete after the engineering gate" section lists all six marked rows with their status (`release-notes.preview.md` l.258 onwards). About's `laterClauses` (ADR-0071 §4) takes only the `IMPLEMENTED` ones, so the two lists differ while three marked rows are blockers.

## 3. Checks run (real exit codes)

Node 24.21.0 (`/opt/nvm/versions/node/v24.21.0/bin`), `MTH_PNPM_OFFLINE=1`, in the shared tree (see the header).

| #   | Command                                                                                                                       | Exit | Result / log                                                                                                                                                                                     |
| --- | ----------------------------------------------------------------------------------------------------------------------------- | ---- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| C1  | `node tools/gates/validate.mjs --historical --stage DG6` (before any write)                                                     | 0    | `PASS gate DG6 (historical)`, `validate-historical-DG6-start.log`                                                                                                                                |
| C2  | `node --test tools/gates/tests/validator.test.mjs` (read-only re-run)                                                          | 0    | `validator-tests.log`                                                                                                                                                                            |
| C3  | Python field diff of the register before and after (csv module; byte round-trip of the original verified first)                | 0    | Changed fields (final): notes 54, evidence 52, status 20, screen_api 4. Notes and evidence are appended. No non-IMPLEMENTED row has empty notes. The marker is on exactly the six Q19 rows.               |
| C4  | `node tools/release/release-notes.mjs --csv … --deps docs/handover/external-dependencies.json --provisional apps/web/src/i18n --out $TMPDIR/release-notes.md` | 0    | `release-notes: 34 unfinished item(s), 6 later clause(s)` (after the REQ-S16-031 correction; the first run said 33) (`release-notes-generate-tmp.log`, `release-notes.preview.md`). DO-J's run on the old register exited 1.                                  |
| C5  | `node tools/release/secret-scan.mjs --path docs/delivery/requirements.csv --path $TMPDIR/release-notes.md`                    | 0    | `secret-scan: PASS (path; 2 files …)`                                                                                                                                                            |
| C6  | `node tools/release/claims-scan.mjs --root <scratch copy of register + notes>`                                                | 1    | 3 hits, all in pre-existing text (REQ-PB-001 l.2 twice, l.413). The **before** register gives the same 3 hits (`claims-scan-register-BEFORE-baseline.log`). The repository allow-list does not apply to a scratch root. |
| C7  | `node apps/api/scripts/register-snapshot.mjs --csv … --deps … --out $TMPDIR/snap.json`                                         | 0    | `412 rows, sha256 33c4f9681974` (final register) (`register-snapshot-build.log`)                                                                                                                                  |
| C8+ | the background sequence in `exits.log` (claims-scan default, secret-scan payload, release-notes tests, typecheck, lint, openapi:lint, pnpm test, contract test, DG6 historical at the end) | see §3.1 | §3.1                                                                                                                                                                                             |

### 3.1 Background sequence (filled from `exits.log` after it finished)

RESULTS_PLACEHOLDER

## 4. Known gaps

1. **34 DG7 rows are not IMPLEMENTED.** Under the validator's rule (`final gate DG7 requires IMPLEMENTED at DG7`), `validate --stage DG7` fails until each one closes. Promoting a row needs only its missing dependency met. Then status and evidence change, and the note gets one more sentence.
2. **`docs/handover/release-notes.md` is not written.** My write scope excludes `docs/handover/`, and the runner reports any write outside the scope. The orchestrator should run `node tools/release/release-notes.mjs --csv docs/delivery/requirements.csv --deps docs/handover/external-dependencies.json --provisional apps/web/src/i18n --out docs/handover/release-notes.md`, then `--check` and `check-handover.mjs`. Any later register change needs a regeneration.
3. **The register is in the candidate,** so every promotion after a freeze-time run (group 6) changes the payload. The freeze-time runs need to happen before the freeze, or a second register pass is needed between them and the freeze.
4. **QA-C was active in the same tree.** Its evidence was in flight (A18 run 3 started 13:43:59Z). I cited only its finished logs and did not take its open runs as verdicts.
5. **I did not run** the full release test suite (`node --test tools/release/tests/*.test.mjs`, about 12 minutes of seal rehearsal per suite), the asset scan (BLOCKED: `--web not found; run pnpm -r build first`), the drills, or anything that needs a container. I re-read no reviewer conclusions, because none exist for DG7.
6. **Arabic:** I wrote no Arabic text. The release-notes Arabic section is the generator's own.

## 5. Open questions (for the orchestrator)

1. **Q19 scope.** Should D-243 Q19 (IMPLEMENTED plus `completes-after-gate:`) extend to REQ-DLV-005, DLV-014, DLV-040, S21-002 and DLV-031? Their last clause also completes only with the DG7 gate or the seal, but Q19 lists six rows. Without a decision, DG7 cannot validate.
2. **DLV-041 and S20-028.** Should they become IMPLEMENTED under Q19 while DO-J's O1 and O2 are open? I kept them `SPECIFIED`, because the tooling as delivered would fail a real A28.
3. **Freeze-time protocol-audit.** Will it run before the freeze, followed by a second short analyst pass, so the eight J rows can be promoted inside the frozen payload?
4. **Six versus three later clauses.** The release notes list every marked row with its status. About lists only the `IMPLEMENTED` ones (ADR-0071 §4). Is that difference intended?
5. **Secret-scan hits (REQ-S16-031).** Who owns the 3 payload hits: DO-B through allow-list entries, or the file owners (DO-D for `guide-keys.json`, BE-R2 for `transfer-load.test.ts`)?

## 6. Merge instructions

- No migration, code or contract change. Merge `requirements.csv` as a whole file. The only concurrent writer of it would be another analyst run.
- After merging: run the release-notes `--write` (gap 2), then rebuild the register snapshot with the normal build (`register-snapshot.mjs` is part of the API build).
