# Handback T-DG7-DO-E2: image-bundle follow-ups and the container host run (devops-engineer)

- **Stage:** P7 "Independent transfer and release", gate DG7 (BUILDING). Branch `claude/mobily-transformation-platform-dg6-regate`.
- **Base:** `HEAD` `1e30dda36b537d3dbec77dc8205d55218a22e9df`. At the start the tree was clean apart from two QA handbacks, this run's `runs/` directory and the orchestrator's `test-evidence/DG7/orchestrator/host/` (`00-env.log`, `01-pull.log`), all untracked.
- **Assignment:** `docs/delivery/assignments/DG7/T-DG7-DO-E2.md` (sha256 `9f640588…053df29`, verified).
- **Invocation:** `DG7-T-DG7-DO-E2-devops-engineer-20261114T144656Z-bbb0fb15`, session `bbb0fb15-ab74-41a0-8eff-2fc14133a0f4`.
- **Time:** start `2026-11-14T14:47:07Z`; end `2026-11-14T15:33:51Z` (`date -u`), about 46 minutes.
- **Evidence:** `docs/delivery/handbacks/DG7/T-DG7-DO-E2-evidence/`.

**Summary.**

- **Part 1 is done:** ARCH-R6's follow-ups (a), (b) and (c), plus the `restricted-network.md` line.
- **Part 2, the container host run, is BLOCKED and was not executed.** The daemon the orchestrator started is running, but my sandboxed shell cannot connect to `/var/run/docker.sock`:
  - error: `permission denied while trying to connect to the docker API`;
  - this happens even though the shell is uid 0, mapped to uid 0;
  - the socket is `root:nogroup 0660`.
- The sandbox is the boundary of this run, and I did not try to work around it. Every Docker step of the list failed at its first daemon call, and the logs record each exit.
- The assignment's own text names two of these limits:
  - its "Environment" section still says "No Docker daemon (D-243 Q1)";
  - its write guard forbids `test-evidence/**`, so the requested log location `test-evidence/DG7/orchestrator/host/` is not writable from here (`test -w` says "not writable").

  The logs therefore sit in this handback's evidence directory, with the `do-e2-` prefix.

## 1. Files changed

| File | Purpose |
| --- | --- |
| `deploy/scripts/image-bundle.sh` | **(a)** `load` and `verify` read `docker info` after the tar check and before any id check. They exit 3 with the §B.5 line unless the store is containerd (`DriverStatus` holds `driver-type` `io.containerd.snapshotter.v1`; ADR-0069 A1.2). They log the store either way. **(b)** `save` bundles only the lock images that a Compose file runs (`usedIn` under `deploy/compose/`), plus the app image. It writes the others to the optional `images.json` key `excluded` (`[{lockId, reason}]`, reason `not run by any Compose file (usedIn: <files>)`) and prints them (A1.3). **Fix found on the way:** `mapfile < <(node …) \|\| exit 2` tested `mapfile`'s status, not node's, so an unpinned lock digest was never refused. The node output is now captured first. No temporary file is used, so the script needs no writable `TMPDIR`. The header comment and exit-code list are updated. |
| `deploy/scripts/tests/image-bundle.test.mjs` | **(c)** T-B12 as amended in §B.4. The stub `docker` now answers `info --format` with a configurable driver and `DriverStatus`. The save case expects only the Compose-run images. Four cases are new: `excluded` contents with no save or inspect of an excluded ref; unpinned bundled digest gives exit 2 with no docker call, while an unpinned excluded digest is fine; `load` and `verify` give exit 3 on two classic-store forms (`overlay2`; `overlayfs` with `null` status) with no `load` or `inspect`; the containerd store is reported before the first id check. 13 tests (was 9). |
| `docs/operations/restricted-network.md` | "The four images" becomes the Compose-run set (`postgres`, `keycloak`) plus the app image, three images. The `excluded` key and why `playwright` and `node-runtime` are left out. The containerd-store precondition and its exit 3 line. "What has been shown" now says the store behaviour is the engine's documented model, not confirmed by a run (ADR-0069 residual 8). |
| `docs/delivery/handbacks/DG7/T-DG7-DO-E2-devops-engineer.md` | This handback. |
| `docs/delivery/handbacks/DG7/T-DG7-DO-E2-evidence/**` | Logs (§3). |

There is no product code, API, migration, contract, permission or advisory-lock change. `apps/api/test/support/p7-pending*.ts` holds no DO-E entry, so nothing was removed from it.

