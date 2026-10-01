# Handback T-DG1-BE-R2 — backend-workflow-engineer (DG1 clean re-gate, round-2 repairs)

- **Stage / task:** P1 / DG1, round 2, task T-DG1-BE-R2. Assignment `docs/delivery/assignments/DG1/round-2/T-DG1-BE-R2.md` (sha256 `fb6fdd2f…332bfa`, verified).
- **Invocation reference:** `{"kind":"claude-code-cli-session","run_id":"DG1-T-DG1-BE-R2-backend-workflow-engineer-20261001T211413Z-9761244e","session_id":"9761244e-a53d-43c6-b8a5-0706d5332914"}`
- **Branch:** `claude/mobily-transformation-platform-regate`. At the start `HEAD` was `9fea78d00d3f2b60673e7e1e4ef2a31bb1290e37`. During this run the orchestrator committed `e85769370a37e9dbf977798de9f889570bccdcdf` (D-057/D-058 decision records only; no product code). All changes below are uncommitted working-tree edits on top of `e85769370a37e9dbf977798de9f889570bccdcdf`.
- **Not touched:** `tools/gates/**`, `tools/agents/**`, `.claude/agents/**`, `docs/source/**`, reviews, gate records, `stages.json`, `findings.json`. `apps/web/src/pages/transformations/transformations.test.tsx` shows as modified in the tree. That edit is the parallel **frontend** run (T-DG1-FE-R2, F-DG1-144), not mine; it is excluded from my diff.
- **No business approval** of any kind was granted. Product gates G1–G6 are unaffected, and nothing here implies DG1/DG7.

## 1. Changed files

| File | Purpose |
|---|---|
| `packages/db/migrations/0009_business_unit_hierarchy_guard.sql` (**new**) | F-DG1-140: database-level hierarchy guard (trigger + function + pre-check of existing data) |
| `apps/api/src/modules/organization/repository.ts` | `HIERARCHY_LOCK_CLASS`, `lockBusinessUnitHierarchy()` (the advisory lock shared with the trigger), `hierarchyViolation()` (maps 23514 + constraint name) |
| `apps/api/src/modules/organization/routes.ts` | F-DG1-140: PATCH/POST take the hierarchy lock before the cycle/depth checks; trigger errors map to the same 422/400 problems. F-DG1-141: PATCH re-parent authorizes `business_unit.manage` on the destination parent (or the organization for a move to the top level) |
| `apps/api/src/modules/identity/rate-limit-subjects.ts` (**new**) | F-DG1-142: bounded, TTL'd map from SHA-256(validated token) to user id; written only by the identity module |
| `apps/api/src/modules/identity/routes.ts` | F-DG1-142: remember a token on successful resolve and sign-in; forget it on failed resolve, rotation and logout |
| `apps/api/src/modules/identity/index.ts` | exports `RateLimitSubjects` |
| `apps/api/src/server.ts` | F-DG1-142: limiter key = `u:<userId>` for a validated session, else `ip:<request.ip>` (TRUST_PROXY-aware); never a raw cookie value |
| `apps/api/package.json` | F-DG1-143: `ajv`, `ajv-formats`, `yaml` moved from `dependencies` to `devDependencies` |
| `pnpm-lock.yaml` | the same move in the `apps/api` importer (9 lines moved; no package or version change) |
| `licenses/inventory.csv`, `licenses/sbom.cdx.json` | regenerated with `node licenses/generate-sbom.mjs` for the lockfile change |
| `apps/api/src/architecture.testkit.ts` | F-DG1-143: header scope statement (first-party source only, D-055). Test files (`*.test.ts`, excluded from the build) may import @mth/api devDependencies (previously only `vitest`); module source may not |
| `apps/api/src/architecture.test.ts` | F-DG1-143 self-check: ajv/ajv-formats/yaml are violations in module source and `.test.mts`, allowed in `.test.ts`; the reviewer's planted `ajv` import is refused |
| `apps/api/test/integration/bu-hierarchy-guard.test.ts` (**new**) | F-DG1-140/141 integration tests (7) |
| `apps/api/test/integration/platform.test.ts` | F-DG1-142 integration tests (2) |
| `docs/architecture/data-dictionary.md` | F-DG1-145/001/230: new "Views (read models)" section (actor_display, business_unit_closure, scope_node: purpose, columns, source, grants, depth cap); business_unit invariants updated (0009 trigger, destination authz) |
| `docs/architecture/erd.md` | F-DG1-145/001/230: the three views and the 0009 hierarchy guard listed under "Also created in P1" |
| `packages/db/src/schema.ts` | F-DG1-145: comment now cites the real test `packages/db/test/integration/catalogue.test.ts` |
| `docs/operations/clean-start.md` | F-DG1-002: step A1–A2 says "every shipped migration … (currently 9: `0001`–`0009`)". The historical timing row is marked as "the count at the time of measurement" |
| `docs/delivery/handbacks/DG1/round-2/T-DG1-BE-R2-evidence/*` | the full diff and the real logs referenced below |

**Note on F-DG1-002.** The assignment says to correct the count to 8 (0001–0008). This task adds 0009, so 8 would already be stale. The guide now states the current count (9, 0001–0009) and says "every shipped migration", so the next migration does not make it wrong again.

## 2. Behaviour delivered

### F-DG1-140 (REQ-S19-004, Medium, mandatory): a cycle can never commit, even under concurrency
**Database guard (migration `0009_business_unit_hierarchy_guard.sql`):** `AFTER INSERT OR UPDATE OF parent_business_unit_id, organization_id ON business_unit FOR EACH ROW` trigger `business_unit_hierarchy_guard()`:
1. **Serialization.** `pg_advisory_xact_lock(730219, hashtext(organization_id))` serializes every hierarchy change of one organization. A hash collision only serializes more than needed.
2. **Re-check after the lock and after the row is written.** It is an AFTER trigger, so a multi-row statement is checked on its final state. Under READ COMMITTED each query in the function takes a fresh snapshot after the lock, so it sees what the previous holder committed.
3. **Locking walk.** The parent chain is walked with `SELECT … FOR SHARE`. Under REPEATABLE READ or SERIALIZABLE, a chain row that a concurrent transaction changed raises `40001` instead of being read stale. The walk is bounded at 10 levels, so even a pre-existing loop terminates.
4. **Errors.** `SQLSTATE 23514`, with constraint `business_unit_acyclic` (cycle) or `business_unit_max_depth` (more than 10 levels, the same limit as `MAX_BU_DEPTH = 9`).
5. **Pre-check.** The migration aborts if the existing data already has a cycle or a depth over 10.

**API:** the PATCH re-parent (and the POST with a parent) takes the **same** advisory lock *before* reading anything it checks, so the friendly path stays the existing `422 business_unit.cycle` / `business_unit.depth_exceeded` (400 on create) even when requests race. A trigger refusal maps to the same problems (`hierarchyRule`). Lock order is advisory lock → row locks on every application path, and no app path holds a row lock and then waits for the advisory lock while another holds them in the reverse order, so this adds no deadlock. Single-threaded behaviour is unchanged (the existing `organizations.test.ts` cycle and depth tests pass).

**Stated residual (DEPTH only, never cycles):** under REPEATABLE READ, a concurrent child **insert** into a subtree that is being moved deeper is not seen by the height query. A cycle cannot form through an insert, because the FK is not deferrable. The application uses READ COMMITTED, where this case is serialized and tested ("READ COMMITTED depth race"). This is documented in the migration header and the data dictionary.

