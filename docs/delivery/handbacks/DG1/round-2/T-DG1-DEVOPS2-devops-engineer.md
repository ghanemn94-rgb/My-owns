# Handback T-DG1-DEVOPS2: devops round-2 repairs (devops-engineer)

- **Stage:** P1 / DG1 round-2 repair. **Assignment:** `docs/delivery/assignments/DG1/round-2/T-DG1-DEVOPS2.md`
  (sha256 `c116e3e0…0c2b50e9c7c`, verified before starting).
- **Invocation:** `{"kind":"claude-code-cli-session","run_id":"DG1-T-DG1-DEVOPS2-devops-engineer-20261001T071338Z-940b6cb5","session_id":"940b6cb5-f6d7-4402-a284-ba1fe10b9fe6"}`
- **Base revision:** worktree `/home/user/mth-wt-devops`, branch `dg1r2-devops`, `HEAD` = `868ebb6c44c1b89709234e3db4e8dfd2d7672233`
  (≥ `c433078` as required). Nothing committed by me; all changes are in the worktree for the orchestrator to integrate.
- **Environment (facts):** Linux 6.18.44-fc-v50 x86_64, 4 vCPU; node v22.22.2; pnpm 10.33.0; bubblewrap 0.9.0;
  uid 0; agent sandbox (nested bubblewrap) with **no network** (D-025); PostgreSQL server binaries present (used by
  the clean start). **No Docker daemon was used.** `actionlint` and `shellcheck` are not installed. No `pnpm install`
  was run in the worktree. Scratch work (clones, store copy, assembled trees) lived under the run's `$TMPDIR` only.
- **Scope kept:** only `deploy/**`, `licenses/**` and this handback (plus its evidence directory). `.github/` is
  **read-only** for me (`touch .github/workflows/.probe` → `Read-only file system`), so every CI change is in the
  **staged** `deploy/ci/ci.yml` for the orchestrator to install (see §6).

## 1. Changed files

| File | Purpose |
|---|---|
| `deploy/scripts/assemble-runtime.sh` | **F-DG1-202.** The workspace packages copied into the runtime tree are now **derived** from the `workspace:` production dependencies of `apps/api`, `apps/worker` and `packages/db` (transitively), so `packages/design-tokens` is included. Non-`dist/` export targets are copied (`@mth/design-tokens/tokens.json` → `src/tokens.json`), and a package without production deps (no `node_modules`) is handled. New **module-resolution check**: from every shipped workspace package, every production dependency must resolve (`import.meta.resolve`) and the package's entry module must import. |
| `deploy/scripts/ci-install-deps.sh` (new, +x) | **F-DG1-104.** The single CI install entry point. It checks for bubblewrap, runs a sandbox capability probe, then `tools/deps/install-sandbox.sh frozen`, then re-checks that the lockfile is unchanged. Missing or unusable bubblewrap → **exit 65 BLOCKED**, with no fallback. |
| `deploy/ci/ci.yml` (staged; re-created) | **F-DG1-104:** every job (verify, integration, e2e, images) provisions pnpm as a real binary, installs bubblewrap and installs dependencies only via `deploy/scripts/ci-install-deps.sh`. No Corepack and no plain `pnpm install` remain. The e2e container gets the options bubblewrap needs. **F-DG1-107/104:** the `images` job also runs the deploy self-tests. |
| `deploy/scripts/check-ci-needs.mjs` | **F-DG1-107:** product jobs whose job-level `if:` uses `always()`, `failure()` or `cancelled()` (incl. `!cancelled()`, any case or spacing) are violations. Also flagged: `continue-on-error` on the gate job or its validate step, an `if:` on the validate step, and a validate command that is not exactly `node tools/gates/validate.mjs --pipeline` (e.g. `|| true`). **F-DG1-104:** any install command except the whole-line `deploy/scripts/ci-install-deps.sh` is a violation, and so is running pnpm before it. The workflow path now accepts absolute paths. |
| `deploy/scripts/tests/check-ci-needs.test.mjs` (new) | `node:test` self-test: 4 positive and 18 negative cases (round-1 N1–N5 included). |
| `deploy/scripts/pin-images.mjs` | **F-DG1-108/203:** lock **structure** validation (`scope`, `blockedReason`, digest/verifiedAt consistency). `blockedReason` images are reported **BLOCKED** and `--check` still exits 1. **Completeness** scan: an image referenced in Dockerfile, Compose or CI but missing from the lock or from its `usedIn` fails. Both the staged and installed CI copies are checked and applied. `--resolve [id…]` records the reachable images, sets `blockedReason` from the real error for an unreachable registry, never nulls an existing pin, writes the lock and exits 1. `--apply` pins what has a digest and reports `NOT APPLIED` for the rest. |
| `deploy/scripts/tests/pin-images.test.mjs` (new) | `node:test` self-test (9 cases). It works in temp copies with **test-only placeholder digests** and a **stub `docker`** that fails like the quay.io denial. |
| `deploy/images.lock.json` | Structure: added `scope` (`production` / `test-ci`) and `blockedReason: null` on every image; `$comment` documents both. **All four digests remain `null`**: nothing was resolved or fabricated. |
| `licenses/generate-sbom.mjs` | Container `scope` now comes from the lock's `scope` field instead of hardcoded ids (same result today). `mth:digest-pinned` shows the `blockedReason` when set. |
| `licenses/sbom.cdx.json` | Regenerated (**F-DG1-108 SBOM part**). Only `serialNumber` and `mth:lockfile-sha256` changed (`3c94b771…` → `f199a0e1…`); `inventory.csv` is unchanged. |
| `docs/delivery/handbacks/DG1/round-2/T-DG1-DEVOPS2-evidence/*.log` | Real command output (below). `$TMPDIR` is substituted for the run's private scratch path. |

