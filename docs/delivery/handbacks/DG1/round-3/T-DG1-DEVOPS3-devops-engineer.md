# Handback: T-DG1-DEVOPS3 (devops-engineer, DG1 round-3 repair)

- **Invocation:** `{"kind":"claude-code-cli-session","run_id":"DG1-T-DG1-DEVOPS3-devops-engineer-20261001T090248Z-a12a4aaa","session_id":"a12a4aaa-b0de-47e4-aeb2-1a2a159a70eb"}`
- **Assignment:** `docs/delivery/assignments/DG1/round-3/T-DG1-DEVOPS3.md`. The sha256 `56035c6b…f77160` matched before I started.
- **Base revision:** `HEAD` = `e7a7084f0667794415c87d9b50cbfb1164bab832` (≥ `45d0297`, as required), worktree `/home/user/mth-wt-devops3`.
- **Environment:** node v22.22.2, offline. The Bash sandbox has no network (D-025), and `.github/` is read-only for this role.
- **Scope:** only F-DG1-116 and F-DG1-108/F-DG1-203. I committed nothing; the runner or orchestrator commits.

## 1. Changed files

| File | Purpose |
|---|---|
| `deploy/scripts/check-ci-needs.mjs` | F-DG1-116: fail-closed allow-lists for the gate's execution context. Details are in §2. All F-DG1-107/F-DG1-104 checks are unchanged. |
| `deploy/scripts/tests/check-ci-needs.test.mjs` | Adds 11 negative cases (N19–N29) and 2 positive cases (P4, P5). N19–N22 are the four round-2 vectors verbatim. |
| `deploy/scripts/pin-images.mjs` | F-DG1-108/203: new `--resolve --missing`, which resolves only images whose digest is still null. Pinned images are untouched. If nothing is missing it calls no registry and leaves the lock byte-identical. |
| `deploy/scripts/tests/pin-images.test.mjs` | Adds C10–C13: runner with quay access, runner without quay access, nothing-missing no-op, and the step order in the CI `images` job. |
| `deploy/ci/ci.yml` | `images` job: a new step that runs `--resolve --missing` and then `--apply` before `pin-images --check`, and saves the resolved lock to the `stack-evidence` artifact. The self-test step name is updated. **The orchestrator must install this file; see §5.** |

`deploy/images.lock.json` is **not** changed (sha256 `24c6d17a…7cab`). The committed lock keeps keycloak with `digest: null` and its real `blockedReason`. No digest was fabricated.

## 2. Behaviour delivered

### F-DG1-116 (Low): more ways to weaken the gate step

`check-ci-needs.mjs` now rejects all of the following (fail-closed: any key not on an allow-list is a violation):

- **Workflow level:** any `defaults:` or `env:` block. These reach the validate step through `run.shell`, `run.working-directory`, `NODE_OPTIONS`, `PATH` and similar.
- **`delivery-gates` job keys:** only `name`, `runs-on`, `steps`, `permissions`, `timeout-minutes` and `continue-on-error` are allowed. `continue-on-error` must still be false. This rejects job `env:`, `defaults:`, `container:`, `services:`, `if:`, `strategy:` and so on.
- **`delivery-gates` steps:** only pinned `actions/checkout` / `actions/setup-node` steps (keys `uses`, `with`, `name`, `id`) and the validate step are allowed. No other `run:` step is permitted, which closes the routes of writing `NODE_OPTIONS` to `$GITHUB_ENV` or tampering with the validator before it runs.
- **Any step in any job that runs `tools/gates/validate.mjs`:** only `name`, `id` and `run` are allowed. An `if:` or `continue-on-error` on the gate's validate step still fails with the existing F-DG1-107 messages. This rejects `env:` (e.g. `NODE_OPTIONS=--import=data:...`), `shell:` (e.g. `"true {0}"`) and `working-directory:` (decoy).

Mapping from the round-2 vectors (`25-check-ci-needs-bypass.log`) to the tests:

| Round-2 vector | Test |
|---|---|
| B: validate step with `NODE_OPTIONS` env | N19 |
| C: validate step with `working-directory` | N20 |
| D: validate step with `shell` override | N21 |
| E: workflow `defaults.run.working-directory` | N22 |

Related variants, also accepted by the old checker, are covered by:
- N23: workflow `defaults.run.shell`
- N24: workflow `env`
- N25: gate job `env`
- N26: gate job `defaults`
- N27: `$GITHUB_ENV` pre-step
- N28: `env` on the setup-node step
- N29: validate.mjs with `env` in another job

The positive cases still pass:
- P0: the workflow as committed
- P4: validate step with `id`
- P5: a product job with its own `env`/`defaults`, which is still allowed

### F-DG1-108 / F-DG1-203 (Medium): the CI `images` job and the unpinned test-only keycloak image

New step in the `images` job (staged `deploy/ci/ci.yml`), placed before `pin-images --check`:

```yaml
- name: Resolve and pin images still missing a digest (live registry lookup; test-only keycloak)
  run: |
    node deploy/scripts/pin-images.mjs --resolve --missing
    node deploy/scripts/pin-images.mjs --apply
    mkdir -p stack-evidence
    cp deploy/images.lock.json stack-evidence/images.lock.ci-resolved.json
```

- **Runner that reaches quay.io** (e.g. GitHub-hosted): keycloak is resolved live through `docker buildx imagetools inspect`. The step applies it to the workspace copies, `--check` passes, and the resolved lock goes into the `stack-evidence` artifact so IT can review and commit the pin. Proof: C10, using a stub `docker` that answers for quay.
- **Runner without quay access:** `--resolve --missing` exits 1 and records `blockedReason`, so the job fails (BLOCKED). The digest stays null and `--check` still exits 1. Proof: C11.
- **Already-pinned images** (node, postgres, playwright) are never re-resolved and their `verifiedAt` does not change. C10 deep-compares them; C12 covers the case where nothing is missing.
- `--check` was not relaxed: a null digest still fails (C1, C3, C9, C11).

## 3. Checks actually run (offline, in this worktree)

| # | Command | Result |
|---|---|---|
| 1 | `node --test deploy/scripts/tests/*.test.mjs` | **exit 0**, `# tests 48 # pass 48 # fail 0` (check-ci-needs 35, pin-images 13), duration 3.8 s |
| 2 | **Fail-before:** the new test file run against the HEAD checker (`git show HEAD:deploy/scripts/check-ci-needs.mjs`, in a `$TMPDIR` copy with `apps/api` symlinked for `yaml`) | `# tests 35 # pass 24 # fail 11`. Exactly N19–N29 fail, each with `expected exit 1, got 0` (11×), so the old checker reported OK on every vector |
| 3 | **Fail-before:** C13 before the `deploy/ci/ci.yml` change | `not ok 13 - C13 …`; `# pass 12 # fail 1` |
| 4 | `node deploy/scripts/check-ci-needs.mjs` (default: installed `.github/workflows/ci.yml`) | **exit 0** |
| 5 | `node deploy/scripts/check-ci-needs.mjs deploy/ci/ci.yml` (staged copy) | **exit 0** |
| 6 | `node deploy/scripts/pin-images.mjs --check` | **exit 1** (expected here, D-049 residual; see §4) |
| 7 | YAML validity (`yaml` `parseDocument`) of `deploy/ci/ci.yml` and `.github/workflows/ci.yml` | 0 errors and 0 warnings for both; jobs `delivery-gates,verify,integration,e2e,images` |
| 8 | `node_modules/.bin/prettier --check` on the 5 changed files | exit 0, after `--write` on 3 files (formatting only) |
| 9 | `node_modules/.bin/eslint` on the 4 changed `.mjs` files | exit 0 |

Output of check 4:

```
OK: .github/workflows/ci.yml: 5 jobs; first job delivery-gates runs validate.mjs --pipeline; every other job depends on it with no status-function if:; installs only via ci-install-deps.sh
  verify <- delivery-gates
  integration <- verify
  e2e <- verify
  images <- integration, e2e
EXIT=0
```

Excerpt from check 1 (new cases):

```
N19 validate step: env NODE_OPTIONS=--import=data:...process.exit(0): exit 1: FAIL: delivery-gates step 3: a validate.mjs step must not set env: {"NODE_OPTIONS":"--import=data:text/javascript,process.exit(0)"} (only name/id/run)
N20 validate step: working-directory: decoy: exit 1: FAIL: delivery-gates step 3: a validate.mjs step must not set working-directory: "decoy" (only name/id/run)
N21 validate step: shell: 'true {0}': exit 1: FAIL: delivery-gates step 3: a validate.mjs step must not set shell: "true {0}" (only name/id/run)
N22 workflow-level defaults.run.working-directory: decoy: exit 1: FAIL: workflow-level defaults: is not allowed (it reaches the delivery-gates validate step): {"run":{"working-directory":"decoy"}}
N27 delivery-gates pre-step writes NODE_OPTIONS to $GITHUB_ENV: exit 1: FAIL: delivery-gates step 3: only the validate step may run commands in delivery-gates: ...
ok 10 - C10 runner WITH quay.io: --resolve --missing pins ONLY keycloak, --apply, --check exits 0
ok 11 - C11 runner WITHOUT quay.io: --resolve --missing exits 1, keycloak stays null/BLOCKED, --check still exits 1
ok 12 - C12 nothing missing: --resolve --missing calls no registry, leaves the lock byte-identical, exits 0
ok 13 - C13 CI images job: resolve --missing, then --apply, then --check, in that order
# tests 48
# pass 48
# fail 0
```

Output of check 6:

```
PINNED     node-runtime (production) node:24-bookworm-slim@sha256:0e0ff40c…f9b6
PINNED     postgres (production) postgres:18@sha256:5a5a84b1…9722
BLOCKED    keycloak (test-ci) quay.io/keycloak/keycloak:26.4: BLOCKED: --resolve at 2026-10-01T07:30:37.561Z could not reach the registry: ERROR: failed to do request: Head "https://quay.io/v2/keycloak/keycloak/manifests/26.4": Forbidden
PINNED     playwright (test-ci) mcr.microsoft.com/playwright:v1.56.1-noble@sha256:f1e7e010…837a
FAIL: keycloak (quay.io/keycloak/keycloak:26.4): BLOCKED, not pinned — …
FAIL: deploy/compose/compose.yaml: quay.io/keycloak/keycloak:26.4 has no digest
2 problem(s). …
EXIT=1
```

### Checksums (sha256, working tree after the changes)

| File | sha256 |
|---|---|
| `deploy/ci/ci.yml` | `8b5b11068ac3a49798cbb24393996a5d3f54125626a4f81ec06396b58db476ce` |
| `.github/workflows/ci.yml` (unchanged, not yet installed) | `4c7328a0dcb06c17a2ae50c47b7bd2e8ac7d81e5b513f4cfb4b4650f99178f90` |
| `deploy/scripts/check-ci-needs.mjs` | `2b1bb5fc7d16091e0fe6d6019e42e1f9d1b9a04c833502f202f5e50b0dbadf67` |
| `deploy/scripts/pin-images.mjs` | `26c4ba6bf45a59d5967682c37075dc7ed08ff45e6b065191c8256f210413f814` |
| `deploy/scripts/tests/check-ci-needs.test.mjs` | `6ebee4ecfd1b1d707f54abd5b006f836b5149148bf0ebcb84d68007faf3adbb1` |
| `deploy/scripts/tests/pin-images.test.mjs` | `a353315ea48304b47bb842cde3e4db0dda3049e59e36a50b2ec91c43f7a3866e` |
| `deploy/images.lock.json` (unchanged) | `24c6d17aab61b37bb8cf82510c4e60567b501ead0a28f50878fcf50ddb327cab` |

### Checks not run

- **The real CI `images` job on GitHub Actions** (live quay.io resolution, image build, Compose smoke): **BLOCKED**. There is no network and no Actions runner in this sandbox. The live path is proven only with a stub `docker` (C10/C11).
- **`pnpm format:check` / `pnpm lint` over the whole repository:** not run. I ran prettier and eslint only on the changed files (checks 8 and 9).

## 4. Known gaps and residuals

- **D-049 residual (disclosed; not a fix that makes `--check` pass locally).** On the committed candidate, `node deploy/scripts/pin-images.mjs --check` **still exits 1 on keycloak in any environment without access to quay.io**, including this one. This is intentional:
  - keycloak is a **test-only** IdP image (Compose profile `test-idp`, scope `test-ci`);
  - the production images (node runtime base, postgres) and the CI playwright image are pinned by digest in the committed lock;
  - the CI `images` job pins keycloak at runtime only where quay.io is reachable, and is BLOCKED (fails) where it is not;
  - the pin becomes permanent once IT or the orchestrator, with quay access, commits the resolved lock (from the `stack-evidence/images.lock.ci-resolved.json` artifact, or from `--resolve --missing && --apply`).
- **The installed `.github/workflows/ci.yml` is now behind the staged copy.** The pin-images C13 test and the check-ci-needs test both check the staged copy when it exists. `node deploy/scripts/check-ci-needs.mjs` (installed copy) passes before and after installation.
- **The F-DG1-116 allow-lists are deliberately strict.** Any future workflow-level `env:`/`defaults:`, or new keys on the gate job or its steps, will fail the checker until they are reviewed and added there. Product jobs may still use their own job-level `env`/`defaults` (P5).
- **Closing findings:** I don't close findings; a non-author reviewer verifies F-DG1-116 and F-DG1-108/203.
- **Local demonstration only:** a local Compose/CI demonstration is not proof of high-availability production readiness.

## 5. Merge instructions

1. **Orchestrator action:** I could not write `.github/` (`cp: cannot create regular file '.github/workflows/ci.yml': Read-only file system`). Install the staged workflow verbatim: `cp deploy/ci/ci.yml .github/workflows/ci.yml`. Then verify:
   - `diff deploy/ci/ci.yml .github/workflows/ci.yml` prints nothing;
   - `sha256sum .github/workflows/ci.yml` gives `8b5b11068ac3a49798cbb24393996a5d3f54125626a4f81ec06396b58db476ce`;
   - `node deploy/scripts/check-ci-needs.mjs` exits 0;
   - `node --test deploy/scripts/tests/*.test.mjs` passes 48 of 48.
2. There are no migrations, no lockfile changes and no new dependencies. `yaml` is already resolved from `apps/api`.
3. **Expected conflicts:** none outside `deploy/**`. The other round-3 tasks (BE4, FE4, ANALYST3) do not own these files.
4. Do **not** commit a keycloak digest unless it was produced by a real `--resolve` with quay access.
