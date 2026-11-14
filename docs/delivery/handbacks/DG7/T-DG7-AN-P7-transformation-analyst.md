# Handback T-DG7-AN-P7: final register pass before the freeze (transformation-analyst)

- **Stage:** P7, gate DG7 (BUILDING). Branch `claude/mobily-transformation-platform-dg6-regate`.
- **Base:** `HEAD` `3386b90921b7ff7cb54096419aeaa4eec125ce7b` at the start. The tree was clean apart from two `runs/` directories, this run's and QA-C's.
- **The tree moved during the run:** the orchestrator committed QA-C's output as `ce05d1e63` (QA-C's test fixes and evidence). That commit also swept in this run's in-progress handback and evidence files. QA-D (`…-QA-D-…-e71b6576`) started at 14:11:58Z in the same tree. `requirements.csv` itself was not committed. The assignment's "You run alone" did not hold, so the checks in §3 ran on a tree carrying QA-C's in-flight edits (before `ce05d1e63`) or its committed edits (after). I did not touch their files.
- **Assignment:** `docs/delivery/assignments/DG7/T-DG7-AN-P7.md`, sha256 `3d5ee9c2…dec3a79` (verified with `sha256sum`).
- **Invocation:** `DG7-T-DG7-AN-P7-transformation-analyst-20261114T134324Z-13ecec6e`, session `13ecec6e-0f40-41c8-ad97-143ee3065b89`.
- **Time:** start `2026-11-14T13:43:34Z`, last check finished `14:15:12Z` (`date -u` in the logs).
- **Evidence:** `docs/delivery/handbacks/DG7/T-DG7-AN-P7-evidence/`.
- **Gate systems:** the register status is an engineering delivery state. Nothing in this pass grants or implies DG7, or any business approval G1–G6.

## 1. Files changed

| File | Purpose |
| --- | --- |
| `docs/delivery/requirements.csv` | All 54 DG7 rows that were `SPECIFIED`. Fields touched: `status` (22 rows), `evidence` (52, appended), `notes` (54, appended and never replaced), `screen_api` (4: Q10 and D-250 O6). No other row or field changed (`register-field-diff.txt`). |
| `docs/delivery/handbacks/DG7/T-DG7-AN-P7-transformation-analyst.md` | This handback. |
| `docs/delivery/handbacks/DG7/T-DG7-AN-P7-evidence/*` | Check logs; `register-field-diff.txt`; `release-notes.preview.md`, the generator's output from the final register written to scratch. It is **not** `docs/handover/release-notes.md`. |

I made no change to `docs/handover/**`, code, tests, `p7-pending*.ts` (no entry belongs to the analyst) or delivery records.

## 2. Behaviour per requirement

**Result:** 412 rows. 380 are `IMPLEMENTED`; 358 were before this pass. 32 are `SPECIFIED`. Of the 54 DG7 rows, **22 are now `IMPLEMENTED`, and 32 are release blockers.** Each blocker's notes start with "RELEASE BLOCKER at this pass, not IMPLEMENTED. Missing dependency: …" and name the exact clause and what is already done. No row was removed, deferred or reworded outside the fields above.