## 2. Per finding: fix, proof, real output

### F-DG1-202 (High, mandatory): runtime tree omitted `@mth/design-tokens`

**Fix.** The hand-kept list `apps/api apps/worker packages/config packages/db packages/shared` was replaced by the derived
runtime workspace closure. This removes the root cause: the next new workspace dependency cannot be silently dropped.
The layout check now tests **module resolution**, which the old check (`@mth/db`, `pg-boss` only) never did. The Dockerfile
already copies `packages/design-tokens/package.json` for its install layer and runs this script, so it needed no change.

**Proof** (`evidence/assemble-runtime.log`). The same built scratch workspace (fresh clone of HEAD, offline install from a
copy of the local pnpm store, `pnpm -r build` exit 0) was assembled with the old and the new script:

```
# baseline, UNCHANGED script: exit 0, but
$ ls out-base/packages        -> config db shared
$ node -e 'import("./apps/api/dist/server.js")'   (in out-base)
ERR_MODULE_NOT_FOUND Cannot find package '@mth/design-tokens' imported from …/out-base/apps/api/dist/server.js   exit 1

# fixed script: exit 0 (2.91 s)
runtime workspace packages: apps/api apps/worker packages/config packages/db packages/design-tokens packages/shared
virtual store: 129 package directories, all in the shipped set (129 runtime+bundled)
resolve: @mth/api: 18 dependencies resolve; ./dist/index.js imports
resolve: @mth/worker: 7 dependencies resolve; ./dist/index.js imports
resolve: @mth/config: 2 dependencies resolve; ./dist/index.js imports
resolve: @mth/db: 5 dependencies resolve; ./dist/index.js imports
resolve: @mth/design-tokens: 0 dependencies resolve; ./dist/index.js imports
resolve: @mth/shared: 2 dependencies resolve; ./dist/index.js imports
assemble-runtime: OK 129 packages, 100M
$ node -e 'import("./apps/api/dist/server.js")'   (in out-fix)
server.js import OK; exports: JSON_BODY_LIMIT_BYTES,buildServer,defaultWebRoot      exit 0

# negative: the NEW resolution check run against the OLD tree
@mth/api: unresolved: @mth/design-tokens (ERR_MODULE_NOT_FOUND)
layout check failed: apps/api does not resolve its runtime dependencies           exit 1
```

