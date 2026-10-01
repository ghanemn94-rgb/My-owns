# DG1 round-2: code-security-reviewer

Read `review-common.md` first. Task ID: `T-DG1-REV-SEC-R2`.

## Scope: correctness and security of the repaired product code and configuration
Directly review the source of `apps/api/**`, `apps/worker/**`, `packages/{shared,db,config,design-tokens}/**`, `tools/deps/**`, `deploy/**`, `.github/workflows/ci.yml`, and `docs/api/openapi.yaml`. Flag any web security issue you see.

## Findings you verify (code-security-authored in round 1), with file:line + a re-test
- **F-DG1-102** (installer): `tools/deps/install-sandbox.sh` now runs `--clearenv` (only PATH/HOME/XDG/PNPM/registry + proxy-TLS vars pass in — no orchestrator secrets), re-binds the control paths (`.git`, `.claude`, `.github`, `tools/{gates,agents,deps,source}`, `docs/{source,delivery}`) read-only over the writable tree, and `--cap-drop ALL`. Run `tools/deps/tests/install-sandbox.test.sh` (expect 10/10; incl. AC-5 control-path RO, AC-6 clean env). Try to defeat it (write `.git/hooks`, read a planted secret env var).
- **F-DG1-103** (OIDC CSRF): the `state` is browser-bound via a `__Host-`/HttpOnly/SameSite cookie (SHA-256 only, migration 0007); a mismatched callback is refused + audited, state not consumed. Try a cross-browser callback.
- **F-DG1-001** (close): the mutation path refuses `→closed` (422), writes nothing. **F-DG1-106** (authz): a BU-scoped Lead's derived transformation assignment is explicit + audited, never for an approval-holding role, revoked with its source (migration 0008); cross-BU still 404. Try cross-scope.
- **F-DG1-112** (cookies): production refuses an http `APP_BASE_URL` (except localhost).
- **F-DG1-109** (module lint): `architecture.test.ts` now catches `createRequire()` and computed `import()/require()`. Plant one and confirm it fails.
- **F-DG1-105/002** (modules): the three scaffolds declare real boundaries; the dependency-lint enforces them; no scaffold exposes an ungoverned mutating route.
- **F-DG1-104** (CI install): every CI job installs only through `deploy/scripts/ci-install-deps.sh` → `install-sandbox.sh frozen` (BLOCKED/65 without bwrap, no pnpm fallback). **F-DG1-107:** `check-ci-needs.mjs` flags `if:always()/!cancelled()/failure()`, `|| true` gate steps, continue-on-error and non-sandboxed installs. **F-DG1-202:** `assemble-runtime.sh` includes `@mth/design-tokens`. **F-DG1-108/203:** `pin-images --check` stays honest (fails on the environment-BLOCKED keycloak per D-049; node/postgres/playwright pinned by digest); assess the D-049 residual. **F-DG1-110:** flaky integration tests fixed.

## Checks to run (record real output; BLOCKED if a tool/DB is missing)
`pnpm -r typecheck`, `pnpm -r build`, `pnpm lint`, `pnpm openapi:lint`, `pnpm check:no-cdn`, `pnpm test`, the integration suite on a disposable PostgreSQL (`packages/db/test/global-setup.ts`, `TEST_DATABASE_ADMIN_URL`), `node --test tools/gates/tests/*.test.mjs tools/agents/tests/*.test.mjs`, `node --test deploy/scripts/tests/*.test.mjs`, and `tools/deps/tests/install-sandbox.test.sh`. Confirm the DG1 product changes did not weaken any DG0 delivery control (`tools/gates/**`, the write guard, the candidate hash): `node tools/gates/validate.mjs --stage DG0 --historical`. Save evidence under `docs/delivery/test-evidence/DG1/code-security/round-2/`.

**Disposable PostgreSQL:** you run concurrently with the qa reviewer, so spin your throwaway cluster on a **distinct port 5451** (e.g. `QA_E2E_PG_PORT=5451`, or `TEST_DATABASE_ADMIN_URL=postgresql://postgres@127.0.0.1:5451/postgres`) to avoid contention. PostgreSQL cannot run as root; use `unshare --user --map-user=1000 --map-group=1000` as `e2e/support/qa-stack.sh` does.

## Requirements to check (record exactly these in `requirements_checked`)
`REQ-DLV-025`, `REQ-DLV-033`, `REQ-DLV-042`, `REQ-S16-001`, `REQ-S16-003`, `REQ-S16-004`, `REQ-S19-004`, `REQ-S19-006`.
