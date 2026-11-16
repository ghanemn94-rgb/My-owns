# Handback T-DG7-DO-D8B: finish F-DG7-963, transfer-drill cleanup after PASS (devops-engineer)

- **Stage:** DG7 (P7), branch `claude/mobily-transformation-platform-dg6-regate`, base `HEAD` 17b2b22f3188e599da53ea89fc36cb1a28e64d90. DO-D8's partial work is in 6c606e5b3. My changes are not committed.
- **Invocation:** run `DG7-T-DG7-DO-D8B-devops-engineer-20261115T200458Z-1254beb9`, session `1254beb9-4286-4327-9e1d-ee57a0b76200`. I checked the assignment's sha256 (`264e15dd…c82bf41`) and it matches.
- **Finding:** F-DG7-963 (Low, owner devops-engineer). **Requirements:** REQ-S20-018, REQ-S19-001.
- **Time:** started 20:06:12Z and ended about 20:35Z, so about 29 minutes.
- **Environment:**
  - Node v24.21.0, run offline (`MTH_PNPM_OFFLINE=1`).
  - PostgreSQL 16.15 server binaries at `/usr/lib/postgresql/16/bin`. The disposable QA cluster comes from `tests/qa/support/with-pg.sh`.
  - Running as uid 0, so the drill's PostgreSQL runs in a user namespace as uid 1000.
  - `bwrap --unshare-net` is available. There is no Docker daemon (D-243 Q1).
  - About 10.6 GB was free under `$TMPDIR` at the T-B11 start.
- **Scope of this evidence:** it is engineering evidence only. It grants no G1–G6 business, Finance or IT approval and no DG gate. A local drill does not show high-availability production readiness.

## 1. Files changed

### What DO-D8 did (6c606e5b3), reviewed against F-DG7-963

DO-D8 found that the root cause goes beyond what the finding describes. `pg_start` backgrounds a shell function (`as_pg postgres … &`) inside `$( … )`. So the recorded `$!` is a bash subshell, and the postmaster is that subshell's child. `stop_pid` therefore sent SIGTERM only to the subshell, and the postmaster kept writing `pgT/data` while the outer mode ran `rm -rf "$WORK"` under `set -e`.

DO-D8 made these changes:

- **`deploy/scripts/drill/cleanup.sh`** (new). It provides:
  - `td_alive`, `td_descendants` and `td_postmaster`;
  - `td_stop_pg`, which stops the real postmaster with INT (fast shutdown) and waits up to 30 s, then sends QUIT and waits 5 s, then sends KILL to the whole tree and waits 5 s. It returns 0 only when every process is gone; otherwise it prints a WARNING and returns 1. It never hangs;
  - `td_remove_work`, which makes five removal attempts. If they all fail, it prints one WARNING line on stderr and in `drill.log` and returns 0, so the result is unchanged.
- **`deploy/scripts/transfer-drill.sh`**:
  - the EXIT trap stops both clusters with `td_stop_pg … || true` and ends with `true`;
  - the D2/D3 and D9 stops use `td_stop_pg`;
  - the outer mode and the BLOCKED-disk path use `td_remove_work`, then `exit "$rc"`.
- **Tests:** seven test cases.

I reviewed this code line by line. It meets the finding's "expected" text: cleanup waits for PostgreSQL to stop, and a cleanup failure is reported without changing a PASS or a FAIL. I found no defect. I kept all of it.

**The one remaining gap,** which DO-D8 listed itself (§4: "`pg_start` still records the subshell PID"): if the launcher subshell has already gone while the postmaster still runs, `td_stop_pg <launcher pid>` finds nothing to stop and returns 0. The postmaster could then still be writing when the work tree is removed. I closed that gap.

### What I changed