**End-to-end** (`evidence/clean-start-local.log`). This is QA's own reproduction path, the container-free clean start
with the image's layout and entrypoint:
`MTH_PNPM_STORE=$TMPDIR/s/pstore/v10 MTH_PNPM_OFFLINE=1 bash deploy/scripts/clean-start-local.sh --include-worktree --work $TMPDIR/s/cs`
→ exit 0, **`CLEAN START: PASS (total 31.5 s)`**. Step **A3**, which failed in round 1 (`exit 1, expected 78`
with `ERR_MODULE_NOT_FOUND`), now passes (`mth api with AUTH_MODE=dev: exit 78 (expected 78)`). A4 starts api and worker in
production/OIDC and reaches readiness; A5, A6 and B1–B5 pass. Record counts (synthetic data, `mth_dev`): organization 1,
business_unit 4, app_user 6, scoped_assignment 5, transformation 1, audit_event 22, outbox_event 1,
processed_message 1, schema_migration 6.

**Not proven here:** the actual `docker build` of `mth-app` and `mth api` in the container. No Docker daemon was used
(see §4). The assembled tree is the same one the Dockerfile copies (`COPY --from=build /out/app /app`).

### F-DG1-104 (Medium, mandatory): CI installs without the sandboxed installer

**Fix.** In the staged `deploy/ci/ci.yml`, each of the 4 install sites now runs these steps in order:

1. `npm install --global --ignore-scripts "$(node -p '…packageManager.split("+")[0]')"` installs pnpm 10.33.0 as a
   **real binary**. It is not a Corepack shim, because the sandbox clears `HOME`, and a shim would re-download pnpm
   inside the sandbox.
2. It installs bubblewrap. On host runners this is `sudo apt-get install bubblewrap`, plus
   `kernel.apparmor_restrict_unprivileged_userns=0` on the **ephemeral** runner when the knob exists. On Ubuntu 24.04
   that AppArmor restriction blocks unprivileged bwrap.
3. It runs **`deploy/scripts/ci-install-deps.sh`**, which runs `tools/deps/install-sandbox.sh frozen`.

The e2e job runs as root inside the Playwright container, so it uses
`options: --cap-add SYS_ADMIN --security-opt apparmor=unconfined --security-opt seccomp=unconfined --security-opt systempaths=unconfined`.
Docker's default profiles and the masked `/proc` refuse bwrap's mount and pid namespaces otherwise. This relaxation is
scoped to that CI container and documented in the workflow. `check-ci-needs.mjs` now **fails any other install command**
and any line that is not the exact, whole-line installer call (so `ci-install-deps.sh || pnpm install` is rejected).

**Proof** (`evidence/ci-install-deps.log`), on a scratch clone, offline (frozen lockfile + full store copy):

```
ci-install-deps: bubblewrap 0.9.0; sandbox probe OK
ci-install-deps: node v22.22.2; pnpm 10.33.0 at /opt/node22/bin/pnpm
ci-install-deps: lockfile sha256 f199a0e18472519b24d9eaf840ead45e42192d74187e22b6b03e9e8005708dd5
… Progress: resolved 371, reused 371, downloaded 0, added 371, done … Done in 2.3s using pnpm v10.33.0
ci-install-deps: OK (sandboxed, frozen lockfile)          exit 0 (3.12 s); lockfile unchanged
N1 bwrap not on PATH:  ci-install-deps: BLOCKED: bubblewrap (bwrap) is not installed on this runner; refusing an unsandboxed install   exit 65
N2 bwrap unusable:     ci-install-deps: BLOCKED: bubblewrap cannot create its sandbox on this runner: bwrap: No permissions to create new namespace   exit 65
```

N2 uses a stub `bwrap` that prints the kernel refusal; the real bwrap works here. The structural check against the
**currently installed** `.github/workflows/ci.yml` now correctly **fails** with 15 violations (plain
`pnpm install --frozen-lockfile` in verify, integration, e2e and images, and pnpm used without a sandboxed install). The
staged copy passes (`evidence/check-ci-needs.log`).

