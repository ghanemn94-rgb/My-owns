# Handback T-DG7-DO-D15 (devops-engineer): restore.sh symlinked evidence root (F-DG7-1101) and guide §8 (F-DG7-1092)

- **Stage:** DG7 (P7). Assignment `docs/delivery/assignments/DG7/T-DG7-DO-D15.md`, SHA-256 `7bb48b0a0c3772c487449b12c4989c856f964f1117efedb656ad9674d8759972` (verified at start).
- **Invocation:** `{"kind":"claude-code-cli-session","run_id":"DG7-T-DG7-DO-D15-devops-engineer-20261125T101752Z-2d3c2d1c","session_id":"2d3c2d1c-a530-4af9-8a67-cd646f9ae0d5"}`.
- **Base:** `HEAD` `3f48bd28b10d4696281430727040de537aa8911d`, branch `claude/mobily-transformation-platform-dg6-regate`. Working tree at start: only untracked run, assignment and round-4 review evidence files.
- **Time:** started 2026-11-25 10:18:06 UTC, last check finished 10:55:52 UTC (about 40 minutes).
- **Environment:**
  - Node 24.21.0 (`/opt/nvm/versions/node/v24.21.0/bin`), `MTH_PNPM_OFFLINE=1`, running as `uid=0(root)` inside a user namespace without a uid `10001` mapping (`chown 10001:10001` fails with `Invalid argument`).
  - Disposable PostgreSQL 16 through `tests/qa/support/with-pg.sh` on ports 28420–28426.
  - **No Docker daemon** (D-243 Q1). No Compose run is claimed here.
- **Concurrency note:** the assignment says "You run alone", but T-DG7-SA-ADR74 (solution-architect) ran at the same time. It modified `docs/architecture/adr/ADR-0066-…md` and wrote its own handback. **I did not touch those files.** They appear in `git status` and are not part of this handback.

## 1. Files changed

| File | Purpose |
| --- | --- |
| `deploy/scripts/restore.sh` | F-DG7-1101: step 3 resolves a symlinked `--target-evidence-path` once (`readlink -e`) before step 4. Every later use works on the resolved directory: the default owner (`stat -L`), copy-in, `chown -R`, the `find … chmod` and the R7 counts. A dangling link, or a link to a non-directory, is refused with exit 2 before the database is touched. Also adds a non-root pre-check before step 4 (§4 explains why it is beyond the strict scope). Header usage text updated. |
| `deploy/scripts/tests/backup-restore.test.mjs` | New tests T-E15a–d (below). Header range changed to T-E1…T-E15. Prettier formatting. |
| `docs/handover/backup-restore.md` | F-DG7-1092: §8 records the passing rg4c Compose run (C0–C11, 2 evidence files, 1 queued job, owner 10001), with a timings-table row, and names rg4/rg4b as the two failed attempts with their cause. §5 and the step-3 row describe the symlinked root and the non-root refusal. §10 "Permissions in Compose" is corrected. The Arabic summary gains two matching lines (still provisional, D-243 Q7). |
| `docs/delivery/handbacks/DG7/T-DG7-DO-D15-devops-engineer.md` | This handback. |
| `docs/delivery/handbacks/DG7/T-DG7-DO-D15-evidence/*` | The logs of §3. |

No `apps/api/test/support/p7-pending*.ts` entry belongs to this task: it declares and routes no API operation, so none was removed.

## 2. Behaviour delivered, per requirement

### REQ-S19-012 / REQ-S20-019: F-DG7-1101, symlinked target evidence root

**The repair (step 3 of `restore.sh`):**
- **Symbolic link.** If `--target-evidence-path` is a symbolic link, it is resolved with `readlink -e`, through chains of links too.
  - A dangling link is refused (exit 2): `restore: refused: the target evidence path <p> is a symbolic link whose target does not exist (<target>); create the target directory or pass it directly`.
  - A link to a non-directory is refused (exit 2): `restore: refused: the target evidence path <p> is a symbolic link to <t>, which is not a directory`.
  - Both refusals happen before step 4, so the target database stays empty.
