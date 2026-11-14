# Handback T-DG7-AN-P7B: register pass 2 before the freeze (transformation-analyst)

- **Stage:** P7, gate DG7 (BUILDING). Branch `claude/mobily-transformation-platform-dg6-regate`.
- **Base:** `HEAD` `55742fd9c4fe3ad8c0863a89fa859d84c6500f81`. The tree was clean apart from this run's `runs/` directory. No other run wrote to the tree during this pass.
- **Assignment:** `docs/delivery/assignments/DG7/T-DG7-AN-P7B.md`, sha256 `75b66a9b…ba67212` (checked with `sha256sum`, and it matches).
- **Invocation:** `DG7-T-DG7-AN-P7B-transformation-analyst-20261114T184844Z-59afaba7`, session `59afaba7-c7b2-49ab-9d61-900e5d8a2130`.
- **Time:** start `2026-11-14T18:48:55Z`. Handback written at about `19:10Z`. The final checks' times are in their logs.
- **Evidence:** `docs/delivery/handbacks/DG7/T-DG7-AN-P7B-evidence/`.
- **Gate systems:** a register status is an engineering delivery state. This pass grants and implies no DG7 approval. It also grants and implies no business, Finance or IT approval, and no product gate G1–G6.

## 1. Files changed

| File | Purpose |
| --- | --- |
| `docs/delivery/requirements.csv` | The 32 DG7 rows that were release blockers after pass 1. Fields changed: `status` (10 rows), `evidence` (10 rows, appended to), `notes` (32 rows). No other row or field changed (`register-field-diff.txt`: 42 field changes, each one preserving the existing text). |
| `docs/delivery/handbacks/DG7/T-DG7-AN-P7B-transformation-analyst.md` | This handback. |
| `docs/delivery/handbacks/DG7/T-DG7-AN-P7B-evidence/*` | Check logs; `register-field-diff.txt`; `release-notes.preview.md`. That file is the generator's output from the new register, written to scratch and copied here. It is **not** `docs/handover/release-notes.md`. |

**How notes were edited.** Each note gets one sentence that starts "DG7 analyst pass 2 (T-DG7-AN-P7B, base 55742fd, 2026-11-14): …". It goes at the end of the note, except in the three Q19 rows that carry `completes-after-gate:` (REQ-DLV-039, DLV-041 and S20-028), where it goes immediately **before** the marker. The reason: `laterClauseOf` (release-notes.mjs l.104) reads everything after the marker up to the end of the line, and no note has a newline. Appending after the marker would therefore have changed the published later-clause text. The diff script confirms that removing the inserted sentence gives back the old note exactly. The pass-1 sentences stay as history, so a promoted row still contains its old "RELEASE BLOCKER at this pass" sentence, followed by the pass-2 sentence that closes it.

No code, test, `p7-pending*.ts` (no entry belongs to the analyst), `docs/handover/**` or delivery record was changed. The assignment's generic deliverables (mutations, decimal arithmetic, bilingual texts) do not apply to a register pass.

## 2. Behaviour per requirement

**Result: 412 rows. 390 are `IMPLEMENTED` (380 before this pass) and 22 are `SPECIFIED`. All 22 are DG7 release blockers. Each note names the exact missing item.** No row was removed, deferred or reworded outside the fields above.

**Rule (same as pass 1).** A row becomes `IMPLEMENTED` only when every acceptance clause has a check that actually ran and passed, recorded in a committed log. Q19 applies only to its six rows (D-266 (d)). The evidence column was given only files that exist; the update script asserts each one.

### 2.1 Promoted to IMPLEMENTED (10)