### F-DG1-141 (REQ-DLV-033, Medium, mandatory): destination authorization
A change of `parentBusinessUnitId` now also requires `business_unit.manage` on the **destination**: the new parent BU (via `targetFor(..., "business_unit")`), or the **organization** for a move to the top level. The check uses `requireAction`, so the response is 403 `forbidden` with the policy denial attached, and `registerDeniedMutationAudit` writes `authorization.denied` against the destination record. The moved-unit checks are unchanged. An organization-scope manager can still move units across branches. The test also proves the exposure is gone: V (AUD at a2) still gets 404 on the a1-branch transformation after the refused move.
Existence disclosure: the order is parent-exists/same-org (422 `parent_invalid`) and then authorization (403). That is the same disclosure as the pre-existing 422, and the assignment asks for 403.

### F-DG1-142 (REQ-DLV-033, Medium): trustworthy rate-limit key
The limiter still runs on `onRequest` (before any DB lookup). Its key is now:
- `u:<userId>` only when the presented cookie is in `RateLimitSubjects`. Only the identity hook writes entries, and only **after** `resolveSession` returned a live session (or at sign-in, from the freshly created session).
- `ip:<request.ip>` otherwise: no cookie, or a forged, expired, revoked or unknown token. `request.ip` follows Fastify `trustProxy` = `TRUST_PROXY`, so X-Forwarded-For hops count only when configured.

A token that fails to resolve, a token rotated at sign-in, and a token signed out are **forgotten**. Entries are keyed by SHA-256 (never the raw value), expire after the session idle timeout, and are capped at 50,000 (least recently validated evicted first). Only live sessions can add entries, so anonymous traffic cannot grow the map. Per-user keying also means all of one user's sessions share one bucket.

### F-DG1-143 (REQ-S16-003, Low)
**Verification (grep over apps, packages, tools, deploy, licenses):**
- `ajv` is used only in `apps/api/test/support/contract.ts` and `apps/api/src/modules/admin/branding.test.ts`.
- `ajv-formats` is used only in `contract.ts`.
- `yaml` is used in `contract.ts`, `branding.test.ts`, and the CI script `deploy/scripts/check-ci-needs.mjs` plus its test. The CI script runs in a dev/CI checkout, where devDependencies are installed; its test passes 46/46.

No runtime path uses them, so all three moved to `devDependencies`.

**Effect:** they are off the module allow-list (`THIRD_PARTY` = `dependencies`), so a module file importing `ajv` is now a violation. The reviewer's planted import gives `imports package ajv`, where the round-1 log showed `[]`.
- `yaml` leaves the production install (`development` in the regenerated inventory).
- `ajv@8.17.1` and `ajv-formats@3.0.1` stay in the **runtime** dependency graph **transitively**, because fastify's own validator/serializer depend on them. The SBOM therefore still classifies them `runtime`, now attributed `apps/api (dev)`. **Moving them did not take them out of the production image, and they could not be removed:** fastify needs them. What changed is that first-party module source can no longer import them.

**Lint:** the testkit header now states that the lint governs first-party source, not a third-party package's internal codegen (D-055, F-DG1-143). Test files may import devDependencies; module source may not. The lint is not weakened: module source lost the ajv/yaml allowance it had before.

### F-DG1-145 / F-DG1-001 / F-DG1-230 (REQ-S19-004, Low)
- The data dictionary has a new "Views (read models)" section. It covers `actor_display` (0001, identity), `business_unit_closure` (0001, organization; depth 0–10 cap) and `scope_node` (0002, access): columns, source tables/definition, purpose, the `mth_app` SELECT grant, and the test that pins them.
- The ERD lists the three views and the 0009 guard.
- The `schema.ts` comment now cites `catalogue.test.ts`.

### F-DG1-002 (Low)
`docs/operations/clean-start.md` step A1–A2 is corrected (see the note in section 1).

## 3. Migration and API endpoints
- **Migration added:** `packages/db/migrations/0009_business_unit_hierarchy_guard.sql`. 0001–0008 are unchanged (the checksum-lock test passes).
- **API endpoints added:** none.
- **Endpoint behaviour changed:**
  - `PATCH /api/v1/business-units/{businessUnitId}`: destination authorization (new 403 case, already declared in the contract), hierarchy lock, trigger mapping.
  - `POST /api/v1/organizations/{organizationId}/business-units`: hierarchy lock, trigger depth mapped to the existing 400.
  - All routes: the global rate-limit key.

## 4. Checks actually run (real output; full logs in `T-DG1-BE-R2-evidence/`)
Environment: Linux sandbox, pnpm 10.33.0, offline, PostgreSQL 16.13 disposable clusters via `tests/qa/support/with-pg.sh` on unique ports (55141–55146). Node 22 = `/opt/node22/bin` (v22.22.2), Node 24 = `/opt/nvm/versions/node/v24.21.0/bin` (v24.21.0).

### 4.1 New tests fail on the old code
In a disposable clone at `9fea78d` (pre-fix, 8 migrations), only the new test files were copied in. A first attempt symlinked per-package `node_modules`, which resolved `@mth/db` to the working tree (9 migrations). I discarded that attempt and re-ran with copied symlink farms, so `@mth/db` resolved inside the clone. Log: `01-new-tests-on-old-code-9fea78d.log`. Command: `QA_PG_PORT=55143 tests/qa/support/with-pg.sh pnpm exec vitest run --project integration apps/api/test/integration/bu-hierarchy-guard.test.ts apps/api/test/integration/platform.test.ts` → exit 1:
```
[integration] PostgreSQL 16.13 (Ubuntu 16.13-0ubuntu0.24.04.1); database mth_test_muq1mz4c_1bc413bd; applied 8 migrations to a fresh database
   × F-DG1-140 concurrent re-parenting through the API never commits a cycle > A->C and B->A (with C under B) interleaved: one 200, the other 422 business_unit.cycle; no cycle persists 10704ms
   ✓ F-DG1-140 concurrent re-parenting through the API never commits a cycle > the sequential control is still the friendly 422 business_unit.cycle 47ms
   × F-DG1-140 the database guard (migration 0009) fails closed on its own > refuses a direct cycle and an over-deep chain with 23514 and the named constraint 15ms
   × F-DG1-140 the database guard (migration 0009) fails closed on its own > READ COMMITTED: two raw transactions forming A->C->B->A - the second fails with 23514 after the first commits 21204ms
   × F-DG1-140 the database guard (migration 0009) fails closed on its own > REPEATABLE READ with a snapshot older than the first commit: the second fails (40001 or 23514), no cycle 23ms
   × F-DG1-140 the database guard (migration 0009) fails closed on its own > READ COMMITTED depth race: a move that makes a subtree 10 deep and a concurrent child insert below it 10640ms
   × F-DG1-141 re-parenting authorizes the destination parent too > a manager scoped to BU a1 cannot move a1 units under sibling a2 or to the top level (403, audited); in-scope moves work 72ms
   ✓ health and readiness > reports ready when the database answers and every shipped migration is applied 9ms
   ✓ health and readiness > reports 503 not_ready/pending when the build ships a migration the database lacks, and fail on checksum drift 30ms
   ✓ rate limiting (ADR-0007 T-3) > limits auth endpoints per IP with a 429 problem and Retry-After 31ms
   ✓ rate limiting (ADR-0007 T-3) > limits general API traffic per session, never the health endpoints 86ms
   × rate limiting (ADR-0007 T-3) > does not reset the bucket when an unauthenticated client rotates fabricated session cookies 27ms
   × rate limiting (ADR-0007 T-3) > keys a validated session by its user, so it is not starved by an IP flood, and a revoked one falls back to the IP 60ms
   ✓ request hygiene > rejects malformed JSON, non-JSON bodies and bodies over 1 MiB with 400 problems 24ms
   ✓ request hygiene > answers unknown API paths with a 404 problem 1ms
   ✓ request hygiene > sends a strict same-origin Content-Security-Policy and other security headers 1ms
   ✓ fail-closed guards (ADR-0006) > refuses to start with an /api route that declares no access 2ms
   ✓ fail-closed guards (ADR-0006) > turns a success from a route that never consulted the policy function into a 500 3ms
⎯⎯⎯⎯⎯⎯⎯ Failed Tests 8 ⎯⎯⎯⎯⎯⎯⎯
Error: timed out waiting for 2 advisory lock waiter(s)
AssertionError: expected null to deeply equal { code: '23514', …(1) }
Error: timed out waiting for 1 advisory lock waiter(s)
AssertionError: expected null not to be null
Error: timed out waiting for 1 advisory lock waiter(s)
AssertionError: expected [ 200, 'BU5A0A58' ] to deeply equal [ 403, 'forbidden' ]
AssertionError: expected [ 401, 401, 401, 401, 401, 401, …(2) ] to deeply equal [ 401, 401, 401, 429, 429, 429, …(2) ]
AssertionError: expected 401 to be 429 // Object.is equality
      Tests  8 failed | 10 passed (18)
```
- On the old code the API concurrency test fails by timeout: the second request never waits on a hierarchy lock, because there is none. The fact that the old code **commits the cycle** is the reviewer's own reproduction (`docs/delivery/test-evidence/DG1/code-security/round-1/repro-bu/repro-bu.log`: both 200, parent(A)=C, parent(C)=B, parent(B)=A).
- 141: 200 instead of 403. 142: never 429.

