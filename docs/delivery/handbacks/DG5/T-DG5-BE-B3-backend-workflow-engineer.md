# Handback T-DG5-BE-B3 (backend-workflow-engineer): review where configured, publish, rollback, review policies

- **Stage:** P5 "Configuration automation and outputs", gate DG5 (BUILDING). Section `docs/architecture/p5-work-split.md` §A.4.
- **Assignment:** `docs/delivery/assignments/DG5/T-DG5-BE-B3.md` (sha256 `b724b871…3886`, verified at start).
- **Invocation reference:** `{"kind":"claude-code-cli-session","run_id":"DG5-T-DG5-BE-B3-backend-workflow-engineer-20261014T085025Z-b09833cb","session_id":"b09833cb-b1e4-4702-8fb0-5d4079b22c08"}`.
- **Working tree:** `/home/user/wt/dg5-be-b3`, branch `dg5/be-b3`, starting `HEAD` `f591b7c0981242d246816a3868fe8e36660d181c`. The changes are **uncommitted**, for the orchestrator to integrate.
- **Time:** start `Wed Oct 14 08:50:36 UTC 2026`; end: see §3.
- **Product gates.** G1–G6 are business approvals inside the product. A configuration review approves a Studio configuration change only. It never approves a G1–G6 gate, a Finance validation or any business decision, and no timer or job decides one. Nothing here reads or writes the engineering gate records DG0–DG7. All test data is synthetic.

## 1. Files changed

| File | Purpose |
|---|---|
| `apps/api/src/modules/methodology/reviews.ts` | Filled the stub: `submitConfigReview`, `listConfigReviews`, `decideConfigReview`, `withdrawConfigReview`. It calls BE-B2's `proposeConfigRevision` and creates the `config_review` tasks with `createConfigReviewTasks`. It also closes the review tasks of a decided or withdrawn request (`closeConfigReviewTasks`), and exports `stepDraftStage` and `reviewRequiredFor` for `publish.ts`. |
| `apps/api/src/modules/methodology/publish.ts` | Filled the stub: `publishConfigVersion` (the §13 refusals in pipeline order, the one-call publish when review is off, the 100 % rule) and `rollbackConfigVersion` (a new draft with origin `rollback`). Locks: `configDraft`, then `configPublish` (730251). |
| `apps/api/src/modules/methodology/review-policies.ts` | Filled the stub: `listConfigReviewPolicies` and `updateConfigReviewPolicy` (TO only, reviewer never AUD or an admin role, an unchanged update writes nothing). |
| `packages/shared/src/schemas/studio-review.ts` | Filled the stub with the zod mirrors: `configReviewSubmit`, `configReviewRequest` (+ page), `configReviewDecision`, `configRollbackRequest`, `configReviewPolicy` (+ list), `configReviewPolicyUpdate`, `CONFIG_REVIEW_POLICY_KINDS`. |
| `apps/api/test/support/p5-pending-be-b3.ts` | All 8 operations removed from the pending list (now `[]`). |
| `apps/api/test/integration/contract/p5-exercises-be-b3.ts` | Exercises all 8 operations through the validating client, with a success and every reachable declared refusal; mirrors listed. |
| `apps/api/test/integration/contract/contract.test.ts` | One pinned count only: the media-type triple `[334, 333, 1]` → `[338, 337, 1]`, with a named comment line (the D-146 precedent). See §4. |
| `apps/api/src/modules/methodology/methodology.test.ts` | The module's route pin: my 6 version routes added under a named `T-DG5-BE-B3` comment, plus the 2 policy routes with their access (the BE-B precedent). |
| `apps/api/test/integration/methodology/studio-review-publish.test.ts` | New integration suite (14 tests, real PostgreSQL) for the §A.4 tests and the acceptance texts below. |
| `docs/delivery/handbacks/DG5/T-DG5-BE-B3-backend-workflow-engineer.md`, `…/T-DG5-BE-B3-evidence/` | This handback and its logs. |

