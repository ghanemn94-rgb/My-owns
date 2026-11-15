# Handback T-DG7-AN-P7D: register pass 4 with the protocol audit (transformation-analyst)

- **Stage:** DG7 (BUILDING), branch `claude/mobily-transformation-platform-dg6-regate`.
- **Base:** `HEAD` `0c78543abe5ea5f122b35ca7e3bc3f4672b8d507`. The working tree was clean apart from this run's own run folder.
- **Assignment:** `docs/delivery/assignments/DG7/T-DG7-AN-P7D.md`, SHA-256 `48c3ac8d843e98c015c260fdd52e2b47c2e1720deeb84ee5c72de230677e655c` (checked).
- **Invocation:** `DG7-T-DG7-AN-P7D-transformation-analyst-20261115T065849Z-0115393e`, session `0115393e-7372-4d8b-b84c-56926ca26e13`.
- **Start and end:** started 2026-11-15 07:03:40Z; end time is in the closing line.
- **Clean tree:** this re-run started from a clean tree (D-270). I did not read or apply the stash `an-p7d-partial`.

This pass approves nothing. It grants no G1–G6 business approval and no Finance or IT approval, and it does not imply DG7. Product G6 never implies DG7.

## 1. Files changed

| File | Purpose |
| --- | --- |
| `docs/delivery/requirements.csv` | Pass 4 for all 20 non-IMPLEMENTED rows. Each row gets a dated "DG7 analyst pass 4" note. Two rows are promoted to IMPLEMENTED (REQ-DLV-009, REQ-DLV-027). Evidence paths are added where a check that ran supports the note. The `completes-after-gate:` marker of REQ-DLV-039 stays at the end of its notes. |
| `docs/delivery/handbacks/DG7/T-DG7-AN-P7D-transformation-analyst.md` | This handback. |
| `docs/delivery/handbacks/DG7/T-DG7-AN-P7D-evidence/*.log` | Logs of the checks listed in §3. |

**Register after this pass:** 394 of 412 rows are IMPLEMENTED (pass 3 had 392). 18 rows are SPECIFIED, every one with a release-blocker note that names its missing dependency. No row was removed, deferred or reclassified. Classes, increments and final gates are unchanged.

**No product code changed.** There are no `p7-pending*.ts` entries in my scope, so none were removed. The assignment's generic product-code clauses (authorization, concurrency, audit events, decimals, bilingual text) don't apply to a register-only task.

## 2. Behaviour per requirement

**Evidence used.**

- The orchestrator's protocol audit before the freeze (D-269): `test-evidence/DG7/orchestrator/protocol-audit/protocol-audit-prefreeze.json` and `.log`. It was run with `--all` at head `b2ba3e3`, exited 1 and reported 279 hits.
- `check-handover-2.log`.
- `release-notes/run-2.log`.
- The pre-freeze logs `prefreeze/3-*.log`.

I read the per-check hits in the audit JSON directly.

**Scope caveat on every C-check result below.** The audit read records up to `b2ba3e3`, which covers 75 DG7 runs. It ran before the freeze, not on a frozen DG7 candidate, so it does not cover anything after `b2ba3e3`: this pass, the review round or the audit.

### Promoted to IMPLEMENTED (2)

**REQ-DLV-009 (at most four concurrent workers).**

- DG7 C1 PASS: 75 runs with `meta.json`, peak overlap 2 at 2026-11-14T13:13:44Z (ARCH-R6 and QA-C), limit 4.
- One DG7 run folder has no `meta.json`: `DG7-T-DG7-ARCH-02-…-96a9626b`. Even if it is counted, the peak can't go above 4.
- The scope caveat is written into the row. A later overlap above four would be a DG7 finding (§J.1).
- The D-249 H1/H2 disclosure for DG5/DG6 is unchanged.

**REQ-DLV-027 (automatic continuation, no approval claim).**

- C8 PASS across all stages: 3971 files, 927,329 sentences.
- DG7 C9 PASS: DG7 entered BUILDING at 12:02:49Z on 2026-11-12, after DG6 was APPROVED at 11:30:26Z. No confirmation step was recorded.
- D-249 and D-270 are disclosure decisions, not confirmations to continue.
- The scope caveat is written into the row. The status explicitly grants no approval.

### Release blockers under D-270 (3): the DG7 hits are stated and the release-auditor judges them

**REQ-DLV-011, C2: 27 DG7 hits.**

