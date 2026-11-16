# Handback T-DG7-AN-P7G (transformation-analyst): register disclosure repairs for F-DG7-920, F-DG7-960 and F-DG7-921

- **Stage:** DG7 (P7). Branch `claude/mobily-transformation-platform-dg6-regate`. Base `HEAD` 5458273cd4803b2c5b5573b4f2ff317c0d01d2ff. Working tree clean before I started, apart from this run's own `runs/` directory.
- **Assignment:** `docs/delivery/assignments/DG7/T-DG7-AN-P7G.md`. Its sha256 6acd923f…3d2a8a matches the value I was given.
- **Run:** DG7-T-DG7-AN-P7G-transformation-analyst-20261116T013856Z-99fb4120. Started 01:39:08Z, finished about 01:59Z.
- **Requirement IDs:** REQ-DLV-012 and REQ-S19-017. I also changed REQ-S20-018 and REQ-S01-006, because finding F-DG7-921 asks for them.
- **Approvals:** this task grants no approval. It grants no DG7 approval and no G1–G6 business approval.

## 1. Files changed

| File | Purpose |
| --- | --- |
| `docs/delivery/requirements.csv` | Changes notes and evidence in 4 rows: REQ-DLV-012, REQ-S19-017, REQ-S20-018 and REQ-S01-006. No status, acceptance, increment or gate value changed. The diff is 4 lines. sha256 after the edit: `ec2b526ad70351263cf4bbfb715456dab6157c5b1f5a8cf32021dc3f34856731`. |
| `docs/delivery/handbacks/DG7/T-DG7-AN-P7G-transformation-analyst.md` | This handback. |
| `docs/delivery/handbacks/DG7/T-DG7-AN-P7G-evidence/*` | Logs from the protocol audit, the validator and the checks (listed in §3). |

I did not edit anything under `docs/handover/**`, the gate tooling, the reviews or the gate records.

## 2. Behaviour per requirement

### REQ-DLV-012 (F-DG7-920, F-DG7-960)

**Where the count comes from.** I ran the protocol audit fresh on this base:

```
node tools/release/protocol-audit.mjs --stage DG7 --json <scratch>
```

The tool exits 1 by design when it finds hits. This run found 35 hits:
- C2: 27
- C3: 7, out of 75 DG7 implementation handbacks
- C5: 1
- C6: PASS

Evidence: `T-DG7-AN-P7G-evidence/protocol-audit-DG7.json` and `.out`.

**The seven C3 hits:**

| # | Handback | Missing section | Origin |
| --- | --- | --- | --- |
| 1 | `T-DG7-AN-P7B-transformation-analyst.md` | merge instructions | D-270 |
| 2 | `T-DG7-ARCH-R2-solution-architect.md` | behaviour | D-270 |
| 3 | `T-DG7-ARCH-R5-solution-architect.md` | behaviour | D-270 |
| 4 | `T-DG7-BE-R5-backend-workflow-engineer.md` | merge instructions | D-270 |
| 5 | `T-DG7-DO-A2-devops-engineer.md` | behaviour | D-270 |
| 6 | `T-DG7-FE-C3-frontend-ux-engineer.md` | merge instructions | F-DG7-960 |
| 7 | `T-DG7-DO-D8-devops-engineer.md` | merge instructions | F-DG7-920 |

Hit 7 is a round-2 repair handback, committed in 6c606e5b3. Its run ended with exit 1 and task DO-D8B completed it.

**Changes to the row:**
- **Pass-6 text.** "DG7 C3 6 hits" now says the six were counted on the earlier candidate ca38b65e, and that pass 7 corrects the count. The text that said "Disclosed deviation, not met: six DG7 implementation handbacks… The sixth…" now lists the five D-270 hits plus FE-C3, with no "six". I also added why pass 6 missed DO-D8: it counted from the round-2 report.
- **New pass-7 note.** It states SEVEN and names all seven handbacks with their missing sections. It describes the DO-D8 handback: commit 6c606e5b3, run exit 1, completed by DO-D8B, and no merge-instructions section. It also says:
  - D-270 and D-274 do not name hits 6 and 7, so the release-auditor's decision has to cover all seven.
  - Every surface that states this count must say seven. The orchestrator regenerates the handover files.
