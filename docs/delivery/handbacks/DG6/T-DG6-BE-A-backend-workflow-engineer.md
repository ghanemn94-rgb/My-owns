# Handback T-DG6-BE-A: P6 registry, stubs and wiring points (backend-workflow-engineer)

- **Stage:** P6 "Integration and system hardening", gate DG6 (BUILDING). This is engineering delivery work. Nothing here grants a business, Finance or IT approval. No product gate G1–G6 is decided, and nothing reads or writes the DG0–DG7 records. Product G6 never implies DG7.
- **Assignment:** `docs/delivery/assignments/DG6/T-DG6-BE-A.md` (sha256 `024266d5375d47382396bd32ff1e88698351841f757f796a81960746c5f23230`, verified at start). Scope: `docs/architecture/p6-work-split.md` §E/F.1 (which points to the p6-plan §5.1 BE-A list), shared rules §2, D-193 to D-196.
- **Invocation reference:** `{"kind":"claude-code-cli-session","run_id":"DG6-T-DG6-BE-A-backend-workflow-engineer-20261026T164021Z-5a73b485","session_id":"5a73b485-b7bf-48c1-b34e-491fbbe9aadd"}`.
- **Working tree:** worktree `/home/user/wt/dg6-be-a`, branch `dg6/be-a`, base `702a6bb4851a34d9d3a6b0311cdd542ec44f55a9`. All changes are left **uncommitted** for the orchestrator.
- **Time:** `date -u` at start `2026-10-26T16:40:34Z`; at end `2026-10-26T18:16:41Z` (after the closing validator run). About 96 minutes, inside the 2-hour limit. About 52 of them were the full integration run. Nothing was salvaged or split.
- **Preceding gate:** `node tools/gates/validate.mjs --historical --stage DG5` exited **0** at the start (`PASS gate DG5 (historical)`) and at the end (§0).
- **Data:** every fixture value in the new tests is synthetic.

## 0. Checks actually run (final tree; logs in `T-DG6-BE-A-evidence/`)

Environment: Node 24.21.0, offline. PostgreSQL 16 disposable cluster from `tests/qa/support/with-pg.sh`. Harness ports were 23810 (PG) and 23811–23849 (pool), all inside my 23800–23849 range. Empty `.claude/.cc-writes` directories (and their then-empty `.claude` parents) under `apps/` and `packages/` were removed before every test run.

| # | Command | Exit | Result | Log |
|---|---|---|---|---|
| 1 | `node tools/gates/validate.mjs --historical --stage DG5` (start) | 0 | `PASS gate DG5 (historical)` | (console; re-run at the end, row 10) |
| 2 | `pnpm -r typecheck` | 0 | all packages | `typecheck.log` |
| 3 | `pnpm -r build` | 0 | all packages | `build.log` |
| 4 | `pnpm lint` | 0 | `eslint . --max-warnings=0` clean | `lint.log` |
| 5 | `git ls-files -co --exclude-standard -z \| xargs -0 npx prettier --check --ignore-unknown` | 0 | "All matched files use Prettier code style!" (every batch) | `prettier-check.log` |
| 6 | `pnpm openapi:lint` | 0 | `PASS docs/api/openapi.yaml: OpenAPI 3.1.1, 859 operations` (contract unchanged) | `openapi-lint.log` |
| 7 | `pnpm test`, locale unset (`env -u LANG -u LC_ALL -u LC_CTYPE -u LANGUAGE`) | 0 | unit-node 153 files / **2395** passed; unit-web 94 / **1746** passed; unit-formula-nocodegen 3 / **259** passed + 2 skipped (by design, as before) | `unit-locale-unset.log` |
| 8 | `pnpm test`, `LANG=LC_ALL=C.UTF-8` | 0 | same counts: 2395; 1746; 259 + 2 skipped | `unit-c-utf8.log` |
| 9 | `QA_PG_PORT=23810 MTH_PORT_POOL=23811-23849 tests/qa/support/with-pg.sh pnpm test:integration` | 0 | **322/322 files; 3112 passed, 1 skipped (3113)**; 3110.3 s (17:23:18 to 18:15 UTC). Includes `contract.test.ts` (101) and `p6-guard-mapping.test.ts` (6). The base was 321 files and 3088 + 1, so the change is +1 file and +24 tests, exactly as expected. The lines in the log that contain "failed" are test names, not failures. | `integration.log` |
| 10 | `node tools/gates/validate.mjs --historical --stage DG5` (end) | 0 | `PASS gate DG5 (historical)` | `validate-historical-DG5-end.log` |