- 24 hits lack only the task and requirement ids (the orchestrator's custom template).
- 3 hits are the A26 drill assignments, which lack several elements: BE-A26, REV-A26-CS, REV-A26-QA and REV-A26-V. Each is listed in the row with its missing elements.
- The D-249 H3/H4 disclosure (149 hits in DG0–DG6) still applies.

**REQ-DLV-012, C3: 5 DG7 hits.**

| Handback | Missing section |
| --- | --- |
| AN-P7B | Merge instructions |
| ARCH-R2 | Behaviour |
| ARCH-R5 | Behaviour |
| BE-R5 | Merge instructions |
| DO-A2 | Behaviour |

- DG7 C6 PASS: 14 handbacks list open gaps, and none of those tasks is reported complete.
- The auditor's reading of `progress.md` is still missing.

**REQ-DLV-024, C5: 1 DG7 hit.**

- The first implementation run was DO-A at 15:02:13Z on 2026-11-12.
- `validate-historical-DG6.log` records 18:27:48Z and was committed at 18:30:24Z, both later.
- The audit doesn't list that file among those it found, but its date wouldn't change the result.
- This is the late run already disclosed in D-269.

All three rows cite D-270 and leave the decision to the release-auditor.

### Still release blockers, with the pass-4 state recorded (15)

| Row | What changed in pass 4 | Still missing |
| --- | --- | --- |
| REQ-DLV-008 | C4 PASS: 4 concurrent pairs, 0 shared declarations, no actual shared write. | The first acceptance clause ("each assignment names a base revision and permitted files"): the C2 hits on BE-A26 and the three REV-A26 assignments, and the 49 assignments without declared paths by C4's reading. The acceptance also names the release-auditor's check. The hits are stated like DLV-011's (open question 1). |
| REQ-DLV-018 | C7 PASS, but with **0** DG7 findings, so the check had nothing to test. | The DG7 review round and its repair cycles; C7 at the gate. |
| REQ-DLV-028 | C6 PASS ("gate update not applicable"). | The DG7 gate update in `progress.md`. A DG6 C6 hit remains after the H10 line and is noted for the auditor. |
| REQ-DLV-005, REQ-DLV-014, REQ-DLV-040, REQ-S21-002, REQ-S21-004 | C9 PASS recorded where relevant. | The DG7 gate, review round and audit; `--pipeline` after DG7. D-266 (d). |
| REQ-DLV-030 | No K11 re-drill. `progress.md` now marks its stale lines as historical (cf17128c3). | A K11 re-drill, or the auditor's decision on the partial result. |
| REQ-DLV-031 | T-M12 passed again in the pre-freeze run (463/465 pass, 0 fail, 2 skipped). | The final report at sealing (V18). |
| REQ-DLV-039 | Release notes regenerated after pass 3 (run-2.log); pre-freeze verification (D-269). | K11; A23 for DG7; the full e2e and visual runs on the frozen candidate; the D-270 rows for the auditor; release-notes regeneration after this pass. The marker is kept. |
| REQ-S02-005 | Release notes regenerated after pass 3. | T-I13 on the frozen register (QA-D); release-notes regeneration after this pass. |
| REQ-S19-015 | H.4 T-H1 and T-H5 fixed (DOC-B2; pre-freeze release-tool tests 0 fail). check-handover passes all six checks with the DG7-inclusive report (check-handover-2.log). | T-I10 at the freeze; the A28 archive listing and register byte check at the seal. 8 H.3 warnings remain. |
| REQ-S20-031 | None. | The DG7 section of the test-level index after the freeze. |
| REQ-S21-003 | Release-blocker list regenerated; secret scans PASS (payload 3148 files, history 35735 files). | T-I10 and T-I13 on the frozen register, the auditor's check, and regeneration after this pass. |

## 3. Checks run (Node 24.21.0, offline, `MTH_PNPM_OFFLINE=1`, real exit codes)

| # | Command | Exit | Log |
| --- | --- | --- | --- |
| 1 | `node tools/gates/validate.mjs --historical --stage DG6`, run **before** the register edit (07:06Z) | 0 (`PASS gate DG6 (historical)`) | `01-validate-historical-DG6-before.log` |
| 2 | `node tools/release/release-notes.mjs --csv … --out docs/handover/release-notes.md --check`, after the edit | **1**, as expected: "out of date (run with --write)". Two rows changed status, and regeneration is the orchestrator's job (my write scope excludes `docs/handover/`). | `02-release-notes-check-after-edit.log` |
| 3 | `pnpm -r typecheck` | 0 | `03-typecheck.log` |
| 4 | `pnpm lint` | 0 | `04-lint.log` |
| 5 | `pnpm openapi:lint` | 0 (965 operations) | `05-openapi-lint.log` |
| 6 | `release-notes.mjs … --out "$TMPDIR/rn-preview.md" --write`, a preview in scratch only (deleted afterwards) | 0: "18 unfinished item(s), 6 later clause(s)" | `06-release-notes-preview.log` |
| 7 | `git ls-files -co --exclude-standard -z \| xargs -0 npx prettier --check --ignore-unknown` | see §3a | `07-prettier.log`, `09-prettier-final.log` |
| 8 | `pnpm test` | see §3a | `08-pnpm-test.log` |
| 9 | `node tools/gates/validate.mjs --historical --stage DG6`, after the edit | see §3a | `10-validate-historical-DG6-after.log` |

Also checked: every evidence path in the register is an existing file (a Python check; it printed no missing path).

Not run: integration tests and the contract test on a disposable PostgreSQL. I changed no product code, integration test or contract, so the assignment's "the integration tests you touch" covers none.

### 3a. Final results

- **#7 prettier, before this handback existed:** exit 0 (`07-prettier.log`). It was re-run on the final tree, including this handback: `09-prettier-final.log`, exit status recorded in that log.
- **#8 `pnpm test` as is: BLOCKED (environment), exit 1.**
  - All three projects stop at config load with `EROFS: read-only file system … node_modules/.vite-temp/vitest.config.ts.timestamp-…` (the analyst sandbox). No test runs.
  - This is the same condition QA-D recorded (`T-DG7-QA-D/13-pnpm-test.log`).
  - Re-run of the same three projects with `npx vitest run --configLoader runner --project <p>` and `QA_EVIDENCE_DIR=$TMPDIR/qa-a20` (`08b-unit-configloader-runner.log`):

    | Project | Files | Tests | Exit |
    | --- | --- | --- | --- |
    | unit-node | 207/207 | 3042/3042 | 0 |
    | unit-web | 130/130 | 2179/2179 | 0 |
    | unit-formula-nocodegen | 3/3 | 259 passed, 2 skipped (by design) | 0 |

  - The React Router "ErrorBoundary" lines in that log are stderr from tests that exercise error states. They are not failures.
- **#9 `--historical --stage DG6` after the edit:** exit 0, `PASS gate DG6 (historical)` (`10-validate-historical-DG6-after.log`).
- **Extra:** `node --test tools/release/tests/release-notes.test.mjs` ran 9 tests: 9 pass, 0 fail, exit 0 (`11-release-notes-tests.log`).

## 4. Known gaps

- **18 rows are still release blockers.** Each one names its dependency in the register. Most need the freeze, the DG7 review round, the audit or the seal, which this pass can't supply.
- **The D-270 rows (DLV-011, DLV-012, DLV-024) and DLV-008** wait on the release-auditor's judgement of the DG7 hits.
- **`docs/handover/release-notes.md` is now stale** (check exit 1). The orchestrator must run `release-notes.mjs --write` and then `--check`.
- **The two promotions rest on a pre-freeze audit at `b2ba3e3`,** not on a frozen-candidate run. The scope caveat is written into each row.
- **Assignment contradiction.** The assignment's five handback sections are "files changed; behaviour; checks; known gaps; open questions". `agent-protocol.md` and protocol-audit C3 require "Merge instructions" instead of "open questions". Missing merge instructions is exactly the AN-P7B C3 hit. This handback includes both sections: §5 Merge instructions and §6 Open questions.

## 5. Merge instructions

- No migrations and no product code; only `docs/delivery/requirements.csv` and this handback with its evidence.
- After merging, the orchestrator runs:
  1. `node tools/release/release-notes.mjs --csv docs/delivery/requirements.csv --deps docs/handover/external-dependencies.json --provisional apps/web/src/i18n --out docs/handover/release-notes.md --write`
  2. The same command with `--check`.
  3. `check-handover`, because the release-notes content changes.
- No conflicts are expected unless another task edits `requirements.csv`.

## 6. Open questions

1. **DLV-008.** D-270 names only DLV-011, -012 and -024. DLV-008's first clause fails on the same C2 hits (four A26 drill assignments without base revision and/or permitted files). I gave it the same disclosure wording and left it to the release-auditor. Should D-270 be read as covering DLV-008 explicitly?
2. **Coverage of the promotions.** DLV-009 and DLV-027 were promoted on the pre-freeze audit, with the scope caveat in each row. Should the orchestrator re-run `protocol-audit --all --json` on the frozen DG7 candidate (§J.1/§J.2 "at the freeze") so that C1, C8 and C9 cover the review round? If a hit appears there, the rows return to blocker status as DG7 findings.
3. **DLV-018.** C7 passed with zero DG7 findings. I kept the row as a blocker because the check had nothing to test. Please confirm that the gate-time C7 is the intended evidence.

---

Final prettier (`09-prettier-final.log`): exit 0. Ended 2026-11-15 07:27Z, about 24 minutes after the start. The pass was not cut short.
