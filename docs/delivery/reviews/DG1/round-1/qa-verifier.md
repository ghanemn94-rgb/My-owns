# DG1 round 1: qa-verifier gate verification (T-DG1-REV-QA-R1)

- **Candidate:** `sha256:7fcc4943694dc9d7d207b18b53c42eab1efa131da46b898f733ae20298b39367`, source commit `85e5bbd6`. I recomputed it in the repository at HEAD `863505e`, a metadata-only freeze commit, and again in a disposable `--no-local` clone at `85e5bbd`. Both matched.
- **Invocation:** `DG1-T-DG1-REV-QA-R1-qa-verifier-20261001T062256Z-a249b76d` (session `a249b76d-…`).
- **Verdict: FAIL.** There are 2 High findings, 1 Medium and 4 Low. Details are in `qa-verifier.findings.json`.
- **Evidence:** `docs/delivery/test-evidence/DG1/qa/round-1/` (logs numbered 00–24, screenshots, helper scripts). The new independent spec is at `docs/delivery/test-evidence/DG1/qa/tests/dg1-r1-branding-fonts-wordmark.spec.ts`. It is not in `e2e/`, so the candidate stays unchanged; it can be promoted later.

I read no other round-1 review record before I formed this verdict.

## What verified on the frozen candidate

| Area | Result |
|---|---|
| Install from the committed lockfile, offline and frozen | 371 reused, 0 downloaded, lockfile unchanged |
| `pnpm -r typecheck` / `build`, `lint`, `format:check`, `openapi:lint` (33 ops), `check:no-cdn`, `check:contrast` | all exit 0 |
| Unit tests (`unit-node` + `unit-web`) | 130/130 |
| Migrations on a fresh PostgreSQL 16 database; `audit_event` append-only (UPDATE/DELETE/TRUNCATE rejected, including for the owner) | PASS (2 fresh clusters) |
| A12 cross-scope read/write (14), A13 idempotency (5), A14 concurrency (5) | PASS |
| e2e on the real stack, chromium-en and chromium-ar: A20 shell, token CSS, create/list/409-reapply/archive/admin/no-permission journeys | 20/20; axe 0 violations on 13 pages per language |
| A20 token change propagates (`brand.deep` → `#6B1D5C`, restored) | PASS |
| REQ-S15-002/005/006, new spec: branding API (401 when unauthenticated; exactly 7 tokens and values; provenance=provisional, also for a user with no roles); no non-local requests; Plex fonts served from the app origin; text wordmark with Provisional/مؤقت, no image; no positive official claim in AR or EN | 6/6 |
| A18 clean start from a fresh checkout, including the offline install (production config, restart, 503 on an unmigrated database) | PASS (workspace layout) |
| REQ-S16-001: stopping the worker leaves the API ready and creates working (201); a restarted worker drains the outbox | PASS |
| REQ-S16-003 dependency lint: two injected bypass imports both fail the test | PASS |
| REQ-DLV-025 `check-ci-needs` (positive check, and a negative check with an injected job) | PASS |
| REQ-DLV-042 installer suite | 7/7 with a writable store (see F-DG1-206) |
| Validator: `--register DG1`, `--pipeline`, `--reconcile`, DG0 historical; the 12 DG1 rows are IMPLEMENTED and all their evidence files exist | PASS |

## Failures

1. **F-DG1-201 (High, REQ-S19-006).** `pnpm test:integration` is red on the candidate. The contract-coverage test reports `getBrandingTokens` as never exercised. It failed the same way on two fresh clusters. Commit 0b42847 added the operation but left the integration contract run to "the reviewers". The CI `integration` job would fail, and `images` would be skipped. The branding response itself is correct and contract-valid: the unit test checks it with ajv, and my e2e checks the values.
2. **F-DG1-202 (High, REQ-DLV-033, deployment).** `deploy/scripts/assemble-runtime.sh` is the exact step the Dockerfile runs. It copies `config`, `db` and `shared` but not `packages/design-tokens`, which `apps/api/dist/server.js` now imports. In the assembled runtime the API crashes with `ERR_MODULE_NOT_FOUND`. devops' documented `clean-start-local.sh` fails at A3, and a minimal repro shows the dangling symlink. The image therefore cannot start the API. My own A18 script runs from the built workspace, so it could not catch this. I will extend A18 to also start the assembled runtime; that test change will be promoted by the orchestrator.

## Assessments the orchestrator asked for

- **REQ-S16-003 / D-047.** I judge A12 met at architecture scope for DG1:
  - `modules.ts` declares every boundary, including the reserved workflows, kpi and reporting modules.
  - The dependency lint is effective: my negative probes made it fail.
  - The 8 P1 modules have suites.

  Building the workflow, formula and reporting modules now would contradict the stage plan. However, the register still states the literal "six modules exist with separate test suites". I filed F-DG1-207 (Low) so the acceptance text or the increments get amended rather than only reinterpreted.
- **400/403 instead of 422; FE probes `dev-login` with an empty body.** I accept both for P1:
  - The contract tests check status codes for every operation, and all operation groups except branding coverage passed.
  - The SPA no longer calls an undeclared `/api/v1/auth/options`. It sends an empty POST to the declared `dev-login` operation, which returns 400 in dev and 404 otherwise. Both codes are in the contract, and A18 confirms the 404 in production.
- **DevOps flags.**
  - Unpinned image digests make the CI `images` job deterministically red: F-DG1-203, Medium. They need pinning, or a recorded non-blocking decision until registry access exists.
  - The EN/AR same-user race is a test-design limitation, mitigated by `--workers=1`. My A20 spec creates a fresh user per run. No finding.
  - `.env.example` at the repository root rather than under `deploy/`: only the planned name in REQ-S19-009 (DG7) differs. The `--check` passes. No finding for DG1.
  - SBOM lockfile hash is stale: F-DG1-204, Low.
- **Provisional brand.** The 7 tokens are served with provenance=provisional. The wordmark is text with a badge, and there is no logo asset. Every "official", "certified", "معتمد" or "رسمي" string is a negated disclaimer. This was checked both statically and on the rendered pages.

## Blocked (not passed)

- Compose/image clean start: the Docker daemon socket refused the connection (permission denied).
- A live CI run with a failing gate record: there is no runner or network.
- Registry-only egress of the installer: there is no network.
- `pnpm deps:verify`: it needs the registry. It was not in my required list.

## Test-side notes (my own, not product defects)

- The first iteration of my spec flagged the product's Arabic disclaimer ("غير معتمد من PMI", "not certified by PMI") as a claim. I fixed this with negation-aware patterns, and a regex sanity log is in the evidence.
- The outbox probe in the worker-stop script first used a mis-encoded psql URL. It was rerun, and both logs are kept.
