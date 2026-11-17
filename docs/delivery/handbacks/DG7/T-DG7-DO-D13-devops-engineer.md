# Handback T-DG7-DO-D13 (devops-engineer): Compose backup profile fails at phase database

- **Stage:** DG7 (P7), branch `claude/mobily-transformation-platform-dg6-regate`, base `HEAD` `92c134bbcc233c57954fcb71595a47239c979223` (working tree clean apart from this run's own `docs/delivery/runs/…` directory at start).
- **Invocation:** `{"kind":"claude-code-cli-session","run_id":"DG7-T-DG7-DO-D13-devops-engineer-20261117T174656Z-1fa70efc","session_id":"1fa70efc-2542-4b84-8bce-1aa57bcd8678"}`. The assignment file's SHA-256 was checked: `e8dfdefc…572a08`.
- **Time:** started 2026-11-17T17:47:05Z, finished 2026-11-17T18:09Z (about 22 minutes).
- **Environment:** Node v24.21.0; disposable PostgreSQL through `tests/qa/support/with-pg.sh` (the newest `/usr/lib/postgresql/*/bin` on this host); offline. There is **no Docker daemon** (D-243 Q1).
- **Not claimed:** the Compose drill was **not run** here and is **not claimed to pass**. It is the orchestrator's host run (`deploy/scripts/drill/compose-backup-drill.sh`). A local Compose drill is also not evidence of high-availability production readiness.

## Root cause (F-DG7-1031/1051, rg3 step C3)

- **What the script expects.** `deploy/scripts/backup.sh` computes the repository root as `MTH_REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"`. It then reads `$MTH_REPO/deploy/compose/compose.yaml`, `$MTH_REPO/deploy/compose/.env` and `$MTH_REPO/deploy/images.lock.json` for `config/`.
- **What the service mounted.** The `backup` service mounted the script at `/mth/scripts/backup.sh`, which is **one level too shallow**. `/mth/scripts/../..` is `/`, so the script looked for `//deploy/compose/compose.yaml`, while the Compose file was mounted at `/mth/deploy/compose/compose.yaml`. That is exactly the rg3 line `backup: set rg3 failed: the Compose file //deploy/compose/compose.yaml does not exist`.
- **A second, silent effect.** `images.lock.json` was also looked up at `/deploy/images.lock.json`. Its copy is guarded by `[ ! -f … ] ||`, so even with the first defect fixed it would have been left out of `config/` without an error.
- **The failure left a half set behind.** The check ran inside the database phase, *after* the set directory and its `.backup-state` had been created. A failed run therefore blocked its own label on the next attempt (`… already exists; a backup never overwrites a set`).

## Same class of defect in the later steps, read against the container layout

| Step | Finding | Fix |
| --- | --- | --- |
| C4 (§3.2 step 2, copy-out in the app image) | **Defect 1: the database URL never reached the CLI.** The command passes `-e DATABASE_URL_FILE=/run/secrets/database_url` and `--entrypoint node`, which bypasses the image's `mth` dispatcher. But `transfer-attachments` read only `DATABASE_URL` (`apps/api/src/cli/transfer-attachments.ts`, old l.258), so C4 would have stopped with `BLOCKED: transfer-attachments copy-out: DATABASE_URL is not set` (exit 2). | The CLI now reads `DATABASE_URL` or `DATABASE_URL_FILE` through `@mth/config` `readSecretVariable`, the ADR-0011 `<NAME>_FILE` rule. Both forms at once, or an unreadable file, is BLOCKED exit 2, and the message names the variable, never the value. |
| C4 | **Defect 2: root could not read the store.** The step runs as `--user 0:0`, so that it can write into the root-owned `0700` set. But the `api` service has `cap_drop: ["ALL"]`, and the image creates `/var/lib/mth/evidence` as `mth:mth` (uid 10001) with mode `0700` (`deploy/docker/Dockerfile` l.79–81). Root without `CAP_DAC_READ_SEARCH`/`CAP_DAC_OVERRIDE` cannot list or read that directory, so the copy-out would have failed with EACCES on the store. | Both the guide and the drill now add `--cap-add DAC_READ_SEARCH` (read and search only, no `DAC_OVERRIDE`). Root writes into its own set as the owner, which needs no capability. |
| C5 (`--phase finish` on postgres:18) | No path defect. The finish phase does not read the Compose or lock files; it needs only `/backups/<label>`, the secret and the evidence volume (read-only). The service runs as root with Docker's default capabilities, so it can read the 10001-owned store for the retention sets. | none |
| C6 | Host-side `find` as root. No defect. | none |
| C8 (restore.sh in a postgres:18 runner) | The runner mounts the repository at its **own host path** (`-v "$REPO:$REPO:ro"`, `-w "$REPO"`). `restore.sh` sources `backup.sh` from that path, so `MTH_REPO` is the real repository root and `$MTH_REPO/packages/db/src/cli.ts` and `apps/api/src/cli/transfer-attachments.ts` resolve. The backup root is mounted read-only at its own path, and `restore.sh` writes only to `--out /drill-out/restore` and the target store. No defect found. | none |
| C9 (chown in the postgres:18 runner) | Root with default capabilities (`CAP_CHOWN`), on `<dst>_evidence` at `/var/lib/mth/evidence`. No defect found. | none |
| C10 | Host `curl` against the published port. No container path. No defect found. | none |

None of these was run on Docker here: the table is a reading of the files against the container layout, backed by the static and layout tests below.

## 1. Files changed

| File | Purpose |
| --- | --- |
| `deploy/compose/compose.yaml` | `backup` service: the script is mounted at `/mth/deploy/scripts/backup.sh` (repository layout, so `MTH_REPO=/mth`) and the entrypoint follows it. The whole Compose directory is mounted read-only at `/mth/deploy/compose`, so `compose.yaml` and, when present, `.env` are seen. A single-file bind of a missing `.env` would make Docker create a directory. Includes a comment explaining the layout. |
| `deploy/service-list.json` | Regenerated with `node tools/release/service-list.mjs`. The two changed volume strings only. |
| `deploy/scripts/backup.sh` | Preflight (phases `all` and `database`): a missing Compose file or `--env-file` is refused **before anything is written**, with `BLOCKED: the Compose file <f> does not exist (repository root resolved to <MTH_REPO> from <script>; …)` (exit 2). No half set is left, and the label stays free. The later in-phase check is kept as a backstop. |
| `apps/api/src/cli/transfer-attachments.ts` | `copy-out` reads `DATABASE_URL` or `DATABASE_URL_FILE` (`readSecretVariable`). The unset message is unchanged (`DATABASE_URL is not set`). The header comment is updated. |
| `deploy/scripts/drill/compose-backup-drill.sh` | C4 adds `--cap-add DAC_READ_SEARCH`. The step description and header comment explain why. |
| `docs/handover/backup-restore.md` | §3.2 step 2 command gains `--cap-add DAC_READ_SEARCH`. New bullets: why root plus one capability; the `DATABASE_URL_FILE` rule; where the `backup` service finds its files and the preflight refusal; where the run happens (orchestrator's host). |
| `deploy/scripts/tests/backup-compose-layout.vitest.mjs` (new) | 12 Docker-free tests, run in `pnpm test` through the `deploy/scripts/tests/**/*.vitest.mjs` include. They rebuild the `backup` service's repository bind mounts from `compose.yaml` in a temporary "container root", source `backup.sh` there and check that `MTH_REPO` is `/mth` with the Compose file and lock file present. They also cover: the preflight (exit 2, nothing written, against the old `/mth/scripts/` layout); the Dockerfile and `cap_drop` facts; `--cap-add DAC_READ_SEARCH`, `--user 0:0` and `DATABASE_URL_FILE` in both the guide and the drill C4; and the guide and drill using the same flags. |
| `deploy/scripts/tests/backup-restore.test.mjs` | T-E11 (the three-step sequence) now runs the copy-out with `DATABASE_URL_FILE` (a `0600` file, trailing newline) and `DATABASE_URL=""`, as §3.2 step 2 does. That is the behavioural reproduction of C4 defect 1 against real PostgreSQL. |
| `apps/api/test/integration/transfer/attachments.test.ts` | Exit-code test: `DATABASE_URL_FILE` unreadable leads to `BLOCKED: … DATABASE_URL_FILE points to a file that cannot be read`, and both forms set lead to `BLOCKED: … DATABASE_URL and DATABASE_URL_FILE are both set; set only one` (exit 2). T-C16: a second copy-out through `DATABASE_URL_FILE` on the scratch database exits 0 with the same manifest items. |
| `docs/delivery/handbacks/DG7/T-DG7-DO-D13-devops-engineer.md`, `…/T-DG7-DO-D13-evidence/*.log` | This handback and its logs. |

No migration, no API route and no product mutation were added, so the authorization, audit and concurrency rule has nothing new to cover. No `p7-pending*.ts` entry belongs to this task: `grep -l 'DO-D13\|compose-backup' apps/api/test/support/p7-pending*.ts` finds nothing.

## 2. Behaviour per requirement

- **REQ-S19-012 / REQ-S20-019 (A19, Compose half), F-DG7-1031/1051:**
  - Inside the `backup` container, `backup.sh` resolves the repository root to `/mth`, where `compose.yaml`, `.env` (when present) and `images.lock.json` are mounted. `--phase database` no longer fails on the path, and `config/` again gets `images.lock.json` and `environment.env`, as ADR-0066 §3 lists.
  - A wrong layout, or a missing `--compose-file`/`--env-file`, is refused before any write (exit 2).
  - The §3.2 step 2 copy-out has its database URL, through `DATABASE_URL_FILE`, and read access to the 10001-owned store, through `DAC_READ_SEARCH`.
  - **Not verified on Docker. The orchestrator must re-run the drill.**
- **Secrets:** no secret value was added. The URL is still read from the Compose secret file, and the messages name variables only. The secret scans pass (below).

## 3. Checks run (real exit codes; logs in `docs/delivery/handbacks/DG7/T-DG7-DO-D13-evidence/`)

| # | Command | Result |
| --- | --- | --- |
| 01 | `npx vitest run --project unit-node deploy/scripts/tests/backup-compose-layout.vitest.mjs`, first draft, before any fix | exit 1, 9 failed / 3 passed. One of the 9 failures was the test's own YAML merge-key parse (fixed with `{ merge: true }`), so see 03 for the clean before-fix run. |
| 02 | same, after the fix | **exit 0, 12/12 passed** |
| 03 | the final test against the **HEAD** versions of `compose.yaml`, `backup.sh`, the drill, the Dockerfile, the guide and the CLI (`git archive HEAD … \| tar -x` into `$TMPDIR/before`, `npx vitest run --root $TMPDIR/before`; tree deleted afterwards) | **exit 1, 8 failed / 4 passed** (fail before). One failure is `expected '' to be '/mth'`: the root resolved to the container's `/`. |
| 04 | `tests/qa/support/with-pg.sh node --test deploy/scripts/tests/backup-restore.test.mjs` | **exit 0, 18/18 passed** (25 s), including T-E11 with `DATABASE_URL_FILE` |
| 05 | `tests/qa/support/with-pg.sh npx vitest run --project integration apps/api/test/integration/transfer/attachments.test.ts` (re-run after `prettier --write`) | **exit 0, 15/15 passed** (13 s) |
| 06 | `tests/qa/support/with-pg.sh npx vitest run --project integration apps/api/test/integration/contract/contract.test.ts` | **exit 0, 111/111 passed** (114 s) |
| 07 | `pnpm -r typecheck` | **exit 0** (385 s) |
| 08 | `pnpm lint` | **exit 0** (43 s) |
| 09 | `pnpm openapi:lint` | **exit 0** |
| 10 | `pnpm test` (it includes the new `backup-compose-layout.vitest.mjs` through unit-node) | **exit 0** (413 s): unit-node 208 files / 3054 tests passed; unit-web 131 files / 2199 tests passed; unit-formula-nocodegen 3 files, 259 passed, 2 skipped |
| 11 | `node --test tools/release/tests/service-list.test.mjs`; `node tools/release/service-list.mjs --check` | **exit 0 (7/7)**; **check exit 0** |
| 12 | `node tools/release/secret-scan.mjs` (payload scope) | **exit 0**: `secret-scan: PASS (payload; 3160 files; allowed 33; canary (documented) 22)` |
| 13 | `node tools/release/secret-scan.mjs --path <the 9 changed files>` | **exit 0**: `PASS (path; 9 files; allowed 0; …)` |
| 14 | `node tools/release/claims-scan.mjs` | **exit 0**: `PASS (891 files; …)` |
| 15 | `node tools/release/check-handover.mjs` | **exit 2 (BLOCKED)**: index, deployment, summaries, security-links and **guides PASS**. `generated` is BLOCKED because no `--protocol-audit` report was given; that input is the orchestrator's and has nothing to do with this change. |
| 16 | `git ls-files -co --exclude-standard -z \| xargs -0 npx prettier --check --ignore-unknown` | first run **exit 123** (`attachments.test.ts`). After `prettier --write` on that file and writing this handback, re-run: **exit 0** (93 s) |
| 17 | `node tools/gates/validate.mjs --historical --stage DG6` | **exit 0**: `PASS gate DG6 (historical)` |
| – | `bash -n deploy/scripts/backup.sh deploy/scripts/drill/compose-backup-drill.sh` | exit 0 |
| – | `shellcheck` | **BLOCKED**: not installed on this host |
| – | `deploy/scripts/drill/compose-backup-drill.sh` | **BLOCKED / NOT RUN**: no Docker daemon (D-243 Q1) |
| – | `secret-scan.mjs --scope history` | not run (not required by the assignment) |

SHA-256 after the change:

| File | SHA-256 |
| --- | --- |
| `deploy/compose/compose.yaml` | `91d8aa5d97f515ea0c3ca27671c09ab63307922aad63aa173013b6a5638ed394` |
| `deploy/scripts/backup.sh` | `f93ad333cabc6cd7343006393b2019df0e1820d4d07138257046dbcd1fea4580` |
| `deploy/scripts/drill/compose-backup-drill.sh` | `ba78ba1b77cd2227526c11ed41c94f0c30a477f40ed7257c904e22468a70b751` |
| `deploy/scripts/tests/backup-compose-layout.vitest.mjs` | `e64c5e118fc611dfddaea8455583d0afa1598ea2b2f8152fcc9c4d872b78ea70` |

## 4. Known gaps

1. **The drill was not run.** The Compose sequence (C3–C10) was not executed here (no Docker daemon). The fixes are proven only by the Docker-free layout tests, the scripts on a disposable PostgreSQL, and a reading of the container layout. The orchestrator must re-run `compose-backup-drill.sh` with a new label, and the rebuilt app image is needed for the CLI change (`deploy/scripts/build-image.sh`). C4 runs `/app/apps/api/dist/cli/transfer-attachments.js` from the image, so an image built before this change still lacks `DATABASE_URL_FILE` support.
2. **`--cap-add` on `docker compose run` is unverified here.** It is documented for Compose v2 `run`, but I could not check it against the host's Compose v5.6.1. If a Compose version rejects it, the fallback is to read the store as uid 10001 into a directory that uid owns. That would change the set's ownership model and would need an ADR-0066 amendment.
3. **ADR-0066 A1.4 is now incomplete.** It says step 2 runs "as root (`--user 0:0`)" and does not mention `--cap-add DAC_READ_SEARCH` or `DATABASE_URL_FILE`. I did not edit the ADR, which is the architect's. It needs an amendment line.
4. `shellcheck` was not run (not installed).

## 5. Open questions / merge instructions

- **Merge:** no migration and no ordering constraint. `deploy/service-list.json` must stay in step with `compose.yaml` (`node tools/release/service-list.mjs --check`).
- **Q1 (orchestrator):** please rebuild `mth-app:local` from this tree before the next host drill (gap 1).
- **Q2 (solution-architect):** do you accept `CAP_DAC_READ_SEARCH` for the one-off copy-out command as the least privilege (ADR-0066 A1.4 amendment)? The alternative is a store-readable group, which the image does not have today.
- **Q3:** the `backup` service now also mounts the rest of `deploy/compose/` read-only: `db-init/`, `compose.load.yaml` and `compose.no-egress.yaml`, plus `.env`, which holds only `MTH_SECRETS_DIR`. None holds a secret value. Only `compose.yaml` and `.env` are copied into `config/`.