### 4.2 Reviewer repros against the repaired code
In a disposable clone of `e85769370a37e9dbf977798de9f889570bccdcdf` plus this diff, the reviewer's `zz-review-bu-hierarchy.test.ts` and `zz-review-ratelimit.test.ts` were copied in unchanged. They assert the *vulnerable* behaviour, so they now **fail**. Log: `05-reviewer-repros-on-repaired-code.log`:
```
[integration] PostgreSQL 16.13 (Ubuntu 16.13-0ubuntu0.24.04.1); database mth_test_muq1s93z_e368a57d; applied 9 migrations to a fresh database
SEC-1 sequential control (B under A after A under C): 422 {"type":"urn:mth:problem:validation","title":"Business rule violated","status":422,"detail":"A business unit cannot be moved under itself or one of its descendants.","code":"business_unit.cycle","requestId":"01a0f95f-cd88-738d-8486-f6fcdb5352f6"}
SEC-2 control: U PATCH a2 -> 404
SEC-2 V read before: 404 | U move a1x->a2: 403 | V read after: 404 | U read a1x after: 200
   × SEC-1 concurrent re-parenting creates a business-unit cycle > A->C and B->A (with C already under B) both return 200 and the committed hierarchy has a cycle A->C->B->A 10466ms
   × SEC-2 re-parenting does not authorize the destination parent > a manager scoped to BU a1 moves a1x under sibling a2 (no rights on a2); a2's inheriting users gain a1x records 110ms
SEC-3 control (no cookie, same IP): 401,401,401,429,429,429
SEC-3 bypass (random cookie per request, same IP) status counts: {"429":50}
   ✓ SEC-3 global rate limit is bypassed by rotating an invalid session cookie > control: without a cookie the 4th request from one IP is 429 4ms
   × SEC-3 global rate limit is bypassed by rotating an invalid session cookie > bypass: 50 requests from the SAME IP with a fresh random 43-char cookie each are never 429 26ms
⎯⎯⎯⎯⎯⎯⎯ Failed Tests 3 ⎯⎯⎯⎯⎯⎯⎯
    171|     console.log("SEC-2 V read before:", before.status, "| U move a1x->…
     32|     console.log("SEC-3 bypass (random cookie per request, same IP) sta…
      Tests  3 failed | 1 passed (4)
```
- SEC-1: the second move now waits on the organization hierarchy lock instead of a row lock, so the reviewer's row-waiter wait times out. My test waits on the advisory lock and shows the outcome: 200 + 422, no cycle.
- SEC-2: 403, V's read stays 404, and U keeps its unit.
- SEC-3: 50 × 429.

### 4.3 Static checks (working tree, Node 24 default)
- `pnpm -r typecheck` → exit 0
- `pnpm lint` (`eslint . --max-warnings=0`) → exit 0
- `pnpm exec prettier --check <every edited/new TS/JSON/MD file, pnpm-lock.yaml, licenses/sbom.cdx.json>` → "All matched files use Prettier code style!", exit 0
- `node licenses/generate-sbom.mjs --check` → `OK: packages=422 runtime=111 bundled=17 development=294 containers=4 shipped-without-licence-id=0 lockfile-sha256=4f63722a…1703`, exit 0 (after regenerating)
- `pnpm install --offline --frozen-lockfile --lockfile-only` → "Done", exit 0 (the lockfile matches every manifest)
- `node --test deploy/scripts/tests/check-ci-needs.test.mjs` → 46 pass, 0 fail (yaml still resolves for the CI script)

### 4.4 Unit tests
`pnpm test` on Node 22 (`PATH=/opt/node22/bin:$PATH`) → exit 0 (`02-unit-node22.log`):
```
 ✓ |unit-node| apps/api/src/architecture.test.ts (133 tests) 1495ms
 Test Files  21 passed (21)
      Tests  326 passed (326)
```
`pnpm test` on Node 24 (`PATH=/opt/nvm/versions/node/v24.21.0/bin:$PATH`) → exit 0 (`02-unit-node24.log`):
```
 ✓ |unit-node| apps/api/src/architecture.test.ts (133 tests) 1512ms
 Test Files  21 passed (21)
      Tests  326 passed (326)
```