- **Existing (non-link) root.** It is checked for emptiness as before, with the unchanged message. It is then resolved with `readlink -e`, which also normalises a path that sits below a symlinked parent.
- **Default owner.** Taken with `stat -L -c '%u:%g'` from the resolved directory, never from the link.
- **One resolved path.** From then on, `$store` is the resolved directory for copy-in, retention copy, `chown -R`, `find -type d/f -exec chmod`, the R7 `otherOwner`/`groupOrOtherBits` counts, the R7 `owner` stat and the R8 offline check. The directory that was checked is the one written, as backup.sh does for a symlinked backup root (DO-D12, F-DG7-1053). The link itself is left in place.

**Reproduction before the fix** (reviewer's probe `05-probe-symlink-evidence-root.test.mjs.txt`, unchanged, on base `restore.sh` sha256 `29d8344b…f865a`; log `01-repro-probe-old-code.log`):
- exit 1 at R7 with `groupOrOtherBits` 1;
- 351 tables already in the target;
- `retention/` left at 0755.

This matches the finding.

**After the fix** (same probe; log `04-probe-fixed-code.log`):
- exit 0, `restore: test-do-f-set restored and ready in 8.4 s; all checks passed`;
- R7 PASS `{"owner":"0:0","verified":0,"mismatches":0,"otherOwner":0,"retentionFiles":2,"groupOrOtherBits":0}`;
- every path of the real root is 0700 (directories) or 0600 (files).

**Tests T-E15:**

| Test | Asserts | Old code (`02-t-e15-old-code.log`) | Fixed code (`11-…-final.log`) |
| --- | --- | --- | --- |
| T-E15a | A link to an empty 0700 directory: exit 0. The link is kept. At least 2 files restored. Every path is runner-owned and 0700/0600. R7 PASS, `owner` = runner, `otherOwner` 0, `groupOrOtherBits` 0. | **FAIL** | PASS |
| T-E15b | A runner-owned link to a directory owned by `10001:10001`: the default owner is 10001 (the target's, not the link's). Every path is 10001, 0700/0600. R7 PASS, owner 10001. | SKIPPED (no uid 10001 mapping) | SKIPPED (same reason) |
| T-E15c | A dangling link, then a link to a regular file: both exit 2 with their messages. The database has 0 tables. Nothing is created at the dangling target, and the file is unchanged. | **FAIL** | PASS |
| T-E15d | Non-root runner with `--evidence-owner <uid+1>:<gid>`: exit 2 before step 4. 0 tables, root still empty. | SKIPPED (runner is root) | SKIPPED (runner is root) |

### REQ-S20-019: F-DG7-1092, backup-restore.md §8

**§8 timings table** has a new row for `compose-backup-rg4c`, built from the orchestrator's logs only:
- date 2026-11-24 11:56 UTC, source commit `389482803fd5e338bb83e9078cfc944bda1890ed`;
- `postgres:18@sha256:5a5a84b1…2da9722`, Docker 29.9.2, Compose v5.6.1;
- backup 7.1 s (C3 3.02, C4 1.81, C5 2.24);
- restore C8 9.78 s, of which `restore.sh` took 9.1 s (packageChecks 0.162, targetChecks 0.076, database 4.894, evidence 1.061, checks 2.854; from `restore-report.json`);
- C9 1.24 s, C10 8.11 s, whole drill 65.95 s;
- demo data plus 2 evidence files (146 bytes) plus 1 queued synthetic job, owner `10001:10001`.

**§8 "Compose runs"** now lists:
- **rg3b** (PASS, 0 objects and 0 jobs);
- **rg4 and rg4b** (2026-11-24, source `b2864f2abf2397c27bbb73d3535b8b7c1f30fc6b`): both FAILED at C2b with drill exit 1. The cause was the drill's own seeding: `no transformation readable by the signed-in user`, repaired by the orchestrator (D-285). C3–C10 did not run;
- **rg4c** (PASS C0–C11): C4 copied 2 files; C5 `config.files` has 3 entries and no error line; C8 R1–R8 PASS; C9 R7 owner 10001:10001, verified 2, 0 mismatches, same SHA-256, 1 job still queued; C10 `/readyz` 200.

**What the guide says about scope:**
- rg4c is one local drill on synthetic data. It is **not** proof of high-availability production readiness and not a recovery objective.
- rg4c predates this `restore.sh` change. A re-run on the candidate is the orchestrator's.

**§10 "Permissions in Compose"** no longer says the Compose sequence "has not been run here". It now says that it cannot run in the agent sandbox and that the orchestrator's rg4c passed. It also names T-E15a–d and why T-E15b/d are skipped.

**Source of the figures:** `docs/delivery/test-evidence/DG7/orchestrator/compose-backup-rg4{,b,c}/` (`run.txt`, `02-compose-backup-drill.log`, `02-compose-backup-drill.d/restore/restore-report.json`). I did not run Compose.

**Approvals:** nothing here grants a G1–G6, Finance or IT approval, and nothing implies DG7.

## 3. Checks actually run

All logs are in `docs/delivery/handbacks/DG7/T-DG7-DO-D15-evidence/`. Final file SHA-256s:
- `restore.sh`: `4dca1e4e8f97016140cdc46d0b223e2cd19452a4e6ee1081dd8b6fa51aafb9a7`
- `backup-restore.test.mjs`: `2d58d0edf3b5e4dd5422437deb9a464908ad7e4cf9bb37dcf2474404c8b363c0`
- `backup-restore.md`: `f0d1c28e14dae4f637e07913554e95be6f10df020f7a76ef86e74ce997b6928f`

| # | Command | Result | Log |
| --- | --- | --- | --- |
| 1 | Reviewer probe (copied to `deploy/scripts/tests/zz-d15-probe.test.mjs`, removed afterwards), old code: `QA_PG_PORT=28420 tests/qa/support/with-pg.sh node --test --test-name-pattern CS-RG4-P1 …` | **exit 1** (expected: reproduces F-DG7-1101), 21.9 s | `01-repro-probe-old-code.log`, `01-restore-sh-before.sha256` |
| 2 | T-E15 on base `restore.sh` (`git show HEAD:…` swapped in, then the fix put back): `QA_PG_PORT=28421 … node --test --test-name-pattern T-E15 deploy/scripts/tests/backup-restore.test.mjs` | **exit 1** (expected): 0 pass, 2 fail (T-E15a, T-E15c), 2 skipped | `02-t-e15-old-code.log` |
| 3 | Full suite on the fix, before Prettier: `QA_PG_PORT=28422 … node --test deploy/scripts/tests/backup-restore.test.mjs` | exit 0: 26 tests, 23 pass, 0 fail, 3 skipped (T-E14c, T-E15b, T-E15d), 54.4 s | `03-backup-restore-suite.log` |
| 4 | Reviewer probe on the fix (port 28423) | exit 0, R7 PASS, 22.6 s | `04-probe-fixed-code.log` |
| 5 | QA A19 harness: `QA_PG_PORT=28424 tests/qa/support/with-pg.sh npx vitest run --project integration tests/qa/integration/a19-backup-restore-drill.test.ts` | exit 0, 13/13 pass, 50.4 s | `05-qa-a19-harness.log` |
| 6 | `shellcheck deploy/scripts/restore.sh` | **BLOCKED**: shellcheck is not installed (`command -v shellcheck` fails). `bash -n` exit 0. | `06-shellcheck.log` |
| 7 | `git ls-files -co --exclude-standard -z \| xargs -0 npx prettier --check --ignore-unknown` | First run **exit 123** (the new test file was unformatted). After `npx prettier --write deploy/scripts/tests/backup-restore.test.mjs`, the rerun exits 0: "All matched files use Prettier code style!". The log holds the rerun. | `07-prettier.log` |
| 8 | `node tools/gates/validate.mjs --historical --stage DG6` | exit 0, `PASS gate DG6 (historical)` | `08-validate-dg6.log` |
| 9 | `pnpm -r typecheck`, `pnpm lint`, `pnpm openapi:lint` | exit 0, exit 0, exit 0 | `09-typecheck.log`, `09-lint.log`, `09-openapi.log` |
| 10 | `pnpm test` | exit 0 in 687 s: unit-node 208 files / 3056 tests passed; unit-web 131 / 2199 passed; unit-formula-nocodegen 3 / 259 passed, 2 skipped | `10-pnpm-test.log` |
| 11 | Full suite on the final, formatted bytes (port 28425) | exit 0: 26 tests, 23 pass, 0 fail, 3 skipped, 58.2 s | `11-backup-restore-suite-final.log` |
| 12 | Contract test: `QA_PG_PORT=28426 tests/qa/support/with-pg.sh npx vitest run --project integration apps/api/test/integration/contract/contract.test.ts` | exit 0, 111/111 pass, 2 min 22 s | `12-contract-test.log` |

Timings are this sandbox's on the suite's synthetic set. They are not production figures.

## 4. Known gaps / not done

1. **No Compose run.** There is no Docker daemon here, so the orchestrator must re-run `deploy/scripts/drill/compose-backup-drill.sh` on the candidate. The Compose path uses a named volume, never a link, so the symlink change should not alter it, but that is unverified until the re-run.
2. **T-E15b did not run here.** It covers the link owner differing from the target owner (the F-DG7-1082 failure mode through a link). It needs root with a mapped uid 10001, the same constraint as T-E14c. In this environment, the target-owner rule is shown only where link and target share an owner (T-E15a and the probe). The code path is `stat -L` on the resolved path.
3. **The non-root pre-check goes beyond the strict scope and is unverified here.**
   - **What it does.** Before step 4, a runner that is not root is refused (exit 2) in two cases:
     - the evidence owner's uid is not the runner's, or its gid is not one of the runner's groups (`id -G`);
     - an existing target root is not writable by the runner.
   - **Why I added it.** It is the rule the architect states in ADR-0066 residual 11 (the DO-D14 Q3 answer). That ADR records the rule as "not built and not assigned". I added it because the assignment requires that a restored database never be left with an unnormalised evidence root, and in this case chown would certainly fail after step 4.
   - **Why it is unverified.** Its test T-E15d needs a non-root runner, and here the runner is root. It was skipped in every run here and has never executed. Another uid cannot run the suite either, because `$TMPDIR` is 0700 root.
   - **What the orchestrator should decide.** Keep it, and have T-E15d run on a non-root runner (CI), or ask me to remove it.
   - **Docs.** ADR-0066 residual 11 (SA-ADR74's file, not mine) still says the check is not built. The architect needs to update it if the check is kept.
4. **Shellcheck is BLOCKED** (not installed).
5. **The Arabic summary lines are provisional** until a qualified reviewer checks them (D-243 Q7).

## 5. Open questions and merge instructions

**Open questions:**
- **Q1.** Keep the non-root pre-check of gap 3 (and ask SA to record it in ADR-0066 A3.3/residual 11 "as built"), or remove it? Its messages are in `backup-restore.md` §5 and the step-3 row.
- **Q2.** The ADR-0066 Amendment 3 text (SA-ADR74) says the exact messages are "recorded as built by the next amendment if they differ". As built:
  - a dangling link has its own message (`… is a symbolic link whose target does not exist (…); create the target directory or pass it directly`);
  - a link to a non-directory has its own message (`… is a symbolic link to <t>, which is not a directory`);
  - a non-empty resolved target keeps `the target evidence store is not empty`.

**Merge instructions:**
- No migration, no ordering dependency and no API, OpenAPI or pending-list change.
- Conflicts are possible only with the concurrent SA-ADR74 if it also edited `docs/handover/backup-restore.md`. I saw no change from it there.
- After merge, the orchestrator re-runs the Compose drill (gap 1).