**Rule applied.** A row is `IMPLEMENTED` only when each acceptance clause has a check that ran and passed, recorded in a DG7 handback log or QA evidence file (D-243–D-265, plus QA-C's handback, which arrived during this run). A clause that is still pending keeps its row `SPECIFIED`, and the row's notes name it. Pending means an orchestrator-host half, a freeze-time run, a drill, an ungenerated file or an open defect. The evidence column lists only files that exist now (the update script checks each one). My own logs appear only in this handback.

### 2.1 Now IMPLEMENTED (22)

| Row | Basis (evidence in the row) |
| --- | --- |
| REQ-S19-001 | Archive with recorded checksum (DO-A/A2). T-B11 D0 from the archive. Layout by artefact: `source/` has role `app` (D-244 O1); a reviewer may judge this against the literal text. |
| REQ-S19-002 | `build-from-archive: PASS` (DO-A2). T-B11 D0 in the namespace with no network (DO-E, QA-C). |
| REQ-S19-003, REQ-S16-009 | `checks.log`: SBOM/inventory OK with the procurement flag (required=0, review=59) and `direct-dependency-problems=0`. `service-list: OK … matches the Compose files`. |
| REQ-S19-019 | `scan-assets: PASS` on the tree built from the archive. DO-E offline drill run 2 exit 0. |
| REQ-S19-009 | T-B9/T-B11 D3/D7. Payload template check. **Q10 applied:** `screen_api` now names the repository-root `.env.example`. |
| REQ-S19-017 | T-B11 D0–D10 PASS (DO-D7, D-264; DO-E, D-265). `screen_api` corrected (D-250 O6). Disclosures: `corrective_case`; A4.9 residuals. |
| REQ-S19-014, REQ-S19-016 | BE-C/D/E/R4 integration suites, KBE-A round-trip, T-B11 D5/D9 counts and checksums. The tools are the `mth-db` transfer commands, not a `tools/migration/` directory. |
| REQ-S19-012, REQ-S20-019 | QA-C: `restore-drill.sh` exit 0 (R1–R9; backup 4.6 s, restore 8.0 s). A19 harness 13/13 with timings (`a19-run4.log`). DO-F's drill PASS. Proposed finding F-DG7-qa-C-1 (Medium, not mandatory): the harness failed on the merged tree before QA-C's fixes. RPO/RTO are external. |
| REQ-S19-013 | DO-G: a dry run on a restored copy, then the real migrate. Catalogue test, and catalogue `--check` re-run by BE-R4. |
| REQ-S16-024 | BE-G integration 195/195. Defaults `retain` (D-243 Q3). Disclosures: stuck `running` run; S3 driver. |
| REQ-S19-005 | `dictionary-coverage: PASS` (365 tables, 5776 columns; BE-R4). T-B11 D4 production init. |
| REQ-S19-007 | `openapi-coverage: PASS` (965 operations, no pending entry, no skip; ARCH-R1). Contract test 111/111 (ARCH-R6, and again in §3). `connector-handover: PASS`. |
| REQ-S17-004 | The A17 tests pass in QA-C `a17-a22-run3.log`. That log's exit 1 comes from one A19 test caused by QA-C's own fix, since corrected. `connectors.md` is generated and checked. |
| REQ-S16-033 | Claims scan PASS (DO-B, DOC-C; the default scope again in §3). T-G7 matrix-to-test links (DO-B self-tests 191/191). |
| REQ-S19-011 | check-handover `deployment PASS` (T-H2, DOC-A). T-B9 config-trace in T-B11. |
| REQ-S02-003 | BE-H T-I1/T-I4/T-I5 passed; that run's single failure is route-inventory case 4 on BE-F's route. FE-C screen tests. `build-archive.mjs` ships the register. The role set is wider than ADM, AUD, TO (D-252 O1, disclosed). T-I10 is QA-D's. |
| REQ-DLV-010, REQ-DLV-021, REQ-S20-023 | **D-243 Q19:** DG0–DG6 evidence and tooling, with `completes-after-gate:` naming the DG7 gate-time clause. Each note says no DG7 approval is granted or implied. |

### 2.2 Release blockers at this pass (32), grouped by missing dependency

1. **Orchestrator-host halves** (D-243 Q1; D-265 lists them pending; no Docker daemon here). Each note records the agent half as done, with evidence.
   - REQ-S01-001: §7 Compose up.
   - REQ-S01-006: no-egress Compose run.
   - REQ-S16-008: `up --pull never --wait`.
   - REQ-S19-010: Compose healthcheck; `screen_api` corrected to `/healthz`, `/readyz`.
   - REQ-S19-018: image save/load on a containerd store, plus DO-E's ARCH-R6 code follow-ups; `screen_api` corrected.
   - REQ-S20-018: §7 clean-host start. The agent half is QA-C's A18 harness run 3: 8/8, exit 0. Proposed finding F-DG7-qa-C-2 (Medium). T-B11 and the harness ran on different archives.
2. **Repository secret scan fails, REQ-S16-031.** I first marked it IMPLEMENTED on DO-B's and DOC-C's passing scans. I reverted that when my own `secret-scan.mjs --scope payload` (§3 #8) exited 1 with 3 hits in committed files:
   - `deploy/scripts/drill/guide-keys.json` l.14 and l.30 (S3; the values are guide anchors such as `docs/handover/deployment.md#secrets`; from DO-D);
   - `packages/db/test/integration/transfer-load.test.ts` l.104 (S2; an unreachable `postgres://` URL on `127.0.0.1:1`; from BE-R2).

   They look like false positives, but the check fails. REQ-S21-003's note names this too.
3. **Configuration bundle, REQ-S19-008.** The A06 replay passes, but three items are open:
   - the `automation_rule` kind has no adapter (BE-F gap 1);
   - T-D7 is not written;
   - route-inventory case 4 (422 vs 400) has no later run recorded.
4. **Generated file missing:** REQ-S19-015, REQ-S02-005 and REQ-S21-003. `docs/handover/release-notes.md` does not exist (check-handover `index BLOCKED`). After this pass the generator succeeds (§3 #4). Writing the file is outside the analyst's write scope, so the orchestrator must run `--write`.
5. **Freeze-time protocol-audit run** (p7-work-split §J.1; no `test-evidence/DG7/orchestrator/` log yet). Each note carries its D-249 disclosure (H1–H11).
   - REQ-DLV-008 (C4), 009 (C1), 011 (C2), 012 (C3/C6);
   - REQ-DLV-018 (C7), 024 (C5), 027 (C8/C9), 028 (C6).
6. **Clauses only the DG7 gate can show, and Q19 does not list them:**
   - REQ-DLV-005, REQ-DLV-014, REQ-DLV-040 and REQ-S21-002 (`validate --stage DG7`, `--pipeline`);
   - REQ-S21-004 (A23, plus the A18 host half).
7. **Drills and index:**
   - REQ-S20-026 (A26);
   - REQ-S20-027 and REQ-DLV-030 (A27);
   - REQ-S20-031 (QA-D's test-level index).
8. **Q19 rows I did not mark IMPLEMENTED:**
   - REQ-DLV-041 and REQ-S20-028: DO-J's O1 and O2 are unresolved, and DO-J states that "a real A28 run would FAIL". O1 is the L3 hit on the approved `gates/DG3.json` notes. O2 is the envelope allow-list entry for `reviews/DG6/round-7/code-security-reviewer.json` l.220. The rehearsal passed only with two scratch-only adjustments.
   - REQ-DLV-039: QA-D's part, the drills and the host halves are open. QA-B's and QA-C's parts are done.
   - REQ-DLV-031 is not a Q19 row, but its final report also exists only at sealing. T-M12 is TODO.

**`completes-after-gate:` marker:** in exactly the six Q19 rows (REQ-DLV-010, DLV-021, S20-023, DLV-039, DLV-041, S20-028).
- Three of them are `IMPLEMENTED`, so About's `laterClauses` (ADR-0071 §4) lists three.
- T-I13 ("appear in `laterClauses`") **fails for DLV-039, DLV-041 and S20-028** until their blockers close.
- The release notes' "Clauses that complete after the engineering gate" lists all six with their status (`release-notes.preview.md`).

## 3. Checks run (real exit codes)

Node 24.21.0 (`/opt/nvm/versions/node/v24.21.0/bin`), `MTH_PNPM_OFFLINE=1`, in the shared tree (see the header). Logs are in the evidence directory.

| # | Command | Exit | Result / log |
| --- | --- | --- | --- |
| 1 | `node tools/gates/validate.mjs --historical --stage DG6` (before any write) | 0 | `PASS gate DG6 (historical)` (`validate-historical-DG6-start.log`) |
| 2 | `node --test tools/gates/tests/validator.test.mjs` | 0 | `validator-tests.log` |
| 3 | Python field diff, before against final register (the byte round-trip of the original verified first) | 0 | `register-field-diff.txt`: 54 rows, all formerly SPECIFIED DG7; notes and evidence appended; every non-IMPLEMENTED row has a release-blocker note; marker on the six Q19 rows. |
| 4 | `node tools/release/release-notes.mjs --csv docs/delivery/requirements.csv --deps docs/handover/external-dependencies.json --provisional apps/web/src/i18n --out $TMPDIR/release-notes.md` | 0 | `release-notes: 32 unfinished item(s), 6 later clause(s)` (final register). DO-J's run on the old register exited 1. |
| 5 | `node tools/release/secret-scan.mjs --path docs/delivery/requirements.csv --path $TMPDIR/release-notes.md` | 0 | `secret-scan: PASS (path; 2 files …)` |
| 6 | `node apps/api/scripts/register-snapshot.mjs --csv … --deps … --out $TMPDIR/snap.json` | 0 | `412 rows, sha256 54367819ef8c` (final register) |
| 7 | `node tools/release/claims-scan.mjs` (default scope, repository allow-list) | 0 | `claims-scan-default.log`. Separately, `--root <scratch copy>` exits 1 with 3 hits, all in pre-existing text (REQ-PB-001, l.413). The **before** register gives the same 3 hits (`claims-scan-register-BEFORE-baseline.log`); the allow-list does not apply to a scratch root. |
| 8 | `node tools/release/secret-scan.mjs --scope payload` | **1** | 3 hits in committed files not written by me (§2.2 item 2) (`secret-scan-payload.log`). After the run I redacted that log's quoted S2 line text, because the masked quote itself re-triggered S2. A `--path` scan of this handback and its evidence directory then exits 0 (24 files). |
| 9 | `node --test tools/release/tests/release-notes.test.mjs` | 0 | `release-notes-tests.log` |
| 10 | `pnpm -r typecheck` | 0 | `typecheck.log` |
| 11 | `pnpm lint` | 0 | `lint.log` |
| 12 | `pnpm openapi:lint` | 0 | `openapi-lint.log` |
| 13 | `pnpm test` | **1** | **BLOCKED (sandbox), no test ran:** vitest could not write `node_modules/.vite-temp` (EROFS) (`pnpm-test.log`). |
| 13b | The same three projects with `npx vitest run --configLoader runner --project <p>` | **1** | unit-node 3021/3022, unit-web 2175/2175, unit-formula-nocodegen 259 passed and 2 skipped. The one failure is `tests/qa/unit/a20-p6-token-contrast.test.ts` writing `test-results/qa-a20/contrast-pairs.txt`: EROFS in this sandbox, not a product result (`pnpm-test-configloader-runner.log`). |
| 14 | `tests/qa/support/with-pg.sh npx vitest run --project integration apps/api/test/integration/contract/contract.test.ts` | **1** | BLOCKED (sandbox): the same EROFS startup error (`contract-test.log`). |
| 14b | The same with `--configLoader runner` | 0 | 111/111 (`contract-test-configloader-runner.log`) |
| 15 | `git ls-files -co --exclude-standard -z \| xargs -0 npx prettier --check --ignore-unknown` | 123, then **0** | Run 1: every batch formatted, but exit 123 because three of QA-C's run files vanished mid-scan ("No files matching", `prettier-repo.log`). Run 2: exit 0, no `[warn]` (`prettier-repo-run2.log`). `requirements.csv` is outside Prettier's scope (D-261). |
| 16 | `node tools/gates/validate.mjs --historical --stage DG6` (end) | 0 | `PASS gate DG6 (historical)` (`validate-historical-DG6-end.log`) |

Not run: the full release suite (`node --test tools/release/tests/*.test.mjs`, about 12 minutes of seal rehearsal), and the asset scan (BLOCKED: `--web not found; run pnpm -r build first`). I ran no drills, containers or e2e. No integration test was touched, so the contract test is the only integration run.

## 4. Known gaps

1. **32 DG7 rows are not IMPLEMENTED.** Under the validator's rule `final gate DG7 requires IMPLEMENTED at DG7`, `validate --stage DG7` fails until each one closes. Promoting a row needs only its missing dependency met. Then status and evidence change, and the note gets one more sentence.
2. **`docs/handover/release-notes.md` is not written.** It is outside my write scope, and the runner reports any write there. The orchestrator should run:
   - `node tools/release/release-notes.mjs --csv docs/delivery/requirements.csv --deps docs/handover/external-dependencies.json --provisional apps/web/src/i18n --out docs/handover/release-notes.md`;
   - then `--check` and `check-handover.mjs`.

   Any later register change needs a regeneration.
3. **The register is in the candidate,** so promoting a row after a freeze-time run (§2.2 item 5) changes the payload. The freeze-time runs need to happen before the freeze, or a short second register pass is needed between them and the freeze.
4. **The secret-scan payload failure** (§3 #8) is real at the current tree. The scan has to be fixed and re-run before REQ-S16-031 and REQ-S21-003 can close.
5. **QA-C's results were added mid-run.** I read QA-C's handback and evidence (committed in `ce05d1e63`) but not its review record. QA-C writes no review record in this task. Its proposed findings F-DG7-qa-C-1 and F-DG7-qa-C-2 are cited in the notes and still need the orchestrator to allocate them.
6. I wrote no Arabic text. The Arabic section of the release-notes preview is the generator's own, and it is provisional.

## 5. Open questions (for the orchestrator)

1. **Q19 scope.** Should D-243 Q19 (IMPLEMENTED plus `completes-after-gate:`) extend to REQ-DLV-005, DLV-014, DLV-040, S21-002 and DLV-031? Their last clause also completes only with the DG7 gate or the seal, but Q19 lists six rows. Without a decision, DG7 cannot validate.
2. **DLV-041 and S20-028.** Should they become IMPLEMENTED under Q19 while DO-J's O1 and O2 are open? I kept them `SPECIFIED`, because the tooling as delivered would fail a real A28.
3. **Freeze-time protocol-audit.** Will it run before the freeze, followed by a second short analyst pass, so the eight J rows in §2.2 item 5 can be promoted inside the frozen payload?
4. **Six versus three later clauses.** The release notes list every marked row with its status, while About lists only `IMPLEMENTED` ones (ADR-0071 §4). Is that difference intended?
5. **Secret-scan hits.** Do DO-B's allow-list entries (with reasons) resolve them, or do the file owners reword the lines (DO-D `guide-keys.json`, BE-R2 `transfer-load.test.ts`)?

## 6. Merge instructions

- No migration, code or contract change. Take `requirements.csv` as a whole file. No other run writes it.
- After merging, run the release-notes `--write` (gap 2). The API build regenerates the register snapshot.
