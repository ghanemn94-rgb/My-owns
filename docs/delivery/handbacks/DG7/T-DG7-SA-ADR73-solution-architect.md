# Handback T-DG7-SA-ADR73 (solution-architect): ADR-0066 Amendment 2 for DO-D13 (F-DG7-1073, F-DG7-1083)

- **Stage:** DG7 (P7), branch `claude/mobily-transformation-platform-dg6-regate`, base `HEAD` `ef91b97d7068206aa4e1f0473b9671d1973b2afa`.
- **Invocation:** `{"kind":"claude-code-cli-session","run_id":"DG7-T-DG7-SA-ADR73-solution-architect-20261124T105910Z-ae2fd628","session_id":"ae2fd628-2618-488b-a75a-bb93dc9a0d20"}`. I checked the assignment file's SHA-256: `5291a9f8…ef87`, which matches.
- **Time:** started 2026-11-24T10:59:20Z and finished about 11:28Z.
- **Two gate systems:** this is an engineering record. It grants no business, Finance or IT approval, and recovery objectives stay IT placeholders.

## 1. Files changed

| File | Purpose |
| --- | --- |
| `docs/architecture/adr/ADR-0066-p7-backup-restore-backup-set-manifest-restore-checks-drill.md` | Adds a dated **Amendment 2** at the end (A2.1 to A2.8). Three one-line italic pointers were added to A1.4 (two) and A1.5 residual 9, as Amendment 1 did. No other existing text was changed. |
| `docs/delivery/handbacks/DG7/T-DG7-SA-ADR73-solution-architect.md` | This handback. |
| `docs/delivery/handbacks/DG7/T-DG7-SA-ADR73-evidence/*` | Check logs (§3). |

I changed no code, no test, no guide, no migration, no OpenAPI and no image lock. No `p7-pending*.ts` entry belongs to this documents-only task.

## 2. Behaviour per requirement / finding

REQ-S19-012 and REQ-S20-019 (A19, the Compose half), F-DG7-1073 (code-security) and F-DG7-1083 (qa):

- **A2.1 records the `backup` service's `/mth/deploy` layout.** It covers:
  - how `MTH_REPO` is derived;
  - the five mounts in a table;
  - why the whole Compose directory is mounted;
  - the preflight refusal before any write (exit 2, label left free);
  - the rg3 defect it fixes;
  - its tests (`backup-compose-layout.vitest.mjs`).
- **A2.2 records step 2 as built.** This is the exact command, with `--user 0:0`, `--cap-add DAC_READ_SEARCH`, `DATABASE_URL_FILE` and `--entrypoint node`. It explains why the capability is needed: `cap_drop: ALL`, and a uid-10001 `0700` store. It also states that `DAC_OVERRIDE` is not granted and that the flags are scoped to this one command.
- **A2.3 records the `copy-out` `DATABASE_URL`/`DATABASE_URL_FILE` rule** (ADR-0011 `<NAME>_FILE`) with its exit-2 cases. It covers `copy-out` only, which I checked against `apps/api/src/cli/transfer-attachments.ts` l.250–275.
- **A2.4 answers DO-D13 Q2: accepted.**
  - `CAP_DAC_READ_SEARCH` for the one-off command is the least privilege that meets both needs (write into a root-owned `0700` set, read a uid-10001 `0700` store) without changing A1.3's ownership model.
  - Six alternatives are judged: uid 10001, `DAC_OVERRIDE`, a store group, staging as 10001, the copy-out in `postgres:18`, and `FOWNER`/`CHOWN`.
  - **I added one disclosed residual that no earlier record mentions (residual 10).** The capability also makes `open_by_handle_at(2)` available. Docker's default seccomp profile gates that call on this capability; this is the "shocker" class. Through the bind mounts, other files on the same host file system could in principle be reached. I accept it as bounded: one fixed pinned command, read-only root file system, `no-new-privileges`, `--rm`, 1.26 s. IT can narrow it with a dedicated file system for the backup root.
- **A2.5 answers DO-D13 Q3: accepted.** The extra read-only Compose files hold no secret value, and only `compose.yaml` and `.env` (as `environment.env`) are copied.
- **A2.6 corrects A1.4's verification status:**
  - rg3 (`bf5bf82a7`) FAILED at C3 with `//deploy/compose/compose.yaml`; C4 to C10 were NOT_RUN.
  - rg3b (`ebe11c378`, rebuilt image) PASSED C0 to C11 in 46.34 s.
  - It states what rg3b proves and does not prove:
    - C4 copied **0 objects**, and there were 0 jobs (F-DG7-1072);
    - ownership was set by the undocumented C9 `chown` (F-DG7-1082);
    - the finish phase printed `cat: …/config.sha: No such file or directory` and `config.files` was empty (F-DG7-1061);
    - no Compose refusal case ran.