| Row | Basis |
| --- | --- |
| REQ-S01-001, REQ-S01-006, REQ-S16-008, REQ-S19-010, REQ-S19-018, REQ-S20-018 | **Orchestrator host run 3** (D-267, `test-evidence/DG7/orchestrator/host/`). Details below the table. |
| REQ-S16-031 | DO-J2 reworded the three pass-1 hits; D-266 (b) chose rewording, not allow-listing. Its payload scan exits 0 and its history scan exits 0, and ARCH-R7's payload scan exits 0. **This pass re-ran the payload scan at `55742fd`: exit 0** (3142 files, 33 allowed). Disclosed in the row: DO-J2's two history-only allow-list entries and the S2 own-mask exclusion (ADR-0063 Amendment 1, residuals 7 and 8) are for code-security review; a `--path` scan of ADR-0063 alone reports S2 at l.40, which the payload scope does not report (ARCH-R7 Q4). |
| REQ-S20-027 | **A27 drill** (`a27/drill-report.md`). K9: the candidate is reconstructed and matches the id later frozen. K10: every round 1–6 record is STALE. K11: the next action is reconstructed from `stages.json` and `decisions.md`. K12: `--stage DG6` exits 1, and `--pipeline` shows nothing approved past DG5. K13: no session id reused across 733 runs. K14: 60/60. Every clause of the row passes. Disclosed: a full clone was used instead of a sparse one. |
| REQ-DLV-041, REQ-S20-028 | **D-243 Q19 rows.** Pass 1 kept them blocked only for DO-J's O1 and O2. DO-J2 (integrated by D-267) resolved both, and the A28 rehearsal now runs with **no** scratch-only adjustment: seal CLI exit 0, verify CLI exit 0 `REHEARSAL-PASS`, V12 PASS with one acknowledged sentence, V13 PASS. The `completes-after-gate:` text is unchanged. Noted in the rows: code-security has still to judge the acknowledgement list and the allow-list changes (ARCH-R7 Q3), and the orchestrator has still to adopt the ARCH-R7 amendments (Q5). |

**What host run 3 shows:**
- build-image `BUILD+VERIFY: PASS` (step 03);
- save, `image rm`, load and verify, each exit 0 (steps 04–06);
- `docker compose -f deploy/compose/compose.yaml up -d --pull never --wait` exit 0, with `/readyz` reporting `database`, `migrations` and `storage` ok and `worker` alive (step 07). This is the documented command (`docs/operations/restricted-network.md` l.142);
- no-egress stack healthy and smoke 15/15, with the egress probe failing as it should (`ENETUNREACH`, `EAI_AGAIN`) (`host-run-3b.log` b01–b03);
- Keycloak e2e 4/4 on the default `test-idp` stack with the proxy variables unset (`host-run-3c.log` b07). Run 3b failed with the proxy set, and its log is kept.

**Disclosed in each of these six rows:**
- one host with registry access through a proxy, not air-gapped and not HA. "Without registry access" is shown by `rm` followed by `--pull never`, which is ADR-0069 §6's definition (residual 5);
- "clean VM" means a fresh Compose project on a fresh daemon (residual 2);
- the run used D-267's integration tree, not a frozen candidate;
- REQ-S20-018 only: QA-C's harness, T-B11 and the host run used three different trees or archives, and F-DG7-qa-C-2 is still unallocated.

### 2.2 Still release blockers (22), with the exact missing item

