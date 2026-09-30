# Assignment T-DG1-DEVOPS: images, Compose, CI, Keycloak, operations (devops-engineer)

- **Stage:** P1 / gate DG1 (BUILDING). **Base revision:** HEAD after T-DG1-BE and T-DG1-FE integrate (you run third; Compose and CI then exercise the merged app).
- `node_modules` is installed; builds run **offline**. Do not run `pnpm install`. Dependency changes → handback (name + exact version), never applied yourself.

## Your requirements
DG1-completing: `REQ-DLV-025` (CI with `needs: delivery-gates`), `REQ-DLV-033` (repo/build/packaging share). P1 increments include `REQ-S18-001`, `REQ-S19-005/007/009..010/015/019`, `REQ-DLV-039..040`, `REQ-S20-018` (A18 clean start). List your exact set with the `csv.DictReader` one-liner and record which you touched.

## Scope — you own (write) ONLY these (p1-work-split.md §4)
- `.github/workflows/ci.yml`: **install `docs/architecture/ci/ci.yml` verbatim first**, then add the image job and digest pins. **Never** touch `delivery-gates.yml`.
- `deploy/**`: `docker/Dockerfile` (+ `.dockerignore` handling); `compose/compose.yaml` (with an internal-network variant for the no-egress smoke test); `keycloak/realm-mth-test.json` (synthetic users, **no real credentials**); `scripts/` for startup and smoke tests.
- `.dockerignore`.
- `.env.example`: **generated from `packages/config/src/index.ts` `ENV_VARS`**; no secret values.
- `docs/operations/**`: local/clean-VM startup, health/readiness, restricted-network preparation (§19 items 6–7, P1 increments).
- `licenses/`: a collection script for third-party notices and SBOM generation from the lockfile.

## Consumes (read, do not edit)
ADR-0011 (images, Compose, no egress, config); ADR-0013 (CI); ADR-0012 (Playwright image + `PLAYWRIGHT_BROWSERS_PATH`, Postgres service); ADR-0003 (PostgreSQL 18, roles `mth_owner`/`mth_app`, migrate one-shot); ADR-0005 (Keycloak test IdP; `AUTH_MODE=oidc` in production images); the start commands in `apps/api/package.json` and `apps/worker/package.json`, and `mth-db migrate`.

## Deliver (P1)
- **one application image** with `api`, `worker` and `migrate` commands, **non-root**;
- **Compose** with `db`, `migrate`, `api`, `worker` and a `test-idp` profile;
- **health checks**;
- **CI with `needs: delivery-gates` semantics** (the first job re-runs `node tools/gates/validate.mjs --pipeline`; every product job depends on it — REQ-DLV-025);
- the **Keycloak realm** (synthetic only);
- **`.env.example`** (generated, no secrets);
- a **clean-start runbook and smoke test**;
- an **A18 first-case clean start**, together with qa-verifier.

## Conventions (CLAUDE.md; reviewers verify)
- Every mandatory runtime service runs inside company-controlled infrastructure. **No builder-hosted services, public CDNs or personal keys.** No secrets in the repo (`.env.example` has names only).
- The runtime must run with **no outbound internet** (the internal-network Compose variant proves it).
- If bubblewrap/docker/tooling needed for a check is missing, that check is **BLOCKED**, never a pass.

## Must not touch
`apps/**` source, `packages/**`, `e2e/**`, `tests/qa/**`, `tools/**`, `.github/workflows/delivery-gates.yml`, and the frozen files (§1). The write guard also blocks `.claude/agents/**`, `docs/source/**` and delivery records.

## Acceptance checks (reviewers verify independently)
1. `docker build` of `deploy/docker/Dockerfile` produces a non-root image exposing `api`/`worker`/`migrate`; if docker is unavailable in the review env, this is **BLOCKED** (documented), not a pass.
2. `compose up` (db → migrate → api → worker) reaches healthy; `/readyz` returns ready; the `test-idp` profile starts Keycloak with the test realm.
3. The internal-network variant starts the app with **no egress** and still serves `/healthz`.
4. `.github/workflows/ci.yml` first job runs `validate.mjs --pipeline` and every product job `needs` it; `delivery-gates.yml` is unchanged.
5. `.env.example` matches `ENV_VARS` names exactly and contains no secret values; the clean-start runbook commands work from a fresh checkout (A18, with qa).

## Handback
`docs/delivery/handbacks/DG1/T-DG1-DEVOPS-devops-engineer.md` — changed files, requirements touched, checks run with real output (mark any BLOCKED for missing docker/tools), dependency requests, and the A18 clean-start evidence.
