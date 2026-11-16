# Handback T-DG7-DO-E: the offline drill and the image bundle (devops-engineer)

- **Stage:** P7 "Independent transfer and release", gate DG7 (BUILDING). Branch `claude/mobily-transformation-platform-dg6-regate`.
- **Base:** `HEAD` `60e7e8e4c53c7c957ed5d595508280a380610bd5`, clean apart from this run's `runs/` directory.
- **Assignment:** `docs/delivery/assignments/DG7/T-DG7-DO-E.md` (sha256 `d0d51873…123e1e`, verified). Scope: p7-work-split §B.3, ADR-0069 §5–§7, and D-264 (the D9 failure listing and a T-B11 rerun).
- **Invocation:** `DG7-T-DG7-DO-E-devops-engineer-20261113T210813Z-2c513e93`, session `2c513e93-0fea-4ebb-a1aa-4aa002cc5914`.
- **Time:** start `2026-11-13T21:08:23Z`; end `2026-11-13T21:44Z` (`date -u`), about 36 minutes.
- **Evidence:** `docs/delivery/handbacks/DG7/T-DG7-DO-E-evidence/`.

**Disclosure required by the assignment (D-243 Q1).** The orchestrator-host halves need a Docker daemon, and this container has none: Compose up, the image save/remove/load with `up --pull never`, the no-egress Compose run and the Keycloak e2e. In the agent sandbox, `docker info` exits 1 with "permission denied while trying to connect to the docker API at unix:///var/run/docker.sock" (`environment-facts.txt`). These halves are **BLOCKED here, never PASS**. Their command list is in §5.

## 1. Files changed

