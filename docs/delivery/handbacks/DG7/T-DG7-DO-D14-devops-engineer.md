# Handback T-DG7-DO-D14 (devops-engineer): phased backup manifest and Compose restore ownership/evidence drill

- **Stage:** DG7 (BUILDING). Branch `claude/mobily-transformation-platform-dg6-regate`. Base `HEAD` `ef91b97d7068206aa4e1f0473b9671d1973b2afa`.
- **Invocation:** run `DG7-T-DG7-DO-D14-devops-engineer-20261124T105910Z-8e1697ef`, session `8e1697ef-f909-41e0-b7d1-2ee5b4fc908b`.
- **Time:** started `2026-11-24T10:59:20Z`. Finished at about `11:40Z` (see the end of §3).
- **Findings addressed:** F-DG7-1061, F-DG7-1071, F-DG7-1081 (split-phase `config.files`, plus the stray `cat` error) and F-DG7-1072, F-DG7-1082 (Compose restore ownership, and a drill that moves real evidence and job state).
- **Status:**
  - The code, test and guide repairs are done, and their tests ran and passed.
  - **The Compose drill was NOT run. It is BLOCKED** because this sandbox cannot reach a Docker daemon (§3, check 10). I do not claim a PASS for it.
  - An author never closes their own finding. All five findings stay open for reviewer verification.
- **Approvals:** these are engineering artefacts. They approve nothing: no G1–G6 decision, no Finance or IT approval, and no DG7 decision. All drill and test data is SYNTHETIC.

## 1. Files changed

| File | Purpose |
| --- | --- |
| `deploy/scripts/backup.sh` | **Split-phase listing.** The database phase writes the `config/` listing to the set's `.backup-state/config.sha`, on the shared backup root, instead of the per-process `$WORK` that the EXIT trap removes. **Finish-phase checks.** `--phase finish` first checks three things: the listing exists, it matches `config_sha256`, and it still equals a fresh listing of `config/`. It then writes the listing as `config.files`. Each failure is `backup: set <label> failed: …` (exit 1). **Helper.** New `backup_config_listing()`. |
| `deploy/scripts/restore.sh` | **New option.** `--evidence-owner <uid>:<gid>`. The default is the owner of the existing empty target evidence root, otherwise the account running `restore.sh`. An invalid value is BLOCKED (exit 2). **Step 5.** After the copy-in and the retention copy, step 5 does `chown -R` to that owner when it differs, then sets directories to `0700` and files to `0600`. A failed `chown` gives exit 1 with `restore: check R7 failed: …`. **R7.** R7 now also compares `owner`, `otherOwner` (0) and `groupOrOtherBits` (0). |
| `deploy/scripts/drill/compose-backup-drill.sh` | **C2** also runs `seed-dev`. **New C2b:** a one-off dev-auth API of the app image (`run api`, so uid 10001 with `cap_drop ALL` on the source evidence volume) on `--seed-api-port` (default 28303). In C2b, `journey.mjs --steps signin,uploads` uploads 2 synthetic files and 1 synthetic pg-boss job is queued. The store is then listed as uid 10001 (owner, mode, SHA-256), and C2b needs at least 2 files, all `10001:10001` with `0700`/`0600`. **C4** must copy at least 2 distinct files. **C5** fails on four conditions: any stderr line that is not Compose progress, an empty `config.files`, fewer than 2 evidence files, or no created job. **C9 no longer changes an owner.** It verifies R6 and R7 (`verified` ≥ 2, owner `10001:10001`) and reads and hashes every restored object as uid 10001 in the app image. It compares that (sha256, path) list with the source's, checks owner and modes, and checks that the job is still `created`. **Return codes.** Every multi-command step now returns explicitly. `run_step` calls steps inside `||`, where `set -e` is off, so before this change C7 and C10 ignored a failure of `up --wait` or of the `up to date` grep. |
| `deploy/scripts/tests/backup-restore.test.mjs` | **`run()`** also returns `stderr`. **T-E11** now asserts: empty stderr in both phases; `config.files` equals every file of `config/` with its SHA-256 (non-empty); `config.sha256` is the digest of that listing; `.backup-state` is removed. **New T-E11b:** a missing listing, and a `config/` changed between phases, each give exit 1 and no manifest. **New T-E14:** restored evidence belongs to the root's owner with `0700`/`0600`, and R7's new fields are present. **New T-E14b:** an invalid `--evidence-owner` gives exit 2 and nothing is written. **New T-E14c:** the root restore hands the evidence to uid 10001, and uid 10001 can read it. T-E14c is skipped, with its reason, when uid 10001 cannot be expressed. |
| `deploy/scripts/tests/backup-compose-layout.vitest.mjs` | **New describe block, 2 tests.** The drill has no `chown` in its code. `restore.sh` carries `--evidence-owner` and its `chown`. `backup-restore.md` §5 documents `--evidence-owner` and 10001. The drill seeds uploads and a queued job, and fails on a zero copy-out, an empty `config.files` or fewer than 2 restored files. |
| `docs/handover/backup-restore.md` | **§3.2:** the listing survives between steps, and the new failure lines. **§5:** "Ownership of the restored evidence" (default owner, `--evidence-owner`, root needed, R7) and a "Compose restore" paragraph. **§7 R7:** the ownership fields. **§8:** the extended drill steps, and the disclosure that rg3b moved 0 evidence objects and 0 jobs and carried the `cat` line, and that the extended drill has not been run here. **§10:** test coverage and the T-E14c skip. **Arabic summary:** an ownership bullet (provisional, D-243 Q7). |
| `docs/delivery/handbacks/DG7/T-DG7-DO-D14-devops-engineer.md` | This handback. |
| `docs/delivery/handbacks/DG7/T-DG7-DO-D14-evidence/*.log` | Logs 01–10 (§3). |

