# Handback T-DG1-DEVOPS4 — devops-engineer (DG1 round-4 repair)

- **Assignment:** `docs/delivery/assignments/DG1/round-4/T-DG1-DEVOPS4.md` (sha256 `8220779e4e75a6aabd4188868d8cd17a701d69d9a504d5a47e8f41ef7b5e6699`, verified)
- **Invocation reference:** `{"kind":"claude-code-cli-session","run_id":"DG1-T-DG1-DEVOPS4-devops-engineer-20261001T100859Z-dde4d39a","session_id":"dde4d39a-38ac-4f12-a85b-904aa301d47e"}`
- **Base revision:** `c6cd411` (≥ `96e75cc`), worktree `/home/user/mth-wt-devops4`, branch `dg1r4-devops4`.
- **NOT COMMITTED:** `git commit` failed in the sandbox: `fatal: Unable to create '/home/user/My-owns/.git/worktrees/mth-wt-devops4/index.lock': Read-only file system`. The orchestrator must commit the three changed files plus this handback from the worktree.
- **Environment:** Linux 6.18.44, node v22.22.2, prettier 3.8.1 (lockfile), offline sandbox (no network). Docker was not used.

## 1. Changed files

| File | Purpose |
|---|---|
| `.prettierignore` | F-DG1-119: ignores the generated `deploy/images.lock.json`, with a comment explaining why. |
| `deploy/scripts/check-ci-needs.mjs` | F-DG1-120: fail-closed allow-list of `with:` inputs (with value predicates) on the delivery-gates job's checkout/setup-node steps. The header comment is updated. |
| `deploy/scripts/tests/check-ci-needs.test.mjs` | F-DG1-120: negative cases N30–N38 and positive cases P6–P7. The header is updated. |
| `docs/delivery/handbacks/DG1/round-4/T-DG1-DEVOPS4-devops-engineer.md` | This handback. |

`deploy/ci/ci.yml` and `.github/workflows/ci.yml` are **unchanged** and still byte-identical (`cmp` OK), so nothing needs installing. `deploy/images.lock.json` is unchanged (sha256 `24c6d17a…7cab`). `pin-images.mjs`, `licenses/**` and `.env.example` are untouched.

## 2. Behaviour delivered

### F-DG1-119 (Medium): `format:check` was red on the committed lock
- **Option chosen:** add the file to the Prettier ignore list, not change the emitter. `deploy/images.lock.json` is generated, and only `pin-images.mjs --resolve` writes it, using `JSON.stringify(lock, null, 2)`. That also happens at CI runtime in the `images` job (`--resolve --missing`). Copying Prettier's JSON layout in a dependency-free script would be fragile, and any mismatch would turn CI red again. Ignoring the generated file is durable.
- **Lock validity is still enforced:** `pin-images.mjs` parses the lock with `JSON.parse`, and `--check`/`--apply` run structure checks on it. `--check` is unaffected; it still exits 1 only on the test-only keycloak image (D-049).
- **`--apply` does not touch the lock.** It rewrites only the `usedIn` files (Dockerfile, compose, ci.yml copies), which Prettier accepts after the rewrite (proof below).

### F-DG1-120 (Low): delivery-gates checkout `with:` inputs were not restricted (closes the F-DG1-107 residual)
`GATE_WITH` allows only these inputs on the gate job's steps:
- **checkout:** `fetch-depth` (a non-negative integer literal) and `persist-credentials` (a boolean).
- **setup-node:** `node-version` (a numeric literal such as `22` or `22.1.0`).

Everything else is rejected. On checkout that includes `ref`, `repository`, `path`, `token`, `ssh-key`, `sparse-checkout`, `submodules` and `filter`. On setup-node it includes `node-version-file`, `cache` and `registry-url`. Expressions in an allowed key (e.g. `fetch-depth: ${{ … }}`) and a non-mapping `with:` are also rejected. The installed workflow uses only `fetch-depth: 0` and `node-version: "22"`, and it passes.

## 3. Checks actually run

**Where these ran:**
- The format checks ran in a disposable clone (`git clone` of the worktree into `$TMPDIR`, with the three changed files copied in and `node_modules` symlinked). In the worktree itself, Prettier also reports `EACCES` on untracked, sandbox-denied dotfiles (`.vscode`, `.zshrc`, `CLAUDE.local.md`, …). Those are environment artifacts, not repository files.
- The other checks ran in the worktree.

**`pnpm format:check` on the committed tree with the fixes:**
```
$ pnpm format:check
Checking formatting...
All matched files use Prettier code style!
EXIT=0   (npx prettier --check . : real 0m5.569s)
```

**Fail-before: the same tree with `HEAD:.prettierignore`:**
```
$ npx prettier --check --ignore-path <HEAD .prettierignore> .
[warn] deploy/images.lock.json
[warn] Code style issues found in the above file. Run Prettier with --write to fix.
EXIT=1
```

**Still green after `pin-images --apply`:**
```
$ node deploy/scripts/pin-images.mjs --apply      EXIT=0  (keycloak NOT APPLIED: BLOCKED, as expected)
$ git status --short                              -> only the 3 intended changes (apply was a no-op on the pinned files)
$ pnpm format:check                               FORMAT_AFTER_APPLY_EXIT=0
```

