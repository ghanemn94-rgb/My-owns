# Handback T-DG4-BE-M3 (backend-workflow-engineer): portfolios and workstreams (p4-work-split §J+K JK.3)

- **Stage:** P4 "Execution value and sustainment", gate DG4 (BUILDING). Engineering task only. Nothing here grants a business, Finance or IT approval, and nothing reads or writes DG0–DG7. Product gate G6 never implies DG7.
- **Invocation:** `{"kind":"claude-code-cli-session","run_id":"DG4-T-DG4-BE-M3-backend-workflow-engineer-20261010T013124Z-94b42094","session_id":"94b42094-5df7-4454-8dde-c998ce52e50f"}`
- **Assignment:** `docs/delivery/assignments/DG4/T-DG4-BE-M3.md` (sha256 `471836ca…2b8c5a`, verified at start).
- **Base:** branch `dg4/be-m3` at `a8bcf5d` (worktree `/home/user/wt/dg4-be-m3`). The changes are **uncommitted**, for the orchestrator to integrate.
- **Time:** start `2026-10-10T01:31:36Z` (`date -u`), end `2026-10-10T02:24:45Z`, about 53 minutes, inside the 2-hour limit.
- **Preceding gate:** `node tools/gates/validate.mjs --historical --stage DG3` printed `PASS gate DG3 (historical)` and **exited 0**, before any edit.

## 1. Files changed

| File | Purpose |
|---|---|
| `apps/api/src/modules/portfolio/structure.ts` (new) | The 14 routes. Portfolios (organization level), their transformation memberships, workstreams (`WS-nn` from `record_code_counter` prefix `WS`) and their initiative memberships. Also the ADR-0038 §12 refusals (exact texts) and the presenters. |
| `apps/api/src/modules/portfolio/index.ts` | One registration: the import of `registerStructureRoutes` and its call in `registerPortfolioModule`. |
| `packages/shared/src/schemas/structure.ts` (new) | Zod mirrors of the 14 request and response shapes (`Portfolio*`, `Workstream*`). Also the shared "archive needs a reason" refinement. |
| `packages/shared/src/schemas/index.ts` | One export line, after BE-M2's. |
| `apps/api/src/modules/platform/db-errors.ts` | `mapP4StructureError`, appended to the slices J/K block after BE-M2's, plus one dispatch line after BE-M2's. |
| `apps/api/test/support/p4-pending-be-m3.ts` | Emptied. All 14 operations are routed. |
| `apps/api/test/integration/contract/p4-exercises-be-m.ts` | Appended after BE-M2: the 14 mirrors in `P4_MIRRORS_BE_M`, the `exerciseP4BeM3Operations` call at the end of `exerciseP4BeMOperations`, and the exercise function. |
| `apps/api/test/integration/contract/contract.test.ts` | Media-type pin only: `[315, 314, 1]` → `[323, 322, 1]`, plus its comment line (see §4). |
| `apps/api/test/integration/portfolio/structure.test.ts` (new) | 18 integration tests: portfolios and workstreams. |
| `apps/api/test/integration/reporting/bu-scope.test.ts` (new) | 4 integration tests: the business-unit scope sweep. |
| `docs/delivery/handbacks/DG4/T-DG4-BE-M3-evidence/*` | Logs of every check in §3, and `exit-codes.txt`. |

No migration, no `server.ts` edit, no OpenAPI edit, no `schema.ts` edit. Every file I touched is inside JK.3's ownership, except the `contract.test.ts` pin, which the assignment's "media-type pin" rule tells me to update.

## 2. Behaviour delivered: REQ-S03-001

**Acceptance (requirements.csv, quoted):** "A02;A12: two transformations in different business units are listed separately; a user scoped to one business unit cannot list the other's transformations".
**Requirement text:** "Users with scope create and link these records; a transformation belongs to one organization and one or more business units and can sit in a portfolio; workstreams group initiatives".

### 2.1 What is delivered

