# Assignment T-DG1-DEVOPS3: devops round-3 repairs (devops-engineer)

- **Stage:** P1 / gate DG1 (round-3 repair). **Base revision:** current `HEAD` (≥ `45d0297`). Dedicated git worktree; `node_modules` present; run **offline**; **no network** (D-025).
- Fix **only** the findings below (full text in `docs/delivery/findings.json`). Write ONLY `deploy/**`, `.github/workflows/ci.yml` (or the staged `deploy/ci/ci.yml` if your guard blocks `.github/`), `licenses/**`, `.env.example`.

## Findings

### F-DG1-116 (Low) — check-ci-needs.mjs accepts further ways to weaken the gate step
`deploy/scripts/check-ci-needs.mjs` still passes when the `delivery-gates`/validate step carries a `NODE_OPTIONS` env, a `working-directory` override, a `shell:` override, or when a workflow-level `defaults:` block changes how run steps execute (evidence: `docs/delivery/test-evidence/DG1/code-security/round-2/25-check-ci-needs-bypass.log`). **Fix:** make the checker flag each of these on the gate step (and on any step that runs `validate.mjs`/the delivery-gates install), and extend its self-test (`deploy/scripts/tests/check-ci-needs.test.mjs`) with a case for each of the four vectors (fail-before/pass-after). Keep the existing F-DG1-107 checks.

### F-DG1-108 / F-DG1-203 (Medium) — the CI images job cannot pass because the test-only keycloak image is unpinned
Digest resolution needs registry access and is an orchestrator/IT step (D-049). node:24 + postgres:18 (docker.io) and mcr playwright are pinned in the committed lock; **quay.io/keycloak/keycloak (TEST-only, Compose profile test-idp) is denied by THIS environment's egress policy and is recorded BLOCKED** — it is pinnable only where quay.io is reachable (GitHub Actions / IT), never fabricated. **Fix:** make the CI `images` job resolve-and-pin any `blockedReason` image **at CI runtime** before `pin-images --check` — e.g. a step that runs `node deploy/scripts/pin-images.mjs --resolve && node deploy/scripts/pin-images.mjs --apply` (guarded so it only resolves images still missing a digest), then `--check`. On a runner with quay.io access this pins keycloak live and the job passes; the committed lock keeps keycloak `blockedReason` (honest for environments without quay). Document in the handback that `pin-images --check` on the committed candidate still exits 1 on keycloak in any environment lacking quay.io access, which is the disclosed D-049 residual (a test-only IdP image, production images already pinned). Do **not** fabricate a digest and do **not** make `--check` pass on a null digest locally.

## Self-verification (offline)
`node --test deploy/scripts/tests/*.test.mjs` (incl. the new F-DG1-116 cases), `node deploy/scripts/check-ci-needs.mjs`, `node deploy/scripts/pin-images.mjs --check` (still exits 1 on keycloak — correct here), and YAML validity of the workflow you change. Anything you cannot run is BLOCKED.

## Handback
`docs/delivery/handbacks/DG1/round-3/T-DG1-DEVOPS3-devops-engineer.md` — the fixes, proofs, real output; note any `deploy/ci/ci.yml` change the orchestrator must install to `.github/workflows/ci.yml`; the keycloak/D-049 residual.