**Remaining limits, stated plainly:**

- The workflow was **not executed on a GitHub runner** (no access). Whether `ubuntu-24.04` needs the AppArmor sysctl, and
  whether the e2e container options are sufficient, is **BLOCKED (unverified)** until the first CI run. If either is
  insufficient, the install exits 65 or bwrap's own error, and the job fails. It never installs unsandboxed.
- The Dockerfile's `RUN pnpm install --frozen-lockfile` (inside `docker build`) is unchanged. It runs in the BuildKit
  build container: no host filesystem and no CI secrets, with only the optional `build_ca` secret mounted. It is the
  container equivalent the finding allows. It is not the bwrap wrapper, and the register text should say so (see §5).
- `deploy/scripts/clean-start-local.sh` (a local operator script, not CI) still uses plain `pnpm install`. That is out of
  this finding's CI scope and is unchanged.

### F-DG1-107 (Medium): `check-ci-needs.mjs` bypassable by status functions

**Fix.** See the `check-ci-needs.mjs` row in §1. `success()` and plain conditions stay allowed (the implicit success semantics
are kept). The check deliberately fails closed: a status-function name anywhere in a job-level `if:` is rejected.

**Proof** (`evidence/check-ci-needs.log`). The **same mutated workflows** were run through the old checker (from HEAD
`868ebb6`) and the new one:

```
N4 verify: if: always()            | old checker: exit 0: OK …   | new: exit 1: FAIL: job "verify": job-level if: "always()" uses a status function, so it can run after delivery-gates failed
N5 images: if: ${{ !cancelled() }} | old checker: exit 0: OK …   | new: exit 1: FAIL: job "images": … "${{ !cancelled() }}" uses a status function …
N6 integration: if: failure()      | old checker: exit 0: OK …   | new: exit 1: FAIL: job "integration": … "failure()" …
N12 validate step `|| true`        | old checker: exit 0: OK …   | new: exit 1: FAIL: delivery-gates does not run exactly "node tools/gates/validate.mjs --pipeline"
```

`node --test deploy/scripts/tests/check-ci-needs.test.mjs` → **22/22 pass**:

- **Positive:** P0 committed, P1 `success() && …`, P2 a non-status `if:`, P3 step-level `always()`.
- **Negative:**
  - N1–N3: needs and structure.
  - N4–N9: status functions, including `Always ( )` and `success() || failure()`.
  - N10–N13: gate `continue-on-error`, `|| true`, step `if: false`.
  - N14–N18: plain install, missing install, `npm ci`, corepack, `|| pnpm install` fallback.

While writing N18, the self-test caught a hole in my first version: the `|| pnpm install` fallback was accepted. It was
fixed before handback (the whole-line rule). The self-test now runs in the CI `images` job.

### F-DG1-108 / F-DG1-203 (Medium): images job cannot pass (unpinned digests, stale SBOM)

**What I did (no network, so no digest resolved):**

- `--check` stays honest. With the real lock it exits **1** and lists every image `NOT PINNED`. A `blockedReason` image
  prints `BLOCKED … <reason>` and still fails. **No digest was fabricated; `--check` was not made to pass.**
- `--resolve` no longer aborts the whole run on the first unreachable registry. That matters for D-049: in the old code,
  the quay.io denial threw before the lock was written, so the reachable digests were lost. Now it records the reachable
  images, writes `blockedReason` from the **real** error for the unreachable one, keeps any existing pin on a later
  failure, and exits 1. `--apply` pins what has a digest and lists `NOT APPLIED` for the rest.
- `usedIn` and the `ref:tag` strings are now **machine-checked** for completeness. Every `FROM`, `ARG …IMAGE=` and
  `image:` reference in `deploy/docker/*`, `deploy/compose/*.yaml` and both CI copies is either in the lock (with that
  file in `usedIn`) or a `${…}` variable (`FROM ${NODE_IMAGE}`, and `${MTH_APP_IMAGE:-mth-app:local}`, the repository's
  own image). On the current tree, the scan finds **no unlisted image**.