**Not mine, present in the tree:** a concurrent run, `DG7-T-DG7-DO-J2-devops-engineer-20261114T144717Z-158a2cd2`, started 21 s after mine and edits the same tree. At 15:34Z, `git status` shows these files as not mine: `deploy/scripts/drill/guide-keys.json`, `packages/db/test/integration/transfer-load.test.ts`, eight modified files under `tools/release/` (`lib/gate-labels.mjs`, `secret-allowlist.json`, `secret-scan.mjs`, `verify-seal.mjs` and three tests plus one fixture under `tests/`), the new `tools/release/gate-labels-acknowledged.json`, and `docs/delivery/handbacks/DG7/T-DG7-DO-J2-evidence/`. I did not touch them. My repo-wide checks (§3) ran on a tree that held some of its in-progress edits. Commit only the files above for this task. `do-e2-my-diff.patch` is my diff alone.

## 2. Behaviour per requirement

| Requirement / clause | Test | Result |
| --- | --- | --- |
| REQ-S19-018 "the image set loads on a host without registry access": script logic, A1.3 image set and `excluded` | T-B12 (stub `docker`) | **PASS**: 13 of 13 |
| same: A1.2 classic store gives exit 3 on `load` and `verify` | T-B12 (stub) | **PASS** |
| same: real save, remove, load, `up --pull never` | §5 host list, steps 1–5 | **BLOCKED**: no daemon access from the sandbox |
| REQ-S16-008 "docker compose up on a clean host" | §5 step 5 | **BLOCKED**: same reason |
| REQ-S19-018 / S01-006: the no-egress Compose run with the test IdP | §5 step 6 | **BLOCKED**: same reason |
| REQ-S16-007 residual: the Keycloak e2e | §5 step 7 (needs step 6's stack) | **BLOCKED**: same reason |
| A19 container drill (p7-work-split §E.7: "the orchestrator runs the container drill") | — | **BLOCKED**: same reason |
| ADR-0069 A1.2 / residual 8: does the containerd store keep the digest after `load`? | §5 steps 3–5 | **Not observed.** D-266 (a) expected this run to answer DO-E Q2 by observation. It does not. |

These items stay release blockers under REQ-S21-003, never passes. Everything here is synthetic. Even when it runs, the Compose host run is one Docker host with registry access, not an air-gapped host (ADR-0069 residual 5) and not evidence of high-availability production readiness.

## 3. Checks run (real exit codes)

Node 24.21.0 (`PATH=/opt/nvm/versions/node/v24.21.0/bin:$PATH`), `MTH_PNPM_OFFLINE=1`, repository root.

| Command | Exit | Result / log |
| --- | --- | --- |
| `docker version`, `docker info`, `id`, `/proc/self/{uid,gid}_map`, `ls -la /var/run/docker.sock`, `test -w …/orchestrator/host` | `docker` **1** | Client 29.9.2. Server: permission denied. uid map `0 0 1`. Socket `root:nogroup 0660`. Orchestrator host dir not writable (`do-e2-environment-facts.txt`). |
| `node tools/gates/validate.mjs --historical --stage DG6` (14:50Z) | 0 | `PASS gate DG6 (historical)` (`validate-historical-DG6-first.log`). **Order:** it ran after implementation had started, not before. |
| `node --test --test-reporter=spec deploy/scripts/tests/image-bundle.test.mjs deploy/scripts/tests/offline-drill.test.mjs` | 0 | 26 of 26 (image-bundle 13, offline-drill 13) (`drill-tests.log`) |
| Host list (§5), each command logged in `do-e2-host-run.log`, `MTH_SECRETS_DIR=$TMPDIR/do-e2-secrets` | see below | |
| — `deploy/scripts/ensure-docker.sh` | **3** | `BLOCKED: /run is read-only here (sandboxed shell)`. It first found no reachable daemon. |
| — `docker info --format '{{.Driver}} {{json .DriverStatus}}'` | **1** | permission denied |
| — `deploy/scripts/init-secrets.sh` | 0 | 3.4 s. 6 secrets, 2 derived URLs and the test IdP certificates in `$TMPDIR`. It also wrote `deploy/compose/.env` (gitignored, `MTH_SECRETS_DIR` only). |
| — `docker compose -f deploy/compose/compose.yaml --profile test-idp pull` | **1** | permission denied |
| — `deploy/scripts/build-image.sh --tag mth-app:local` | **3** | `BLOCKED: no Docker daemon reachable (docker info failed)` |
| — `deploy/scripts/image-bundle.sh save --out $TMPDIR/do-e2-bundle --app-image mth-app:local` | **3** | Printed `excluded node-runtime …` and `excluded playwright …` (the new selection running against the real lock), then `image-bundle: BLOCKED: docker daemon not reachable` |
| — steps rm, load, verify, Compose up/ps/`/readyz`, no-egress run, Keycloak e2e, A19 | **not run** | Each needs the daemon. They were not attempted after the daemon calls above failed. |
| — cleanup `rm -f deploy/compose/.env; rm -rf $TMPDIR/do-e2-secrets $TMPDIR/do-e2-bundle` | 0 | Both gone (`ls` confirms). `docker compose down -v` was not run, because no stack was started. |
| `pnpm openapi:lint` | 0 | 1 s (`openapi-lint.log`) |
| `pnpm lint` | 0 | 86 s (`lint.log`) |
| `pnpm -r typecheck` | 0 | 708 s, under a load average of about 11 from the concurrent run (`typecheck.log`) |
| `pnpm test` (run 1, 15:06Z) | **1** | 721 s, load average about 11. One failure: `apps/api/src/p7-wiring.test.ts` "every guard row is a contract operation…", **timed out at 5 000 ms**, with a vitest `Timeout calling "onTaskUpdate"` RPC error. All other tests passed: 204 + 130 + 3 files, 3021 + 2175 + 259 tests, 2 skipped (`pnpm-test.log`). This is not my file. |
| `npx vitest run --project unit-node apps/api/src/p7-wiring.test.ts` | 0 | 3 of 3. The test that failed took 1 368 ms (`p7-wiring-rerun.log`). |
| `pnpm test` (run 2, 15:20Z) | **0** | 471 s. Files 205 + 130 + 3; tests 3022 + 2175 + 259 passed, 2 skipped (`fuzz.test.ts`, as before) (`pnpm-test-2.log`). The 1-minute load average, sampled every 60 s, ran from 4.41 to 7.99 (`pnpm-test-2-load.log`). |
| `tests/qa/support/with-pg.sh npx vitest run --project integration apps/api/test/integration/contract/contract.test.ts` | 0 | 111 of 111, 107 s (`contract-test.log`) |
| `git ls-files -co --exclude-standard -z \| xargs -0 npx prettier --check --ignore-unknown` | 0 | 132 s, 23 batches, all "All matched files use Prettier code style!", no `[warn]` (`prettier-repo.log`), 15:31Z. This handback held placeholders then; it is re-checked after its last edit (next row). |
| `node tools/gates/validate.mjs --historical --stage DG6` (end) | 0 | `PASS gate DG6 (historical)` (`validate-historical-DG6-end.log`), 2026-11-14T15:33:51Z |
| `npx prettier --check --ignore-unknown` on this handback after its last edit | 0 | "All matched files use Prettier code style!" |

Timings and order are in `checks-summary.log`. No integration test was touched, so the contract test is the only one run on the disposable PostgreSQL.

## 4. Known gaps

1. **The whole container host run is BLOCKED** (§2): image save/remove/load, Compose `up --pull never --wait` with `ps` and `/readyz`, the no-egress run, the Keycloak e2e and the A19 container drill. The cause is the sandbox's refusal of the Docker socket, not the daemon. REQ-S19-018's image clause, REQ-S16-008, the S16-007 residual and A19's container half stay open. ADR-0069 residual 8 (the store behaviour) stays unverified.
2. **The logs are not in `test-evidence/DG7/orchestrator/host/`.** That path is outside my write scope (write guard and sandbox). The orchestrator can copy `do-e2-host-run.log` and `do-e2-environment-facts.txt` if it wants them there.
3. **A1.2 detection rests on the `DriverStatus` key**, as recorded in the orchestrator's `00-env.log` (`driver-type: io.containerd.snapshotter.v1`). It is tested against the stub only. A future engine that renames the key would read as classic and exit 3: a false BLOCKED, never a false pass.
4. **The `save` image-store check is not added.** A1.2 item 4 names `load|verify` only. A bundle saved from a classic-store host is caught at `load` on the target.
5. **The concurrent DO-J2 run** shared this tree and CPU (§1). The repo-wide checks are of the shared tree, and the typecheck and test timings are inflated by it.

## 5. Open questions

- **Q1 (orchestrator):** the host list needs a shell that can open `/var/run/docker.sock`. Either run it yourself outside the agent sandbox, or give a run socket access (a sandbox setting, which is yours and the user's to change, not mine). The exact list is DO-E §5 with these updates:
  1. Before step 1, `export MTH_SECRETS_DIR=<dir outside the repo>; deploy/scripts/init-secrets.sh`.
  2. Step 1 no longer needs `docker pull …playwright…`: the shipped `save` excludes it.
  3. `load` and `verify` now log the store and exit 3 on the classic store.
  4. At the end, `rm -f deploy/compose/.env` and remove the secrets directory.
- **Q2 (orchestrator):** the assignment's "Environment" section ("No Docker daemon", `test-evidence/**` forbidden) contradicts its task text. I followed the observed facts and the write guard.

## Merge instructions

- No migration, contract or API change. Merge the three files of §1, plus this handback and its evidence. Leave DO-J2's files to its own handback.
- `images.json` gains the optional `excluded` key. `mth-image-bundle/1` manifests without it still pass `check_tar`, which ignores the key.
- To add T-B12 to CI, add `deploy/scripts/tests/image-bundle.test.mjs` to the job that runs `transfer-drill.test.mjs` (work-split §2 rule 9). That file is not mine to edit.