- **A2.7 notes the follow-on change assigned to T-DG7-DO-D14** (split-phase config list, Compose restore ownership without an undocumented `chown`, a drill with real objects and jobs). It is stated as not built at this amendment's base, with no rule claimed. It also requires a further amendment of §7 once DO-D14 is merged.
- **A2.8 replaces residual 9** (the Compose half ran, but only the database, audit and snapshot legs carried data) **and adds residual 10** (`open_by_handle_at`).

The reproduction greps of both findings now match. ADR-0066 contains `DAC_READ_SEARCH`, `DATABASE_URL_FILE` and `/mth/deploy` (20 matching lines).

## 3. Checks run (real exit codes; logs in `docs/delivery/handbacks/DG7/T-DG7-SA-ADR73-evidence/`)

Environment: Node v24.21.0, `MTH_PNPM_OFFLINE=1`, offline, no Docker daemon. **The working tree was shared with the concurrently running T-DG7-DO-D14** (see §4 gap 1).

| # | Command | Result |
| --- | --- | --- |
| 01 | `node tools/gates/validate.mjs --historical --stage DG6` | **exit 0** |
| 02 | `pnpm openapi:lint` | **exit 0** |
| 03 | `node tools/release/claims-scan.mjs` | **exit 0** |
| 04 | `node tools/release/secret-scan.mjs --path <ADR-0066>` | **exit 0** |
| 05 | `pnpm lint` | **exit 0** |
| 06 | `pnpm -r typecheck` | **exit 0** |
| 07 | `pnpm test` | **exit 1.** unit-node: 1 failed / 3055 passed. unit-web: 2199 passed. formula: 259 passed, 2 skipped. The one failure is `deploy/scripts/tests/backup-compose-layout.vitest.mjs` › "Compose restore ownership (F-DG7-1072/1082) … the drill never changes an owner itself" (`expected … not to match /\bchown\b/`). This test is in **DO-D14's uncommitted, in-progress diff**, not in mine (`08-foreign-diff-failing-test-file.diff`, `08-git-status-at-test-time.txt`). It is DO-D14's test-first case against a drill script it was still editing. No test reads ADR-0066 (`grep` over `*.mjs`/`*.ts`/`*.js` outside `docs/delivery` finds none). **I report this exit 1 as it is. I could not get a clean `pnpm test` run of HEAD plus only my change in this shared tree.** |
| 09 | `git ls-files -co --exclude-standard -z \| xargs -0 npx prettier --check --ignore-unknown` | **exit 0** (run before this handback existed; re-run after writing it is below) |
| 10 | `tests/qa/support/with-pg.sh npx vitest run --project integration apps/api/test/integration/contract/contract.test.ts` | **exit 0**, 111/111 |
| – | integration tests touched by this task | none (documents only) |
| – | the Compose drill | not run: no Docker daemon here (D-243 Q1), and not in my scope |

Re-run after writing this handback: `npx prettier --check docs/delivery/handbacks/DG7/T-DG7-SA-ADR73-solution-architect.md`. Its result is in `11-prettier-handback.log`.

## 4. Known gaps

1. **`pnpm test` did not exit 0 (check 07).** The assignment says "You run alone", but T-DG7-DO-D14 was launched at the same second (`…20261124T105910Z…`) in the same working tree. Its uncommitted edits to `deploy/scripts/**` and `docs/handover/backup-restore.md` were present while my checks ran. That contradicts the assignment, and I cannot isolate my result in the shared tree without disturbing DO-D14's files. The orchestrator should re-run `pnpm test` on the integrated tree.
2. **The facts in A2.4 residual 10 were not checked online.** They are `open_by_handle_at` gated by `CAP_DAC_READ_SEARCH` in Docker's default seccomp profile, and the "shocker" class. The sandbox is offline, and the ADR says so. Please check them against current official Docker and Linux documentation before the guide cites them.
3. **A2.6 and A2.7 describe DO-D14 as not built.** If DO-D14 merges in the same integration, the ADR then lags its behaviour on restored evidence ownership (§7 step 5) until a further amendment records it (A2.7, last paragraph).
4. **A traceability slip noted by F-DG7-1073 is outside my scope.** `tools/release/secret-allowlist.json` (an SA-ADR72 entry, around l.362) cites `D-285`, which does not exist in `decisions.md`. I did not touch it (no code or config edits).

## 5. Open questions / merge instructions

- **Merge:** documents only. No migration and no ordering constraint. It may conflict textually only with another ADR-0066 edit. DO-D14 does not own the ADR.
- **Q1 (devops-engineer / orchestrator):** should `backup-restore.md` §3.2 ("Why root, and why one capability") add the A2.4 residual and the advice to put the backup root on a dedicated file system? The guide is not mine to edit.
- **Q2 (orchestrator):** after DO-D14 merges, assign the §7 ownership amendment of A2.7 (Amendment 3), with A2.6 restated from DO-D14's drill log.
- **Q3 (orchestrator):** please confirm whether concurrent DO-D14 and SA-ADR73 runs in one tree were intended (gap 1). Future documents-only tasks could run in their own worktree, as the 2026-11-02 ARCH-11 note in `progress.md` already recommends.
