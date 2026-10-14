# Handback T-DG5-BE-A: P5 slice A foundation (backend-workflow-engineer)

- **Stage:** P5 "Configuration automation and outputs", gate DG5 (BUILDING). This is engineering delivery work. Nothing here grants a business, Finance or IT approval; no product gate G1–G6 is decided; nothing reads or writes the DG0–DG7 records. Product G6 never implies DG7.
- **Assignment:** `docs/delivery/assignments/DG5/T-DG5-BE-A.md` (sha256 `bdb1363f…fe91849`, verified at start). Scope: `docs/architecture/p5-work-split.md` §A.1, shared rules §2.
- **Invocation reference:** `{"kind":"claude-code-cli-session","run_id":"DG5-T-DG5-BE-A-backend-workflow-engineer-20261014T001048Z-a7971968","session_id":"a7971968-b6bc-43b4-a156-f0f362a37479"}`.
- **Working tree:** worktree `/home/user/wt/dg5-be-a`, branch `dg5/be-a`, base `7344b25`. All changes are left **uncommitted** for the orchestrator.
- **Time:** `date -u` at start `2026-10-14T00:10:58Z`; at end `2026-10-14T01:31:00Z` (taken just before the final prettier check), about 80 minutes, inside the 2-hour bound; nothing was salvaged or split.
- **Preceding gate:** `node tools/gates/validate.mjs --historical --stage DG4` exited **0** at the start (`T-DG5-BE-A-evidence/validate-historical-DG4-start.log`) and at the end (§0, row 10).
- **Data:** every fixture and seed value in the tests is synthetic.

## 0. Checks actually run (final tree; logs in `T-DG5-BE-A-evidence/`)

Environment: Node 24.21.0, offline; PostgreSQL 16.13 disposable cluster from `tests/qa/support/with-pg.sh`; harness ports 23800–23849 only; empty `.claude/.cc-writes` directories removed before each test run.

| # | Command | Exit | Result | Log |
|---|---|---|---|---|
| 1 | `node tools/gates/validate.mjs --historical --stage DG4` (start) | 0 | `PASS gate DG4 (historical)` | `validate-historical-DG4-start.log` |
| 2 | `pnpm -r typecheck` | 0 | all packages | `typecheck.log` |
| 3 | `pnpm -r build` | 0 | all packages | `build.log` |
| 4 | `pnpm lint` | 0 | `eslint . --max-warnings=0` clean | `lint.log` |
| 5 | `git ls-files -co --exclude-standard -z \| xargs -0 npx prettier --check --ignore-unknown` | 0 | "All matched files use Prettier code style!" | `prettier-check.log` |
| 6 | `pnpm openapi:lint` | 0 | `PASS docs/api/openapi.yaml: OpenAPI 3.1.1, 690 operations` (contract unchanged) | `openapi-lint.log` |
| 7 | `pnpm test`, locale unset (`env -u LANG -u LC_ALL -u LC_CTYPE -u LANGUAGE`) | 0 | unit-node 91 files / **1615** passed; unit-web 69 / **1358** passed; unit-formula-nocodegen 3 / **259** passed + 2 skipped (by design, as before) | `unit-locale-unset.log` |
| 8 | `pnpm test`, `LANG=LC_ALL=C.UTF-8` | 0 | same counts: 1615; 1358; 259 + 2 skipped | `unit-c-utf8.log` |
| 9 | `QA_PG_PORT=23810 MTH_PORT_POOL=23811-23849 tests/qa/support/with-pg.sh pnpm test:integration` | 0 | **210 files, 2030 tests passed** (1194.7 s); includes `contract.test.ts` (72) and `methodology/studio-drafts.test.ts` (18) | `integration.log` |
| 10 | `node tools/gates/validate.mjs --historical --stage DG4` (end) | 0 | `PASS gate DG4 (historical)` | `validate-historical-DG4-end.log` |

Before → after: integration 1985 → 2030 (+45: 18 Studio tests, 27 P5 seam `it` blocks in `contract.test.ts`); unit-node 1592 → 1615 (+23). No pinned count other than the media-type triple changed (§3).

**Disclosed non-zero exits and failures during the run (all fixed before the final runs above):**