- **14 operations routed** (ADR-0038 §9):
  - portfolios: `listPortfolios`, `createPortfolio`, `getPortfolio`, `updatePortfolio` (includes archive), `listPortfolioTransformations`, `addPortfolioTransformation`, `removePortfolioTransformation`;
  - workstreams: `listWorkstreams`, `createWorkstream`, `getWorkstream`, `updateWorkstream` (includes archive), `listWorkstreamInitiatives`, `addWorkstreamInitiative`, `removeWorkstreamInitiative`.
  - Every route's `config.consumes` is `application/json`, which equals the request media type in the OpenAPI file (S-3). The contract test's `consumesDrift` check passes.
- **Lifecycles:**
  - A portfolio or workstream goes `active → archived`. This is terminal and needs a reason. After that it is read-only: every later write, its memberships included, answers 422 `portfolio.archived` or `workstream.archived`. It stays readable, and the lists include it with `includeArchived=true`.
  - A membership goes `active → removed`. This is terminal, needs a reason, and keeps the row (`includeRemoved=true` lists it). Re-adding creates a new row. A second removal answers 422 `membership.not_active`.
- **One placement at a time:**
  - A transformation already in a portfolio → 422 `portfolio.transformation_already_placed`.
  - An initiative already in a workstream → 422 `workstream.initiative_already_assigned`.
  - The 0055 partial unique indexes back both rules, and `db-errors.ts` maps them, so a concurrent race also answers 422. A test proves that two concurrent placements give exactly one 201 and one 422.
- **Codes:** `WS-01`, `WS-02`, `WS-03` in creation order, from the counter UPSERT inside the creating transaction.
- **Authorization** (ADR-0038 §10):
  - Workstream writes need `workstream.manage` (TL, TO).
  - Portfolio writes need `portfolio.manage`, decided on the organization target (TO).
  - Workstream reads need `transformation.read`. An id outside scope answers 404.
  - Portfolio reads need `organization.read` (see §2.3 for how).
  - `listPortfolioTransformations` filters rows with the DG1 scoped policy (`scopeFilter` on `transformation.read`, the function DG1 `listTransformations` uses).
  - Placing a transformation needs it to be readable. An unreadable, unknown or other-organization transformation answers 404, and an archived one answers 422 `transformation.archived` (an existing code).
- **S-4, for every mutation:**
  - authorization re-checked at commit, on grants reloaded inside the transaction;
  - validation with the shared `freeText`/`reason` rules, through the strict UTF-8 parser (S-1/S-2);
  - `If-Match` on every change: 428 when missing, 409 when stale. Creates are version 1 and carry an ETag and a Location;
  - exactly one audit event in the transaction (the 0055 audit triggers check it at COMMIT);
  - no remote I/O.
  - Creates also accept the optional `Idempotency-Key`, using the shared `maybeIdempotent`.

### 2.2 Proofs of JK.3 (all against a real disposable PostgreSQL 16.13)

| JK.3 proof | Where |
|---|---|
| Two transformations in different business units are listed separately, and a user scoped to one business unit cannot list the other's: `listTransformations`, `listPortfolioTransformations`, `listWorkstreams`, and the slice J/K reads that exist when it merges | `reporting/bu-scope.test.ts` (4 tests). X sits in BU a1 and Y in BU a2, in one portfolio, each with a workstream and an initiative. The users are a TO scoped to BU a1 and an AUD scoped to BU a2. The organization TO sees both, each with its own `businessUnitId`. Each scoped user sees only its own transformation in `listTransformations` (also with a `businessUnitId` filter for the other unit), `listPortfolioTransformations` (with and without `includeRemoved`), `listWorkstreams`, `getWorkstream` and `listWorkstreamInitiatives`. The slice J/K reads covered are: traceability, trace links, orphans, missing links, inherited records, `getRecordImpact`, the transformation dashboard, the workstream dashboard, the Executive Overview (`transformations` = own only), and every dashboard drill-down metric except `outcomes.kpi_status`, which is per record and covered by KBE-G's `scope.test.ts`. Explicit reads of the other unit answer 404, and the other unit's ids and codes never appear in a response. |
| A transformation in two portfolios → 422 `portfolio.transformation_already_placed` | `portfolio/structure.test.ts`, "a transformation in two portfolios…" (exact text), and "two concurrent placements…" |
| An initiative in two workstreams → 422 `workstream.initiative_already_assigned` | "an initiative in two workstreams…" (exact text; also a second assignment to the same workstream) |
| Codes `WS-01`, `WS-02` in order | "codes WS-01, WS-02, WS-03 in creation order…" |
| An archived portfolio or workstream is read-only (422) | "an archived portfolio is read-only…", "an archived workstream is read-only…" (edit, add and remove membership all answer 422, with the exact texts) |
| AUD 403 on every write | "AUD, BO and a business-unit-scoped TO get 403 on every write…" (all 4 portfolio writes), "AUD and BO get 403 on every write…" (all 4 workstream writes), plus the contract exercises |
| If-Match 428/409 | "If-Match: 428 when missing, 409 when stale…" (portfolio update), the membership removals, and the workstream update and removal |
| One audit event per mutation | `auditOf(recordId)` equals the exact action list after every create, update, archive, add and remove (for example `["portfolio.create","portfolio.archive"]`). Refused writes add nothing. |
| Commit-time re-authorisation (S-4) | "commit-time re-authorisation…" for both a portfolio create and a workstream create: the grant is revoked while the request waits, the response is 403 and nothing is written. Uses the `calendar/session-lock.ts` technique. |
| db-errors backstop | A direct insert that violates `portfolio_transformation_one_active_key` maps to 422 `portfolio.transformation_already_placed`. `portfolio_org_code_key` maps to 409 `portfolio.code_taken`, and `workstream_initiative_one_active_key` to 422. |