A targeted integration run before the full one: `p6-guard-mapping.test.ts` (6) and `contract.test.ts` (101) passed together, 107/107, exit 0 (`integration-targeted-run1.log`).

**Count deltas against the measured base:** the base is T-DG6-ARCH-01's final runs on the same base revision (its handback §0: unit-node 147 files / 2369; integration 321 files, 3088 passed + 1 skipped).
- **unit-node:** 147 → 153 files and 2369 → **2395** (+26). That is the 4 new module suites (2 tests each, 8), `db-errors-p6.test.ts` (14), `secrets-registry.test.ts` (3) and one new P6 block in `architecture.test.ts` (1). `server.test.ts` gains assertions only.
- **Integration:** 321 → 322 files and 3088 → **3112** passed (+24; 1 skipped, unchanged): 18 P6 seam `it` blocks in `contract.test.ts` (83 → 101) and the 6 tests of the new `p6-guard-mapping.test.ts`.
- **unit-web and formula:** unchanged.

**Disclosed non-zero exits and failures during the run (all fixed before the final runs above):**

- My first targeted unit run (architecture, server, new suites, db-errors, secrets, advisory locks) failed **1 of 175**. `architecture.test.ts` rejected my own `secrets-registry.test.ts`: "computed member with a non-literal key (line 12)", which was `entries[name]` in a test fake. I replaced it with a `Map`, and the rerun passed (144/144 for the two files). No other test failed, was retried, was skipped or timed out.

## 1. Behaviour delivered, per requirement row

**No requirement row is assigned to BE-A.** p6-work-split §E/F.14 names no BE-A owner, and no register row names this task. BE-A delivers the registry, stubs, wiring points, guard mappings and contract seams that the row owners build on. Each row it supports stays **not complete** until its owners deliver it:

| Row | Acceptance (quoted) | What BE-A contributes | Owners who complete it |
|---|---|---|---|
| REQ-S10-002 | "A12: a Business Owner on transformation X gets 403/404 reading transformation Y; a sensitive benefit is hidden from a workstream member without the grant" | the 0098 guard mappings (grant duplicate / not-self / transition, record_ref 404, record_key 409), proven against the real guards; the `access/sensitivity.ts` route stub with its registration line; the `sensitivity.ts` mirror stub | BE-B, BE-B2, FE-B |
| REQ-S10-004 | "A12: a user without access to transformation Y receives no Y records in search, export, evidence URL or AI retrieval; …" | the `ReadScope` port types (ADR-0051 §1, verbatim shape) exported through `access/index.ts` (`export *`, so BE-B's `readScopeFor` is exported without an index edit); the `search` and `assistant` modules, whose declared dependencies keep assistant read-only (`access`, `audit`, `platform`, `search` only) | BE-B; search (H) and assistant (D) consume it |
| REQ-S13-011 | "A12: an .exe or an oversized file is rejected; an SVG with script is not executed in preview" | the 0099 upload-policy guard mappings (organization key 409, allowed types / max bytes 400); the `evidence/content-policy.ts`, `evidence/preview.ts` and `admin/upload-policy.ts` stubs, each with its registration line; `evidence_content_detected_*` explicitly 500 | BE-D, FE-B |
| REQ-S16-030 | "A12: security tests cover CSRF, SQL injection, XSS in rich text, disallowed upload type, oversized upload and rate limiting, and all pass" | the `SecretProvider` port (ADR-0052 §5 interfaces) and its registry, wired in `server.ts` and returned by `buildServer` as `secrets`, with no provider registered (so the installation behaves exactly as DG5); the `admin/security.ts` stub | BE-E, BE-E2, BE-D, DO-A |

### The §E/F.1 list, item by item

1. **Stub files, each with its registration line** (each registers nothing and returns `[]` until its owner fills it):

   | Stub | Owner | Registered in |
   |---|---|---|
   | `access/read-scope.ts` | BE-B | port types only; `export * from "./read-scope.ts"` in `access/index.ts` |
   | `access/sensitivity.ts` | BE-B | `server.ts` (`registerSensitivityRoutes`) |
   | `tasks/deep-links.ts` | BE-C | `tasks/index.ts` `registerTasksModule` |
   | `evidence/access.ts` | BE-C | `export {}` (helpers; called from the read lines in `routes.ts`) |
   | `evidence/content-policy.ts` | BE-D | `export {}` |
   | `evidence/preview.ts` | BE-D | `evidence/routes.ts` `registerEvidenceModule` (one line; gets `db` and `store`) |
   | `admin/upload-policy.ts` | BE-D | `server.ts` |
   | `admin/security.ts` | BE-E | `server.ts` |
   | `platform/secrets.ts` | BE-E | `platform/index.ts` export; registry line in `server.ts` |
   | `audit/routes.ts` | BE-E | `audit/index.ts` export; `server.ts` (`registerAuditRoutes(app, deps, {})`) (see §4.1) |

   Schema mirror stubs `packages/shared/src/schemas/{sensitivity,deep-links,uploads,security,audit-events}.ts` (`export {}`), each with its barrel line in `schemas/index.ts`.
2. **Wiring points in `server.ts`:** the `SecretProvider` registry (`const secrets = createSecretProviderRegistry()`; BE-E registers `env` and `file` on the line below it), and the `ReadScope` factory export (types now, `readScopeFor` by BE-B, re-exported by `access/index.ts`). There is one named comment block for the other p6-plan §5.1 wiring points, which are designed by later ARCH tasks: `ImportTargetRegistry` (ARCH-03/BE-M, KBE-A's kpi line), `NotificationChannel` (ARCH-02/BE-I) and `ModelProvider` (ARCH-05/BE-T). This follows the P5 `AutomationActionRegistry` precedent. I did not invent their interfaces ahead of their ADRs.
3. **`platform/db-errors.ts` P6 mappings, exactly as listed:** `mapP6AccessHardeningError`, plus its dispatcher line (after the P5 mappers, before the generic `_version_step` and SQLSTATE fallbacks):
   - `sensitive_record_grant_one_active_key` → 409 `sensitive_grant.duplicate` ("This person already has an active grant for this record.")
   - `sensitive_record_grant_not_self` → 422 `sensitive_grant.not_self` ("You cannot grant access to yourself.")
   - `sensitive_record_grant_transition` → 422 `invalid_transition` ("Only an active grant can be revoked.")
   - `record_sensitivity_record_ref` and `sensitive_record_grant_record_ref` → 404 `not_found`
   - `record_sensitivity_record_key` and `upload_policy_organization_key` → 409 `version_conflict`
   - `upload_policy_allowed_types` and `upload_policy_max_bytes` → 400 `validation` (pointers `/allowedTypes` and `/maxBytes`)
   - The four "stay unmapped (500)" constraints answer 500 `internal` (see §4.2).

   Proven twice:
   - by unit tests (`db-errors-p6.test.ts`, with each guard's real SQLSTATE);
   - by `test/integration/p6-guard-mapping.test.ts`, which provokes the 9 reachable 0098/0099 guards **on the real database as `mth_app`**, inside a rolled-back transaction, and passes the driver's error through `mapDatabaseGuardError`.
4. **`contract.test.ts`:** imports, mirror spreads and one `it` block per `p6-exercises-*.ts`. There are 18 stubs: `be-b, be-c, be-d, be-e, be-g, be-h, be-i, be-j, be-k, be-l, be-m, kbe-a, be-n, be-o, be-p, be-q, be-t, be-u`. That is every P6 API task in p6-plan §5.1 that owns routes; the test-only and read-line tasks (BE-B2, BE-C2, BE-E2, BE-F, BE-R, BE-S, KBE-B) get none. A later task that needs one adds a stub and one import/`it` line through the orchestrator. `P6ExerciseContext` is in `test/support/harness.ts`.
5. **Rest of the p6-plan §5.1 BE-A list:**
   - modules `integrations`, `search`, `assistant` and `operations`, each with `index.ts`, a `routes.ts` stub and its own suite;
   - `search/saved-views.ts` and `search/help-topics.ts` (BE-Q), registered in `search/index.ts`;
   - the other new route-file stubs, each with its registration line: `admin/identity.ts` (BE-G), `admin/storage.ts` (BE-H), `admin/notification-channels.ts` (BE-I), `admin/service-identities.ts` (BE-J), `forms/compare.ts` (BE-Q), `portfolio/deliverable-confirmation.ts` (BE-O);
   - worker stubs `apps/worker/src/{queues,handlers}/{integrations,search,notifications,operations}.ts`, with one import and spread line each in both registries;
   - `modules.ts`, `architecture.test.ts` and `server.test.ts` (§2);
   - the `p6-pending.ts` aggregate already exists from ARCH-01, so it is unchanged.

   `forms/drafts.ts` already exists (P5, T-DG5-BE-E2), so BE-Q extends it and I did not stub it. `kpi/import-target.ts` is not a route file; KBE-A creates it with its `server.ts` line.

## 2. Changed files

**Registry and composition:**
- `apps/api/src/modules.ts`:
  - `integrations`, `search`, `assistant` and `operations` added, with documented `dependsOn`;
  - `P6_MODULES`;
  - `IMPLEMENTED_MODULES` includes P6;
  - `SECTION16_MODULES` (seam 21 mapping): `reporting` = reporting, search, assistant; `admin` = admin, forms, integrations, operations.
- `apps/api/src/architecture.test.ts`, new P6 block:
  - each module has a suite;
  - `access` still depends only on `platform` and `audit`;
  - every P6 module depends on `access`;
  - `integrations` imports no domain module (exact list);
  - `assistant` depends exactly on `access`, `audit`, `platform` and `search`;
  - `integrations` and `operations` do not import each other;
  - no P1–P5 module imports a P6 module, and no P6 module imports `workflows`;
  - the §16 pin is extended.
- `apps/api/src/server.ts`:
  - imports and registers the 4 modules and the 8 composition-root stub lines;
  - the P6 wiring-point block and the `SecretProvider` registry;
  - `buildServer` also returns `secrets` (additive).
- `apps/api/src/server.test.ts`: the module list pin, and the 4 P6 scaffolds (`deliversIn: "P6"`).

**New module directories**, each with `index.ts`, `routes.ts` (stub) and `<module>.test.ts`: `integrations/`, `search/` (+ `saved-views.ts`, `help-topics.ts`), `assistant/`, `operations/`.

**Stubs and registration lines in existing modules:**
- `access/read-scope.ts` (ADR-0051 §1 types), `access/sensitivity.ts`, `access/index.ts` (2 lines)
- `tasks/deep-links.ts`, `tasks/index.ts`
- `evidence/access.ts`, `evidence/content-policy.ts`, `evidence/preview.ts`, `evidence/routes.ts` (one import and one registration line only)
- `admin/{upload-policy,security,identity,storage,notification-channels,service-identities}.ts`, `admin/index.ts`
- `audit/routes.ts`, `audit/index.ts`
- `forms/compare.ts`, `forms/index.ts`
- `portfolio/deliverable-confirmation.ts`, `portfolio/index.ts`

**Platform:**
- `platform/secrets.ts`: the ADR-0052 §5 `SecretRef`/`SecretValue`/`SecretProvider` interfaces, `BUILT_IN_SECRET_PROVIDER_IDS`, and `createSecretProviderRegistry`. The registry refuses a malformed or duplicate id. An unknown provider is an error that names the provider, never a value.
- `platform/secrets-registry.test.ts` (named so it does not collide with BE-E's future `secrets.test.ts`).
- `platform/index.ts` (export block).
- `platform/db-errors.ts`: `mapP6AccessHardeningError` and its dispatcher line.
- `platform/db-errors-p6.test.ts`.

**Worker:** `apps/worker/src/handlers/{integrations,search,notifications,operations}.ts`, `apps/worker/src/queues/{…}.ts`, and the lines in `handlers/index.ts` and `queues/index.ts`.

**Shared:** `packages/shared/src/schemas/{sensitivity,deep-links,uploads,security,audit-events}.ts`, plus 5 barrel lines in `schemas/index.ts`.

**Test harness and contract:** `apps/api/test/support/harness.ts` (`P6ExerciseContext`); `apps/api/test/integration/contract/contract.test.ts` (18 seams); the 18 `p6-exercises-*.ts` stubs; `apps/api/test/integration/p6-guard-mapping.test.ts` (new).

No migration was written. BE-A needs none, and no id was taken. No dependency was added. No contract change was made.

## 3. Operations routed (delta to the pending lists)

**None.** BE-A owns no operation and has no `p6-pending-be-a.ts`. All 13 P6 operations stay pending in `p6-pending-be-{b,c,d,e}.ts`, unchanged.

**Pinned counts in `contract.test.ts` (for the D-079 reconciliation):** unchanged. These are the operation count 859, the media-type pins, the rate-limit floor and the CSRF-exempt routes; no route was added. The contract test grows by 18 `it` blocks (83 → 101).

## 4. Decisions and readings (for reviewers and the orchestrator)

1. **`audit/routes.ts` cannot import `access` (a module cycle).**
   - **The conflict:** ADR-0052 §8 places the global audit API in `audit/routes.ts`. But `access` depends on `audit` (ADR-0002 rule 5; `modules.ts`), so an `audit → access` import closes a cycle, and `architecture.test.ts` rejects it.
   - **What I wired:** the GateFactsProvider pattern. `registerAuditRoutes(app, deps, access: AuditRouteAccess)` is called from `server.ts` with an injected port. Today it is `{}`, because the type has no members yet. BE-E declares the members it needs (principal, the `audit_event.read` scope, the ADR-0051 §2 redaction) in `audit/routes.ts`, and fills them on that one `server.ts` line.
   - **Alternative:** place the routes in `admin` (which may import `access`). That would change the ADR's file, so the choice is the orchestrator's or the architect's. Please confirm the port approach to BE-E.
2. **The four "stay unmapped (500)" constraints are named explicitly.** These are `inbox_notification_deep_link_once`, `inbox_notification_link_token_key`, `evidence_content_detected_type` and `evidence_content_detected_media_type`.
   - **Why:** left truly unmapped, the generic SQLSTATE fallbacks in `hooks.ts`/`db-errors.ts` would answer 422 `validation.constraint` (23514) or 409 `duplicate` (23505), not 500.
   - **What I did:** they map to `problems.internal()`, with no business code. That is the §E/F.1 outcome ("500"), and the unit test pins it.
3. **400 `validation` field codes for the upload policy.** ADR-0052 §1 names only the top-level `validation`. The `errors[]` entries use `validation.upload_policy_allowed_types` / `validation.upload_policy_max_bytes` with English messages. In practice the service's zod validation answers first, and BE-D may align the texts with its own schema.
4. **Module dependencies are proposals within the p6-plan §2 rules.** ARCH-02 to ARCH-05 had not written their sections, so I declared the narrowest graph that the plan's prose supports:
   - `integrations`: + `methodology` (seam 24, ConfigResolver), `jobs`, `tasks`; no domain module;
   - `search`: `organization`, `transformations`;
   - `assistant`: `search` only;
   - `operations`: `jobs`, `tasks`.

   Each is pinned by `architecture.test.ts`. An ARCH task that needs another edge asks the orchestrator for a `modules.ts` line (p6-plan §5.3).
5. **The `ReadScope` "factory export".** Modules import it from `access` directly; every P6 module depends on `access`, so nothing needs to pass through `server.ts`. `access/index.ts` re-exports `read-scope.ts` with `export *`, so BE-B adds `readScopeFor` without touching the index. The `server.ts` block documents this, and says that worker job identities get it through the job kit (BE-J).
6. **The `SecretProvider` registry is created but has no providers.** `buildServer` returns it, so BE-E's tests (and later DO-D's redaction) can reach it. Until BE-E registers `env` and `file`, nothing resolves a secret through it, and every configuration path is exactly DG5's. The worker composition (`apps/worker/src/main.ts`) is outside BE-A's file list, so ADR-0052 §5's worker registration is left to BE-E (or BE-J).

## 5. Contract, schema or dependency needs (for the orchestrator)

- **None blocking.** No new dependency, no migration (no id taken), no contract change.
- **For decision:** §4.1 (the audit routes' access port, or move the routes to `admin`).
- **Problem-code translations:** none new from BE-A. The codes my mappings can return already belong to FE-A's P6 `problems.json` block (§E/F.12): `sensitive_grant.duplicate`, `sensitive_grant.not_self`, `invalid_transition`, `not_found`, `version_conflict`, `validation`.

## 6. User-facing texts made untrue

**None.** BE-A ships no user-visible feature. Every stub registers no route, no screen changes, and no en/ar string describes something BE-A delivers. I edited no text.

## 7. What remains

- Nothing in BE-A's list is unfinished. The stubs are filled by their owners (BE-B, BE-C, BE-D, BE-E, BE-G to BE-Q, BE-T, BE-U, KBE-A), as listed in §1.
- **Merge notes:**
  - `server.ts` and `modules.ts` are BE-A files. ARCH-02, running concurrently in the main checkout, owns the J/C contract, ADR, migration and schema files, and touches none of mine as far as the plan says, so I expect no conflict.
  - If ARCH-02 adds `p6-operations.ts` / `p6-pending.ts` lines, they do not overlap with my changes.
  - If the ARCH-02 to ARCH-06 sections rename a file I stubbed, the owner renames the stub with its one registration line.