**Still green after the lock is rewritten by `pin-images --resolve --missing`** (offline, so keycloak's `blockedReason` is rewritten through `JSON.stringify`, which is the CI drift scenario):
```
BLOCKED quay.io/keycloak/keycloak:26.4: ... proxyconnect tcp: dial tcp 127.0.0.1:3128: connect: connection refused (digest stays null; recorded as blockedReason)
EXIT=1  (expected: registry unreachable)
deploy/images.lock.json | 2 +-
$ pnpm format:check                               FORMAT_AFTER_RESOLVE_EXIT=0
```
The lock was restored afterwards with `git checkout` in the clone. Before the rewrite it parsed as valid JSON (`JSON.parse`), sha256 `24c6d17aab61b37bb8cf82510c4e60567b501ead0a28f50878fcf50ddb327cab`.

**`node deploy/scripts/pin-images.mjs --check`: EXIT=1, only on the test-only keycloak image (D-049):**
```
PINNED     node-runtime (production) node:24-bookworm-slim@sha256:0e0ff40c…f9b6
PINNED     postgres (production) postgres:18@sha256:5a5a84b1…9722
BLOCKED    keycloak (test-ci) quay.io/keycloak/keycloak:26.4: BLOCKED: --resolve at 2026-10-01T07:30:37.561Z could not reach the registry: … Forbidden
PINNED     playwright (test-ci) mcr.microsoft.com/playwright:v1.56.1-noble@sha256:f1e7e010…837a
FAIL: keycloak (quay.io/keycloak/keycloak:26.4): BLOCKED, not pinned — …
FAIL: deploy/compose/compose.yaml: quay.io/keycloak/keycloak:26.4 has no digest
2 problem(s).
```

**`node --test deploy/scripts/tests/*.test.mjs`:**
```
# tests 59  # pass 59  # fail 0  # cancelled 0  # skipped 0  # duration_ms 5791.7   EXIT=0
```

**F-DG1-120 fail-before/pass-after.** The new test file was run against the round-3 checker in a clone of `c6cd411`:
```
not ok 36 - NEGATIVE N30 delivery-gates checkout with.ref override
not ok 37 - NEGATIVE N31 delivery-gates checkout with.repository override
not ok 38 - NEGATIVE N32 delivery-gates checkout with.path override
not ok 39 - NEGATIVE N33 delivery-gates checkout with.token override
not ok 40 - NEGATIVE N34 delivery-gates checkout with.sparse-checkout override
not ok 41 - NEGATIVE N35 delivery-gates checkout with.submodules override
not ok 42 - NEGATIVE N36 delivery-gates checkout with.fetch-depth as an expression
not ok 43 - NEGATIVE N37 delivery-gates setup-node with.node-version-file
not ok 44 - NEGATIVE N38 delivery-gates checkout with: is a string, not a mapping
# tests 46  # pass 37  # fail 9
```
With the fixed checker, all 46 pass. Example outputs:
```
N30 ...: exit 1: FAIL: delivery-gates step 1: with.ref is not allowed on checkout in delivery-gates (allowed: fetch-depth, persist-credentials); it could make validate.mjs check a different tree or toolchain
N36 ...: exit 1: FAIL: delivery-gates step 1: with.fetch-depth has a disallowed value "${{ github.event.inputs.depth }}"
P6 delivery-gates checkout with persist-credentials: false (allow-listed): exit 0
P7 delivery-gates checkout without with: (defaults to the triggering commit): exit 0
```

**`node deploy/scripts/check-ci-needs.mjs` (installed workflow): EXIT=0**
```
OK: .github/workflows/ci.yml: 5 jobs; first job delivery-gates runs validate.mjs --pipeline; every other job depends on it with no status-function if:; installs only via ci-install-deps.sh
  verify <- delivery-gates
  integration <- verify
  e2e <- verify
  images <- integration, e2e
```
Running it on `deploy/ci/ci.yml` also gives OK (EXIT=0).

**Changed-file checksums (sha256):**
- `.prettierignore`: `e31977d7e11e2c369c8b0b6bf3b8a5b94e2389b3769674187e76876bd7af6eb1`
- `deploy/scripts/check-ci-needs.mjs`: `ee475b06a2b68472ad9ff5a60d40b7ba9d963756e88b614c29838c78ddac1a58`
- `deploy/scripts/tests/check-ci-needs.test.mjs`: `66a9c4b623ca413ec998ef8d5c544ebc46b2ffffd47f6759eb65722d896d8bc7`

## 4. Known gaps / not done
- **Not committed:** the sandbox made the git metadata read-only (see the top of this handback).
- **The CI run itself was not executed:** no GitHub runner and no network. The green `verify` job is inferred from the local `pnpm format:check` run on the same tree.
- **Keycloak is still BLOCKED (D-049):** `pin-images --check` exits 1 by design until an orchestrator or IT step with quay.io access resolves the digest. That is not part of this task.
- **`node tools/gates/validate.mjs` was not run:** this is an implementer repair, and the gate validator is the orchestrator's responsibility.
- **Not proof of HA production readiness:** none of this demonstrates high-availability production readiness.

## 5. Merge instructions
- Commit `.prettierignore`, `deploy/scripts/check-ci-needs.mjs`, `deploy/scripts/tests/check-ci-needs.test.mjs` and this handback from the worktree.
- There are no migrations and no workflow install step (`deploy/ci/ci.yml` is unchanged).
- Conflicts are expected only if another round-4 task also edits `.prettierignore`. In that case keep both entries.
- Findings F-DG1-119 and F-DG1-120 (and F-DG1-107's residual) are for a non-author reviewer to verify. I do not close them.
