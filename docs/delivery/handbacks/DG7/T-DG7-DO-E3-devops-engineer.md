# Handback T-DG7-DO-E3: Make the container image build (devops-engineer)

- **Stage:** DG7 (P7 "Independent transfer and release"), BUILDING. Engineering delivery gate only. No product gate G1–G6 and no business, Finance or IT approval is implied or granted.
- **Invocation:** run `DG7-T-DG7-DO-E3-devops-engineer-20261114T171628Z-9266e072`, session `9266e072-e459-478a-ac42-80e49401e556`.
- **Assignment:** `docs/delivery/assignments/DG7/T-DG7-DO-E3.md`, sha256 `99b8188a678edbec78f61c8d7519e90991d8d0a984f1775a0cd0f6611d41fc02` (verified).
- **Base:** branch `claude/mobily-transformation-platform-dg6-regate`, `HEAD` `d6f97420bad71372dabaa528185b62ad8fce681f`, clean apart from this run's own run directory.
- **Time:** start `2026-11-14T17:16:38Z`, end `2026-11-14T17:38:15Z` (about 19 minutes).
- **Environment:** Node v24.21.0 (`/opt/nvm/versions/node/v24.21.0/bin`), `MTH_PNPM_OFFLINE=1`, nested bubblewrap sandbox with `.git` read-only. **No Docker daemon** is reachable from this sandbox (D-243 Q1), so **I did not build an image**: the orchestrator reruns `deploy/scripts/build-image.sh` on its host. The proxy CA bundle was not needed (no network was used).

## 1. Files changed

| File | Purpose |
| --- | --- |
| `deploy/docker/Dockerfile` | Defect (a): `mkdir -p "$PNPM_HOME"` before `corepack enable --install-directory "$PNPM_HOME"` (was the literal `/pnpm`, which does not exist in `node:24-bookworm-slim`: ENOENT). Defect (b): `COPY packages/reporting/package.json` added to the dependency layer, plus a comment that every workspace manifest must be listed and which test enforces it. |
| `.dockerignore` | Defect (c): after `**/*secret*`, re-include `apps/*/src/**/*secret*.ts(x)` and `packages/*/src/**/*secret*.ts(x)` with a comment explaining why. `**/*secret*` still excludes every other secret-named file (e.g. `deploy/compose/secrets/*`), and `*.pem`, `*.key` and `.env*` rules are unchanged. |
| `deploy/scripts/build-image.sh` | Adds four things. (1) `--network MODE` (or `MTH_BUILD_NETWORK`), limited to `default`, `host` or `none`. (2) `--proxy-from-env` (or `MTH_BUILD_PROXY_FROM_ENV=1`): passes each **set** variable among `HTTP_PROXY`, `HTTPS_PROXY`, `NO_PROXY`, `ALL_PROXY` and their lower-case forms as `--build-arg NAME`, with the name only so Docker reads the value from the environment. (3) `--dry-run`: prints the argument vector and exits 0 without Docker. (4) A post-build check that fails if any `*_PROXY` variable is in the image `Env`. It also refuses an option with no value and a missing or empty `--build-ca` file (exit 64). |
| `deploy/scripts/check-dockerfile-context.mjs` (new) | A static checker with a CLI and exported functions; it needs no dependency or Docker. **manifests**: every tracked workspace `package.json` (from the `pnpm-workspace.yaml` globs), plus `package.json`, `pnpm-lock.yaml`, `pnpm-workspace.yaml` and `.npmrc`, is COPYed in the install stage before `pnpm install` and is not excluded by `.dockerignore`. **sources**: no git-tracked file under `apps/*/src` or `packages/*/src` is excluded by `.dockerignore`. **corepack**: `corepack enable --install-directory DIR` runs only after DIR is created by `mkdir -p` or `WORKDIR`. The `.dockerignore` matcher follows moby/patternmatcher `MatchesOrParentMatches`. Exit codes: 0 PASS, 1 FAIL, 2 BLOCKED (input or usage), 3 BLOCKED (git). |
| `deploy/scripts/tests/dockerfile-context.test.mjs` (new) | 14 `node --test` cases (§3). |
| `docs/delivery/handbacks/DG7/T-DG7-DO-E3-devops-engineer.md` | This handback. |
| `docs/delivery/handbacks/DG7/T-DG7-DO-E3-evidence/*` | Logs of every check listed in §3, plus `sha256-changed-files.txt`. |

The Dockerfile fixes match the orchestrator's probe (`test-evidence/DG7/orchestrator/host/image-build-probe.diff`, which built with exit 0) except in two ways. First, `mkdir` uses `"$PNPM_HOME"` rather than the literal path, so the directory and `ENV PNPM_HOME` cannot drift apart. Second, the `.dockerignore` exceptions also cover `.tsx`.