### 4.5 Integration tests
Full integration suite on a disposable PostgreSQL 16.13.
- Node 22: `PATH=/opt/node22/bin:$PATH QA_PG_PORT=55144 tests/qa/support/with-pg.sh bash -c 'node --version; pnpm test:integration'` → exit 0 (`03-integration-node22.log`):
```
v22.22.2
[integration] PostgreSQL 16.13 (Ubuntu 16.13-0ubuntu0.24.04.1); database mth_test_muq1qdcz_d8772071; applied 9 migrations to a fresh database
 ✓ |integration| apps/api/test/integration/bu-hierarchy-guard.test.ts (7 tests) 689ms
 ✓ |integration| apps/api/test/integration/platform.test.ts (11 tests) 299ms
 ✓ |integration| apps/worker/test/integration/outbox.test.ts (10 tests) 4999ms
 ✓ |integration| packages/db/test/integration/scratch-drop.test.ts (3 tests) 5356ms
 ✓ |integration| tests/qa/integration/a13-job-idempotency.test.ts (5 tests) 2962ms
 ✓ |integration| apps/api/test/integration/transformations.test.ts (30 tests) 597ms
 ✓ |integration| apps/api/test/integration/access-scope.test.ts (18 tests) 593ms
 ✓ |integration| apps/api/test/integration/access-derived-race.test.ts (4 tests) 704ms
 ✓ |integration| packages/db/test/integration/bootstrap.test.ts (5 tests) 1346ms
 ✓ |integration| apps/api/test/integration/admin.test.ts (11 tests) 497ms
 ✓ |integration| apps/api/test/integration/contract/contract.test.ts (9 tests) 568ms
 ✓ |integration| apps/api/test/integration/oidc.test.ts (19 tests) 459ms
 ✓ |integration| tests/qa/integration/a12-cross-scope.test.ts (14 tests) 469ms
 ✓ |integration| apps/api/test/integration/organizations.test.ts (10 tests) 365ms
 ✓ |integration| apps/api/test/integration/identity.test.ts (13 tests) 238ms
 ✓ |integration| packages/db/test/integration/migrate.test.ts (7 tests) 289ms
 ✓ |integration| tests/qa/integration/a14-concurrency.test.ts (5 tests) 214ms
 ✓ |integration| apps/worker/test/integration/maintenance.test.ts (2 tests) 221ms
 ✓ |integration| packages/db/test/integration/protection.test.ts (17 tests) 102ms
 ✓ |integration| packages/db/test/integration/catalogue.test.ts (9 tests) 30ms
 Test Files  20 passed (20)
      Tests  209 passed (209)
```
- Node 24: `PATH=/opt/nvm/versions/node/v24.21.0/bin:$PATH QA_PG_PORT=55145 tests/qa/support/with-pg.sh bash -c 'node --version; pnpm test:integration'` → exit 0 (`04-integration-node24.log`):
```
v24.21.0
[integration] PostgreSQL 16.13 (Ubuntu 16.13-0ubuntu0.24.04.1); database mth_test_muq1r2ks_43059768; applied 9 migrations to a fresh database
 ✓ |integration| packages/db/test/integration/scratch-drop.test.ts (3 tests) 7390ms
 ✓ |integration| apps/worker/test/integration/outbox.test.ts (10 tests) 5137ms
 ✓ |integration| tests/qa/integration/a13-job-idempotency.test.ts (5 tests) 3114ms
 ✓ |integration| packages/db/test/integration/bootstrap.test.ts (5 tests) 962ms
 ✓ |integration| apps/api/test/integration/access-derived-race.test.ts (4 tests) 625ms
 ✓ |integration| apps/api/test/integration/bu-hierarchy-guard.test.ts (7 tests) 581ms
 ✓ |integration| apps/api/test/integration/transformations.test.ts (30 tests) 572ms
 ✓ |integration| apps/api/test/integration/access-scope.test.ts (18 tests) 568ms
 ✓ |integration| apps/api/test/integration/contract/contract.test.ts (9 tests) 559ms
 ✓ |integration| apps/api/test/integration/admin.test.ts (11 tests) 461ms
 ✓ |integration| tests/qa/integration/a12-cross-scope.test.ts (14 tests) 484ms
 ✓ |integration| apps/api/test/integration/oidc.test.ts (19 tests) 568ms
 ✓ |integration| apps/api/test/integration/organizations.test.ts (10 tests) 377ms
 ✓ |integration| apps/api/test/integration/platform.test.ts (11 tests) 244ms
 ✓ |integration| packages/db/test/integration/migrate.test.ts (7 tests) 411ms
 ✓ |integration| apps/api/test/integration/identity.test.ts (13 tests) 236ms
 ✓ |integration| apps/worker/test/integration/maintenance.test.ts (2 tests) 278ms
 ✓ |integration| tests/qa/integration/a14-concurrency.test.ts (5 tests) 214ms
 ✓ |integration| packages/db/test/integration/protection.test.ts (17 tests) 101ms
 ✓ |integration| packages/db/test/integration/catalogue.test.ts (9 tests) 40ms
 Test Files  20 passed (20)
      Tests  209 passed (209)
```

### 4.6 Lockfile step
The assignment asked for `pnpm install --offline --lockfile-only`. **That command failed:** `ERR_PNPM_NO_OFFLINE_META Failed to resolve playwright-core@1.56.1 in package mirror` (the offline metadata cache lacks that package).

Instead I made the minimal lockfile edit by hand, a Python script that moved the 3 importer entries from `dependencies` to `devDependencies` under `importers: apps/api`. No `packages:`/`snapshots:` entries changed, and lockfile v9 carries no dev flags there. I validated it with `pnpm install --offline --frozen-lockfile --lockfile-only` (exit 0; pnpm rejects a lockfile that does not match the manifests) and the SBOM regeneration/check. The diff is 9 lines moved (in `00-diff-tracked.patch`).

## 5. Known gaps / not done
- **Validator not run.** I did not run `node tools/gates/validate.mjs` or the candidate tool. Freezing and validating are orchestrator steps.
- **Depth residual under REPEATABLE READ.** It is stated in section 2 (depth only; the application uses READ COMMITTED).
- **ajv/ajv-formats stay in the production image** as fastify's transitive dependencies (see F-DG1-143). Only the direct dependency and the module allow-list entry are gone.
- **Rate-limit tradeoff (new behaviour).**
  - The first request of a session that this process has not validated within the idle timeout is counted against the client IP. Examples: after an API restart, or on another instance in a future multi-instance P6.
  - During an IP-level flood, such a request can get a 429 until the IP bucket refills.
  - Already-validated sessions are unaffected (tested).
  - The store is still in-process, as before (ADR-0007 T-3).
- **No interactive/UI checks.** Backend only.

## 6. Merge instructions
- Apply the migration with `mth-db migrate` (forward-only; 0009 runs after 0008). It aborts with a clear message if existing business-unit data already has a cycle or a depth over 10. Repair the data first in that case. No other ordering constraints.
- `pnpm-lock.yaml`, `licenses/inventory.csv` and `licenses/sbom.cdx.json` must be committed together with `apps/api/package.json`.
- Expected conflict surface: none with the frontend run (it edits `apps/web/**` only). `apps/api/test/integration/platform.test.ts` and `organizations`-area files were edited only here.