- **No migration.** No database change was needed: the `0062` guards and the `platform/db-errors.ts` mappings for every refusal already exist.
- **No new dependency.** `decimal.js` is already an `apps/api` dependency.
- **Not mine, not touched:** two empty harness folders, `apps/api/.claude/.cc-writes` and `apps/api/src/modules/methodology/.claude/.cc-writes`, were removed before the tests, as the assignment requires.
- **Untracked files not created by this run:** the worktree also shows untracked files at its top level that this run did not create and did not touch: `.bash_profile`, `.bashrc`, `.gitconfig`, `.gitmodules`, `.idea`, `.mcp.json`, `.profile`, `.ripgreprc`, `.vscode`, `.zprofile`, `.zshrc` and `CLAUDE.local.md`. Do not integrate them.

## 2. Behaviour delivered, per requirement row

### Endpoints added (8 operations; `docs/api/openapi.yaml` 1.4.0-p5, unchanged)

| Operation | Route | Permission | If-Match |
|---|---|---|---|
| `submitConfigReview` | `POST /api/v1/admin/methodology-versions/{versionId}/submit-review` (JSON) | `methodology.publish` | the draft |
| `listConfigReviews` | `GET /api/v1/admin/methodology-versions/{versionId}/reviews` | `methodology.read` | — |
| `decideConfigReview` | `POST …/{versionId}/reviews/{reviewId}/decision` (JSON) | `methodology.review`, and the caller holds the request's reviewer role | the review request |
| `withdrawConfigReview` | `POST …/{versionId}/reviews/{reviewId}/withdraw` (bodiless) | `methodology.publish` | the review request |
| `publishConfigVersion` | `POST …/{versionId}/publish` (bodiless) | `methodology.publish` | the draft |
| `rollbackConfigVersion` | `POST …/{versionId}/rollback` (JSON) | `methodology.publish` | the restored version |
| `listConfigReviewPolicies` | `GET /api/v1/admin/config-review-policies` | `methodology.read` | — |
| `updateConfigReviewPolicy` | `PATCH /api/v1/admin/config-review-policies/{configKind}` (JSON) | `config_review_policy.configure` | the policy |

Every write has the following, each covered by a test:

- **Authorization re-checked at commit time.** Grants are reloaded inside the write transaction. The test revokes a grant mid-request for submit, decide, publish, rollback and the policy update: each answers 403 and writes nothing.
- **Zod validation.** Free text uses `freeText` (note 1–4000, reason 3–4000, decision note 1–4000).
- **`If-Match`.** 428 when missing, 409 when stale.
- **One audit event per row written, in the same transaction:** `config_review_request.create|decide|withdraw`, `methodology_version.submit_review|review_approve|review_request_changes|review_withdraw|approve_without_review|publish|rollback_create`, `methodology_element.copy`, `config_review_policy.update`, `work_item.complete|cancel`, and the revision proposal's and tasks' own events.
- **No remote I/O.**
- **AUD and BO get 403** on every write. ADM_METHOD gets 403 on decide and on the policy update.
- **Locks:** `configDraft` (730250) on `"<kind>:<key>"` for the review operations; `configDraft`, then `configPublish` (730251) for publish and rollback, always in that order.

### REQ-S06-007: the review and publish half (BE-B3) is delivered

Acceptance (binding): *"A06: publish without required review is rejected; editing a published version returns 409; the diff lists the added field"*.

- **"publish without required review is rejected".** Covered by `publish without the required review -> 422 config_version.review_required; after approval it publishes, immutable`:
  - A previewed draft with passing compatibility and coverage runs → 422 `config_version.review_required`, with the exact §13 text.
  - With the review pending → also 422.
  - After the TO approval → 200 `published`.
