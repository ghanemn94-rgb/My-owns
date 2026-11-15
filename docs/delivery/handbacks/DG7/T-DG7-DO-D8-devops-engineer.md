# Handback T-DG7-DO-D8: transfer-drill cleanup after PASS (devops-engineer)

- **Stage:** DG7 (P7), branch `claude/mobily-transformation-platform-dg6-regate`, base `HEAD` 4f22171d6b0c8f0e020d5a73a923d0576ed99966 (changes not committed).
- **Invocation:** run `DG7-T-DG7-DO-D8-devops-engineer-20261115T183751Z-f4b1dc56`, session `f4b1dc56-8d20-468f-8bcf-44e5af5f96f9`. Assignment sha256 `f4bb4c68…0643fd17` (verified).
- **Finding:** F-DG7-963 (Low, owner devops-engineer). **Requirements:** REQ-S20-018, REQ-S19-001.
- **Time:** start 18:38:05Z, end about 19:10Z (about 32 minutes).
- **Environment:** Node v24.21.0; PostgreSQL 16.15 server binaries at `/usr/lib/postgresql/16/bin`; uid 0, so PostgreSQL runs in a user namespace as uid 1000; `bwrap --unshare-net` available; no Docker daemon (D-243 Q1); offline (`MTH_PNPM_OFFLINE=1`); about 10.6 GB free under `$TMPDIR` at the T-B11 start.
- This is engineering evidence only. It grants no G1–G6 business, Finance or IT approval and no DG gate. A local drill is not evidence of high-availability production readiness.

## 1. Files changed

| File | Change | sha256 |
| --- | --- | --- |
| `deploy/scripts/drill/cleanup.sh` (new) | A sourced library with `td_alive`, `td_descendants`, `td_postmaster`, `td_stop_pg` and `td_remove_work` | `a891ff9a81466efad106542e14c6cfb3ddb15071e002952f7dbce5c544e0662b` |
| `deploy/scripts/transfer-drill.sh` | Sources the library. The EXIT trap stops both clusters with `td_stop_pg` and always ends with `true`. The source cluster at the D2/D3 boundary and the target cluster before the D9 restart are stopped with `td_stop_pg`; D9 fails if the target does not stop. The outer mode and the not-enough-disk BLOCKED path use `td_remove_work` instead of `rm -rf "$WORK"` | `c6cf2a1453f88cfbea1e875484944151788cd481e8478bf412c88e30b71f3d85` |
| `deploy/scripts/tests/transfer-drill.test.mjs` | A new suite, `T-DG7-DO-D8 drill/cleanup.sh …`, with 7 cases (see §2) | `35146b59d78c92292e72eaac281d68e9ec9becbfdfd52d4062c06792ef193f55` |
| `docs/delivery/handbacks/DG7/T-DG7-DO-D8-evidence/**` | Logs, the T-B11 driver, and the T-B11 drill output (`transfer/`) | report sha256 `79efd4fd…f84ef` |

There are no entries for this finding in `apps/api/test/support/p7-pending*.ts`, so none were removed. No product code, migration, contract, permission, demo data or KPI configuration changed. Because no mutation route changed, the authorization, validation, concurrency and audit rule has nothing new to apply to.

## 2. Behaviour per requirement

**Root cause, measured (it is more than the finding describes).** `pg_start` runs `as_pg "$PGBIN/postgres" … &`, which backgrounds a shell function. So the recorded `$!` (`PG_S_PID`, `PG_T_PID`) is a bash subshell, and the postmaster is that subshell's child:

- The probe `comm=bash`, `SigIgn: …4`, child `comm=sleep` shows this, and the real-PostgreSQL test case prints `comm bash (the launching pid), 6 processes under it`.
- `stop_pid` sent SIGTERM to the subshell, so the subshell exited and **the postmaster kept running**. That happened in the EXIT trap, so the outer `rm -rf "$WORK"` (under `set -e`) raced a live server writing `pgT/data`. This is the A18 run-1 failure `rm: cannot remove '…/pgT/data/base/34663': Directory not empty`.
- The same happened at the D2/D3 boundary for the source cluster, and in D9 before the restart. There, the old postmaster probably kept serving port 25433, so the new `pg_start` was most likely answered by the old server. I infer this from the mechanism; the pre-fix logs no longer exist to prove it. That is why I applied the fix to D9 as well and reran T-B11.

**Fix.**