### 2.3 Interpretations for the orchestrator and reviewers

1. **Portfolio reads use the "any grant in the organization" rule.** The rule is `organizationsWith(principal, "organization.read")`, as in `benefits/totals.ts` and `tasks/routes.ts`.
   - Under the DG1 policy, a business-unit or transformation grant never applies to an *organization* target (`grantApplies`). The `access/groups.ts` style (`requireRead` on the organization) would therefore answer 404 to every BU-scoped user, so the ADR-0038 §9 statement "a portfolio's membership list shows only transformations the caller may read" could never apply to them.
   - With this rule, a BU-scoped user reads the portfolio and sees only its own unit's memberships. `bu-scope.test.ts` proves it.
   - `portfolio.manage` is still decided on the organization target. A **BU-scoped TO therefore gets 403 on portfolio writes**, and only an organization-level TO manages portfolios. This is tested. If the orchestrator wants a BU-scoped TO to place its own transformations, that is an ADR-0038 §10 change.
2. **Workstream writes run the read gate on the request-start grants first** (the `access/groups.ts` order), then call `openWrite(…, { atCommit: true })`.
   - So a caller who never could read the transformation (another organization) gets **404, not 403**, which follows JK.10 item 3.
   - A right revoked during the request is still 403 and audited.
   - BE-M2's `reporting/modular.ts` answers 403 to that outsider: its test at `modular.test.ts:388` says "the commit-time read gate refuses (403…)". The two slice K files therefore differ for that one caller. I did not touch BE-M2's file. The orchestrator may want one rule for both.
3. **`updatePortfolio`/`updateWorkstream` validation.**
   - `status: archived` without `archiveReason` answers 400 `validation.required` at `/archiveReason`.
   - An `archiveReason` without `status: archived` answers 400 `validation.not_applicable`.
   - An archive patch may also change other fields in the same request. Both are applied, and the audit action is `*.archive`.
4. **The membership list order is creation order** (UUIDv7 id keyset). Workstreams are also listed by id, which follows the `WS-nn` order without parsing codes. Portfolios are listed by `(code, id)`.
5. **Initiative status:** an initiative of any status may be assigned. Neither the ADR nor the requirement restricts it.

## 3. Checks actually run

Environment: Node 24.21.0 (`/opt/nvm/versions/node/v24.21.0/bin`), offline. PostgreSQL 16.13, disposable clusters through `tests/qa/support/with-pg.sh` on ports 25150–25199. Disk was 22 GB free before every full run. Logs are in `docs/delivery/handbacks/DG4/T-DG4-BE-M3-evidence/`, and every exit code is in `exit-codes.txt`.