## 2. Behaviour delivered

This task has no register ID of its own. It repairs the image build that acceptance check 1 and REQ-S19 image/clean-deployment rows rely on (ADR-0011; host-run step 03).

- **Defect (a), corepack ENOENT:** fixed in the Dockerfile. `checkCorepack` reports the pre-fix form: `Dockerfile line 44 (stage build): corepack enable --install-directory /pnpm runs before /pnpm is created`.
- **Defect (b), missing workspace manifest:** fixed. `checkManifests` derives the required list from git-tracked files and the workspace globs: 12 inputs, including all 8 workspace manifests. It fails if one is missing, if one is COPYed only after `pnpm install`, or if `.dockerignore` excludes one. This means a ninth workspace package added later without a COPY line fails the test.
- **Defect (c), `.dockerignore` dropping sources:** fixed. `checkSources` checks all 1,579 tracked files under `apps/*/src` and `packages/*/src`. On the pre-fix `.dockerignore` it reports 8 files: `apps/worker/src/secrets.ts` and `secrets.test.ts`, `apps/api/src/modules/platform/secrets.ts`, `secrets.test.ts`, `secrets-registry.test.ts` and `secret-namespace.ts`, `apps/api/src/modules/integrations/secret-refs.ts`, and `apps/api/src/modules/access/secret-refusals.ts`. On the fixed file it reports none. A test also asserts that local secrets, keys, `.env*`, `.git`, `docs/delivery/**` (except `requirements.csv`) and `trading_agent/` stay **excluded**.
- **Build networking and proxy pass-through:** opt-in only. With neither option, the argument vector has no `--network` and no proxy build arg, even when proxy variables are set. Proxy **values never appear** on the command line, in the script's output (a test asserts this with a planted value assembled from fragments) or in the image. The Dockerfile declares no proxy `ARG`/`ENV`, and Docker's predefined proxy args are not persisted in the image config or history. The post-build check enforces "no `*_PROXY` in the image `Env`" on every real build. The build-time CA secret behaviour is unchanged, and the runtime image still never needs it.

**Not claimed:** that the image builds. That needs the orchestrator's host rerun. A local or Compose build would not prove high-availability production readiness either.

## 3. Checks actually run

Every command below ran in `/home/user/My-owns` with `PATH=/opt/nvm/versions/node/v24.21.0/bin:$PATH`. Logs are in `docs/delivery/handbacks/DG7/T-DG7-DO-E3-evidence/`.