## Appendix A — migration 0009 (full text)
```sql
-- 0009 database-level guard for the business-unit hierarchy (T-DG1-BE-R2, F-DG1-140; REQ-S19-004, ADR-0006).
-- Until now "no cycles, depth <= 10" was only an API check (0001 business_unit comment). It ran under READ COMMITTED
-- with no serialization, so two concurrent re-parents (A under C while B moves under A, with C under B) each passed
-- the check against the committed hierarchy and together committed the cycle A -> C -> B -> A.
--
-- This trigger makes the database refuse such a row, whatever the client and however the writes interleave:
--  1. SERIALIZE: every INSERT with a parent, and every change of parent_business_unit_id / organization_id, takes the
--     transaction-scoped advisory lock (HIERARCHY_LOCK_CLASS, hashtext(organization_id)). The API takes the SAME lock
--     before its own (friendly, 422) checks (organization/repository.ts lockBusinessUnitHierarchy), so in the
--     application the checks and the write are serialized per organization. A hash collision between two
--     organizations only serializes them more than needed; it never weakens the guard.
--  2. RE-CHECK after the write is applied (AFTER ROW, so a multi-row statement is checked on its final state) and
--     after the lock is held. Under READ COMMITTED every query below takes a fresh snapshot, so it sees what the
--     previous lock holder committed.
--  3. LOCKING WALK: the parent chain is walked with SELECT ... FOR SHARE. Under REPEATABLE READ / SERIALIZABLE (whose
--     snapshot may predate the lock) a chain row that a concurrent transaction changed raises a serialization failure
--     (40001) instead of being read stale, so the cycle check fails closed at every isolation level. The walk stops
--     after 10 levels, so even a pre-existing loop cannot make it spin.
--  Depth: parent levels + 1 + height of the moved subtree must stay <= 10 (MAX_BU_DEPTH = 9 below the organization in
--  organization/routes.ts). The subtree height is read without row locks: under READ COMMITTED it is serialized by the
--  lock (every insert with a parent takes it too); under REPEATABLE READ a concurrent child insert into the moved
--  subtree is a stated residual for DEPTH only (no cycle is possible through an insert: the FK is not deferrable, so
--  a new row can never be anyone's parent yet). The application uses READ COMMITTED.
-- Errors: SQLSTATE 23514 (check_violation) with constraint name business_unit_acyclic or business_unit_max_depth; the
-- API maps both to its existing business_unit.cycle / business_unit.depth_exceeded problems.

-- Refuse to install over a hierarchy that is already broken (fail loudly; an operator must repair the data first).
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM business_unit_closure WHERE ancestor_id = descendant_id AND depth > 0) THEN
    RAISE EXCEPTION 'business_unit hierarchy already contains a cycle; repair it before applying 0009';
  END IF;
  IF EXISTS (SELECT 1 FROM business_unit_closure WHERE depth > 9) THEN
    RAISE EXCEPTION 'business_unit hierarchy is already deeper than 10 levels; repair it before applying 0009';
  END IF;
END $$;

CREATE FUNCTION business_unit_hierarchy_guard() RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog, public
AS $$
DECLARE
  -- Advisory-lock class shared with the API (organization/repository.ts HIERARCHY_LOCK_CLASS).
  hierarchy_lock_class CONSTANT integer := 730219;
  max_levels CONSTANT integer := 10;
  cur uuid;
  parent_levels integer := 0;
  height integer;
BEGIN
  IF TG_OP = 'UPDATE'
     AND NEW.parent_business_unit_id IS NOT DISTINCT FROM OLD.parent_business_unit_id
     AND NEW.organization_id = OLD.organization_id THEN
    RETURN NULL;
  END IF;
  -- A root unit cannot close a cycle, and its depth (1 + height) cannot exceed what it already had below a parent.
  IF NEW.parent_business_unit_id IS NULL THEN
    RETURN NULL;
  END IF;

  PERFORM pg_advisory_xact_lock(hierarchy_lock_class, hashtext(NEW.organization_id::text));

  cur := NEW.parent_business_unit_id;
  WHILE cur IS NOT NULL LOOP
    IF cur = NEW.id THEN
      RAISE EXCEPTION 'business unit % cannot be placed under its own descendant %', NEW.id, NEW.parent_business_unit_id
        USING ERRCODE = 'check_violation', CONSTRAINT = 'business_unit_acyclic', TABLE = 'business_unit';
    END IF;
    parent_levels := parent_levels + 1;
    IF parent_levels >= max_levels THEN
      RAISE EXCEPTION 'business unit % would be nested deeper than % levels', NEW.id, max_levels
        USING ERRCODE = 'check_violation', CONSTRAINT = 'business_unit_max_depth', TABLE = 'business_unit';
    END IF;
    SELECT b.parent_business_unit_id INTO cur FROM business_unit b WHERE b.id = cur FOR SHARE;
  END LOOP;

  WITH RECURSIVE sub (id, d) AS (
    SELECT NEW.id, 0
    UNION ALL
    SELECT c.id, s.d + 1 FROM business_unit c JOIN sub s ON c.parent_business_unit_id = s.id WHERE s.d < max_levels
  )
  SELECT max(d) INTO height FROM sub;

  IF parent_levels + 1 + height > max_levels THEN
    RAISE EXCEPTION 'business unit % would be nested deeper than % levels', NEW.id, max_levels
      USING ERRCODE = 'check_violation', CONSTRAINT = 'business_unit_max_depth', TABLE = 'business_unit';
  END IF;
  RETURN NULL;
END $$;

CREATE TRIGGER business_unit_hierarchy_guard
  AFTER INSERT OR UPDATE OF parent_business_unit_id, organization_id ON business_unit
  FOR EACH ROW EXECUTE FUNCTION business_unit_hierarchy_guard();

COMMENT ON FUNCTION business_unit_hierarchy_guard() IS
  'F-DG1-140: refuses a business_unit row that would close a cycle or nest deeper than 10 levels; serialized per organization by an advisory lock shared with the API.';
```