- `td_stop_pg <pid> [secs]` finds the real postmaster: `<pid>` itself if its command is `postgres`, otherwise its nearest `postgres` descendant. It lists the whole process tree first, then:
  1. sends SIGINT to the postmaster (fast shutdown) and waits up to `MTH_TD_PG_STOP_SECS`, default 30 s;
  2. then sends SIGQUIT and waits 5 s;
  3. then sends SIGKILL to every listed process and waits 5 s.
- It returns 0 only when every process in the tree has exited; zombies count as exited. It returns 1 with a WARNING line after the bound, so it never hangs. All waiting is done by polling `/proc`, because the postmaster is not the caller's child.
- `td_remove_work <dir> <rc> [log]` makes five attempts, 1 s apart. If they all fail, it prints one line on stderr and appends it to `drill.log`:
  `transfer-drill: WARNING: could not remove the work directory <dir> (<rm error>); the drill result (exit <rc>) is unchanged; remove the directory by hand`
  It then returns 0, and the outer mode runs `exit "$rc"`. A cleanup failure therefore never changes a PASS (0) or a FAIL (1), and it is never silent.

**REQ-S20-018 (A18 independent deployment) and REQ-S19-001.** The drill's exit status now reflects only the drill's result. T-B11 was rerun on the changed scripts: 12/12 steps PASS, exit 0, the work tree removed by the drill itself, and no postgres process left afterwards.

New tests (`node --test`, all in `deploy/scripts/tests/transfer-drill.test.mjs`):

1. `td_remove_work` removes the tree and returns 0, with no stderr output.
2. and 3. With a stub `rm` that always fails, under `set -euo pipefail`, it returns 0, the script's `exit 0` or `exit 1` is unchanged, the exact WARNING line appears on stderr and in the log, and it finishes in under 15 s (measured about 4.0 s).
4. A stand-in "postmaster" ignores INT, QUIT and TERM and has a child that ignores them too. It is a copy of bash named `postgres`, started as `pg_start` does (a backgrounded function inside `$( … )`). `td_postmaster` finds it under the subshell, `td_stop_pg … 1` escalates to KILL, returns 0, and both are gone in about 7 s, within the 20 s bound.
5. A **real PostgreSQL 16** cluster, started exactly as `pg_start` does, with a 10,000-row table written. `td_stop_pg` returns 0 in 0.21 s, `pg.log` contains `received fast shutdown request` once (the signal reached the postmaster), `postmaster.pid` is removed (a clean shutdown, not a kill), none of the 6 processes is alive, and the tree is removable.
6. Static checks on `transfer-drill.sh`:
   - the library is sourced;
   - the EXIT trap uses `td_stop_pg … || true` and ends with `true`;
   - the outer mode ends `td_remove_work "$WORK" "$rc" "$OUT/drill.log"` followed by `exit "$rc"`;
   - no bare `rm -rf "$WORK"` and no `stop_pid "$PG_[ST]_PID"` remain;
   - the D2/D3 and D9 stops use `td_stop_pg`.
7. End to end, inside the namespace: a failing drill (fake archive, D0 FAIL) whose work tree cannot be removed still exits 1, prints `transfer-drill: FAIL: D0 FAIL…`, and shows the WARNING line `(exit 1)` on stderr and in `drill.log`.

A **PASS** end to end with a failing removal is not run as its own case, because making the inner drill pass needs the full T-B11. The PASS path is covered by tests 2, 3 and 6, and by the real T-B11 rerun (exit 0 after PASS, tree removed).

## 3. Checks run (real exit codes)

| Command | Exit | Time | Log |
| --- | --- | --- | --- |
| `node --test --test-name-pattern="T-DG7-DO-D8" deploy/scripts/tests/transfer-drill.test.mjs` (development iterations; the first had 1 failure, which revealed the subshell PID) | final 0, 7/7 | 21 s | console |
| `tests/qa/support/with-pg.sh bash docs/delivery/handbacks/DG7/T-DG7-DO-D8-evidence/t-b11-driver.sh` (**T-B11**) | drill **0**; driver 2 (see below) | drill 283 s, total 5m16.7s | `t-b11-run.log`, `transfer/` |
| `tests/qa/support/with-pg.sh node --test deploy/scripts/tests/transfer-drill.test.mjs` | **0**: 54 tests, 54 pass, 0 fail, 0 skipped | 149 s | `transfer-drill-test.log` |
| `pnpm -r typecheck` | **0** | 301 s | `typecheck.log` |
| `pnpm lint` | **0** | 42 s | `lint.log` |
| `pnpm openapi:lint` | **0** | 1 s | `openapi-lint.log` |
| `pnpm test` | **0**: unit-node 207 files and 3042 tests; unit-web 131 files and 2199 tests; formula-nocodegen 3 files, 259 passed and 2 skipped | 386 s | `pnpm-test.log` |
| `node tools/gates/validate.mjs --historical --stage DG6` | **0** | 150 s | `validate-dg6.log` |
| `git ls-files -co --exclude-standard -z \| xargs -0 npx prettier --check --ignore-unknown` | see `final-exits.log` (it is run last, after this file is written) | | `prettier-repo.log` |