- **"editing a published version returns 409".** The same test sends five writes to the published version (`PATCH` the draft, `PUT` an element, discard, submit-review, publish). Each answers 409 `config_version.not_editable`, and the version number is unchanged.
- **"the diff lists the added field"** is BE-B's diff plus slice B's form provider (p5-work-split §A.9, "completes with slice B"). Not in my scope.
- **Review where configured.**
  - `submitConfigReview` (stage `preview → review`) records:
    - the `config_review_request` for the exact content hash;
    - the S12-018 revision proposal (BE-B2's `proposeConfigRevision`; validation from the stored runs);
    - one `config_review` work item per active holder of the policy's reviewer role, never the requester or the author. Dedupe key: `config_review:<proposalId>:<userId>`.
  - `decideConfigReview`:
    - approve → stage `approved`;
    - request changes → a note is required (400 `validation.required` at `/note`) and the stage returns to `editing`;
    - the decider's task becomes `done`, the other reviewers' tasks `cancelled`.
  - `withdrawConfigReview`: stage `review → editing`; the tasks are cancelled.
- **Publish refusals, in pipeline order:**

  | Condition | Refusal |
  |---|---|
  | Not a draft | 409 `not_editable` |
  | Stage `editing` | 422 `preview_required` |
  | Review required and not approved (or a review pending) | 422 `review_required` |
  | A compatibility or (methodology) coverage run is missing for the hash | 422 `checks_required` |
  | The latest compatibility run failed | 422 `compatibility_failed` |
  | The latest coverage run failed | 422 `source_incomplete` |
  | Scoring weights not 100 % over 2–6 | 422 `weights_total` |

  Each is tested except `not_editable` on a retired version (P5 has no retire operation).
- **One-call publish.** A kind with `review_required = false` publishes from `preview` in one call: two version steps and two audit events (`approve_without_review`, `publish`). Test: `TO switches review off …`.

### REQ-S06-009: delivered

Acceptance: *"A07: after rollback, records created under the rolled-back version remain retrievable and the audit trail shows the rollback"*. Test: `restores an earlier version as a new version; later records stay retrievable; the audit trail shows the rollback`.

- v1 (G3 labelled "v1") → v2 (relabelled, published through the pipeline) → a business record (a transformation) is created while v2 is in force → rollback of v1.
- The reason is required: missing → 400; blank → 400.
- The rollback creates **v3**: `origin: rollback`, `rollbackOfVersionId` = v1, `basedOnVersionId` = v2, `changeSummary` = the reason, and v1's G3 label.
- v3 then follows the pipeline and is published.
- **After the publish, these compare equal to the snapshot taken before the rollback:** the transformation row; v2's body (except the derived `isNewestPublished`, now `false`); v2's elements, reviews and check runs, read through the API. v1 is unchanged.
- **The audit trail** of v3 starts with `methodology_version.rollback_create` and ends with `methodology_version.publish`, whose diff names v1 (`rollback_of_version_id`).
- **Refusals:**
  - rolling back the newest published version → 422 `rollback_target_invalid` (exact text);
  - a second open draft → 409 `draft_exists`;
  - AUD, BO and TO → 403;
  - 428 and 409.

### REQ-S06-010: the BE-B3 authorization part is delivered (shared with BE-C)

Acceptance: *"A06;A12: a methodology admin can publish a form change but receives 403 approving a funding reallocation; a KPI owner can update assigned KPI actuals but not Studio"*.

- **Test `the methodology admin who publishes a change gets 403 approving a funding reallocation`:**
  - A user holding ADM_METHOD, plus WL on a transformation so that it can see it, publishes a configuration version (200).
  - It then gets **403** on `POST /api/v1/funding-decisions` for a real initiative of that transformation. No funding decision is written.
  - A plain ADM_METHOD, without read access to the transformation, gets 404 there (non-disclosure; ADM_METHOD holds no `transformation.read`, permissions-matrix §5).
  - **"a form change":** the published version here is a methodology version. Publishing a `form_schema` version end to end needs slice B's provider in the pipeline. The publish route itself is kind-generic and was exercised for `methodology`, `scoring_defaults` and `health_check_scheme`.
- **Test `BO (a KPI owner) gets 403 on every Studio write of this file`:** submit, decide, publish, rollback and the policy update → 403. "Can update assigned KPI actuals" is DG4 behaviour (unchanged).
- **`decideApproval` 403 is not proven here.** With a random approval id the route answers 404 (non-disclosure), which proves nothing, so I removed that assertion. A real approval fixture is BE-C's part of this row (§A.9 "BE-B3 and BE-C").

### REQ-S02-001: the publish-gate part is delivered

Acceptance: *"…deleting a template in a draft methodology makes the check fail and blocks publish"*. Test `deleting T13 in a draft: the coverage run fails and publish -> 422 config_version.source_incomplete`:

- T13 is removed through `removeConfigElement`.
- The draft is previewed, the compatibility check runs, and the review is approved.
- Publish → 422 `checks_required` (no coverage run yet). The coverage run records `fail`. Publish → 422 `source_incomplete` (exact text). The version stays a draft.

The report half is BE-B2's; the `warn` sets complete with rule A-7.

### REQ-PB-093: the publish part (the 100 % rule) is delivered

Acceptance (my part): *"publishing defaults that total 95% is rejected"*. Test `scoring defaults that total 95 % -> 422 config_version.weights_total (REQ-PB-093); 100 % publishes`:

- The base has the five T06 weights 25/25/20/15/15. The draft lowers `feasibility` to `"15.00"` (95 %) and goes through review → publish → 422 `weights_total` (exact text).
- A new draft at 100 % publishes (200).
- The sum uses `decimal.js` over the decimal strings; no float is used.

The defaults, the rubric and the instantiation are KBE-A's.

### REQ-S12-018 case 1 (wired; the row is BE-B2's)

- `submitConfigReview` calls `proposeConfigRevision` in its transaction (ADR-0039 Consequences: "completes with BE-B3's two triggers").
- **Replay.** The proposal is keyed on the content hash, so a second request of the same content (after a withdrawal, or a "request changes" without a content change) finds it already recorded. The test confirms there is still exactly one proposal. The new request's reviewers then get tasks under `config_review:<proposalId>#<round>:<userId>` (the `#n` precedent of `tasks/service.ts`), exactly once per request. Without this, a resubmitted request would have had no open task.

## 3. Checks actually run

Environment: Node 24.21.0, offline; ports 23800–23849 (`QA_PG_PORT=23800`, `MTH_PORT_POOL=23801-23849`). The machine was shared with the other W5 runs; the measured load average was about 9.

| # | Command | Exit | Result | Log |
|---|---|---|---|---|
| 0 | `node tools/gates/validate.mjs --historical --stage DG4` (start) | 0 | `PASS gate DG4 (historical)` | `T-DG5-BE-B3-evidence/validate-dg4-start.log` |
| 1 | `pnpm -r typecheck` | 0 | | `…/typecheck.log` |
| 2 | `pnpm -r build` | 0 | | `…/build.log` |
| 3 | `pnpm lint` | 0 | eslint `--max-warnings=0` | `…/lint.log` |
| 4 | `git ls-files -co --exclude-standard -z \| xargs -0 npx prettier --check --ignore-unknown` | 0 | "All matched files use Prettier code style!" | `…/prettier.log` |
| 5 | `pnpm openapi:lint` | 0 | "PASS docs/api/openapi.yaml: OpenAPI 3.1.1, 789 operations" | `…/openapi.log` |
| 6 | `pnpm test` (locale unset) | RESULT_UNIT_UNSET | | `…/unit-unset.log` |
| 7 | `LANG=C.UTF-8 LC_ALL=C.UTF-8 pnpm test` | RESULT_UNIT_CUTF8 | | `…/unit-cutf8.log` |
| 8 | `QA_PG_PORT=23800 MTH_PORT_POOL=23801-23849 tests/qa/support/with-pg.sh pnpm test:integration` | RESULT_INTEG | | `…/integration.log` |
| 9 | `node tools/gates/validate.mjs --historical --stage DG4` (end) | RESULT_VAL_END | | `…/validate-dg4-end.log` |

Intermediate runs during development, all disclosed:

- **Contract test, first run: exit 1.** 71/72 passed; only the media-type pin failed (`[338, 337, 1]` vs `[334, 333, 1]`), as expected from my four JSON bodies. My exercises passed on that first run. I updated the pin (§4).
- **New suite, first run: exit 1.** 13/14 passed. The funding check expected 403 and got 400, because the funding route parses the initiative id before it authorizes.
- **Funding test, iterations: exit 1 each, test errors, not product defects.**
  - An invalid initiative code (`initiative_code_check`).
  - 404 for the plain ADM_METHOD, which cannot read the transformation. The test now uses an admin who can read it, and asserts the plain admin's 404 explicitly.
  - 400 and then 404 on `decideApproval` with a random id. The assertion was removed (§2, REQ-S06-010).
- **Methodology suites, all 5 files: exit 0, 62/62** (`…/methodology-suites.log`).
- **`pnpm test`, first run (locale unset): exit 1.** unit-node had 1 failure out of 1824: `methodology.test.ts > registers the P2 catalogue routes and the P5 Studio routes of BE-A` pins the module's routes and did not list my new ones. unit-web passed 1385/1385; unit-formula-nocodegen passed 259 + 2 skipped. This was my omission, not a flake. I added my routes to the pin; the methodology unit files then passed 15/15. That log is kept as `…/unit-unset-run1-before-pin-fix.log`. Rows 6–7 are the reruns.

## 4. Contract seams: the pending-list delta and the pinned counts

- **`p5-pending-be-b3.ts`:** −8 (`submitConfigReview`, `listConfigReviews`, `decideConfigReview`, `withdrawConfigReview`, `publishConfigVersion`, `rollbackConfigVersion`, `listConfigReviewPolicies`, `updateConfigReviewPolicy`). The list is now empty.
- **Media-type triple: +4 JSON bodies** (`submitConfigReview`, `decideConfigReview`, `rollbackConfigVersion`, `updateConfigReviewPolicy`). `withdrawConfigReview` and `publishConfigVersion` are bodiless; the other two operations are GETs. I changed the pin `[334, 333, 1]` → `[338, 337, 1]` in `contract.test.ts`, with a `T-DG5-BE-B3` comment line, so the suite is green in this tree. **The orchestrator reconciles it with the other W5 increments (D-079, D-146).**
- **Rate-limit floor:** no change seen; that test passed.
- **Declared but not reachable** in the exercises:
  - `updateConfigReviewPolicy` 404: the path enum lists exactly the seven seeded rows;
  - 429: the rate limiter's own suite.

## 5. For the orchestrator: decisions and contract needs

1. **Outbox events not emitted (contract need).** ADR-0039 §11 names `methodology_version.published` `{versionId, kind, key, versionNo}` and `config_review.requested` `{reviewRequestId, versionId}`. `enqueueOutboxEvent` refuses an event type without a registered payload schema in `packages/shared/src/schemas/events.ts`, and that file is not in my ownership. `methodology` also does not depend on `jobs` (the gate and kpi modules have their own writers). No consumer exists in P5 ("no new job"), so nothing reads them today.
   - **Proposed:** the contract owner adds the two v1 payload schemas to `events.ts`, and a follow-up adds the two inserts (one line each, in `publishVersion` and `submitReview`), using a local writer as `workflows/gates.ts` does.
2. **Problem code for a review that is no longer pending.** Deciding or withdrawing a request that was already decided or withdrawn answers **422 `invalid_transition`**. That is the existing shared code (`problems.invalidTransition`, translated in `problems.json`), with the detail "This review has already been decided or withdrawn." ADR-0039 §13 has no code for this case. Please confirm, or name a code to add.
3. **Reviewer-role check on decide.** Beyond `methodology.review`, the decider must hold the request's `reviewer_role_code` in the organization (otherwise 403 `forbidden`). This is the S06-007 row's "review: configured reviewer". If the policy names a role other than TO, that role also needs `methodology.review`: a TO-owned policy change should come with a permissions change. Please confirm.
4. **Review tasks of a discarded draft (BE-A's `drafts.ts`).** `discardConfigDraft` withdraws a pending review request, but it cannot close that request's `config_review` tasks: the comment in `drafts.ts` leaves that to BE-B3's `reviews.ts`, and I may not edit `drafts.ts`. The reviewers' tasks therefore stay open after a discard. **Proposed one-line fix for the owner of `drafts.ts`:** call `closeConfigReviewTasks(tx, audit, actor.organizationId, pending.id, null)` (exported from `reviews.ts`) right after the withdrawal there.
5. **Work-item writes from `methodology`.** `methodology` cannot import `tasks`. So `closeConfigReviewTasks` updates `work_item` directly: only the status columns that `tasks/service.ts closeWorkItemsOfSubject` moves, under the same `0028` guard, each with its audit event. This follows the DG4 `workflows/phase-steps.ts closeOwnReviewItems` precedent. The alternative is a second port, like `setReviewTaskWriter`, wired in `server.ts`, a file I do not own. Please decide whether to keep this or convert it.
6. **The round-suffixed task key** `config_review:<proposalId>#<round>:<userId>` for the second and later requests of the same content (§2, REQ-S12-018). It reuses BE-B2's exported `createConfigReviewTasks` by passing the proposal reference with id `<proposalId>#<round>`. That is correct, but indirect. A cleaner option is an optional `round` parameter in `revision-impact.ts` (BE-B2's file).
7. **Test isolation.** `studio-review-publish.test.ts` switches the **`health_check_scheme`** review policy off and restores it in `finally`. No current suite publishes that kind. **When KBE-G's health-check scheme tests (slice H) land, they must not assume that policy is constant during a parallel run**, or this test must move to another unused kind. The contract exercise patches `procedure` with unchanged values only, so nothing is written.

## 6. User-facing texts

- **`admin.plannedSections`** (en/ar): "Methodology, forms, workflows, automation and branding settings are planned for later releases." This stays true for the web release until FE-B ships the Studio screens (D-144 note). My work ships API routes only, with no UI, so I made no change.
- **My Work message key `methodology.task.config_revision_review`** (already reported by BE-B2) has no en/ar text yet. These items render the kind's existing fallback label ("Configuration change to review"), which is true, but generic. My params are `{configKind, key, versionNo}`. This is for the owner of `apps/web/src/i18n/{en,ar}/myWork.json` (FE).
- **Problem texts.** Every §13 code I return already has en/ar keys in `problems.json` (FE-A). `invalid_transition` and `validation.required` are existing keys.

## 7. What remains

- **The outbox events** (§5 item 1), pending the `events.ts` registration.
- **Closing the review tasks on discard** (§5 item 4), a one-line change in `drafts.ts` by its owner.
- **The `decideApproval` 403 part of REQ-S06-010**, with a real approval fixture: BE-C.
- **"the diff lists the added field" (REQ-S06-007)**, publishing a `form_schema` version end to end, and REQ-S06-004's routing: slices B and E (§A.9).
- **The Studio publish, review and policy screens:** FE-B.

## 8. Merge instructions

- No migration and no ordering constraint. BE-C and KBE-A start after this task (§A.8); they can import `stepDraftStage`, `reviewRequiredFor` and `closeConfigReviewTasks` from `reviews.ts`.
- **Expected conflict:** `apps/api/test/integration/contract/contract.test.ts`, at the media-type pin, with the other W5 tasks. Resolve it by summing the increments: mine is +4 JSON.
- `packages/shared/src/schemas/index.ts` already exports `studio-review.ts` (BE-A's barrel line), and `methodology/routes.ts` already registers the three route files, so neither changes.