| # | Command | Exit | Result |
|---|---|---|---|
| 1 | `node tools/gates/validate.mjs --historical --stage DG3` (before any edit) | 0 | `PASS gate DG3 (historical)` |
| 2 | `pnpm -r typecheck` | 0 | `typecheck.log` |
| 3 | `pnpm -r build` | 0 | `build.log` |
| 4 | `pnpm lint` | 0 | `eslint . --max-warnings=0` clean (`lint.log`) |
| 5 | `git ls-files -co --exclude-standard -z \| xargs -0 npx prettier --check --ignore-unknown` | 0 | "All matched files use Prettier code style!" (`prettier.log`) |
| 6 | `pnpm openapi:lint` | 0 | `PASS docs/api/openapi.yaml: OpenAPI 3.1.1, 647 operations` (unchanged by me) |
| 7 | `env -u LANG -u LC_ALL -u LC_CTYPE -u LANGUAGE pnpm test` | 0 | unit-node + unit-web **2352 passed (123 files)**; unit-formula-nocodegen **259 passed, 2 skipped** (`unit-locale-unset.log`) |
| 8 | `LANG=C.UTF-8 LC_ALL=C.UTF-8 pnpm test` | 0 | **2352 passed**; **259 passed, 2 skipped** (`unit-c-utf8.log`) |
| 9 | `QA_PG_PORT=25160 MTH_PORT_POOL=25161-25199 tests/qa/support/with-pg.sh pnpm test:integration` | 0 | **1683 passed (177 files)**, 0 failed, 0 skipped (`integration.log`) |
| 10 | `node tools/gates/validate.mjs --historical --stage DG3` (at the end) | 0 | `PASS gate DG3 (historical)` (`validate-dg3-historical-end.log`) |

Targeted runs during development, against a disposable cluster:
- `contract.test.ts` alone: 45/45 on the first run.
- `structure.test.ts` + `bu-scope.test.ts`: 20/22 on the first run, then 67/67 together with the contract test.
- The two first-run failures are disclosed in §3.1.

### 3.1 Disclosed non-zero exits

- **Unit run 1, both locales, exit 1:** 1 failed and 2351 passed. The only failure was `apps/api/src/architecture.test.ts` "has only mapped module directories": `expected [ '.claude' ] to deeply equal []`.
  - Cause: the empty write-tracking directory `apps/api/src/modules/.claude/.cc-writes`, which the sandbox created when I used the Write/Edit tools.
  - The assignment says to remove such empty directories before tests. I removed every empty `.claude/.cc-writes` under `apps/`, `packages/` and `tests/` with `rmdir`, and reran. Both locales then exited 0 (rows 7 and 8).
  - The run-1 logs are kept as `unit-locale-unset-run1.log` and `unit-c-utf8-run1.log`.
  - **Note for the orchestrator:** the handback file written with the Write tool may re-create such a directory under `docs/`. Remove empty `.claude/.cc-writes` directories before your merged-tree run.
- **First targeted run of the new tests, 2 failures, both fixed:**
  - A test fixture that archived a transformation broke `transformation_archive_complete`: it did not set `archived_by` and `archive_reason`. Fixed in the test.
  - An outsider's workstream create answered 403 where the test expected 404. I fixed the code (§2.3 item 2) and added outsider PATCH and remove cases.

### 3.2 Integration

- **Result:** `Test Files 177 passed (177)`, `Tests 1683 passed (1683)`, duration 936.95 s. PostgreSQL 16.13, `server_encoding UTF8`, 60 migrations applied to a fresh database. Exit 0, on the first full run, with no failed, flaky or retried test.
- **Count change:** 1683 = 1661 (the D-110 merged-tree count) + 22 new tests: 18 in `portfolio/structure.test.ts` and 4 in `reporting/bu-scope.test.ts`.
- `contract.test.ts` stays at 45 tests. The BE-M3 exercises run inside the existing "P4 BE-M operations" test.
- **Pinned counts:** only the media-type pin changed (§4). The operation count (647, from `openapi:lint`) and every other pin are untouched.

## 4. Contract seams