| # | Command | Result | Log |
| --- | --- | --- | --- |
| 1 | `node tools/gates/validate.mjs --historical --stage DG6` (before implementing) | exit 0, `PASS gate DG6 (historical)` | `validate-historical-DG6-before.log` |
| 2 | `node --test deploy/scripts/tests/dockerfile-context.test.mjs` | exit 0, tests 14, pass 14, fail 0 | `dockerfile-context.test.log` |
| 3 | `node deploy/scripts/check-dockerfile-context.mjs` (fixed tree) | exit 0, `12 install inputs …; 1579 tracked source files; 0 problem(s)`, `RESULT: PASS` | (the test's first case runs it; output reproduced in §2) |
| 4 | Same CLI with `Dockerfile` and `.dockerignore` temporarily replaced by `git show HEAD:…`, then restored by `cp` (restoration verified with `git diff --stat`) | **exit 1**, 10 FAIL lines: 1 manifest, 8 sources, 1 corepack | `check-on-prefix-HEAD.log` |
| 5 | Row 2's test against the same pre-fix files | **exit 1**, pass 7, fail 7 (every defect case fails) | `test-on-prefix-HEAD.log` |
| 6 | `bash deploy/scripts/build-image.sh --network host --proxy-from-env --dry-run --node-image node:24` (proxy vars set) | exit 0; argv carries `--network host` and `--build-arg NAME` with no values | in the test cases |
| 7 | `pnpm lint` | exit 0 | `lint.log` |
| 8 | `pnpm openapi:lint` | exit 0, `PASS … 965 operations` | `openapi-lint.log` |
| 9 | `pnpm -r typecheck` | exit 0 | `typecheck.log` |
| 10 | `pnpm test` | exit 0: unit-node 205 files / 3022 tests passed; unit-web 130 / 2175 passed; unit-formula-nocodegen 3 / 259 passed, 2 skipped (pre-existing skips in `packages/shared/src/formula/fuzz.test.ts`) | `pnpm-test.log` |
| 11 | `QA_PG_PORT=27463 tests/qa/support/with-pg.sh npx vitest run --project integration apps/api/test/integration/contract/contract.test.ts` | exit 0: 1 file, 111/111 tests passed (PostgreSQL 16.15 disposable cluster, 135 migrations, duration 110 s) | `contract-test-with-pg.log` |
| 12 | `git ls-files -co --exclude-standard -z \| xargs -0 npx prettier --check --ignore-unknown` | exit 0, `All matched files use Prettier code style!` (rerun after this handback was written) | `prettier-check.log` |
| 13 | `node tools/release/secret-scan.mjs --path` over the 5 changed or new files | exit 0, `PASS (path; 5 files; allowed 0)` | `secret-scan-changed.log` |
| 14 | `node --test deploy/scripts/tests/{pin-images,check-ci-needs,check-virtual-store,log-scan}.test.mjs` | **exit 1**: 79 tests, 78 pass, **1 fail (pin-images C2, pre-existing; §4)** | `deploy-node-tests.log` |
| 15 | pin-images C2 with the HEAD Dockerfile restored (`--test-name-pattern=C2`) | **exit 1**, the same `10 !== 9` | `pin-images-C2-at-HEAD-dockerfile.log` |
| 16 | `node tools/gates/validate.mjs --historical --stage DG6` (end) | exit 0, `PASS gate DG6 (historical)` | `validate-historical-DG6-end.log` |
| — | `deploy/scripts/build-image.sh` (a real image build) | **BLOCKED**: no Docker daemon in this sandbox (D-243 Q1). The orchestrator reruns it. | — |

Final checksums of the changed files are in `sha256-changed-files.txt`, recomputed at the end of this run after all formatting.

## 4. Known gaps

1. **No image build was run by me** (BLOCKED, no Docker socket). The three fixes are proven statically, and they match the probe that built with exit 0 on the orchestrator's host. The full `build-image.sh` verification needs the orchestrator's host rerun. That verification includes non-root, entrypoint, no package managers, licences and the new no-`*_PROXY`-in-Env check. `--network host` with `--proxy-from-env` is untested against a real daemon.
2. **Pre-existing failure, not caused by this task:** `deploy/scripts/tests/pin-images.test.mjs` C2 fails with `10 !== 9`, both with my changes and with the HEAD Dockerfile (row 15). Cause: `deploy/compose/compose.yaml` now has three digest-pinned image lines (postgres l.43, keycloak l.139, a second postgres l.258), and C2 still expects "compose 2". The fix belongs to whoever owns that test or the Compose file. I did not touch either.
3. **CI wiring:** I did not add the new test to `deploy/ci/ci.yml` (and its verbatim copy) because I am not this wave's CI owner (work split §2 rule 9). Fragment for the orchestrator: append `deploy/scripts/tests/dockerfile-context.test.mjs` to the `node --test …` line at `deploy/ci/ci.yml` l.246, or add a step `node deploy/scripts/check-dockerfile-context.mjs`.
4. **Docs not updated (not in my file set):** `docs/operations/restricted-network.md` (l.89 lists the `build-image.sh` options) and the Dockerfile header's restricted-network notes could mention `--network` and `--proxy-from-env`. That is for the docs owner. The `pnpm-workspace.yaml` comment still says `packages/reporting` has no `package.json`, which is stale but harmless; I did not edit it.
5. **Sandbox incident, no effect:** while proving row 15, I attempted `git stash push` on my three files. It failed because `.git` is read-only, so nothing was stashed. The `git stash pop` that followed tried the existing `stash@{0}` (`fe-d-partial`) and could not apply it; the entry was kept. Afterwards I verified that `git stash list` still shows `fe-d-partial` and `fe-a-partial`, that `git status` shows only this task's files, and that the diff stats are unchanged. The orchestrator may want to confirm `stash@{0}` is intact (`git stash show stash@{0}`).
6. No `apps/api/test/support/p7-pending*.ts` entry relates to this task, so none was removed. No mutation endpoint, money or rate value, or user-facing string is touched, so authorization, audit, decimal and bilingual rules do not apply.

## 5. Open questions

1. Should `check-dockerfile-context.mjs` run as its own CI step (fast, readable FAIL lines) or only through the test file? I recommend both (see gap 3).
2. Should `build-image.sh` turn on `--proxy-from-env` automatically when a proxy variable is set? I kept it opt-in so that a build never silently depends on a host proxy (restricted-network rule). The orchestrator's host run would pass `--proxy-from-env` (and `--network host` if the proxy listens on loopback).

## Merge instructions

No migrations and no ordering constraints. Expected conflicts: none. The five product or deploy files are disjoint from other open tasks as far as I know. After merging, the orchestrator reruns `deploy/scripts/build-image.sh --tag mth-app:local` on its host (add `--proxy-from-env` if the host build needs the egress proxy) and commits the log as orchestrator evidence.