**Not changed by me.**

- `docs/architecture/adr/ADR-0066-…md` shows as modified in the worktree. Those are the concurrent solution-architect run's edits (T-DG7-SA-ADR73, Amendment 2). I did not touch the file.
- No `p7-pending*.ts` entry names these findings (`grep` for 1061/1071/1072/1081/1082/DO-D14: no file), so I removed none.
- There is no migration, no OpenAPI change, no new dependency and no new image.

## 2. Behaviour per requirement

**REQ-S19-012 (backup set, ADR-0066 §2). F-DG7-1061, F-DG7-1071, F-DG7-1081.**

- **Same manifest from the split sequence.** A set from `--phase database`, then copy-out in another process, then `--phase finish` now has the same `config` section as a `--phase all` set: `files` is every `config/` file with its SHA-256, and `sha256` is the digest of exactly that listing.
- **No stray error.** Neither phase writes to stderr on success (asserted in T-E11). This removes the stray `cat: …/config.sha: No such file or directory` line.
- **Refusals in the finish phase.** It refuses a set whose listing is missing (`the config/ listing of the database phase is missing from .backup-state`) and a set whose `config/` changed between the phases (`config/ changed after the database phase`). T-E11b covers both.
- **Why `.backup-state/` is safe.** The listing lives in the set's `.backup-state/`. That directory is owner-only, excluded from `files[]`, and removed when the set succeeds. In Compose it is on the shared `MTH_BACKUP_ROOT` bind, so it survives from the database container to the finish container.

**REQ-S19-012 and REQ-S20-019 (A19, restore of evidence). F-DG7-1072, F-DG7-1082.**

- **Owner and modes set by `restore.sh`.** The documented restore now leaves the evidence owned by the account of the API and the worker: by default the owner of the existing empty target root, in Compose uid 10001 of the volume. Directories become `0700` and files `0600`. There is no separate `chown` step, and `backup-restore.md` §5 documents the rule and the option.
- **R7 fails on a wrong owner or mode.** R7 fails if any path has another owner or a group or other bit.
- **The drill seeds real data.** The Compose drill now seeds 2 evidence objects through the API's own write path (uid 10001) and 1 queued job. It fails on a vacuous copy-out, and C9 only verifies ownership, count and hashes as uid 10001.
- **Not demonstrated here.** The Compose behaviour itself is not demonstrated in this run (BLOCKED, §3 check 10). In the sandbox only the same-account case (T-E14) ran. The root-to-10001 case (T-E14c) was skipped, because the user namespace has no mapped uid 10001.

## 3. Checks run (real exit codes)

Environment:

- Node 24.21.0 (`/opt/nvm/versions/node/v24.21.0/bin`), `MTH_PNPM_OFFLINE=1`.
- Running as uid 0 inside the bubblewrap sandbox (user namespace). Linux 6.18.44.
- The disposable PostgreSQL comes from `tests/qa/support/with-pg.sh`.
- Disk: about 8.1 GB free at start.

| # | Command | Exit | Result / tail | Log |
| --- | --- | --- | --- | --- |
| 1 | `QA_PG_PORT=31420 tests/qa/support/with-pg.sh node --test deploy/scripts/tests/backup-restore.test.mjs` | 0 | `tests 22, pass 21, fail 0, skipped 1`. The skip is T-E14c: `not runnable here: chown to 10001:10001 failed (… Invalid argument)`. The first run failed 1 test: my own T-E14 assertion `verified >= 1` was wrong, because the T-E fixture set has 0 attachment rows (only a retention set). I removed that assertion. The test still checks `verified` = the manifest's `entries` and ≥ 2 restored files. | `01-backup-restore-test.log` (final run) |
| 2 | `git ls-files -co --exclude-standard -z \| xargs -0 npx prettier --check --ignore-unknown` | 0 | `All matched files use Prettier code style!` (rerun after this handback: see 11) | `02-prettier.log` |
| 3 | `pnpm -r typecheck` | 0 | | `03-typecheck.log` |
| 4 | `pnpm lint` | 0 | `eslint . --max-warnings=0` | `04-lint.log` |
| 5 | `pnpm openapi:lint` | 0 | `PASS docs/api/openapi.yaml: OpenAPI 3.1.1, 965 operations` | `05-openapi-lint.log` |
| 6 | `npx vitest run --project unit-node deploy/scripts/tests/backup-compose-layout.vitest.mjs` | 0 | `Tests 14 passed (14)`. The first run failed my new no-`chown` test, because a step label contained the word "chown". I relabelled the step and reran. | `06-layout-vitest.log` |
| 7 | `pnpm test` (11:17:33 to 11:26:38 Z) | 0 | `208 files / 3056 tests passed`; `131 / 2199 passed`; `3 / 259 passed, 2 skipped` (pre-existing skips) | `07-pnpm-test.log` |
| 8 | `node tools/gates/validate.mjs --historical --stage DG6` | 0 | `PASS gate DG6 (historical)` | `08-validate-dg6.log` |
| 9 | `QA_PG_PORT=31421 tests/qa/support/with-pg.sh npx vitest run --project integration apps/api/test/integration/contract/contract.test.ts` | see `09-contract-test.log` | The result is in the log's last line (`exit=<n>`). See the note under this table. | `09-contract-test.log` |
| 10 | **Compose drill:** `deploy/scripts/ensure-docker.sh` (with `MTH_DOCKERD_LOG=$TMPDIR/dockerd.log`) and `docker info` | 3 / 1 | **BLOCKED.** `docker info` gives `permission denied while trying to connect to the docker API at unix:///var/run/docker.sock`. `ensure-docker.sh` gives `BLOCKED: /run is read-only here (sandboxed shell); dockerd cannot create its socket`. A daemon of my own under `$TMPDIR` would not have the host's `mth-app:local` and `postgres:18` images, and the sandbox's user namespace cannot map uid 10001 (`chown 10001:10001` gives `Invalid argument`). So `compose-backup-drill.sh` was **not run**. The changed drill is checked only by `bash -n` and the static layout tests (6). | this table |
| 11 | prettier on this handback | see the note under this table | | |

Notes on checks 9 and 11. I wrote this handback while check 9 was still running. I append its final result and the prettier check of this file at the end of this document, under "Final results".

Checksums (sha256) of the changed files at handback:

```text
617475595bb47748a1583cc1759acee3b7e32dd75b5bf7898b27bd0f72b05688  deploy/scripts/backup.sh
29d8344b9775fe7839d70ae0063c4a01d132f541e024250f3d3b3f1f80ef865a  deploy/scripts/restore.sh
e771db25f9f5c77ec72aab7bfc48eac9fd4c4ca2ee4ac6b3f7dd1c4df1f73e60  deploy/scripts/drill/compose-backup-drill.sh
67a9a2b7698ec2b23d0315da87d92ffa93c18c07f417a1423d6398588d2aeae7  deploy/scripts/tests/backup-restore.test.mjs
215164e8ce91516e288380fee66b1977f9bbaa527e19e806512d2e53d636bf02  deploy/scripts/tests/backup-compose-layout.vitest.mjs
e33dcae0df9b63459cb657f37774e91071525ea6132c9476f043e5c41a2cbeda  docs/handover/backup-restore.md
```