- **Operations routed:** the pending list delta is −14. `P4_PENDING_BE_M3` changes from the 14 operations below to `[]`:
  - `listPortfolios`, `createPortfolio`, `getPortfolio`, `updatePortfolio`, `listPortfolioTransformations`, `addPortfolioTransformation`, `removePortfolioTransformation`;
  - `listWorkstreams`, `createWorkstream`, `getWorkstream`, `updateWorkstream`, `listWorkstreamInitiatives`, `addWorkstreamInitiative`, `removeWorkstreamInitiative`.
  - Each is exercised through `ctx.mirrored` in `exerciseP4BeM3Operations`, appended after BE-M2's exercises in `p4-exercises-be-m.ts`. Its success body is validated against the mirror in `P4_MIRRORS_BE_M`.
- **Media-type pin delta: +8 JSON bodies**, from `[315, 314, 1]` to **`[323, 322, 1]`**. The 8 are `createPortfolio`, `updatePortfolio`, `addPortfolioTransformation`, `removePortfolioTransformation`, `createWorkstream`, `updateWorkstream`, `addWorkstreamInitiative` and `removeWorkstreamInitiative`. The 6 GETs have no body. The orchestrator reconciles this with the concurrent pins of KBE-G2 and FE-D, if any.
- **db-errors:** `mapP4StructureError` sits after `mapP4ModularEntryError` (BE-M2), and its dispatch line sits after BE-M2's. It maps:

  | 0055 constraint | Answer |
  |---|---|
  | `portfolio_org_code_key` | 409 `portfolio.code_taken` |
  | `portfolio_transformation_one_active_key` | 422 `portfolio.transformation_already_placed` |
  | `workstream_initiative_one_active_key` | 422 `workstream.initiative_already_assigned` |
  | `workstream_code_key`, the four `*_archive_complete`/`*_removal_complete` checks | `internal` (the API writes these shapes itself) |

  Foreign keys are left to the generic mapping. The mapper ends with `default: return null;`, so it leaves no dangling `case`.

## 5. Codes, contract and schema needs

- **Codes used:**
  - The ADR-0038 §12 codes with their exact English texts: `portfolio.code_taken`, `portfolio.transformation_already_placed`, `portfolio.archived`, `workstream.initiative_already_assigned`, `workstream.archived`, `membership.not_active` (problem type invalid-transition).
  - Existing codes: `validation.required`, `validation.not_applicable` (ARCH-R1 table row 66), `validation.reference`, `validation.user_invalid`, `validation.min_properties`, `transformation.archived`, `version_conflict`, `precondition_required`, `not_found`, `forbidden`.
  - **No new code.**
- **Contract:** no OpenAPI change is needed. Every response I return is one the operation declares (the contract assertion runs on every test call).
- **Schema:** no migration and no schema change are needed. `0055` and `0057` were sufficient.
- **Production wiring (D-107):** none needed. The routes register through the existing `registerPortfolioModule`, which `server.ts` already calls. All tests build the real server through `startApi()`, and nothing is wired by hand.

## 6. What remains

- Nothing in JK.3's scope is unfinished.
- REQ-S03-001 is a multi-stage row (P1–P4). Its DG4 half (portfolios, workstreams and the BU sweep) is delivered here. The FE-G screens (JK.7) are outside this task.
- The orchestrator should decide §2.3 items 1 and 2: the BU-scoped TO cannot manage portfolios, and the outsider 404 here differs from the 403 in `modular.ts`.

## 7. End of run

- `date -u` at the end: `Sat Oct 10 02:24:45 UTC 2026`.
- `node tools/gates/validate.mjs --historical --stage DG3` printed `PASS gate DG3 (historical)` and exited 0.
- **Merge instructions:**
  - No migration to run.
  - Expect union conflicts only in these appended regions:
    - `p4-exercises-be-m.ts`: the mirror map and the call at the end of `exerciseP4BeMOperations`, after BE-M2;
    - `db-errors.ts`: the BE-M3 mapper and the dispatch line, after BE-M2;
    - `schemas/index.ts`: the last export line;
    - `portfolio/index.ts`: the import and the route spread, after BE-E's.
  - Reconcile the `contract.test.ts` media-type pin, +8 JSON bodies, with any concurrent pin.
  - Remove empty `.claude/.cc-writes` directories before running `architecture.test.ts`.
- The changes are left **uncommitted**.
