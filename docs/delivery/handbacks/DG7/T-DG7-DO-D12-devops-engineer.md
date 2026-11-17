# Handback T-DG7-DO-D12 (devops-engineer): backup root symlink handling, DO-D11 Q1/Q2, Compose drill script

- **Stage:** DG7 (BUILDING), branch `claude/mobily-transformation-platform-dg6-regate`.
- **Assignment:** `docs/delivery/assignments/DG7/T-DG7-DO-D12.md`, SHA-256 `0c5f855dc46469b96ba473eacff6bcfd6e7b418a71532f8c5438cfc24941316c` (verified at start).
- **Invocation:** `DG7-T-DG7-DO-D12-devops-engineer-20261117T164920Z-61e390f4`, session `61e390f4-17da-4aae-8c11-ab434c8fecc7`.
- **Start revision:** `faa1154ca9d15e160bf39f5a2a0df575ec1bf133`. During the run the orchestrator committed `90cbc1c3b350ce51a8944d136a7aca34ec214c1e` (D-283, the assignments, findings import). It touches none of my files.
- **Time:** 16:49:31 to about 17:32 UTC on 2026-11-17.
- **Findings:** F-DG7-1053 (REQ-S19-012). It is repaired here, but the finding stays OPEN until a non-author reviewer verifies it.
- **Not the only run:** the assignment says "You run alone", but T-DG7-SA-ADR72 and T-DG7-AN-P7J ran in the same working tree at the same time. ADR-0063, ADR-0066 and the AN-P7J evidence changed during my run. I did not touch them.

## 1. Files changed

| File | Purpose |
| --- | --- |
| `deploy/scripts/backup.sh` | F-DG7-1053: the backup-root check resolves a symbolic link and judges the target's permissions. The new messages are accurate, and the set is written through the resolved path. |
| `deploy/scripts/tests/backup-restore.test.mjs` | Adds T-E13a to T-E13d (five tests). They fail before the fix and pass after it. Also adds the `lstatSync` and `symlinkSync` imports and changes the header to T-E1…T-E13. |
| `deploy/scripts/drill/compose-backup-drill.sh` (new, 0755) | The Compose half of the A19 drill: the three §3.2 commands, then restore into a second new Compose project, then `/readyz` over HTTP. It is prepared only and has **not been run**. |
| `docs/handover/backup-restore.md` | Changes in four places: <br>• §3.3: a new bullet on roots given as symbolic links. <br>• §8: names the drill script, without claiming it has run. <br>• §10: T-E13 added. <br>• Arabic summary: the same symlink rule (provisional, D-243 Q7). |
| `docs/delivery/handbacks/DG7/T-DG7-DO-D12-devops-engineer.md` | This handback. |
| `docs/delivery/handbacks/DG7/T-DG7-DO-D12-evidence/*.log` | Logs 01 to 16, one per check below. |

Checksums of the changed files (after the last edit):

- `48b45e3b21774a0698c17875fa1fca3f924d19e1706f84c91f020c9c931cb7ec` `deploy/scripts/backup.sh`
- `23ecabd56b944fd8ffcdb8f06f0ee20a0f6035afd7e8c7b32d602b4aeaed84b4` `deploy/scripts/drill/compose-backup-drill.sh`
- `59dc3c4eb277962951363e22d4b9fd0168c6220a9f3bc5917360bde38d41621c` `deploy/scripts/tests/backup-restore.test.mjs`
- `64246903126e0e02212c251a1d0ff924927674c6012b3f3d35407956aad68ea0` `docs/handover/backup-restore.md`

All four were re-hashed identically in `17-final-scans.log`.