| File | Change | sha256 |
| --- | --- | --- |
| `deploy/scripts/drill/cleanup.sh` | New `td_stop_pg_dir <datadir> [secs]`. It reads the pid from `<datadir>/postmaster.pid` and acts only on a live process whose `comm` is `postgres` and whose `/proc/<pid>/cwd` is `<datadir>`. That way a stale pid file whose pid has been reused (for example by the `with-pg.sh` cluster) is never signalled. It then runs the same bounded `td_stop_pg`. With no pid file or no matching process it returns 0, and it returns 1 exactly as `td_stop_pg` does. The header documents it. | `1b2b6dfdf7e83e4ef6f01947dc3aceb11fae195e0290cebe3c95ca15cb377bf4` |
| `deploy/scripts/transfer-drill.sh` | In the EXIT trap, after `td_stop_pg` for both pids, it runs `td_stop_pg_dir` for `$WORK/pgS/data` and `$WORK/pgT/data` (`\|\| true`; the trap still ends with `true`). At D2/D3 it adds `td_stop_pg_dir "$WORK/pgS/data" \|\| true`. In D9 the line is now `td_stop_pg "$PG_T_PID" && td_stop_pg_dir "$WORK/pgT/data" \|\| { echo "D9: the target PostgreSQL did not stop before its restart"; return 1; }`. | `8f651ba77266cfb4ee79b7eca36072fa29a82c93893b288a2e9735fb237b9e32` |
| `deploy/scripts/tests/transfer-drill.test.mjs` | A new case, `T-DG7-DO-D8B td_stop_pg_dir …` (see §2). The DO-D8 static case is updated to require the new trap, D2/D3 and D9 lines. The file has been through `prettier --write`. | `07de297e787549076b839dc23b59690530bc52ed2b16b9767801475f2ce7137b` |
| `docs/delivery/handbacks/DG7/T-DG7-DO-D8B-evidence/**` | Check logs, `final-exits.log`, the T-B11 driver and run log, and the drill output (`transfer/`). | report sha256 `f025bd87b757675e7cf34ce1c079ac7446a64a73818469090472c285a34436f2` |

**Other notes:**

- No entries for this finding exist in `apps/api/test/support/p7-pending*.ts`, so none were removed.
- No product code, API, migration, contract, permission, demo data or KPI configuration changed. With no mutation route changed, the authorization, validation, concurrency and audit rule has nothing new to apply to.

**Merge instructions:**

- Commit the three script files and the evidence directory together with this handback.
- There are no migrations, ordering constraints or expected conflicts.
- The files touch only `deploy/scripts/**`.

## 2. Behaviour per requirement

**REQ-S20-018 (A18, independent deployment and transfer drill) and REQ-S19-001.** The drill's exit status now reflects only the drill's result:

1. **No PostgreSQL process outlives the inner run while the outer mode removes the tree.** The EXIT trap stops each cluster through its launcher pid (`td_stop_pg`, DO-D8). It then also stops any postmaster still named in either data directory's `postmaster.pid` (`td_stop_pg_dir`, D8B). Both steps are bounded: 30 + 5 + 5 s at most per process tree. Neither can change the exit status.
2. **The cleanup result cannot override the drill result** (DO-D8). `td_remove_work` returns 0 in every case. A removal that still fails after five attempts produces exactly one line on stderr and in `drill.log`: `transfer-drill: WARNING: could not remove the work directory <dir> (<rm error>); the drill result (exit <rc>) is unchanged; remove the directory by hand`. It is never silent, and PASS stays 0 and FAIL stays 1.
3. **D9 restarts the target PostgreSQL for real.** The new server starts only after the old postmaster, found by either route, has stopped. If it cannot be stopped, D9 FAILs with a named reason instead of connecting to the old server.

**New test (D8B), on a real PostgreSQL 16 cluster started as `pg_start` starts one:**

- **Setup:** after a 10,000-row table is written, the launcher subshell is killed with SIGKILL.
- **Assertions:**
  - `td_stop_pg <launcher>` returns 0 while the postmaster is still alive. This reproduces the gap.
  - A `postmaster.pid` copied into another directory never signals this postmaster, because the cwd check guards against reused pids. Return code 0; the postmaster is still alive.
  - `td_stop_pg_dir <datadir>` returns 0, and the postmaster is gone.
  - `pg.log` has `received fast shutdown request` exactly once, and `postmaster.pid` has been removed, so this was a clean fast shutdown.
  - A second call, and a call on a missing directory, both return 0.
- **Timing:** about 2.0 s.

DO-D8's seven cases still pass unchanged, apart from the updated static regexes. They cover:

- removal success;
- forced removal failure under `set -e` for rc 0 and rc 1;
- INT→QUIT→KILL escalation against a stubborn stand-in;
- a real PostgreSQL fast shutdown (this run: `comm bash (the launching pid), 6 processes under it, td_stop_pg 0.25 s`);
- the static wiring check;
- an end-to-end failing drill with a forced removal failure, which still exits 1 with the WARNING line.

## 3. Checks run (real exit codes)

All checks ran on the working tree with my changes in place. Logs are in `docs/delivery/handbacks/DG7/T-DG7-DO-D8B-evidence/`, and the exit codes were recorded by the runner in `final-exits.log`.