| File | Purpose |
| --- | --- |
| `deploy/scripts/offline-drill.sh` (new) | ADR-0069 §5. It enters one `bwrap --dev-bind / / --unshare-net` namespace, runs the ADR-0062 §5.1 probe, then runs every `e2e/a02-*.spec.ts` and `e2e/a21-*.spec.ts` in both projects on the stack that each spec's header names. It writes the product's connection log for every Node process, then checks it with `drill/connection-check.mjs` and writes `offline-drill-report.json` (`mth-offline-drill/1`). |
| `deploy/scripts/drill/connection-check.mjs` (new) | Sorts each connection-log line as loopback, socket or outside. On any outside line it fails with the B.5 line `offline-drill: connection outside loopback: <address>:<port> by <process>`. It also fails when the log has no API line, so an empty log is never a pass. |
| `deploy/scripts/image-bundle.sh` (new) | ADR-0069 §6 `save`, `load` and `verify`. `save` writes `images.tar` and `images.json` (`mth-image-bundle/1`). `load` checks the tar's size and SHA-256 **before** any `docker` call, then loads and compares image ids. `verify` runs the checks without loading. The script has no `pull`, `login` or `push` call. Exit codes follow §2 rule 4, with the B.5 lines. |
| `deploy/scripts/tests/image-bundle.test.mjs` (new) | T-B12, with a stub `docker` on `PATH` (9 tests). |
| `deploy/scripts/tests/offline-drill.test.mjs` (new) | T-B13's check on fixture logs, plus the script's BLOCKED, usage and isolation paths (13 tests). |
| `deploy/scripts/drill/unexplained-tables.mjs` (new) | D-264: from a mode 2 reconcile report it lists only the `<table>: <a> added, <c> changed, <m> missing (<basis>)` lines, never the informational `<table>: <n> explaining events` lines. |
| `deploy/scripts/transfer-drill.sh` | D-264: D9's failure listing now comes from `unexplained-tables.mjs`, and each line carries its counts and basis. If no table line is found, one generic D9 line is printed. Nothing else changed. |
| `deploy/scripts/tests/transfer-drill.test.mjs` | D-264: one import line, plus a new `describe` with 4 tests (helper on the DO-D7 run-2 report form, the CLI, and the D9 source wiring). The existing tests are untouched. |
| `docs/operations/restricted-network.md` | The image half: save on a connected host, transfer, `load`, then `up --pull never`; what has and has not been shown; the offline-drill paragraph. Two stale facts in "Images to mirror" are corrected so the text is true for this release: Keycloak `26.4` → `26.8.1` (the lock's tag), and "no digest is recorded" → all four images carry a digest. |
| `docs/delivery/environment.md` | New section "P7 drills: where each one runs (the D-243 Q1 split)": the measured environment facts and one row per drill (agent or orchestrator host, what it needs, where its evidence goes). |
| `docs/delivery/handbacks/DG7/T-DG7-DO-E-devops-engineer.md` | This handback. |
| `docs/delivery/handbacks/DG7/T-DG7-DO-E-evidence/**` | Logs and reports (§3). |

There is no product code change, no migration, no contract change, no permission code and no advisory lock. The `apps/api/test/support/p7-pending*.ts` files hold no DO-E entry, because §B.3 adds no API operation, so nothing was removed from them.

## 2. Behaviour per requirement

| Requirement / clause | Test | Where | Result |
| --- | --- | --- | --- |
| REQ-S19-018 "the lifecycle e2e suite passes with egress blocked" | T-B13 check (`offline-drill.test.mjs`) and the offline run | Agent | **PASS**: run 2, see below |
| REQ-S19-018 "the lifecycle e2e suite passes with egress blocked": the no-egress Compose run | §5 command list | Orchestrator host | **BLOCKED here**: no Docker daemon |
| REQ-S19-018 "the image set loads on a host without registry access": script logic | T-B12 (`image-bundle.test.mjs`, stub `docker`) | Agent | **PASS**: 9 of 9 |
| REQ-S19-018 "the image set loads on a host without registry access": real save, remove, load, `up --pull never` | §5 | Orchestrator host | **BLOCKED here**: no Docker daemon |
| REQ-S01-006 "runs key workflows with outbound public internet disabled" | the offline run (T-B13) | Agent | **PASS**: probe `1.1.1.1:443 ENETUNREACH`, `registry.npmjs.org EAI_AGAIN` |
| REQ-S17-009 residual "the A18 capture is DG7's" (a connection log, not a packet capture) | the offline run's `connection-check.json` | Agent | **PASS**: 279 lines from 6 Node processes, 144 of them from the API; all loopback, 0 socket, 0 outside |
| D-264: the D9 failure names only unexplained tables | `transfer-drill.test.mjs` "D-264" (4 tests); T-B11 rerun | Agent | Helper tests **PASS**. T-B11 rerun **PASS**, D0–D11, new archive sha256 `2f70734e…37e0` (below) |

**Offline drill, run 2 (the result run).**
- Command: `PATH=/opt/nvm/versions/node/v24.21.0/bin:$PATH deploy/scripts/offline-drill.sh --out docs/delivery/handbacks/DG7/T-DG7-DO-E-evidence/offline`.
- Result: exit 0, PASS in 182.9 s (wall time 3 min 3 s).
- The namespace: bubblewrap 0.9.0, Node 24.21.0, PostgreSQL 16.15, Chromium `chromium-1194` from `/opt/pw-browsers`.
- Specs:

  | Spec | chromium-en | chromium-ar | Stack |
  | --- | --- | --- | --- |
  | `a02-demo-labels` | 3 passed | 3 passed | `e2e/support/with-demo-stack.sh` |
  | `a02-demo-users-walkthrough` | 1 passed | 1 passed | demo |
  | `a02-guided-walkthrough` | 1 passed | 1 passed | demo |
  | `a21-no-ai-operation` | 1 passed | 1 passed | demo |
  | `a21-p6-degradation` | 2 passed | 2 passed | `apps/web/e2e/support/with-stack.sh` |

  The demo group took 147.7 s and the plain group 35.0 s. There were 16 tests, none failed or skipped.
- Destinations in the log:
  - `127.0.0.1:25440` (demo PostgreSQL), 171 lines;
  - `127.0.0.1:25450` (plain PostgreSQL), 72 lines;
  - `127.0.0.1:25310` and `:25320` (the APIs), 2 lines each;
  - `localhost:31999` (the fresh-install API of `a21-p6-degradation`), 32 lines.
- Checksums:
  - `offline-drill-report.json`: sha256 `249962bbd11dee792ef85064f66f43e1b2a82b371da19dd4c8760f45a51b33bd`;
  - `connections.ndjson`: sha256 `6553eb56800dc10c018a637552a0c157a00fdbf0c37eea2702afa6d6d792c7b0`.
- Everything is synthetic: demo data and dev sign-in users. A namespace drill is not evidence of high-availability production readiness, and it approves nothing.

**T-B11 rerun after the D-264 change.**
- Command: `PATH=/opt/nvm/versions/node/v24.21.0/bin:$PATH MTH_PNPM_OFFLINE=1 tests/qa/support/with-pg.sh bash docs/delivery/handbacks/DG7/T-DG7-DO-E-evidence/t-b11-driver.sh`. This is DO-D7's driver with only the evidence path changed and the temporary tree removed at the end.
- Result: exit 0 in 4 min 17 s; the drill itself took 227.8 s. Log `t-b11-run.log`, output `transfer/`.
- **New archive:** `mth-transformation-hub-0.1.0-897f85455147.tar.gz`.
  - sha256 **`2f70734e8a23fa98e4ab4ef55e7f1ab814ee50d184b2f63d23a9290a917b37e0`**;
  - 14 432 419 bytes;
  - built from commit `60e7e8e4c` with the demo export (335 tables, 4782 rows, manifest `902875943d998c348047a7880da7ec35c8623ebff5b00361a6e1030d1f48c93e`; seed-demo periods relative to 2026-11-14).
  - As in DO-D2–D7, the drill scripts ran from the working tree, which holds this task's uncommitted D9 change. The archive's `source/` is `HEAD` without it.
- **Steps (s), all PASS with exit 0:**

  | D0 | D1 | D2 | D3 | D4 | D5 | D6 | D7 | D8 | D9 | D10 | D11 |
  | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
  | 153.8 | 8.9 | 1.5 | 0.3 | 5.2 | 9.3 | 2.4 | 2.0 | 35.5 | 7.9 | 0.6 | 0 |

- **D5:** 5006 rows in 335 tables and 2 attachments imported, reconciliation matched, and the `audit_already_present` delta (45 rows) recorded. Package manifest `a160b9c80686f895ff949b7f8bc4581a9fc229943be2a5e14b3246964c4d9eb3`.
- **D9:** `reconcile-d9.json` `matched after use`: 290 tables unchanged, 44 with allowed differences, 216 audit events added. Allowance sha256 `4a8dc9e34e3a8832b94abf5a31f834b327d3198479c41248dda845a834431d98`.
- **Report:** `result: PASS`, `mth-transfer-drill/1`, sha256 `14290c7ba96cdcf80f60fa55998b7882a2ff3b2ccac5f2bc428a3769a1a9aaf6`. Attachment manifest `317eddcd…73c5882`, mapping `51ad8b68…bafa9`.
- **The D9 failure branch did not run**, because the run passed (gap 6).

## 3. Checks run (real exit codes)

All runs used Node 24.21.0 (`PATH=/opt/nvm/versions/node/v24.21.0/bin:$PATH`) unless a row says otherwise.

| Command | Exit | Result / log |
| --- | --- | --- |
| `node --test --test-name-pattern='D-264' deploy/scripts/tests/transfer-drill.test.mjs` (Node 22, before I noticed the PATH) | 0 | 4 of 4 |
| `node --test deploy/scripts/tests/image-bundle.test.mjs deploy/scripts/tests/offline-drill.test.mjs` | 0 | 21 of 21, before the non-empty-`--out` test was added |
| `node --test deploy/scripts/tests/offline-drill.test.mjs` (after the `--out` guard) | 0 | 13 of 13 |
| `deploy/scripts/image-bundle.sh save --out $TMPDIR/ib` (real `docker`, no daemon) | **3** | `image-bundle: BLOCKED: docker daemon not reachable`, as designed |
| Offline drill **run 0** (Node 22.22.0, the default PATH) | unknown | **Not a result.** I tried to stop it when I saw Node 22. `pkill -f offline-drill.sh` killed the outer shell and the log pipe: `offline-run0-aborted-node22.log` stops after 3 passed tests, and my own command exited 143. The inner namespace run kept going and finished its two groups (demo 166.4 s, plain 21.4 s). It wrote them into the `offline/` directory that run 1 was using. Its final exit was never recorded. |
| Offline drill **run 1** (Node 24) | **1** | FAIL: `a21-p6-degradation` threw "BLOCKED: MTH_PORT_POOL ("a-b") is not set" in both projects (`offline-run1.log`). Its directory `offline-run1-mixed/` also holds run 0's writes (4 groups in `groups.ndjson`), so it is not usable evidence. Fixes: the drill now exports `MTH_PORT_POOL` (default `25000-31999`) and refuses a non-empty `--out` (exit 2, tested). |
| Offline drill **run 2** (Node 24) | **0** | **PASS**, §2 (`offline-run2.log`, `offline/`) |
| `node tools/gates/validate.mjs --historical --stage DG6` | 0 | `PASS gate DG6 (historical)` (`validate-historical-DG6-first.log`). **Order:** it ran after implementation had started, not before. |
| `pnpm openapi:lint` | 0 | `PASS docs/api/openapi.yaml: OpenAPI 3.1.1, 965 operations` (`openapi-lint.log`) |
| `pnpm lint` | 0 | 38 s (`lint.log`) |
| `npx prettier --write` on 4 of my files (formatting only) | 0 | `connection-check.mjs` and the three test files |
| T-B11 rerun (§2) | **0** | **PASS** D0–D11 (`t-b11-run.log`, `transfer/`) |
| `tests/qa/support/with-pg.sh node --test --test-reporter=spec deploy/scripts/tests/transfer-drill.test.mjs deploy/scripts/tests/image-bundle.test.mjs deploy/scripts/tests/offline-drill.test.mjs` | **0** | 69 of 69 (transfer-drill 47 = DO-D7's 43 + D-264's 4; image-bundle 9; offline-drill 13), 1 min 51 s (`drill-tests-final.log`) |
| `pnpm -r typecheck` | **0** | 4 min 9 s (`typecheck.log`) |
| `pnpm test` | **0** | 6 min 5 s. Test files: 205 + 130 + 3. Tests: 3022 + 2175 + 259 passed, 2 skipped (`fuzz.test.ts`, as before). The 1-minute load average, sampled every 60 s, ran from 2.71 to 6.66, within the envelope of 8 (`pnpm-test.log`, `pnpm-test-load.log`). |
| `tests/qa/support/with-pg.sh npx vitest run --project integration apps/api/test/integration/contract/contract.test.ts` | **0** | 111 of 111, 1 min 34 s (`contract-test.log`). No other integration test was touched. |
| `git ls-files -co --exclude-standard -z \| xargs -0 npx prettier --check --ignore-unknown` | **0** | 23 batches, all "All matched files use Prettier code style!", no `[warn]` (`prettier-repo.log`). This handback is re-checked after its last edit (next row). |
| `node tools/gates/validate.mjs --historical --stage DG6` (end) | **0** | `PASS gate DG6 (historical)` (`validate-historical-DG6-end.log`), 2026-11-13T21:43:52Z |
| `npx prettier --check --ignore-unknown` on this handback, `environment.md` and `restricted-network.md` after the last edit | **0** | "All matched files use Prettier code style!" |
| `docker info` (the orchestrator halves) | **1** | **BLOCKED**: permission denied on `/var/run/docker.sock` (`environment-facts.txt`). Compose up, image load and the no-egress run were not run. |

## 4. Known gaps

1. **The orchestrator-host halves are BLOCKED here** (no Docker daemon, D-243 Q1): Compose up `--pull never --wait`, the image save/remove/load, the no-egress Compose run and the Keycloak e2e. They need the orchestrator's host (§5). Until then, REQ-S19-018's image clause, REQ-S16-008 and the S16-007 residual stay open. That is a release blocker under REQ-S21-003, never a pass.
2. **The offline drill does not use `ci-e2e-stack.mjs`.** ADR-0069 §5 says the specs run "through `deploy/scripts/ci-e2e-stack.mjs`". That launcher needs an already running PostgreSQL service (`TEST_DATABASE_ADMIN_URL`), which the namespace does not have, and it seeds only `seed-dev`. The A02 specs need `seed-demo`. So the drill uses the stacks the spec headers name, `e2e/support/with-demo-stack.sh` and `apps/web/e2e/support/with-stack.sh`. Both start a disposable cluster and the built API serving the built SPA. The ADR wording should be confirmed or amended (Q1).
3. **The connection log covers Node processes only.** The browser, the PostgreSQL server and the OS are covered by the namespace (the probe), not by the log. The log is not a packet capture. The DNS-port residual of REQ-S17-009 is carried (ADR-0069 residual 7). `connection-check.mjs` still fails a non-loopback host name with a null port.
4. **The "socket" category was not exercised for real.** The stacks run PostgreSQL on `127.0.0.1` TCP with no Unix socket (`pg-port.sh`), so run 2 logged 0 socket lines. A line with host, address and port all null counts as a socket. Fixtures test that, and the `--socket-dir` path.
5. **`image-bundle.sh` was not run against a real daemon.** Not proven here:
   - whether `docker save`/`load` of a `<ref>:<tag>@<digest>` reference keeps the repo digest, so that Compose's digest-pinned `image:` lines resolve under `--pull never`. The classic image store may drop `RepoDigests` on load, while the containerd image store keeps them (Q2);
   - the `mcr.microsoft.com/playwright` image is CI-only, yet `save` bundles it because ADR-0069 §6 says "every image of `images.lock.json`". That adds about 1–2 GB to the bundle (estimate, not measured).
6. **D9's new failure listing is exercised only by its unit tests.** A passing T-B11 does not reach the failure branch. The helper is tested on the exact line forms of DO-D7's run-2 report.
7. **The environment record changed.** The P1 rows of `environment.md` say Docker 29.3.1 and Compose v5.1.1; the client here is 29.9.2 and v5.6.1. I recorded this in the new section and left the P1 rows unchanged.

## 5. Open questions, and the orchestrator's host command list (ADR-0069 §6–§7)

**Q1.** ADR-0069 §5 names `ci-e2e-stack.mjs`, and the drill uses the spec headers' stacks instead (gap 2). Should the ADR be amended to match?
**Q2.** If the orchestrator's host uses the classic image store and `up --pull never` cannot resolve the digest references after `load`, should the bundle re-tag the images, or should the host switch to the containerd store?
**Q3.** Should `save` skip `scope: test-ci` images that Compose never runs (the Playwright image)? ADR-0069 §6 currently says every image.

**Command list for the orchestrator's host** (run from the repository root at the integrated commit). Logs go to `docs/delivery/test-evidence/DG7/orchestrator/`. Record `docker info` (including registry mirrors), every command, its exit status and the timings.

```bash
# 0. environment
deploy/scripts/ensure-docker.sh; docker info; docker version; docker compose version
# 1. images present on the connected host (pull is allowed only here, before save)
docker compose -f deploy/compose/compose.yaml --profile test-idp pull
docker pull mcr.microsoft.com/playwright:v1.56.1-noble@sha256:f1e7e01021efd65dd1a2c56064be399f3e4de00fd021ac561325f2bfbb2b837a   # if Q3 keeps it
deploy/scripts/build-image.sh --tag mth-app:local
# 2. save, then the checksum (ADR-0069 §6)
deploy/scripts/image-bundle.sh save --out "$B" --app-image mth-app:local; sha256sum "$B/images.tar"; cat "$B/images.json"
# 3. remove every bundled image, so nothing can come from the local cache
node -e 'for (const i of require(process.argv[1]).images) console.log(i.name)' "$B/images.json" | xargs docker image rm
# 4. load and verify
deploy/scripts/image-bundle.sh load --from "$B"; deploy/scripts/image-bundle.sh verify --from "$B"
# 5. Compose up on a clean project, no pulls (ADR-0069 §7; REQ-S16-008)
P=mth-dg7-$(date +%s); docker compose -p "$P" -f deploy/compose/compose.yaml up -d --pull never --wait
docker compose -p "$P" -f deploy/compose/compose.yaml ps; curl -s http://127.0.0.1:<api port>/readyz
docker compose -p "$P" -f deploy/compose/compose.yaml down -v
# 6. the no-egress run with the test IdP (the smoke service asserts egress is blocked)
docker compose -p "$P-ne" -f deploy/compose/compose.yaml -f deploy/compose/compose.no-egress.yaml --profile test-idp up -d --pull never --wait
docker compose -p "$P-ne" -f deploy/compose/compose.yaml -f deploy/compose/compose.no-egress.yaml --profile test-idp ps
# 7. the Keycloak e2e (REQ-S16-007 residual), against the stack of step 6
npx playwright test e2e/identity/keycloak-login.spec.ts --workers=1
docker compose -p "$P-ne" -f deploy/compose/compose.yaml -f deploy/compose/compose.no-egress.yaml --profile test-idp down -v
```

The service names, ports and the Keycloak spec's environment come from `compose.yaml` and the spec header, and step 7 needs the spec's own variables. I did not run any of these commands, so they are untested here. The orchestrator's host also loads on a host that otherwise has registry access, which is not a physically air-gapped host (ADR-0069 residual 5). A Compose start is a reproducible install and test configuration, not evidence of high-availability readiness.

## Merge instructions

- No migration, no contract change, and no API change. Merge the files of §1 as they are.
- `deploy/scripts/transfer-drill.sh` and `transfer-drill.test.mjs` are DO-D's files. My changes to them are D9's listing (one block) and one appended `describe` plus one import. Neither conflicts with DO-D7's content at `60e7e8e4c`.
- Nothing is added to CI. If the orchestrator wants the two new `node --test` files in a CI job, add `deploy/scripts/tests/image-bundle.test.mjs` and `deploy/scripts/tests/offline-drill.test.mjs` to the job that runs `transfer-drill.test.mjs` (§2 rule 9). That file is not mine to edit.