## Appendix B — key diffs (organization routes, server, identity routes, package.json, lockfile, schema.ts, clean-start, inventory)
Full diff of every tracked change plus the new files: `T-DG1-BE-R2-evidence/00-diff-tracked.patch`. The SBOM JSON diff is omitted; it is 17 lines, regenerated.
```diff
diff --git a/apps/api/package.json b/apps/api/package.json
index 5125c41..870227c 100644
--- a/apps/api/package.json
+++ b/apps/api/package.json
@@ -27,18 +27,18 @@
     "@mth/db": "workspace:*",
     "@mth/design-tokens": "workspace:*",
     "@mth/shared": "workspace:*",
-    "ajv": "8.17.1",
-    "ajv-formats": "3.0.1",
     "decimal.js": "10.6.0",
     "fastify": "5.6.1",
     "kysely": "0.28.7",
     "openid-client": "6.8.1",
     "pg": "8.16.3",
     "uuid": "13.0.0",
-    "yaml": "2.8.1",
     "zod": "4.1.12"
   },
   "devDependencies": {
-    "@types/pg": "8.15.5"
+    "@types/pg": "8.15.5",
+    "ajv": "8.17.1",
+    "ajv-formats": "3.0.1",
+    "yaml": "2.8.1"
   }
 }
diff --git a/apps/api/src/modules/identity/routes.ts b/apps/api/src/modules/identity/routes.ts
index 587ecb2..c28e31c 100644
--- a/apps/api/src/modules/identity/routes.ts
+++ b/apps/api/src/modules/identity/routes.ts
@@ -25,6 +25,7 @@ import {
   touchSession,
   type ActiveSession,
 } from "./sessions.ts";
+import type { RateLimitSubjects } from "./rate-limit-subjects.ts";
 import { loadUser, updatePreferences } from "./users.ts";
 
 /**
@@ -61,6 +62,11 @@ export function sameOrigin(request: FastifyRequest, appOrigin: string): boolean
 export interface IdentityOptions {
   /** Injected OIDC service (tests pass one bound to a local fake IdP); defaults to one built from config. */
   readonly oidc?: OidcService | null;
+  /**
+   * Validated-session subjects for the global rate limiter's key (F-DG1-142). The composition root shares one instance
+   * with the limiter; this module is its only writer.
+   */
+  readonly rateLimitSubjects?: RateLimitSubjects;
 }
 
 export function registerIdentity(
@@ -77,6 +83,7 @@ export function registerIdentity(
   const cookieName = sessionCookieName(config.appBaseUrl);
   const secureCookie = config.appBaseUrl.protocol === "https:";
   const oidc = options.oidc !== undefined ? options.oidc : config.oidc ? new OidcService(config) : null;
+  const subjects = options.rateLimitSubjects ?? null;
   const authRateLimit = {
     max: config.rateLimit.authPerMinute,
     timeWindow: "1 minute",
@@ -112,7 +119,9 @@ export function registerIdentity(
     const token = cookieValue(request, cookieName);
     if (token) {
       const session = await resolveSession(db, token);
+      if (!session) subjects?.forget(token);
       if (session) {
+        subjects?.remember(token, session.userId);
         await touchSession(db, session, config.session.idleMinutes);
         request.session = session;
         request.principal = {
@@ -146,7 +155,10 @@ export function registerIdentity(
   ) {
     const { sessionId, token } = await db.transaction().execute(async (tx) => {
       // Session rotation on login: a previous session presented by this browser is revoked.
-      if (request.session) await revokeSession(tx, request.session.id);
+      if (request.session) {
+        await revokeSession(tx, request.session.id);
+        subjects?.forget(request.session.token);
+      }
       const s = await createSession(tx, {
         userId,
         authMode: mode,
@@ -170,6 +182,7 @@ export function registerIdentity(
       return s;
     });
     setSessionCookie(reply, token);
+    subjects?.remember(token, userId);
     return sessionId;
   }
 
@@ -329,6 +342,7 @@ export function registerIdentity(
       });
     });
     clearSessionCookie(reply);
+    subjects?.forget(session.token);
     const endSessionUrl = session.authMode === "oidc" && oidc ? await oidc.endSessionUrl() : null;
     return { endSessionUrl };
   });
diff --git a/apps/api/src/modules/organization/routes.ts b/apps/api/src/modules/organization/routes.ts
index 9fa5247..2147787 100644
--- a/apps/api/src/modules/organization/routes.ts
+++ b/apps/api/src/modules/organization/routes.ts
@@ -40,7 +40,9 @@ import {
 import {
   findBusinessUnit,
   findOrganization,
+  hierarchyViolation,
   isDescendant,
+  lockBusinessUnitHierarchy,
   subtreeHeight,
   toBusinessUnit,
   toOrganization,
@@ -74,6 +76,32 @@ function uniqueCode(e: unknown, what: string): never {
   throw e;
 }
 
+const cycleRefused = () =>
+  problems.businessRule(
+    "business_unit.cycle",
+    "A business unit cannot be moved under itself or one of its descendants.",
+  );
+const depthExceeded = () =>
+  problems.businessRule(
+    "business_unit.depth_exceeded",
+    `Business units can be nested at most ${MAX_BU_DEPTH + 1} levels deep.`,
+  );
+// createBusinessUnit declares no 422 in the contract, so on create the depth rule surfaces as a 400 field error.
+const depthExceededOnCreate = () =>
+  problems.badRequest(
+    "business_unit.depth_exceeded",
+    `Business units can be nested at most ${MAX_BU_DEPTH + 1} levels deep.`,
+    "/parentBusinessUnitId",
+  );
+
+/** The database hierarchy guard (migration 0009) refused the write: the same problems as the API's own checks. */
+function hierarchyRule(e: unknown): never {
+  const v = hierarchyViolation(e);
+  if (v === "cycle") throw cycleRefused();
+  if (v === "depth") throw depthExceeded();
+  throw e;
+}
+
 export function registerOrganizationRoutes(app: FastifyInstance, { db, config }: ModuleDeps): void {
   // ---------------------------------------------------------------- organizations
   app.get("/api/v1/organizations", { config: { access: { permission: "organization.read" } } }, async (request) => {
@@ -253,6 +281,7 @@ export function registerOrganizationRoutes(app: FastifyInstance, { db, config }:
         });
         await requireAction(tx, principal, "business_unit.manage", target);
         if (body.parentBusinessUnitId !== undefined) {
+          await lockBusinessUnitHierarchy(tx, organizationId); // F-DG1-140: depth check vs a concurrent move
           const parent = await findBusinessUnit(tx, body.parentBusinessUnitId);
           // createBusinessUnit declares no 422 in the contract, so these rules surface as 400 field errors.
           if (!parent || parent.organization_id !== organizationId) {
@@ -263,13 +292,7 @@ export function registerOrganizationRoutes(app: FastifyInstance, { db, config }:
             );
           }
           const parentTarget = await targetFor(tx, "business_unit", { organizationId, businessUnitId: parent.id });
-          if (parentTarget.businessUnitAncestry.length > MAX_BU_DEPTH) {
-            throw problems.badRequest(
-              "business_unit.depth_exceeded",
-              `Business units can be nested at most ${MAX_BU_DEPTH + 1} levels deep.`,
-              "/parentBusinessUnitId",
-            );
-          }
+          if (parentTarget.businessUnitAncestry.length > MAX_BU_DEPTH) throw depthExceededOnCreate();
         }
         const id = uuidv7();
         const created = await tx
@@ -286,7 +309,10 @@ export function registerOrganizationRoutes(app: FastifyInstance, { db, config }:
           })
           .returningAll()
           .executeTakeFirstOrThrow()
-          .catch((e: unknown) => uniqueCode(e, "business unit"));
+          .catch((e: unknown) => {
+            if (hierarchyViolation(e) === "depth") throw depthExceededOnCreate();
+            return uniqueCode(e, "business unit");
+          });
         await record(tx, audit, {
           action: "business_unit.create",
           recordType: "business_unit",
@@ -332,12 +358,24 @@ export function registerOrganizationRoutes(app: FastifyInstance, { db, config }:
         });
         await requireAction(tx, principal, "business_unit.manage", target);
         const expected = requireIfMatch(request);
+        // F-DG1-140: a re-parent serializes on the organization's hierarchy lock BEFORE reading anything it checks, so
+        // two concurrent moves can never both pass the cycle/depth checks against the same committed hierarchy. The
+        // database trigger (migration 0009) re-checks under the same lock as the last line of defence.
+        if (body.parentBusinessUnitId !== undefined) await lockBusinessUnitHierarchy(tx, target.organizationId);
         const current = await findBusinessUnit(tx, businessUnitId, true);
         if (!current) throw problems.notFound();
         if (current.version !== expected) throw problems.versionConflict(current.version);
         if (body.parentBusinessUnitId !== undefined && body.parentBusinessUnitId !== current.parent_business_unit_id) {
           const parentId = body.parentBusinessUnitId;
-          if (parentId !== null) {
+          if (parentId === null) {
+            // F-DG1-141: the destination of a move to the top level is the organization itself.
+            await requireAction(
+              tx,
+              principal,
+              "business_unit.manage",
+              await targetFor(tx, "organization", { organizationId: current.organization_id }),
+            );
+          } else {
             const parent = await findBusinessUnit(tx, parentId);
             if (!parent || parent.organization_id !== current.organization_id) {
               throw problems.businessRule(
@@ -345,11 +383,20 @@ export function registerOrganizationRoutes(app: FastifyInstance, { db, config }:
                 "The parent business unit must exist in the same organization.",
               );
             }
+            // F-DG1-141: a move writes into the destination branch, so the actor needs business_unit.manage on the
+            // destination parent as well as on the moved unit (ADR-0006: grants never apply across siblings).
+            // Refused 403 with an audited authorization.denied (denials.ts).
+            await requireAction(
+              tx,
+              principal,
+              "business_unit.manage",
+              await targetFor(tx, "business_unit", {
+                organizationId: parent.organization_id,
+                businessUnitId: parentId,
+              }),
+            );
             if (parentId === businessUnitId || (await isDescendant(tx, businessUnitId, parentId))) {
-              throw problems.businessRule(
-                "business_unit.cycle",
-                "A business unit cannot be moved under itself or one of its descendants.",
-              );
+              throw cycleRefused();
             }
             const parentDepth = (
               await targetFor(tx, "business_unit", {
@@ -357,12 +404,7 @@ export function registerOrganizationRoutes(app: FastifyInstance, { db, config }:
                 businessUnitId: parentId,
               })
             ).businessUnitAncestry.length;
-            if (parentDepth + (await subtreeHeight(tx, businessUnitId)) > MAX_BU_DEPTH) {
-              throw problems.businessRule(
-                "business_unit.depth_exceeded",
-                `Business units can be nested at most ${MAX_BU_DEPTH + 1} levels deep.`,
-              );
-            }
+            if (parentDepth + (await subtreeHeight(tx, businessUnitId)) > MAX_BU_DEPTH) throw depthExceeded();
           }
         }
         const updated = await tx
@@ -379,7 +421,8 @@ export function registerOrganizationRoutes(app: FastifyInstance, { db, config }:
           .where("id", "=", businessUnitId)
           .where("version", "=", expected)
           .returningAll()
-          .executeTakeFirstOrThrow();
+          .executeTakeFirstOrThrow()
+          .catch(hierarchyRule);
         await record(tx, audit, {
           action: "business_unit.update",
           recordType: "business_unit",
diff --git a/apps/api/src/server.ts b/apps/api/src/server.ts
index 832ac83..d6e5279 100644
--- a/apps/api/src/server.ts
+++ b/apps/api/src/server.ts
@@ -3,7 +3,8 @@
 //
 // Order matters:
 //   1. platform hooks (request IDs, problem+json, route access declarations, fail-closed guard);
-//   2. security headers (helmet, strict same-origin CSP), cookies, rate limiting (per session or IP; stricter on auth);
+//   2. security headers (helmet, strict same-origin CSP), cookies, rate limiting (per validated-session subject or IP;
+//      stricter on auth);
 //   3. the failed-authorization audit hook, health routes, identity (authentication + CSRF hook), then the modules;
 //   4. the built SPA, when present, from the same origin (no CDN).
 import { existsSync } from "node:fs";
@@ -19,7 +20,7 @@ import type pg from "pg";
 import { registerDeniedMutationAudit } from "./modules/access/index.ts";
 import { colorTokens, tokensAreProvisional } from "@mth/design-tokens";
 import { registerAdminRoutes, registerBrandingRoutes } from "./modules/admin/index.ts";
-import { registerIdentity, sessionCookieName, sha256, type OidcService } from "./modules/identity/index.ts";
+import { RateLimitSubjects, registerIdentity, sessionCookieName, type OidcService } from "./modules/identity/index.ts";
 import { registerKpiModule } from "./modules/kpi/index.ts";
 import { registerOrganizationRoutes } from "./modules/organization/index.ts";
 import {
@@ -119,15 +120,21 @@ export async function buildServer(
   await app.register(cookie);
 
   const cookieName = sessionCookieName(config.appBaseUrl);
+  // F-DG1-142: the limiter never trusts a presented cookie value. Only a cookie the identity hook has RESOLVED to a
+  // live session (within the idle timeout) maps to the authenticated subject; everything else - no cookie, forged,
+  // expired or revoked - is keyed by the client IP, so rotating fake cookies cannot open fresh buckets.
+  const rateLimitSubjects = new RateLimitSubjects(config.session.idleMinutes * 60_000);
   await app.register(rateLimit, {
     global: true,
     max: config.rateLimit.perMinute,
     timeWindow: "1 minute",
-    // Keyed by session (hash of the cookie, never the raw value) or else the client IP (TRUST_PROXY decides which
-    // X-Forwarded-For hops count). In-process store (ADR-0007 T-3); a PostgreSQL store comes with multi-instance P6.
+    // Keyed by the authenticated subject (user id) of a validated session, or else the client IP (TRUST_PROXY decides
+    // which X-Forwarded-For hops count). Decided without a database lookup, so floods are refused before any query.
+    // In-process store (ADR-0007 T-3); a PostgreSQL store comes with multi-instance P6.
     keyGenerator: (request: FastifyRequest) => {
       const token = request.cookies?.[cookieName];
-      return token ? `s:${sha256(token).toString("hex")}` : `ip:${request.ip}`;
+      const subject = token ? rateLimitSubjects.subjectOf(token) : null;
+      return subject ? `u:${subject}` : `ip:${request.ip}`;
     },
     allowList: (request: FastifyRequest) => request.url === "/healthz" || request.url === "/readyz",
     errorResponseBuilder: () => problems.rateLimited(),
@@ -136,7 +143,10 @@ export async function buildServer(
   registerDeniedMutationAudit(app, db);
   registerHealthRoutes(app, pool, options.migrationFiles ?? listMigrationFiles());
   const deps = { db, config };
-  registerIdentity(app, deps, options.oidc !== undefined ? { oidc: options.oidc } : {});
+  registerIdentity(app, deps, {
+    rateLimitSubjects,
+    ...(options.oidc !== undefined ? { oidc: options.oidc } : {}),
+  });
   registerOrganizationRoutes(app, deps);
   registerTransformationRoutes(app, deps);
   registerAdminRoutes(app, deps);
diff --git a/docs/operations/clean-start.md b/docs/operations/clean-start.md
index 3f717a7..872cd7a 100644
--- a/docs/operations/clean-start.md
+++ b/docs/operations/clean-start.md
@@ -88,7 +88,7 @@ matches the image. It then runs the image's `entrypoint.sh` with `MTH_APP_ROOT`
 
 | Step | Checks |
 |---|---|
-| A1–A2 | `mth db status` = 3 (pending) on an empty DB. `mth migrate` applies 6 migrations, a re-run is a no-op, then status = 0 |
+| A1–A2 | `mth db status` = 3 (pending) on an empty DB. `mth migrate` applies every shipped migration in `packages/db/migrations/` (currently 9: `0001`–`0009`), a re-run is a no-op, then status = 0 |
 | A3 | `mth db seed-dev` is refused (64): dev seeds are not in the image. `AUTH_MODE=dev` with `NODE_ENV=production` exits 78 |
 | A4–A5 | api + worker in production mode (OIDC). `/healthz` and `/readyz` are ready. `GET /` serves the SPA. The dev login is 404. An unreachable IdP makes login redirect to `/login?error=idp_unavailable` without crashing. `/me` without a session is 401 |
 | A6 | `mth db bootstrap` creates the first organization and admin. A second bootstrap is refused |
@@ -98,7 +98,7 @@ matches the image. It then runs the image's `entrypoint.sh` with `MTH_APP_ROOT`
 ## Measured timings (container-free path B)
 
 Recorded 2026-09-30 in the build sandbox: 4 vCPU, 15 GiB RAM, Node 22.22.2, pnpm 10.33.0, PostgreSQL 16.13 (local
-floor version; Compose uses 18). Offline install from a pre-populated store. Workload: one fresh clone, 6 migrations,
+floor version; Compose uses 18). Offline install from a pre-populated store. Workload: one fresh clone, 6 migrations (the count at the time of measurement),
 1 organization, 4 business units, 6 users, 1 transformation.
 
 | Step | Seconds |
diff --git a/licenses/inventory.csv b/licenses/inventory.csv
index e05dfe0..5951cfe 100644
--- a/licenses/inventory.csv
+++ b/licenses/inventory.csv
@@ -166,9 +166,9 @@ acorn,8.18.0,MIT,development,,sha512-lGq+9yr1/GuAWaVYIHRjvvySG5/4VfKIvC8EWxStPdc
 acorn-jsx,5.3.2,MIT,development,,sha512-rq9s+JNhf0IChjtDXxllJ7g41oZk5SlXtp0LHwyA5cejwn7vKmKp4pPri6YEePv2PU65sAsegbXtIinmDFDXgQ==
 agent-base,7.1.4,MIT,development,,sha512-MnA+YT8fwfJPgBx3m60MNqakm30XOkyIoH1y6huTQvC0PwZG7ki8NacLBcrPbNoo8vEZy7Jpuk7+jMO+CUovTQ==
 ajv,6.15.0,MIT,development,,sha512-fgFx7Hfoq60ytK2c7DhnF8jIvzYgOMxfugjLOSMHjLIPgenqa7S7oaagATUq99mV6IYvN2tRmC0wnTYX6iPbMw==
-ajv,8.17.1,MIT,runtime,apps/api,sha512-B/gBuNg5SiMTrPkC+A2+cW0RszwxYmn6VYxB/inlBStS5nx6xHIt/ehKRhIMhqusl7a8LjQoZnjCs5vhwxOQ1g==
+ajv,8.17.1,MIT,runtime,apps/api (dev),sha512-B/gBuNg5SiMTrPkC+A2+cW0RszwxYmn6VYxB/inlBStS5nx6xHIt/ehKRhIMhqusl7a8LjQoZnjCs5vhwxOQ1g==
 ajv-draft-04,1.0.0,MIT,development,,sha512-mv00Te6nmYbRp5DCwclxtt7yV/joXJPGS7nM+97GdxvuttCOfgI3K4U25zboyeX0O+myI8ERluxQe5wljMmVIw==
-ajv-formats,3.0.1,MIT,runtime,apps/api,sha512-8iUql50EUR+uUcdRQ3HDqa6EVyo3docL8g5WJ3FNcWmu62IbkGUue/pEyLBW8VGKKucTPgqeks4fIU1DA4yowQ==
+ajv-formats,3.0.1,MIT,runtime,apps/api (dev),sha512-8iUql50EUR+uUcdRQ3HDqa6EVyo3docL8g5WJ3FNcWmu62IbkGUue/pEyLBW8VGKKucTPgqeks4fIU1DA4yowQ==
 ansi-regex,5.0.1,MIT,development,,sha512-quJQXlTSUGL2LH9SUXo8VwsY4soanhgo6LNSm84E1LBcE8s3O0wpdiRzyR9z/ZZJMlMWv37qOOb9pdJlMUEKFQ==
 ansi-styles,5.2.0,MIT,development,,sha512-Cxwpt2SfTzTtXcfOlzGEee8O+c+MmUgGrNiBcXnuWxuFJHe6a5Hz7qwhwe5OgaSYI0IJvkLqWX1ASG+cJOkEiA==
 argparse,2.0.1,Python-2.0,development,,sha512-8+9WqebbFzpX9OR+Wa6O29asIogeRMzcGtAINdpMHHyAg10f05aSFVBbcEqGf/PXw1EjAZ+q2/bEBg3DvurK3Q==
@@ -417,7 +417,7 @@ xml-name-validator,5.0.0,Apache-2.0,development,,sha512-EvGK8EJ3DhaHfbRlETOWAS5p
 xmlchars,2.2.0,MIT,development,,sha512-JZnDKK8B0RCDw84FNdDAIpZK+JuJw+s7Lz8nksI7SIuU3UXJJslUthsi+uWBUYOwPFwW7W7PRLRfUKpxjtjFCw==
 xtend,4.0.2,MIT,runtime,,sha512-LKYU1iAXJXUgAXn9URjiu+MWhyUXHsvfp7mcuYm9dSUKK0/CjtrUwFAxD82/mCWbtLsGjFIad0wIsod4zrTAEQ==
 yallist,3.1.1,ISC,development,,sha512-a4UGQaWPH59mOXUYnAG2ewncQS4i4F43Tv3JoAM+s2VDAmS9NsK8GpDMLrCHPksFT7h3K6TOoUNn2pb7RoXx4g==
-yaml,2.8.1,ISC,runtime,apps/api,sha512-lcYcMxX2PO9XMGvAJkJ3OsNMw+/7FKes7/hgerGUYWIoWu5j/+YQqcZr5JnPZWzOsEBgMbSbiSTn/dv/69Mkpw==
+yaml,2.8.1,ISC,development,apps/api (dev),sha512-lcYcMxX2PO9XMGvAJkJ3OsNMw+/7FKes7/hgerGUYWIoWu5j/+YQqcZr5JnPZWzOsEBgMbSbiSTn/dv/69Mkpw==
 yocto-queue,0.1.0,MIT,development,,sha512-rVksvsnNCdJ/ohGc6xgPwyN8eheCxsiLM8mxuE/t/mOVqJewPuO1miLpTHQiRgTKCLexL4MeAFVagts7HmNZ2Q==
 zod,4.1.12,MIT,runtime,apps/api; apps/web; apps/worker; packages/config; packages/shared,sha512-JInaHOamG8pt5+Ey8kGmdcAcg3OL9reK8ltczgHTAwNhMys/6ThXHityHxVV2p3fkw/c+MAvBHFVYHFZDmjMCQ==
 zod-validation-error,4.0.2,MIT,development,,sha512-Q6/nZLe6jxuU80qb/4uJ4t5v2VEZ44lzQjPDhYJNztRQ4wyWc6VF3D3Kb/fAuPetZQnhS3hnajCf9CsWesghLQ==
diff --git a/packages/db/src/schema.ts b/packages/db/src/schema.ts
index e96c642..5b2f129 100644
--- a/packages/db/src/schema.ts
+++ b/packages/db/src/schema.ts
@@ -1,6 +1,6 @@
 // Kysely `Database` interface for the P1 tables (ADR-0003), written by hand from
-// docs/architecture/data-dictionary.md. An integration test (packages/db/test/integration/schema.test.ts)
-// compares every table and column here with information_schema after the migrations run, so a drift fails CI.
+// docs/architecture/data-dictionary.md. An integration test (packages/db/test/integration/catalogue.test.ts)
+// compares every table, view and column here with information_schema after the migrations run, so a drift fails CI.
 //
 // Type mapping (node-postgres defaults): timestamptz -> Date, bigint -> string, numeric -> string,
 // bytea -> Buffer, jsonb -> parsed JSON, text[] -> string[].
diff --git a/pnpm-lock.yaml b/pnpm-lock.yaml
index 4e8938a..6a12b25 100644
--- a/pnpm-lock.yaml
+++ b/pnpm-lock.yaml
@@ -68,12 +68,6 @@ importers:
       '@mth/shared':
         specifier: workspace:*
         version: link:../../packages/shared
-      ajv:
-        specifier: 8.17.1
-        version: 8.17.1
-      ajv-formats:
-        specifier: 3.0.1
-        version: 3.0.1(ajv@8.17.1)
       decimal.js:
         specifier: 10.6.0
         version: 10.6.0
@@ -92,9 +86,6 @@ importers:
       uuid:
         specifier: 13.0.0
         version: 13.0.0
-      yaml:
-        specifier: 2.8.1
-        version: 2.8.1
       zod:
         specifier: 4.1.12
         version: 4.1.12
@@ -102,6 +93,15 @@ importers:
       '@types/pg':
         specifier: 8.15.5
         version: 8.15.5
+      ajv:
+        specifier: 8.17.1
+        version: 8.17.1
+      ajv-formats:
+        specifier: 3.0.1
+        version: 3.0.1(ajv@8.17.1)
+      yaml:
+        specifier: 2.8.1
+        version: 2.8.1
 
   apps/web:
     dependencies:
```