- SBOM regenerated: `node licenses/generate-sbom.mjs --check` → `OK: packages=422 runtime=112 bundled=17 development=293
  containers=4 shipped-without-licence-id=0 lockfile-sha256=f199a0e1…` (was `STALE`, exit 1).

**Proof** (`evidence/pin-images.log`):

```
$ node deploy/scripts/pin-images.mjs --check
NOT PINNED node-runtime (production) node:24-bookworm-slim
NOT PINNED postgres (production) postgres:18
NOT PINNED keycloak (test-ci) quay.io/keycloak/keycloak:26.4
NOT PINNED playwright (test-ci) mcr.microsoft.com/playwright:v1.56.1-noble
FAIL: … (13 problem(s): 4 lock entries + 9 file references incl. the staged ci.yml copy)
exit 1
```

`node --test deploy/scripts/tests/pin-images.test.mjs` → **9/9 pass**:

| Case | What it shows |
|---|---|
| C1 | Committed lock fails honestly. |
| C2 | Apply then check gives exit 0, and only image lines change. |
| C3 | keycloak BLOCKED: apply skips it, and check still fails. |
| C4/C5 | Structural errors are caught. |
| C6 | An unlisted `redis:7` fails. |
| C7 | A missing `usedIn` entry fails. |
| C8 | A digest mismatch fails. |
| C9 | `--resolve` with a stub docker: quay.io gives `CONNECT 403` → BLOCKED with the real message, the 3 others are recorded, exit 1, and a later failure keeps the existing pin. |

A **preview** of the orchestrator's `--apply` diff ran on a scratch copy with **placeholder** digests
(`sha256:111…`, `222…`, `444…`), never written to the real lock. It changes exactly **8 lines**:

- `deploy/docker/Dockerfile` `ARG NODE_IMAGE=` (1);
- `deploy/compose/compose.yaml` `postgres:18` (1);
- `postgres:18` × 2 plus `playwright` × 1 in each CI copy (3 + 3).

keycloak is `NOT APPLIED` (BLOCKED), and `--check` stays at exit 1.

**Image classification (for the orchestrator/IT):**

| id | ref:tag | registry | scope | where |
|---|---|---|---|---|
| node-runtime | `node:24-bookworm-slim` | docker.io | **production** (base of the shipped `mth-app` image) | Dockerfile |
| postgres | `postgres:18` | docker.io | **production** (product DB; Compose and CI services) | compose.yaml, ci.yml × 2 |
| keycloak | `quay.io/keycloak/keycloak:26.4` | **quay.io: denied by this environment's proxy (D-049)** | **test-ci** (test IdP only, Compose profile `test-idp`; production uses Mobily's IdP, ADR-0005) | compose.yaml |
| playwright | `mcr.microsoft.com/playwright:v1.56.1-noble` | mcr.microsoft.com | **test-ci** (CI e2e container) | ci.yml |

**`--resolve` is the orchestrator/IT step (D-049), BLOCKED for me** because agent sandboxes have no network. D-049's text
says the orchestrator "resolved and committed digests" for node, postgres and playwright. **At `868ebb6` the lock still
has all four digests `null`**, so that step is still pending.

## 3. Checks actually run (exact commands, results)

All run in this worktree (or scratch copies under `$TMPDIR`) on the environment above (`evidence/checks.log` and the logs cited).