## 4. Known gaps / not done

1. **The Compose drill was not run. BLOCKED (check 10).** The assignment asks me to run it on the host's Docker daemon with `nohup dockerd`. In this sandbox `/run` is read-only and the host socket is denied. I did not try to work around the sandbox. The orchestrator, or IT on a host with Docker, must run this command as root and record its log under `docs/delivery/handbacks/DG7/` or the orchestrator's evidence:

   ```bash
   MTH_SECRETS_DIR=<dir from deploy/scripts/init-secrets.sh --dir> MTH_BACKUP_ROOT=<owner-only dir> \
     deploy/scripts/drill/compose-backup-drill.sh --log <file>
   ```

   Until then, F-DG7-1072 and F-DG7-1082 are repaired in code and guide but **not demonstrated** in Compose.
2. **C2b in the app image is untested.** C2b starts the app image's API with `NODE_ENV=development AUTH_MODE=dev` (a one-off `run` with dev auth). That is the same dist code, and `loadConfig` refuses dev auth only with `NODE_ENV=production`. I could not try it against the image. If the production image lacks something the dev-auth path needs, C2b fails loudly: the drill stops there, and every later step is NOT_RUN.
3. **T-E14c (root hands the evidence to uid 10001, and uid 10001 reads it) was skipped here.** The reason is recorded in the test output. It runs on any host where root can `chown` to 10001.
4. **The R7 report shape grew three keys** (`owner`, `otherOwner`, `groupOrOtherBits`). ADR-0066 §7 and §8 still describe the old R7, and A2.7 says an amendment of §7 must record the ownership rule as built. That amendment is the architect's.
5. **No API download in the drill.** C9 reads every object as uid 10001 with `cap_drop ALL`, which are the API's own file permissions. It does not download through the API's HTTP route, because the target runs OIDC auth and has no test IdP in this drill. `/readyz` (C10) is still checked over HTTP.
6. **Other handover documents are unchanged.**
   - `docs/handover/known-limitations.md` is generated from a protocol-audit report (`tools/release/known-limitations.mjs`, F-DG7-956), so I did not hand-edit it.
   - `operator-guide.md` §6 only links to `backup-restore.md`.
   - The D-256 line ("the container half … is the orchestrator's host run") is still true.

## 5. Open questions

1. **Orchestrator.** Run the extended Compose drill (gap 1) on the host, and supersede the rg3b disclosure in `backup-restore.md` §8 with its measured result.
2. **Architect.** Record the ownership rule as built (default owner = the existing root's owner, `--evidence-owner`, R7's extra keys) in the ADR-0066 §7 amendment that A2.7 foresees.
3. **Should a restore run as a non-root account other than the store's owner be refused before step 4?** Today it fails at step 5 (`chown` refused, exit 1) after the database has been restored. A refusal before step 4 would leave the target empty. I kept the current behaviour to stay within ADR-0066's step order.

## Merge instructions

There is no migration and no ordering constraint. The changes touch only `deploy/scripts/**`, its tests and `docs/handover/backup-restore.md`. Expect a conflict only with concurrent edits of `backup-restore.md`. The SA-ADR73 ADR edit is a separate file.

## Final results (appended after the checks below finished)

- **Check 9, contract test:** exit 0. `Test Files 1 passed (1)`, `Tests 111 passed (111)`, on a disposable PostgreSQL 16.15 with 135 migrations applied to a fresh database (11:29:52 Z, 131.99 s). Log: `09-contract-test.log`.
- **Check 11, prettier on this handback:** `npx prettier --check docs/delivery/handbacks/DG7/T-DG7-DO-D14-devops-engineer.md` gives exit 0 (`All matched files use Prettier code style!`). It was rerun after this section was appended (see the final line below).
- **End time:** 2026-11-24T11:32Z (about 33 minutes).
- Full-repository prettier rerun at 11:34Z (after this handback was complete): exit 0 (`02-prettier.log`).
