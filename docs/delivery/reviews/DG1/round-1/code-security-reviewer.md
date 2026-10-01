# DG1 round 1: code-security review (clean re-gate)

- **Candidate:** `sha256:25c97340b6047e87e82642c28e90dea72cdd07b5bbd5d81986f497e5e863061b` (391 files).
  - Manifest source commit `37ec374`; freeze commit `2c22c27`. HEAD moved to `3c85e91` mid-review, but that commit only adds another run's evidence and the candidate ID is unchanged.
- **Reviewer:** code-security-reviewer, run `DG1-T-DG1-REV-SEC-R1-code-security-reviewer-20261001T201758Z-17dc36ed`.
- **Verdict: FAIL.** Two Medium findings are mandatory violations (data integrity and access control), both reproduced through the real API.

Engineering gate DG1 only. Nothing here is, or implies, a product G1–G6 business approval.

## What ran

All checks ran in a disposable clone under `$TMPDIR` (removed afterwards).

| Check | Result |
|---|---|
| `pnpm -r typecheck`, `pnpm -r build`, `pnpm lint`, `pnpm format:check` | PASS |
| `pnpm openapi:lint` | PASS (OpenAPI 3.1.1, 33 operations) |
| `pnpm check:no-cdn` | PASS. CSP is self-only; no XSS sinks in `apps/web/src` |
| `pnpm test`, Node 24.21.0 | 325/325 |
| `pnpm test`, Node 22.22.2 | Run 1: 324/325 (intermittent web test, F-DG1-144). Reruns 2–4: 325/325 |
| Integration on a disposable PostgreSQL 16.13 (nested-userns cluster, TCP only), **run twice** | 200/200 both runs; 8 migrations applied to a fresh DB; no leftover databases |
| `node --test tools/gates/tests/*.test.mjs tools/agents/tests/*.test.mjs` | 105/105 |
| `node --test deploy/scripts/tests/*.test.mjs` | 59/59 |
| `check-ci-needs.mjs` on all three `ci.yml` copies | OK; copies byte-identical (sha256 `8b5b1106…`) |
| `install-sandbox.test.sh` offline | 13/14 (see below) |
| `licenses/generate-sbom.mjs --check` | OK |
| `validate.mjs --historical --stage DG0` | PASS |
| REQ-S16-001: built API + worker as two processes; SIGTERM the worker | API still live, `/healthz` 200, `/readyz` 200 |

### REQ-DLV-042 (installer)

The offline acceptance checks that need no package registry all pass: 13 of 14.

AC-1 (effect) installs `is-number@7.0.0` and fails here with `ERR_PNPM_META_FETCH_FAIL ... ECONNREFUSED`. The reviewer sandbox has no registry.

- As the assignment and D-057 require (user-chosen path G, D-056), I record this as the **disclosed environmental residual**, not as a gate check.
- **It is not verified.** Nothing in this record claims it passed.
- D-057 says "14/14 offline". That does not reproduce, because AC-1 (effect) is registry-dependent (F-DG1-146).

My sandbox has a read-only HOME, so I gave pnpm a writable copy of the host store. A first run against the read-only store failed 6 install-dependent ACs with EROFS. That is a reviewer-environment artefact, kept in `install-sandbox.log`.

## Findings

These are proposed IDs; the orchestrator may renumber them. Full details are in `code-security-reviewer.findings.json`.

| ID | Sev | Mandatory | Summary |
|---|---|---|---|
| F-DG1-140 | Medium | yes | Concurrent BU re-parenting commits a cycle A→C→B→A. Both PATCHes return 200. The "no cycles" rule is an unserialized API check (`organization/routes.ts:335-376`) with no DB guard (`0001:68`). |
| F-DG1-141 | Medium | yes | Re-parenting authorizes only the moved unit, never the destination parent. A manager scoped to BU a1 moves a1x under sibling a2; a2's auditor goes from 404 to 200 on a1x's transformation. |
| F-DG1-142 | Medium | no | The global rate-limit key is any presented cookie (`server.ts:128-131`). Rotating a fake cookie gives a fresh bucket each time: 50×401, never 429. Auth routes, which are IP-keyed, are not affected. |
| F-DG1-143 | Low | no | Module lint bypass through the allow-listed third-party `ajv`. Its `_` codegen tag evaluates arbitrary JS: it reaches `child_process` and deep-imports `access/policy.ts`, with zero violations and green suite/eslint/tsc. Also, ajv/ajv-formats/yaml are test-only but are runtime `dependencies`, which ship in the `--prod` image. |
| F-DG1-144 | Low | no | Flaky web test (`transformations.test.tsx:528`, default 1 s `findByRole`): failed 1 of 4 Node 22 runs. |
| F-DG1-145 | Low | no | The data design omits the views `scope_node`, `business_unit_closure` and `actor_display`, which authorization is built on. `schema.ts` cites a non-existent `schema.test.ts`. |
| F-DG1-146 | Low | no | D-057 overstates the offline installer evidence: it is 13/14, not 14/14. |

## Per requirement

- **REQ-DLV-025:** satisfied. Every product job depends on `delivery-gates`; the checker and its 59 tests pass.
- **REQ-DLV-033:** not complete. The CRUD-with-authorization and integrity defects F-DG1-140 and F-DG1-141 are mandatory; F-DG1-142 is also open.
- **REQ-DLV-042:** offline-verifiable surface satisfied (13 ACs). The online effect is the D-057 residual, not verified.
- **REQ-S16-001:** satisfied (two processes; the API survives a worker stop).
- **REQ-S16-003:** modules, suites and the lint exist. The lint is sound for the stated built-in rules but bypassable through a third-party dependency (F-DG1-143, Low).
- **REQ-S16-004:** satisfied. All state is in PostgreSQL via migrations; audit is append-only, verified by trigger tests.
- **REQ-S19-004:** migrations apply to a fresh DB and all 17 base tables match. The three views are undocumented (F-DG1-145). The validation rule "no BU cycles" is not enforced under concurrency (F-DG1-140).
- **REQ-S19-006:** satisfied (contract lint, 33 operations; contract suite 9/9 in both integration runs).

## Reproductions

Each one lives under `docs/delivery/test-evidence/DG1/code-security/round-1/` and was run only in a disposable copy:

- `repro-bu/`
- `repro-ratelimit/`
- `repro-ajv/`
- `dd-vs-schema.mjs`
- `worker-stop-api-survives.sh`