**T-B11 workload and results.**

- HEAD 4f22171d6.
- Demo source: migrate, then seed-demo, then export: 335 tables, 4782 rows, 0 attachments, manifest sha256 `3f64f516…de8c1`, in 8 s.
- Archive `mth-transformation-hub-0.1.0-9ff7aec8d2af.tar.gz`: 14,672,316 bytes, sha256 `eeaf41f2cf1a340d2b907b6dc827a7f6292b59d8ef61ebd06be18687aa9c1e1e`, built in 21 s from committed HEAD. The archive does not contain this uncommitted change, but the drill script and its helpers run from the working tree, so the change was exercised.
- Offline pnpm store copy: 290 MB, 2 s.
- Drill: **PASS in 278.990 s**, 335 tables and 2 evidence files equal, D8's export package 5006 rows and 2 attachments.
- Step times in seconds: D0 193.968, D1 11.434, D2 1.899, D3 0.407, D4 6.963, D5 12.889, D6 3.246, D7 2.294, D8 33.808, D9 9.970 (the restart now preceded by a real fast shutdown), D10 0.863, D11 0.
- `drill.log` has no WARNING line, and no drill work tree is left under `$TMPDIR`.

**Driver mistake, disclosed.** Line 33 of the T-B11 driver, a post-run check I added, had a quoting error. It made the driver exit 2 *after* it had printed `transfer-drill exit 0`. The drill's own exit is that line.

I then did the post-run steps by hand (appended to the log):

- 0 drill work trees left;
- `$TMPDIR/b11` (306 MB) removed;
- a by-name check (`pgrep -x postgres`) found 0 postgres processes.

My first by-hand check used `pgrep -f` and matched its own command line. Those lines were removed from the log and the correction is noted there. The driver file in the evidence directory now has the corrected line, which passes `bash -n`. It was not rerun after that correction.

The rows figure printed by the inherited DO-D7 driver line `tables 335 rows 0883…` is a string concatenation in that line, not a count. The correct counts are in the `export-migration:` lines (4782 and 5006).

**Not run:** the vitest integration suites and the contract test. This change touches no API, contract or migration, and the assignment asks for the contract test only where it is touched.

## 4. Known gaps

- `stop_pid` is still used for the API, the worker and the IdP. They are started with direct `node … &`, so `$!` is the process itself, and they write nothing under `$WORK/pg*`. I left them unchanged.
- `pg_start` still records the subshell PID. `td_stop_pg` handles that by finding the postmaster. Recording the postmaster PID itself (for example from `postmaster.pid`) would be cleaner, but would change `pg_start` for every step. I did not do it.
- A PASS end to end with a forced cleanup failure is covered only by unit, static and real-drill evidence, not by one combined case (see §2).
- Before this fix, the D9 "restart verified" claim in earlier runs (DO-D7, QA round 2 A18) probably did not restart PostgreSQL itself, because the old postmaster survived the SIGTERM sent to its subshell. Only the API and worker restarts were real. This is an inference from the measured mechanism; the old work trees and `pg.log` files are deleted. The T-B11 rerun here is the first one with a real PostgreSQL stop before the restart.

## 5. Open questions

1. For the orchestrator and qa-verifier: should the observation in the last bullet of §4 (earlier D9 restarts were probably API and worker only, not PostgreSQL) be recorded against A18/T-B11 evidence from earlier runs, and should QA's A18 rerun in round 3 cite this run's D9 instead?
2. Is a dedicated PASS-plus-forced-cleanup-failure end-to-end case wanted? It would need either a test-only hook in `transfer-drill.sh` or a second full drill run, about 5 minutes.