- **completes-after-gate marker.** It now reads: "the release-auditor's decision on the DG7 C3 hits (seven: the five D-270 hits plus F-DG7-960's FE-C3 and F-DG7-920's DO-D8 handback) and its reading of progress.md at the DG7 gate, and protocol-audit C3 and C6 on the frozen DG7 candidate".
- **Evidence.** Added this run's protocol-audit JSON and output, and `test-evidence/DG7/orchestrator/protocol-audit/protocol-audit-r3.json`.
- **Status.** Stays IMPLEMENTED under D-243 Q19 as D-274 extends it, with the same conditions as before. The hits are still listed as disclosed, not met.

**Other "six" in the register.** I searched the whole register. No other row states "six" for these C3 hits. The only remaining "6 hits" is the pass-6 history sentence, which now says it applied to candidate ca38b65e. Six other rows (REQ-DLV-008, -011, -014, -018, -024 and -028) cite the round-2 audit as "34 hits in C2, C3 and C5". That was true for that run. They give no C3 count and cite it for other checks, so I left them unchanged.

### REQ-S19-017 (F-DG7-921)

**What I checked before citing the DO-D8B run** (`T-DG7-DO-D8B-evidence/t-b11-run.log`):
- l.714: the D9 plan reads "stop worker; … stop API, PostgreSQL; start PostgreSQL, API, worker; job-check compare; …".
- job-check reports "PASS: enabled schedules equal, earlier job_run rows unchanged (0 new), approval rows equal".
- The export queued before the restart completes after it, with equal SHA-256.
- Both evidence downloads have equal SHA-256.
- Reconcile after use reports a match.
- "step D9 PASS in 9.573 s", and "driver exit 0".

**Limit, also stated in the row.** The log does not print a postmaster PID or a shutdown line. My claim that PostgreSQL really stopped rests on the drill code plus the PASS result:
- In `deploy/scripts/transfer-drill.sh` l.611–612, D9 runs `td_stop_pg … && td_stop_pg_dir "$WORK/pgT/data"`. If that fails, the drill prints "D9: the target PostgreSQL did not stop before its restart" and fails.
- That message is absent from the log (grep count 0).
- `git diff 7c819f08c HEAD -- deploy/scripts/transfer-drill.sh deploy/scripts/drill/` is empty.

**Changes to the row:**
- The pass-1 phrase "intact after a full restart" now reads "after a restart (but see pass 7: in these runs only the API and worker restarted)".
- **New pass-7 note.** Based on DO-D8 §4 and DO-D8B §4, the earlier D9 runs (DO-D7, DO-E, and QA round-2 A18) most probably restarted only the API and worker. The work trees from those runs are gone, so this is an inference, not a proof. The DO-D8B T-B11 run is now the evidence for the full-restart clause.
- **DO-D8's own T-B11 run.** D9 passed after the fix, but the driver exited 2 (cleanup, F-DG7-963). The note says so and does not cite it as the main run.
- **Evidence.** Added the DO-D8B `t-b11-run.log`, its `transfer/transfer-drill-report.json`, and the DO-D8B and DO-D8 handbacks.
- **Status.** Stays IMPLEMENTED. Acceptance is literally met on the DO-D8B run.

### REQ-S20-018 (F-DG7-921)

- A pass-7 note says the restart part of this row rests on the DO-D8B T-B11 run.
- The DO-D7, DO-E and QA-C runs cited earlier came before DO-D8's fix. Their D9 most probably restarted only the API and worker. They remain evidence for the clean start, the restored records, files and configuration, and the workflows.
- Added the DO-D8B log to the evidence. Status unchanged.

### REQ-S01-006 (F-DG7-921)

- A pass-7 note says this row relies on T-B11 D3/D7/D8, not on the D9 restart.
- It discloses that DO-E's D9 restart was limited, and points to REQ-S19-017 for the full-restart evidence. Status unchanged.

## 3. Checks run (Node v24.21.0, `MTH_PNPM_OFFLINE=1`, analyst sandbox, base 5458273cd)