| # | Command | Result |
|---|---|---|
| 1 | `bash deploy/scripts/assemble-runtime.sh --store-dir $S/pstore/v10 <built ws> <out>`: old vs new | old: exit 0 but `server.js` import `ERR_MODULE_NOT_FOUND`; new: exit 0, 6 packages resolve, import OK; new check on old tree exit 1 |
| 2 | `MTH_PNPM_STORE=… MTH_PNPM_OFFLINE=1 bash deploy/scripts/clean-start-local.sh --include-worktree --work $S/cs` | **PASS**, exit 0, 31.5 s |
| 3 | `npm_config_store_dir=… bash deploy/scripts/ci-install-deps.sh` (scratch clone), plus N1/N2 | exit 0 (3.12 s, lockfile unchanged); N1 → 65; N2 → 65 |
| 4 | `node deploy/scripts/check-ci-needs.mjs deploy/ci/ci.yml` | OK, exit 0 |
| 5 | `node deploy/scripts/check-ci-needs.mjs` (installed `.github` copy, pre-install) | exit 1 (15 FAILs, all F-DG1-104), which is correct |
| 6 | `node --test deploy/scripts/tests/check-ci-needs.test.mjs deploy/scripts/tests/pin-images.test.mjs` | **31/31 pass**, exit 0 |
| 7 | `node deploy/scripts/pin-images.mjs --check` | **exit 1** (4 NOT PINNED, 13 problems), honest, expected until `--resolve` |
| 8 | `node licenses/generate-sbom.mjs --check` | before: STALE exit 1 → after regeneration: OK exit 0 |
| 9 | `node deploy/scripts/generate-env-example.mjs --check` | OK (21 names), exit 0; `.env.example` unchanged |
| 10 | `pnpm lint` | exit 0 |
| 11 | `pnpm openapi:lint` | `PASS docs/api/openapi.yaml: OpenAPI 3.1.1, 33 operations`, exit 0 |
| 12 | `pnpm format:check` | exit 2, **environment only**: `EACCES … CLAUDE.local.md` (the sandbox denies reading untracked host dotfiles in the worktree root); "All matched files use Prettier code style!" |
| 13 | `prettier --check --ignore-unknown` over all 3131 tracked + new files (excluding those unreadable host files and `trading_agent/`) | exit 0 |
| 14 | YAML parse (`yaml` 2.8.1) of `deploy/ci/ci.yml`, `compose.yaml`, `compose.no-egress.yaml` | 0 errors (2 pre-existing warnings in the untouched `compose.no-egress.yaml`) |
| 15 | `bash -n` on `assemble-runtime.sh` and `ci-install-deps.sh` | exit 0 |
| — | `actionlint` / `shellcheck` | **BLOCKED**: not installed |
| — | GitHub Actions execution of the staged workflow | **BLOCKED**: no GitHub runner |
| — | `docker build` / Compose clean start / image `mth api` | **BLOCKED**: no Docker daemon used in this agent sandbox (no network, so `ensure-docker.sh` could not pull images either) |
| — | `pin-images --resolve` | **BLOCKED**: no network (orchestrator/IT step, D-049) |

A local, container-free clean start is not proof of high-availability production readiness.

## 4. Known gaps / not done

1. **Digests are not pinned.** `--check` fails, so the CI `images` job **stays red** until the orchestrator or IT runs
   `--resolve` and `--apply`. Even then, per D-049 it stays red while keycloak is BLOCKED (quay.io denied here). Making
   that step non-blocking is a decision for the orchestrator or user, not mine, and I did not make it.
2. **CI not executed on GitHub** (sandboxed install on `ubuntu-24.04` and in the Playwright container): unverified.
   It fails closed (exit 65 or bwrap error), never unsandboxed.
3. **Image build, Compose and in-container API start: not run** (no Docker). The runtime-tree proof is on the identical
   assembled tree.
4. Pre-existing and harmless: pnpm warns `Failed to create bin … mth-db … dist/cli.js` on install before the build. That
   is existing behaviour, not introduced here.

## 5. Notes for other owners (not in my write scope)

- **Register REQ-DLV-042 / docs:** the wording "invoked … by CI for every dependency install" now holds for **CI job
  installs** once the staged workflow is installed. The Docker build's in-container install and the local
  `clean-start-local.sh` are not bwrap-wrapped. The register or ADR text should say so, or the orchestrator should
  decide whether to wrap them.
- `docs/operations/restricted-network.md` and `docs/operations/README.md` mention `images.lock.json` and pinning. They
  could add the `blockedReason` / `scope` fields and the `--resolve [id…]` partial mode (docs are outside my scope).

