# Assignment T-DG1-DEVOPS2: devops round-2 repairs (devops-engineer)

- **Stage:** P1 / gate DG1 (round-2 repair). **Base revision:** current `HEAD` of branch `claude/mobily-transformation-platform-kwcc4i` (≥ `c433078`). You run in a dedicated git worktree; `node_modules` is present, so `pnpm`/`node` run **offline**. Do **not** run `pnpm install`; you have **no network** (agent sandboxes have none — D-025).
- Fix **only** the findings below; do not widen scope. Read `docs/delivery/findings.json` for full text, and `docs/delivery/decisions.md` D-046 (sandboxed installer), D-049 (image pinning under restricted egress).

## Scope — write ONLY within your areas (p1-work-split §4)
`deploy/**` (Dockerfile, compose, `deploy/ci/ci.yml`, `deploy/scripts/**`, `deploy/images.lock.json` structure), `.github/workflows/ci.yml`, `licenses/**` (SBOM tooling), `.env.example`. Do **not** touch `apps/**`, `packages/**`, `docs/**` (except your own handback), `tools/**`, `scripts/**`, root build config, or `pnpm-lock.yaml`.
> Note: implementers normally cannot write `.github/**`; your guard permits `deploy/**` and the **staged** copy `deploy/ci/ci.yml`. Where you cannot write `.github/workflows/ci.yml` directly, edit the staged `deploy/ci/ci.yml` and say so — the orchestrator installs it. If your guard does allow `.github/workflows/ci.yml`, edit it directly and keep `deploy/ci/ci.yml` identical.

## Findings to fix

### High (mandatory)
- **F-DG1-202 — the production runtime / container image cannot start the API: `deploy/scripts/assemble-runtime.sh` omits `packages/design-tokens`, which `apps/api` now imports at runtime** (`server.ts` imports `@mth/design-tokens`). Include `packages/design-tokens` (its built output / package files, matching how the other runtime workspace packages are assembled) in the assembled runtime so the API starts. **Prove it:** run `assemble-runtime.sh` into a scratch dir and show the API's runtime dependency closure now contains `@mth/design-tokens` (and, if you can, that `node <assembled>/apps/api` resolves the import). Record the real output.

### Medium (mandatory)
- **F-DG1-104 — CI installs dependencies without the sandboxed installer**, contradicting the register claim ("invoked by the orchestrator (and by CI) for every dependency install"). Make the CI dependency-install step use `tools/deps/install-sandbox.sh frozen` (bubblewrap must be available on the runner; if a job genuinely cannot run bubblewrap, the install is **BLOCKED**, never a plain `pnpm install` fallback — the wrapper already exits 65 when bwrap is absent). Keep the lockfile frozen. If you cannot edit `.github/workflows/ci.yml` directly, edit `deploy/ci/ci.yml` and note it for the orchestrator.

### Medium
- **F-DG1-107 — `deploy/scripts/check-ci-needs.mjs` can be bypassed: a job-level `if: always()` / `if: ${{ !cancelled() }}` makes a product job run after `delivery-gates` FAILED, yet the check still reports OK.** Harden the check so a product job that declares `needs: delivery-gates` but carries an `if:` that would let it run when `delivery-gates` did not succeed is **flagged as a violation** (every product job must be truly gated on `delivery-gates` success). Add/adjust the negative fixture under `docs/delivery/test-evidence/DG1/...` or the script's own self-test so the bypass is caught. (REQ-DLV-025: every product job `needs` the gate.)
- **F-DG1-108 / F-DG1-203 — the CI `images` job cannot pass: image digests are unpinned (`pin-images --check`: 10 problems) and the SBOM is stale.** The **digest resolution** (`pin-images --resolve`) needs registry access and is an **orchestrator/IT step** (D-049) — you cannot run it (no network). Your part:
  - make `deploy/scripts/pin-images.mjs --check` and `deploy/images.lock.json` **structurally correct and honest**: `--check` must still fail on any null digest (never a silent pass), and the lock must support recording a registry that the environment denies as **BLOCKED** (e.g. a `blockedReason` field on an image) **without** that counting as "pinned" — a BLOCKED/null digest is reported, not passed;
  - ensure the `usedIn` lists and the ref:tag strings in `Dockerfile`/`compose.yaml`/`ci.yml` are exactly what `--apply` will pin (so the orchestrator's `--resolve`+`--apply` is a clean, reviewable diff);
  - document in the handback that `--resolve` is the orchestrator step and which images are production (node, postgres) vs test/CI-only (keycloak = quay.io, denied here; playwright = mcr).
  Do **not** fabricate a digest. Do **not** mark `--check` passing while any digest is null.

## Self-verification (offline, in your worktree)
- `node deploy/scripts/check-ci-needs.mjs` (and its negative case) — show the bypass is now caught.
- `node deploy/scripts/pin-images.mjs --check` — show it still fails honestly on the null digests (that is correct until the orchestrator resolves them).
- `assemble-runtime.sh` into a scratch dir — show `@mth/design-tokens` is now included.
- YAML you change stays valid; `pnpm lint`/`pnpm openapi:lint` unaffected. Anything you cannot run is **BLOCKED**, never a silent pass.

## Handback
`docs/delivery/handbacks/DG1/round-2/T-DG1-DEVOPS2-devops-engineer.md` — per finding: the fix, the proof, real output. List changed files, note every change you made to `deploy/ci/ci.yml` that the orchestrator must install to `.github/workflows/ci.yml`, and anything BLOCKED (incl. the digest-resolve orchestrator step).