| Command | Exit | Time | Log / output tail |
| --- | --- | --- | --- |
| `node --test --test-name-pattern="DO-D8" deploy/scripts/tests/transfer-drill.test.mjs` (development run) | 0: 8 tests, 8 pass | 23 s | console |
| `tests/qa/support/with-pg.sh node --test deploy/scripts/tests/transfer-drill.test.mjs` | **0**: `tests 55, suites 11, pass 55, fail 0, cancelled 0, skipped 0` | 160 s | `transfer-drill-test.log` |
| `pnpm -r typecheck` | **0** | 303 s | `typecheck.log` |
| `pnpm lint` | **0** | 41 s | `lint.log` |
| `pnpm openapi:lint` | **0** | 1 s | `openapi-lint.log` |
| `pnpm test` | **0**: unit-node 207 files, 3042 tests passed; unit-web 131 files, 2199 passed; formula-nocodegen 3 files, 259 passed and 2 skipped | 376 s | `pnpm-test.log` |
| `node tools/gates/validate.mjs --historical --stage DG6` | **0**: `PASS gate DG6 (historical)` | 166 s | `validate-dg6.log` |
| `tests/qa/support/with-pg.sh bash docs/delivery/handbacks/DG7/T-DG7-DO-D8B-evidence/t-b11-driver.sh` (**T-B11**, a full transfer drill on the changed scripts) | **0** (drill 0, driver 0) | drill 277 s, driver 309 s | `t-b11-run.log`, `transfer/` |
| `git ls-files -co --exclude-standard -z \| xargs -0 npx prettier --check --ignore-unknown` | appended to `final-exits.log` (run last, after this file was written) | | `prettier-repo.log` |

**T-B11 workload and results:**

- **Base:** HEAD 17b2b22f3, run at 20:25:53–20:31Z.
- **Demo source:** migrate, then seed-demo, then export. 335 tables, 4782 rows, 0 attachments, manifest sha256 `62ff0e32b99d6cc00054498cbe797885a75c4fcdbcc213743cb868b21b40bca5`, 7 s.
- **Archive:** `mth-transformation-hub-0.1.0-fdde023b6a6f.tar.gz`, 14,683,879 bytes, sha256 `57cbffcf9f5bb3204ab5dc243e348e042e636bf41677a73bd17f993a42ae5aec`, built in 18 s from committed HEAD. It does not contain my uncommitted change. However, `transfer-drill.sh` and `drill/cleanup.sh` run from the working tree, so the change was exercised.
- **Offline pnpm store copy:** 2 s.
- **Drill result:** `transfer-drill: PASS in 272.677 s: 335 tables and 2 evidence files equal, origin http://127.0.0.1:25302, restart verified`. The D8 export package had 335 tables, 5006 rows and 2 attachments.
- **Step times (s):**

  | D0 | D1 | D2 | D3 | D4 | D5 | D6 | D7 | D8 | D9 | D10 | D11 |
  | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
  | 188.483 | 12.557 | 1.978 | 0.345 | 6.688 | 11.494 | 3.224 | 2.223 | 33.642 | 9.540 | 0.770 | 0 |

- **After exit:**
  - `drill PostgreSQL processes left after exit: none`;
  - `drill.log WARNING lines: 0`;
  - `drill work trees left: 0`;
  - `$TMPDIR/b11` removed.
- The `tables 335 rows 0883…` line comes from the inherited driver. It concatenates strings rather than counting rows (DO-D8 disclosed this). The counts are in the `export-migration:` lines.

**Not run:** the vitest integration suites and the contract test. This change touches no API, contract or migration, and the assignment requires those only where they are touched.

## 4. Known gaps

- `pg_start` still records the launcher subshell pid, not the postmaster pid. Both stop routes (`td_stop_pg` through the launcher, `td_stop_pg_dir` through `postmaster.pid`) now cover that. I did not rewrite `pg_start`, because that would affect every step.
- `stop_pid` (SIGTERM, 5 s, then KILL) is still used for the API, the worker and the IdP. They are started directly with `node … &`, so `$!` is the process itself, and they write nothing under `$WORK/pg*`.
- There is no single end-to-end case for a passing drill combined with a forced removal failure. That would need a full drill (about 5 minutes) or a test-only hook. The PASS path is covered by the rc-0 unit case, the static wiring check, and the real T-B11 run (exit 0 after PASS, tree removed).
- DO-D8 inferred, and I agree, that D9 in drills before DO-D8 (DO-D7, QA round-2 A18) probably did not really restart PostgreSQL: the old postmaster survived the SIGTERM sent to its subshell. That cannot be proven now, because those work trees and `pg.log` files are gone. DO-D8's T-B11 and this one are runs with a real PostgreSQL stop before the restart.

## 5. Open questions

1. For the orchestrator and qa-verifier: carried over from DO-D8. Should QA's round-3 A18 cite a post-DO-D8 D9 run, given the inference in the last bullet of §4?
2. Is a dedicated end-to-end case for a passing drill with a forced cleanup failure wanted (about 5 minutes per run, or a test-only hook in `transfer-drill.sh`)?