## 6. Merge instructions (orchestrator)

1. **Install CI (required for F-DG1-104/107 to take effect):** `cp deploy/ci/ci.yml .github/workflows/ci.yml`. Then
   `node deploy/scripts/check-ci-needs.mjs` must print OK (it currently FAILS on the installed file, by design). Then
   `git rm deploy/ci/ci.yml`, or keep it identical (`pin-images` checks and applies both copies while both exist).
   Changes in the staged file relative to the installed one (`diff` = 75 lines):
   - header comment: status-function rule and the sandboxed-install policy;
   - **verify / integration / images**: `corepack enable` and `pnpm install --frozen-lockfile` are replaced by
     (a) `npm install --global --ignore-scripts pnpm@<packageManager>`, (b) the bubblewrap install with the AppArmor
     userns sysctl when present, and (c) `deploy/scripts/ci-install-deps.sh`;
   - **e2e**: the same steps run as root without sudo, plus `container.options` (SYS_ADMIN,
     apparmor/seccomp/systempaths unconfined);
   - **images**: new step `node --test deploy/scripts/tests/check-ci-needs.test.mjs deploy/scripts/tests/pin-images.test.mjs`;
     the CI-structure step was renamed;
   - `delivery-gates` job, `needs`, image refs, action pins and the push step are **unchanged**.
2. **Pin images (registry access):**
   1. Run `node deploy/scripts/pin-images.mjs --resolve`. Where quay.io is denied, keycloak gets `blockedReason`
      automatically from the real error and the command exits 1. Use `--resolve node-runtime postgres playwright` to
      skip it.
   2. Run `node deploy/scripts/pin-images.mjs --apply` and review the diff: 8 image lines with both CI copies, 5 after
      `git rm` of the staged copy.
   3. Run `node deploy/scripts/pin-images.mjs --check`.
   4. Run `node licenses/generate-sbom.mjs`. The SBOM embeds digests and `blockedReason`, so it must be regenerated in
      the same commit.
3. Keep the executable bit on `deploy/scripts/ci-install-deps.sh` (set: `-rwxr-xr-x`).
4. No migrations, no dependency or lockfile changes, no `apps/**` / `packages/**` changes. No conflicts expected
   outside my paths.

## 7. Checksums (sha256, at handback)

```
62b26252f4796ab0e97a9a3c801307c535ec3824fc323f623978f02e760a3e6e  deploy/images.lock.json
6ebec7d52a9d2fac43c0836ea19b6b457cdf48a3bce521d2d3db195262ee7f76  deploy/scripts/assemble-runtime.sh
fc0dfd9a9c05ce066af6319f5f1f23b78188b897841d9a9c61d18de3e83eb117  deploy/scripts/check-ci-needs.mjs
ecb29a574ab303f750c7ac9912be9c81db7d4f4a49ad3673c8a6801f93de64d3  deploy/scripts/pin-images.mjs
492659cb966b5b8fc3b626f6ed46783b1c90da05c7c9d646a8e39031bcc7a6cd  deploy/scripts/ci-install-deps.sh
ba8d7cf88fc4e9bd24a94debfa15c250fd62bbbae57da602ac13c439c6c3e81d  deploy/scripts/tests/check-ci-needs.test.mjs
c56cb455bb554c7ef6d6f5900e8ed43b4cf3e51ebd0a75f11fd711383442d99d  deploy/scripts/tests/pin-images.test.mjs
1788eb327dfb03727e9cdfabd967dd3358969f6ae838b5038b55ed2bdfb1ad04  deploy/ci/ci.yml
f5c5b4dc4a689a9684e3860d8ebb8281b5d03ef324a5805615ccdb195975a4a8  licenses/generate-sbom.mjs
e57a45a45b343f6caebe458c30a5845a604efcea9c28bc675b819a14342dd8bd  licenses/sbom.cdx.json
```

Engineering note only: this handback grants no business, Finance or IT approval, and it is not a DG1 verdict. Findings
close only through reviewer verification.