No pending entry in `apps/api/test/support/p7-pending*.ts` covers this task (grep for backup, symlink and 1053: only BE-G's header). The task adds no mutation, route, migration or user-facing UI string.

## 2. Behaviour per requirement

### REQ-S19-012 / F-DG7-1053: backup root given as a symbolic link

The root check in `backup.sh` `backup_main()` now works as follows.

- **The root is a symbolic link (`[ -L ]`).** The script resolves it with `readlink -e`, which also follows chains of links.
  - **Dangling or unresolvable link:** exit 2 with `BLOCKED: the backup root <link> is a symbolic link whose target does not exist or cannot be resolved (<readlink>); create the target owner-only (install -d -m 0700) or pass an existing directory`. Nothing is created.
  - **Target is not a directory:** exit 2 with `BLOCKED: the backup root <link> is a symbolic link to <target>, which is not a directory`.
  - **Target writable by group or others (`find <target> -maxdepth 0 -perm /022`):** exit 2 with `BLOCKED: the backup root <link> is a symbolic link to <target>, which is writable by group or others; use an owner-only directory (chmod 0700)`. Nothing is written.
  - **Otherwise the link is accepted** and `root` becomes the resolved target. The set is therefore written into the directory that was checked, even if someone re-points the link after the check. The link itself is left unchanged.
- **The root is not a link:** behaviour and messages are unchanged (F-DG7-1012: refuse a non-directory or a group/other-writable root, and create a missing root with mode 0700).
- **Not changed:** Compose. Its bind mount resolves the link on the host, as the finding notes.

Tests (with `tests/qa/support/with-pg.sh`):

| Test | What it proves | Before fix (log 01) | After fix (log 02) |
| --- | --- | --- | --- |
| T-E13a | A link to a 0700 dir, and a chain link→link→0700 dir, are accepted. `--phase database` exits 0, the set is created in the target and is owner-only, and the link stays a link. | FAIL (old message "writable by group or others") | PASS |
| T-E13b ×2 | A link to a 1777 dir and a link to a 0770 dir are refused with exit 2 and the exact new message naming link and target. The target stays empty. | FAIL (old message) | PASS |
| T-E13c | A dangling link is refused with exit 2 and the "target does not exist" message. The target is not created. | FAIL ("is not a directory") | PASS |
| T-E13d | A link to a regular file is refused with exit 2: "symbolic link to …, which is not a directory". | FAIL | PASS |

I re-ran the QA probe from `docs/delivery/test-evidence/DG7/qa/round-2/scripts/backup-root-probe.sh` with the same roots against the working tree (log 03):

- `link-to-700` now passes the root check. It stops later at `DATABASE_URL … is not set`, exactly as `real700` does.
- `link-to-1777` is refused, and the message names the target.
- `shared1777`, `open777` and `afile` are refused as before.
- `grp750` and `real700` pass the root check as before.

The guide (`backup-restore.md` §3.3, and the Arabic summary) states the rule and the exact message.

### Compose drill script (F-DG7-1031/1051 support; REQ-S19-012, REQ-S20-019)

`deploy/scripts/drill/compose-backup-drill.sh --log <file> [--src-project mthbk-src] [--dst-project mthbk-dst] [--src-api-port 28301] [--dst-api-port 28302] [--label <l>] [--keep]` runs these steps, each timed:

| Step | What it does |
| --- | --- |
| C0 | Records the environment facts: date, uname, docker and compose versions, the app and postgres:18 image ids and digests, node, HEAD, the root's mode, and df. |
| C1 | Starts a **new** source project with `up -d --wait`. |
| C2 | Seeds the source with synthetic data (`mth-db seed-demo`). This runs in a one-off container on the pinned postgres:18 image, with the repository and the host's Node mounted read-only. No new image. |
| C3–C5 | The three §3.2 commands **verbatim**. The only addition is `-p <src>`, so the drill never touches the default `mth` installation; the script refuses `mth` as a project name. |
| C6 | Checks the set has no group/other bit. Records the file count and the manifest's SHA-256. |
| C7 | Starts a **second new** project and brings up `db` only, so its `mth` database is empty. The evidence volume is initialized from the app image by a no-op `run` of `api`. |
| C8 | Runs `restore.sh --manifest-sha256 <from the C5 backup line>` in a one-off postgres:18 container on the target's network, so the PostgreSQL 18 client tools match the set's major (D-243 Q14). R8 runs offline here. |
| C9 | Changes the owner of the restored evidence objects to the owner of the evidence root. |
| C10 | Runs `up -d --wait` on the target. Migrate must log "up to date". Then `curl http://127.0.0.1:<dst-port>/readyz` from the host must return HTTP 200 with `"ready"`. |
| C11 | Runs `down -v` on both projects unless `--keep`. Cleanup never changes the result. |

- **Failure handling:** a failed step marks every later step NOT_RUN.
- **Exit codes:** 0 PASS, 1 FAIL, 2 BLOCKED (usage, missing `MTH_SECRETS_DIR`/`MTH_BACKUP_ROOT`, existing project volumes), 3 BLOCKED (no daemon, compose, image, node or curl, or not root).
- **Output:** the log and a `<log>.d/` directory holding `finish.out`, `restore/restore-report.json`, `dst-migrate.log` and `readyz.json`.
- **Not run here:** the only paths exercised in this environment are the preflight refusals (log 04: usage exit 2, project `mth` exit 2, port 80 exit 2, no Docker daemon exit 3). **No Compose step has been run.** The orchestrator runs it on its Docker host (D-283).

## 3. Checks run (Node 24.21.0, `MTH_PNPM_OFFLINE=1`, agent sandbox, no Docker daemon)

| # | Command | Result |
| --- | --- | --- |
| 01 | `tests/qa/support/with-pg.sh node --test --test-name-pattern "T-E13" deploy/scripts/tests/backup-restore.test.mjs` (before the fix) | exit 1; 5 tests, 0 pass, 5 fail (expected: fail before) |
| 02 | same command, after the fix | exit 0; tests 5, pass 5, fail 0; 11.6 s |
| 03 | QA probe re-run (no database) | see §2; nothing is written under any root |
| 04 | `compose-backup-drill.sh` preflight (usage; `--src-project mth`; `--dst-api-port 80`; no Docker daemon) | exit 2, 2, 2, 3 as designed |
| 05 | `tests/qa/support/with-pg.sh node --test deploy/scripts/tests/backup-restore.test.mjs` (full file, disposable PostgreSQL 16) | exit 0; tests 18, pass 18, fail 0; real 32.5 s |
| 06 | `node tools/release/secret-scan.mjs --scope payload` | exit 0: `secret-scan: PASS (payload; 3159 files; allowed 33; canary (documented) 22)` |
| 07 | `node tools/release/secret-scan.mjs --path <the 4 changed files> --path <evidence dir>` | exit 0: `PASS (path; 11 files; allowed 0 …)`. Re-run at the end over the handback, the script and the evidence: see 17. |
| 08 | `node tools/release/claims-scan.mjs` | exit 0: `PASS (891 files; …)` |
| 09 | `node tools/release/check-handover.mjs` | exit 2, **BLOCKED** (no `--protocol-audit` report given) |
| 09b | `protocol-audit.mjs --all --json $TMPDIR/pa.json`, then `check-handover.mjs --protocol-audit $TMPDIR/pa.json` | exit 1, **FAIL**: index, deployment, summaries, security-links and guides PASS; `generated` FAIL. `--write` showed that the only difference is the report-identity line of `known-limitations.md` (report head and SHA-256, now `90cbc1c3…`). I restored the file unchanged; regeneration at freeze belongs to the orchestrator. The warning that `backup-restore.md`'s Arabic section lacks the H.3 line under its heading is pre-existing: the line sits at the end of the file. |
| 10 | `node --test tools/release/tests/*.test.mjs licenses/tests/*.test.mjs` | exit 1: tests 479, pass 475, **fail 2**, skipped 2 (T-A11 BLOCKED: no runtime tree; 28 min). Both failures come from the environment, not this change: **T-A5** pnpm `EROFS … symlink … /root/.local/share/pnpm/store/v10/projects/…` (HOME, and so the pnpm store, is read-only in this sandbox); **T-M2 (end)** `git status` changed during the rehearsal because SA-ADR72 (ADR-0066) and AN-P7J (its evidence files) wrote to the shared tree at the same time. **Neither is a pass.** Re-run them on a quiet tree with a writable store. |
| 11 | `pnpm -r typecheck` | exit 0 (8 min 17 s) |
| 12 | `pnpm openapi:lint` | exit 0: `PASS docs/api/openapi.yaml: OpenAPI 3.1.1, 965 operations` |
| 13 | `node tools/gates/validate.mjs --historical --stage DG6` | exit 0: `PASS gate DG6 (historical)` (210 s) |
| 14 | `git ls-files -co --exclude-standard -z \| xargs -0 npx prettier --check --ignore-unknown` | exit 0: "All matched files use Prettier code style!" Run before this handback existed; re-checked in 17. |
| 15 | `pnpm lint` | exit 0 (73 s) |
| 16 | `pnpm test` | exit 0: unit-node 207 files and 3042 tests passed; unit-web 131 files and 2199 tests passed; formula-nocodegen 3 files, 259 passed and 2 skipped (918 s) |
| 17 | final `secret-scan --path` and `prettier --check` over the handback, the script and the evidence | see `17-final-scans.log` |
| – | `shellcheck` | **BLOCKED**: not installed. `bash -n` passes for `backup.sh` and `compose-backup-drill.sh`. |
| – | the Compose drill itself | **NOT RUN / BLOCKED**: no Docker daemon in this sandbox (D-243 Q1) |

No integration test under `apps/api` was touched. The contract test was not re-run, because no API, route or OpenAPI file changed (openapi:lint 12 is exit 0).

## 4. Known gaps / not done

1. **The Compose drill has never run.** These assumptions are untested until the orchestrator runs it:
   - the host's Node binary runs inside the Debian-based postgres:18 image;
   - `restore.sh` and `seed-demo` run from a read-only mount of the repository;
   - `up -d --wait` accepts the one-shot `migrate` service (the guide already uses it);
   - the no-op `run --entrypoint true api` fills the new evidence volume from the image (uid 10001, 0700).

   If a step fails, the log names it and the later steps are NOT_RUN.
2. **The restored evidence files are owned by root after a restore.** `restore.sh` writes the evidence as root (and `transfer-attachments copy-in` uses its default umask), but the API runs as uid 10001. Step C9 of the drill script works around this with `chown -R`. `backup-restore.md` §5 does not say so: see Q3.
3. **Evidence is copied with zero objects.** The synthetic demo has no evidence objects (as in the DO-F demo run), so C4 and C8 copy zero objects unless the orchestrator adds some first. The script records the counts but does not add objects.
4. **Remaining check failures:** release tests T-A5 and T-M2 fail in this environment (see 10), and `check-handover` `generated` FAILs only on the report-identity line (see 09b). `shellcheck` is BLOCKED.
5. **Parent directories are not checked (residual, unchanged by this task).** Only the root itself, or the resolved target, is checked. A group- or world-writable parent of an owner-only root is not detected; this was true before as well. ADR-0066 could state it as a residual.
6. **ADR-0066 does not describe the new symlink rule.** Implementers do not own ADR text, so I did not edit it. See Q2.
7. **`known-limitations.md` is unchanged** (DO-D11's Q3 is still open).

## 5. Open questions, and answers to DO-D11 Q1 and Q2 (F-DG7-1052)

- **DO-D11 Q1: should ADR-0063 get a dated amendment? Yes.** The solution-architect owns it; D-283 assigns it to T-DG7-SA-ADR72, whose edits to ADR-0063 I saw in the tree. The amendment should record:
  - §1.2 S3: the shipped `isI18nKey` rule in `tools/release/secret-scan.mjs` (l.82, l.101) replaces "`[a-z0-9_.]+`". The rule is: at least one separator, each segment at most 20 characters and at most 3 digits. A bare lower-case or hex value is no longer exempt.
  - §5: the 64-hex checksum exemption (l.99) as a residual. A 64-hex secret, such as the output of `openssl rand -hex 32`, passes the scan as a "checksum". The mitigation is the existing rule that secret values live only in runtime files outside the repository (`init-secrets.sh`, SC-13). The scan is a backstop, not the control.
- **DO-D11 Q2: should ADR-0066 §4 list `ownerOnly`? Yes, and §5 (or a new item) should state the backup-time preconditions.** All of these are shipped in `backup.sh` and tested by T-E10 to T-E13:
  - `umask 077`: directories 0700, files 0600, including `--record-out`;
  - the `--phase finish` repair, followed by `ownerOnly`;
  - refusal of a group- or other-writable root;
  - the DO-D12 symlink rule: resolve the link, judge the target, write through the resolved path, refuse a dangling or non-directory target;
  - the required `MTH_BACKUP_ROOT` in Compose with `create_host_path: false`.

  **`backup-restore.md` §7 should not mirror it.** §7 lists the restore checks R1 to R9, which run on the target. `ownerOnly` is a backup-time property of the set, which IT may copy with other ownership. R1, the SHA-256 of every file, already proves integrity at restore. The guide already states the permissions in §3.3.
- **Q3 (new, for the solution-architect and DOC owner):** should `backup-restore.md` §5 tell the Compose operator to align the restored evidence files to the app user (uid 10001)? Or should `restore.sh` take a `--evidence-owner` option? Today the drill script does this itself (C9), and the guide is silent.
- **Q4 (new, orchestrator):** two release tests fail here only because of the environment (T-A5: read-only pnpm store; T-M2: concurrent writers). Please re-run `node --test tools/release/tests/*.test.mjs licenses/tests/*.test.mjs` on the integrated tree, where the store is writable and nothing else is writing.

**Merge instructions:**

- There is no migration and no ordering constraint.
- Commit the five paths in §1 together with the evidence directory.
- Keep the file mode `0755` on `deploy/scripts/drill/compose-backup-drill.sh`.
- `docs/handover/backup-restore.md` may also be edited by SA-ADR72 or AN-P7J. My edits are confined to §3.3 (one bullet), §8 (one sentence), §10 (the T-E13 reference) and one Arabic summary line.
- Then run the drill on the Docker host:

  ```bash
  MTH_SECRETS_DIR=… MTH_BACKUP_ROOT=<0700 dir> deploy/scripts/drill/compose-backup-drill.sh --log <evidence>/compose-drill.log
  ```

  Run it as root, after `deploy/scripts/ensure-docker.sh` and `build-image.sh`.