- A first `pnpm test` (locale unset, `unit-locale-unset-run1-failed.log`) **exited 1** with 3 failures, all caused by my registry changes: `server.test.ts` (module list pin without the five P5 modules), `reporting.test.ts` (dependency pin without `methodology`), and `advisory-locks.test.ts` (my comments in `drafts.ts` spelled the class number 730250). Fixed by extending the two pins and removing the number from the comments; the final runs 7 and 8 are on the fixed tree.
- Two intermediate targeted integration runs failed (logs `integration-contract-and-studio-run2.log`; the first is not kept): the Studio fixture first wrote seeds through the app-role connection (refused by `methodology_version_seed_only`; fixed by writing through the owner pool `api.owner`), and two of my own test assertions were wrong (a `changeSummary`-only edit does not change the hash, ADR-0039 §1; `limit=200` exceeds the page maximum). The contract test was green in run 2.
- One targeted unit run failed on `architecture.test.ts` because of an empty `apps/api/src/modules/.claude/.cc-writes` directory created by the harness; removed as the assignment instructs.
- The full integration run (row 9) started before I added the update/discard commit-time test and two comment edits; Vitest collected the file after the edit (it reports 18 tests, the final count). The final content of that file also passed alone: `integration-studio-drafts.log` (18/18).
- No test was retried, skipped or marked flaky; no timeout occurred. The two "retry" matches in `integration.log` are test names.


## 1. Behaviour delivered, per requirement row

### REQ-S06-004 (slice A part: drafts, resolved elements, resolver; BE-A of three owners)

**Acceptance (quoted):** "A06: an admin adds a field to T13, changes a validation rule and changes an approver route in the UI; after publish, with no deployment or application-code change, a new T13 record stores the new field, the changed rule rejects a value it previously accepted, and a submission is routed to the new approver".

This row is **not complete** with BE-A, by design (p5-work-split §A.9: BE-A, BE-B, BE-C; completes with slice B, slice E and FE-B). BE-A delivers the part the others build on:

- **Drafts** (`methodology/drafts.ts`): `createConfigDraft` copies every element row of its base (ADR-0039 §2), takes `max(version_no)+1` of the key (a discarded draft keeps its number), and refuses a second open draft of the same kind and key with 409 `config_version.draft_exists`. A base that is not a published version is 422 `config_version.unknown_element` (the contract's summary). `updateConfigDraft` edits titles, change summary and definition only in `editing`/`preview`, recomputes `content_sha256` (ADR-0039 §1), and returns a draft in `preview` to `editing`. `discardConfigDraft` moves it to `discarded` (`discarded_at` set); it stays readable and is never editable again (409 `config_version.not_editable`); published versions are never editable (409 `config_version.not_editable`).
- **Resolved elements** (`methodology/elements-read.ts`, `listConfigElements`): catalogue (DG2–DG4 stable-identity registry: `phase_definition`, `gate_definition`, `tom_dimension`, `gate_criterion_definition`, `source_element`) overridden by the version's `methodology_element` rows; `playbook` v1 has no rows, so it returns exactly the catalogue (`overridden: false`); removed elements only with `includeRemoved=true`.
- **ConfigResolver** (`methodology/config-resolver.ts`, the ADR-0039 §3 port, wired in `server.ts`): `pinnedVersion` (pin, else version 1 of the kind's default key, never "the latest"), `element`, `elements`, `withDraft` (resolves the draft's kind to the draft; persists nothing).
- **Kind registry** (`methodology/kinds.ts`): one `ConfigKindProvider` per kind: default key, element types (the 0062 trigger's list), Zod attribute schemas, and optional hooks `validateElement`, `diffRows`, `compatibility`, `affectedRecords`, `preview`, `migrationItems` that BE-B (methodology), KBE-A (scoring_defaults) and slices B–H register.
- **Content hash** (`methodology/content-hash.ts`): canonical JSON (keys in code-point order, integers only; decimals are strings) of `{definition, titleEn, titleAr, elements}`; seeded hashes are never recomputed.
- **Attribute schemas** (`packages/shared/src/schemas/studio.ts`): per element type (ADR-0039 §2), free text through the shared `freeText` rules, `weightPercent` as a decimal string, plus the `ConfigVersion*`, `ConfigElement*`, `ConfigPin*` mirrors.

### REQ-S16-012 (MethodologyVersion create/read; BE-C writes the entity-group test)

**Acceptance (quoted):** "A08: the ERD and migrations contain every entity listed (Transformation, PerformanceArea, Charter, MethodologyVersion, Phase, GateDefinition, GateInstance, GateDecision) with primary keys, owner and status where applicable, and an integration test creates and reads each one through the API with authorization enforced".

Not owned by BE-A (p5-work-split §A.9: BE-C). BE-A routes the two operations ADR-0039 §10 names for MethodologyVersion (`createConfigDraft` / `getConfigVersion`) and the read of Phase and GateDefinition (`listConfigElements?elementType=phase|gate`), with authorization tested (AUD/TO/BO 403 on writes, ADM_METHOD positive). The Phase/GateDefinition "create" (`putConfigElement`) is BE-B's.

### The §A.1 test list, where each is proved

`apps/api/test/integration/methodology/studio-drafts.test.ts` (18 tests, real PostgreSQL):

| §A.1 item | Test |
|---|---|
| draft create copies the base's element rows | "copies every element row of its base, takes the next version number, and audits each row it writes" |
| next version number | same, and "numbers: a draft is version_no max+1 of its key, and a discarded draft keeps its number" |
| one open draft (409 `config_version.draft_exists`) | "one open draft per kind and key …" (exact English text asserted) |
| update in preview returns to editing | "an edit of a draft in preview returns it to editing" (the preview run no longer counts for the new hash) |
| discard | "discard: the draft stays readable, cannot be edited (409 not_editable), and frees the key" |
| resolved elements = catalogue overridden by rows (v1 has no rows) | "playbook v1 has no rows …" and "a version's row overrides the catalogue …" |
| pins list shows unpinned kinds as version 1 of the default key | "an unpinned kind resolves to version 1 of its default key, never the latest; a pin wins" |
| AUD 403 on writes | "authorization: AUD, TO and BO get 403 on every write and nothing is written" |
| `If-Match` 428/409 | "If-Match: missing 428, stale 409 (update and discard)" |
| one audit event per mutation | asserted per record in every write test (`methodology_version.create_draft`, `.update_draft`, `.discard`, `methodology_element.copy` per copied row) |
| commit-time re-authorization (rule 4) | "commit-time authorization: … -> 403; nothing written" (create) and "commit-time authorization on update and discard …" |
| pins per transformation, 404 outside scope | "pins are scoped per transformation …" (TO of org B and TL of another BU: 404; ADM_METHOD: 200) |

Unit tests: `methodology/studio-core.test.ts` (hash, registry, attribute schemas), `platform/db-errors-p5.test.ts` (every P5 guard mapping with the exact ADR texts), `methodology/methodology.test.ts` (routes and access per operation).

## 2. Changed files

**Module registry and composition (§A.1 "every P5 module and stub up front"):**

- `apps/api/src/modules.ts`: `P5_MODULES` = forms, procedures, automation, launch, health, each with its `dependsOn` (all may read `methodology`; automation depends on no domain module); `reporting` gains `methodology` (snapshots record pinned versions); `SECTION16_MODULES` gains launch (transformations), procedures and automation (workflows), health (formulas/KPI), forms (admin).
- `apps/api/src/architecture.test.ts`: a P5 block (modules exist with suites, methodology imports none of them, automation imports no domain module, no P1–P4 module imports a P5 one, none imports workflows); the §16 pin extended.
- `apps/api/src/server.ts`: imports and registers the five P5 modules; registers the jobs-operations, navigation and environment stubs; the **ConfigResolver** wiring point (`createConfigResolver()` passed to `registerMethodologyModule`) and the named **AutomationActionRegistry** wiring point (a comment block: BE-H adds the registry line, each action owner one line).
- `apps/api/src/server.test.ts`: module list pin + the five scaffolds.
- `apps/api/src/modules/reporting/reporting.test.ts`: the reporting dependency pin gains `methodology` (one line, a consequence of the registry change).
- New module directories, each `index.ts` + `routes.ts` stub + `<module>.test.ts`: `forms/`, `procedures/`, `automation/` (+ `failures.ts`, BE-I), `launch/`, `health/`.
- Route-file stubs with their registration line (each registers nothing until its owner fills it): `workflows/approval-routes.ts`, `workflows/conditional-approval.ts` (BE-K), `tasks/notification-policy.ts` (BE-L), `governance/cut-off.ts` (BE-L), `governance/presentation.ts` (BE-O), `kpi/restatements.ts` (KBE-E), `kpi/formula-preview.ts` (KBE-F), `benefits/financial-metrics.ts` (KBE-F), `portfolio/updates.ts` (KBE-D), `reporting/reports/routes.ts` (KBE-C, then KBE-D), `reporting/exports/routes.ts` (BE-M, then BE-N), `jobs/operations.ts` (BE-I), `identity/navigation.ts` (BE-R), `admin/environment.ts` (BE-S); registration lines in `workflows/index.ts`, `tasks/index.ts`, `governance/index.ts`, `kpi/index.ts`, `benefits/index.ts`, `portfolio/index.ts`, `reporting/index.ts`, `jobs/index.ts`, `identity/index.ts`, `admin/index.ts`.
- Worker stubs: `apps/worker/src/{queues,handlers}/{automation,procedures,reports,launch,demo}.ts` (empty lists) and one import + spread line each in `queues/index.ts` and `handlers/index.ts`.

**Slice A (BE-A's own files):**

- `apps/api/src/modules/methodology/config-resolver.ts`, `kinds.ts`, `content-hash.ts`, `drafts.ts` (5 operations + the §13 refusals, Studio access helpers, lock helper, presenter shared with BE-B/B2/B3), `elements-read.ts`, `pins.ts`.
- `apps/api/src/modules/methodology/routes.ts`: registers the P2 routes and every slice A route file (BE-A's three plus the nine stubs `elements.ts`, `checks.ts`, `source-coverage.ts`, `revision-impact.ts`, `reviews.ts`, `publish.ts`, `review-policies.ts`, `migrations.ts`, `scoring-defaults.ts`); `registerMethodologyModule(app, deps, { configResolver })`.
- `apps/api/src/modules/methodology/index.ts`: exports the resolver, the kind registry and `contentSha256`; `methodology.test.ts` updated; `studio-core.test.ts` new.
- `apps/api/src/modules/platform/db-errors.ts`: `mapP5StudioError` (0062–0064 guards → ADR-0039 §13 / ADR-0040 §8 codes and exact texts; programming-error guards → 500) and its dispatcher line; `db-errors-p5.test.ts` new.
- `packages/shared/src/schemas/studio.ts` (BE-A's mirrors and attribute schemas); stubs `studio-checks.ts`, `studio-coverage.ts`, `studio-review.ts`, `methodology-migrations.ts`, `scoring-defaults.ts`; six barrel lines in `schemas/index.ts`.

**Test harness:**

- `apps/api/test/support/harness.ts`: `P5ExerciseContext`.
- `apps/api/test/support/studio-fixtures.ts`: seeds a synthetic published base version under a unique key per test (owner role, audited), so parallel suites never collide on the global one-open-draft rule; ADM_METHOD user; owner-side element and preview helpers for the stages BE-B/BE-B3 will route.
- `apps/api/test/support/p5-pending-be-a.ts`: emptied.
- `apps/api/test/integration/contract/contract.test.ts`: imports, mirrors and `it` blocks for all 27 `p5-exercises-*.ts` seams; media-type pin.
- `apps/api/test/integration/contract/p5-exercises-be-a.ts` (filled) and 26 stubs `p5-exercises-{be-b,be-b2,be-b3,be-c,kbe-a,be-d,be-e,be-f,be-g,be-h,be-i,be-j,be-k,be-l,kbe-c,kbe-d,be-m,be-n,be-o,kbe-e,kbe-f,be-p,kbe-g,be-q,be-r,be-s}.ts`.
- `apps/api/test/integration/methodology/studio-drafts.test.ts` new.

No migration was written (BE-A has none in §A.7). No dependency was added.

## 3. Operations routed (delta to `p5-pending-be-a.ts`)

Removed all 8, each exercised in `p5-exercises-be-a.ts` with a success and every declared refusal it can reach:

| Operation | Method and path | Exercised statuses |
|---|---|---|
| `listConfigVersions` | `GET /api/v1/admin/methodology-versions` | 200, 403 |
| `createConfigDraft` | `POST /api/v1/admin/methodology-versions` | 201, 400, 403, 404, 409, 422 |
| `getConfigVersion` | `GET /api/v1/admin/methodology-versions/{versionId}` | 200, 403, 404 |
| `updateConfigDraft` | `PATCH /api/v1/admin/methodology-versions/{versionId}` | 200, 400, 403, 404, 409 (stale and `not_editable`), 428 |
| `listConfigElements` | `GET /api/v1/admin/methodology-versions/{versionId}/elements` | 200, 403, 404 |
| `discardConfigDraft` | `POST /api/v1/admin/methodology-versions/{versionId}/discard` | 200, 403, 404, 409 (stale and `not_editable`), 428 |
| `listTransformationConfigPins` | `GET /api/v1/transformations/{transformationId}/config-pins` | 200, 404 |
| `listConfigPinHistory` | `GET /api/v1/transformations/{transformationId}/config-pins/history` | 200, 404 |

Not reachable by design: `updateConfigDraft` 422 and `discardConfigDraft` 422 (declared, but no business rule of these two operations answers 422 in BE-A's scope).

**Pinned counts in `contract.test.ts` (for the orchestrator's reconciliation, D-079):** media-type triple `[323, 322, 1]` → **`[325, 324, 1]`** (+ `createConfigDraft`, `updateConfigDraft`; `discardConfigDraft` is bodiless). The rate-limit floor (`>= 285`) is unchanged; the live sweep covers 8 more operations.

## 4. Decisions and readings (for reviewers)

1. **Resolution is field-level overlay.** ADR-0039 §2 says "V's row when it exists, else the catalogue's values". A version row's `attributes` override the catalogue attributes field by field, so a full row is exactly "V's row" and a partial row (e.g. only `labelEn`) keeps the catalogue's other attributes (approver, help text). `overridden: true` marks any element with a row.
2. **Unpinned kinds without a version 1** (form_schema, procedure, automation_rule_set, health_check_scheme today) are **not listed** by `listTransformationConfigPins` (the contract's `ConfigPin` requires a version id), and `ConfigResolver.pinnedVersion` throws for them (a programming error, never a guess). Each slice registers its default key through `registerConfigKindProvider(kind, { defaultKey })` when its ADR seeds a version 1.
3. **ADM_METHOD reads pins** (D-143 point 6) through an organization-level `methodology.read` grant in the transformation's organization: ADM_METHOD does not inherit downward, so the plain transformation-scoped decision would hide pins from it. Everyone else is decided by the scoped policy; outside scope is 404.
4. **Draft creation audits every copied row** (`methodology_element.copy`), because the 0062 deferred audit guard requires an event per inserted element row; the version itself gets one `methodology_version.create_draft`.
5. **Discarding a draft under review** withdraws its pending `config_review_request` in the same transaction (audited `config_review_request.withdraw`), so no reviewer decides a discarded draft. Closing that review's `config_review` work items is BE-B3's (reviews.ts owns the work items; methodology does not depend on tasks).
6. **`change_summary` is not part of the content hash** (ADR-0039 §1 lists `{definition, titleEn, titleAr, elements}`), so editing only the summary keeps the latest preview run valid for the hash. The 0062 guard still returns a draft in preview to editing on any content edit, which BE-A does for every update.
7. **Lists are newest first by UUIDv7 id** (time-ordered); the seeded rows carry low fixed ids and sort last. `listConfigElements` paginates by position in the computed (catalogue + rows) list, bound to its filters.

## 5. Contract, schema or dependency needs (for the orchestrator)

- **None blocking.** No new dependency, no migration, no contract change.
- **Problem-code translations:** the ADR-0039 §13 / ADR-0040 §8 codes have no `problems.json` keys in `apps/web/src/i18n/{en,ar}/` yet (owned by FE-A, "i18n/{en,ar}/{nav,problems}.json P5 blocks"). The codes BE-A's routes can return: `config_version.draft_exists`, `config_version.not_editable`, `config_version.unknown_element`; the mapping in `db-errors.ts` can return every §13/§8 code.

## 6. User-facing texts made untrue

- `apps/web/src/i18n/en/admin.json` `plannedSections` ("Methodology, forms, workflows, automation and branding settings are planned for later releases.") and its Arabic twin. **Still true after BE-A:** BE-A ships API operations only, and no Studio screen. It becomes untrue when FE-B ships the Studio screens (and FE-C/FE-D/FE-G theirs); listed here for FE-A/FE-B (owners of `apps/web/**`). I did not edit it.
- No other en/ar string names drafts, configuration versions or pins as planned.

## 7. What remains

- Nothing of BE-A's scope. The other slice A operations stay in their owners' pending lists (BE-B 7, BE-B2 3, BE-B3 8, BE-C 9, KBE-A 3), each with its stub route file and registration line already in place.
- Wiring left to owners, on named lines: `AutomationActionRegistry` (BE-H defines it in `automation`, adds the line in `server.ts`); `configResolver` passed into each P5 module that reads configuration (one option on its register call in `server.ts`); `registerConfigKindProvider` calls (BE-B, KBE-A, slices B–H).

## 8. Merge instructions

- No migration to run. Merge order per p5-work-split §A.8 (BE-A first in W2).
- Expected conflicts: none with T-DG5-ARCH-02, which owns contract, ADR, migration and schema files of slices B+C. `packages/shared/src/schemas/index.ts` got six barrel lines at its end; if ARCH-02 appends its own lines there, keep both blocks.
- Untracked files at the worktree root that are **not mine** and must not be integrated: `.bash_profile`, `.bashrc`, `.gitconfig`, `.gitmodules`, `.idea/`, `.mcp.json`, `.profile`, `.ripgreprc`, `.vscode/`, `.zprofile`, `.zshrc`, `CLAUDE.local.md` (environment files; I created none of them. My start-of-run `git status` showed the first ten; its output was truncated, so I cannot say whether `.zshrc` and `CLAUDE.local.md` were already there).