1. **Freeze-time protocol audit** (`protocol-audit.mjs --all --json` on the DG7 candidate; no log in `test-evidence/DG7/orchestrator/` at `55742fd`):
   - REQ-DLV-008 (C4)
   - REQ-DLV-009 (C1)
   - REQ-DLV-011 (C2)
   - REQ-DLV-012 (C3/C6, plus the auditor's reading of `progress.md`)
   - REQ-DLV-018 (C7)
   - REQ-DLV-024 (C5)
   - REQ-DLV-027 (C8/C9)
   - REQ-DLV-028 (C6, plus the DG7 update in `progress.md`)

   New disclosures added: the swept-file attribution incidents (D-266, D-267) go to C4, and the implementers who ran `--historical` late go to C5.
2. **Gate-only clauses, which D-266 (d) does not put under Q19:**
   - REQ-DLV-005, DLV-014, DLV-040 and S21-002: `validate --stage DG7` and `--pipeline` after DG7; the release-auditor decides these;
   - REQ-DLV-031: the final report at sealing, V18 and T-M12;
   - REQ-S21-004: A23 on the DG7 candidate. Its A18 host half is now closed.
3. **A26 drill not run:** REQ-S20-026. No `orchestrator/a26/` exists.
4. **A27 partial:** REQ-DLV-030. K10 and K12/K13 pass. **"Work continues from progress.md" is PARTIAL (K11):** at the checkpoint, `progress.md` was stale. The row needs a passing re-drill against a current `progress.md`, or the release-auditor's decision.
5. **`docs/handover/release-notes.md` not generated** at `55742fd` (D-266 (f) is the orchestrator's): REQ-S02-005, REQ-S19-015 and REQ-S21-003.
   - REQ-S19-015 also needs the protocol-audit report for check-handover's "generated" item. T-H5 is a pre-existing failure (DO-J2 gap 4, owned by DOC-B).
   - REQ-S21-003's secret-scan half is now closed.
6. **REQ-S19-008.** Every acceptance test has now run and passed:
   - QA-B's A06 replay;
   - BE-F2's T-D7, which fails on two mutants;
   - unknown schema version refused;
   - route-inventory case 4 `{400: 490}`, 286/286.

   Still missing: (1) the orchestrator's adoption of ADR-0065 Amendment 1 (ARCH-R7 Q5), which puts individual `automation_rule` records out of scope for DG7, while the title names "automation … configuration"; (2) the known-limitations entry that ADR-0065 Residual 1 requires. It is not in `known-limitations.md` or its Arabic summary (`grep automation_rule` finds nothing). It belongs to DOC-B.
7. **REQ-S20-031.** QA-D's test-level index DG0–DG6 exists (389 checks, 0 missing evidence). Its DG7 section still needs the DG7 round, the full e2e and visual runs on the frozen candidate, and the A26/A27 reports.
8. **REQ-DLV-039 (Q19 row, not promoted).** It still needs:
   - the A26 drill;
   - the A27 progress.md clause;
   - A23 for DG7;
   - `release-notes.md`;
   - the full e2e and visual runs on the candidate.

   The host halves and QA-D's index are now closed.

`completes-after-gate:` is still on exactly the six Q19 rows. Five are `IMPLEMENTED`, so About's `laterClauses` will list five. REQ-DLV-039 stays out of that list until its blocker closes. The release notes list all six with their status (`release-notes.preview.md`).

## 3. Checks run (real exit codes)

Node 24.21.0, `MTH_PNPM_OFFLINE=1`, agent sandbox, tree at `55742fd` plus this register change.

| # | Command | Exit | Result / log |
| --- | --- | --- | --- |
| 1 | `node tools/gates/validate.mjs --historical --stage DG6` (before any write, 18:49Z) | 0 | `PASS gate DG6 (historical)` (`validate-historical-DG6-start.log`) |
| 2 | `node tools/release/secret-scan.mjs --scope payload` (before the register change) | 0 | `PASS (payload; 3142 files; allowed 33; canary (documented) 22)` (`secret-scan-payload.log`) |
| 3 | Python field diff, old register against new (the update script first checks that the CSV round-trips byte for byte) | 0 | 10 status, 10 evidence and 32 notes changes, every one preserving the existing text. 390 IMPLEMENTED / 22 SPECIFIED. The marker is on exactly six rows (`register-field-diff.txt`). |
| 4 | `node tools/release/release-notes.mjs --csv docs/delivery/requirements.csv --deps docs/handover/external-dependencies.json --provisional apps/web/src/i18n --out $TMPDIR/release-notes.md` | 0 | `22 unfinished item(s), 6 later clause(s)` (`release-notes-preview.log`, `release-notes.preview.md`) |
| 5 | `node tools/release/secret-scan.mjs --path docs/delivery/requirements.csv --path <preview>` | 0 | `PASS (path; 2 files …)` |
| 6 | `node apps/api/scripts/register-snapshot.mjs --csv … --deps … --out $TMPDIR/snap.json` | 0 | `412 rows, sha256 d7e10d9d3869` |
| 7 | `node tools/release/claims-scan.mjs` | 0 | `PASS (887 files; …)` |
| 8 | `node --test tools/release/tests/release-notes.test.mjs` | 0 | `release-notes-tests.log` |
| 9 | `pnpm openapi:lint` | 0 | `OpenAPI 3.1.1, 965 operations` |
| 10 | `pnpm lint` | 0 | `lint.log` |
| 11 | `pnpm -r typecheck` | 0 | `typecheck.log` |
| 12 | `pnpm test` | **1** | **BLOCKED (sandbox), no test ran:** EROFS writing `node_modules/.vite-temp` at config load (`pnpm-test.log`). Same cause as on pass 1 and in QA-D's run. |
| 12b | `QA_EVIDENCE_DIR=$TMPDIR/qa-ev npx vitest run --configLoader runner --project <p>` for the three projects of `pnpm test` | 0, 0, 0 | unit-node 205 files / 3022; unit-web 130 / 2175; unit-formula-nocodegen 3 / 259 passed + 2 skipped (`pnpm-test-configloader-runner.log`) |
| 13 | `QA_PG_PORT=27811 tests/qa/support/with-pg.sh npx vitest run --configLoader runner --project integration …/contract/contract.test.ts …/release/about.test.ts` | 0 | 2 files, 115/115 (`contract-about-integration.log`). No integration test was touched, so I ran only the contract test plus About, which reads the register. |
| 14 | `git ls-files -co --exclude-standard -z \| xargs -0 npx prettier --check --ignore-unknown` (after this handback) | 0 | `All matched files use Prettier code style!` (`prettier.log`) |
| 15 | `node tools/gates/validate.mjs --historical --stage DG6` (end, 19:12–19:14Z) | 0 | `PASS gate DG6 (historical)` (`validate-historical-DG6-end.log`) |
| 16 | `node tools/release/secret-scan.mjs --path <this evidence directory> --path <this handback>` | 0 | `PASS (path; 18 files …)`, so committing these files adds no history hit |

Rows 14–16 ran after the body of this file was written. The only later edit is this table row update, which is Markdown table text in the same format.

I ran no drill, container, e2e or protocol audit. Those belong to the orchestrator.

## 4. Known gaps

1. **22 DG7 rows are not IMPLEMENTED,** so `validate --stage DG7` fails on them until each one closes (§2.2).
2. **`docs/handover/release-notes.md` is still not written.** It is outside my write scope. The orchestrator runs `release-notes.mjs … --out docs/handover/release-notes.md`, then `--check` and `check-handover.mjs`, and regenerates after any later register change.
3. **The register is in the candidate payload.** Closing the protocol-audit, A26 and release-notes items after the freeze would change the payload, so a short pass 3 is needed between those runs and the freeze (D-266 (e)).
4. **The promoted host-run rows rest on orchestrator evidence from the integration tree, not the frozen candidate.** Reviewers re-run or judge it (D-243 Q1).
5. **Release notes show each row's whole note,** so the pass-1 blocker text stays visible before the pass-2 sentence that closes it. A reader has to read to the end of a note.
6. I wrote no Arabic text.
7. The final prettier and validator runs (§3 rows 14 and 15) both exited 0. This file was edited once after them, to fill in their results, so prettier is re-checked on this file alone below.

## 5. Open questions

1. **REQ-S19-008.** Once ADR-0065 Amendment 1 is adopted and DOC-B adds the known-limitations entry, is the row `IMPLEMENTED` with the `automation_rule` exclusion disclosed? Or does the release-auditor judge the title's "automation configuration" literally?
2. **REQ-DLV-030.** Will A27 K11 be re-run against a current `progress.md`, or will the auditor decide the PARTIAL?
3. **Pass 3.** Will it run after the protocol audit, the A26 drill and `release-notes --write`, and before the freeze (§4 item 3)?
4. **F-DG7-qa-C-1/-2 and the A27 progress.md finding** are proposed but not yet allocated, and the rows cite them. Will the orchestrator allocate them?

Merge: take `requirements.csv` as a whole file. No migration, code or contract change is involved. The API build regenerates the register snapshot.