| Command | Exit | Result / log |
| --- | --- | --- |
| `node tools/release/protocol-audit.mjs --stage DG7 --json $TMPDIR/pa.json` | 1 (by design: hits found) | C3 HIT 7. Output tail: `FAIL (exit 1): 35 hit(s) in 3 check(s), 0 blocked, 6 pass`. Logs: `protocol-audit-DG7.out`, `protocol-audit-DG7.json` |
| `node tools/gates/validate.mjs --register DG7` | **0** | `PASS register rules at DG7`. Log: `validate-register-DG7.log` |
| `node tools/gates/validate.mjs --historical --stage DG6` | **0** | `PASS gate DG6 (historical)`. Log: `validate-historical-DG6.log` |
| `pnpm -r typecheck` | **0** | `rtypecheck.log` |
| `pnpm lint` | **0** | `lint.log` |
| `pnpm openapi:lint` | **0** | `openapi-lint.log` |
| `git ls-files -co --exclude-standard -z \| xargs -0 npx prettier --check --ignore-unknown` | **0** | "All matched files use Prettier code style!" Log: `prettier-repo.log` |
| `pnpm test` | **1: BLOCKED by the sandbox** | Vitest could not load its config: `EROFS: read-only file system, open …/node_modules/.vite-temp/vitest.config.ts.timestamp-…`. In the analyst sandbox `node_modules` is read-only. No test ran. Log: `pnpm-test.log` |
| The same three projects, with `--configLoader runner` so that no temp file is written: `npx vitest run --project {unit-node,unit-web,unit-formula-nocodegen} --configLoader runner` | unit-node **1**, unit-web **0**, unit-formula-nocodegen **0** | unit-node: 3041/3042 passed. The one failure is `tests/qa/unit/a20-p6-token-contrast.test.ts`: `ENOENT … mkdir '/home/user/My-owns/test-results/qa-a20'`. The test writes evidence to a top-level directory that this sandbox does not allow. unit-web: 2199/2199. unit-formula-nocodegen: 259 passed, 2 skipped. Log: `unit-tests-configloader-runner.log` |
| `tests/qa/support/with-pg.sh npx vitest run --project integration --configLoader runner apps/api/test/integration/contract/contract.test.ts` (disposable PostgreSQL) | **0** | 111/111. Log: `contract-test-with-pg.log` |
| `node tools/release/release-notes.mjs --csv docs/delivery/requirements.csv --deps docs/handover/external-dependencies.json --provisional apps/web/src/i18n --out docs/handover/release-notes.md --check` | **1, expected** | "release-notes.md is out of date (run with --write)". The register changed and the handover is the orchestrator's to regenerate. Log: `release-notes-check.log` |

No integration test was touched. I changed no code, so none of my scope's tests are affected and no pending entries apply.

## 4. Known gaps and residual risks

1. **The full `pnpm test` acceptance check is not met in this sandbox.** As written it is BLOCKED (EROFS on `node_modules/.vite-temp`). With the config-loader workaround, 1 of 5502 tests fails because the analyst sandbox refuses the write to `test-results/qa-a20`. That is an environment limit, not a result of this change: the change is CSV notes and evidence only, and no test reads those cells. The orchestrator should rerun `pnpm test` in an unconfined tree.
2. **The handover files are stale until the orchestrator regenerates them.** `docs/handover/release-notes.md` still says "six" until it is regenerated: its `--check` exits 1 now. The About register snapshot may be stale too. If `check-handover` compares the register with the release notes, it will fail until that regeneration.
3. **The real PostgreSQL restart is inferred, not logged.** In the DO-D8B run it rests on the D9 code path and the PASS result, not on a logged postmaster PID change. A reviewer who needs direct evidence would need a run that logs the postmaster PID before and after D9, or a QA round-3 A18 run on the candidate.
4. **This handback itself is a DG7 implementation handback.** It has all the sections (files changed, behaviour, checks, known gaps, merge instructions, open questions), so it should not add a C3 hit. After this commit, the next protocol-audit run should still report 7. If it reports more, that number wins.

## 5. Merge instructions

- Merge `docs/delivery/requirements.csv` and the handback with its evidence directory. There are no migrations, no code and no ordering constraints.
- After the merge, the orchestrator:
  1. regenerates `docs/handover/release-notes.md` with `--write`, plus known-limitations and any register snapshot, from this register;
  2. reruns `check-handover`;
  3. reruns `protocol-audit.mjs` on the frozen candidate to confirm C3 = 7.
- **Expected conflicts:** a conflict is likely only if another task edits the same 4 rows of `requirements.csv`. Resolve by keeping both note texts. Keep the REQ-DLV-012 `completes-after-gate:` marker as the last clause of the notes.

## 6. Open questions

1. **For the orchestrator and the release-auditor:** D-270 and D-274 name only the five original C3 hits. Should a recorded user or auditor decision explicitly cover hits 6 (FE-C3) and 7 (DO-D8), or is disclosure in the register and release notes enough for the auditor to decide on all seven?
2. **For qa-verifier:** is the DO-D8B T-B11 run enough evidence for the A18 full-restart clause, or should round 4 include an A18 or T-B11 run on the frozen candidate that logs the postmaster PID before and after D9?
