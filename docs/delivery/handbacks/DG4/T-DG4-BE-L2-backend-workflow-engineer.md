# Handback T-DG4-BE-L2 (backend-workflow-engineer): the phase catalogue, workspace, guided steps, evidence and review queue

- **Stage:** P4 / DG4 (BUILDING). Task T-DG4-BE-L2, p4-work-split §H H.4.
- **Invocation:** `DG4-T-DG4-BE-L2-backend-workflow-engineer-20261009T183950Z-f9d77d57`, session `f9d77d57-4813-4014-93ca-ae907319719e`.
- **Base:** branch `dg4/be-l2`, `HEAD` `85cae06be8db43b6e322c842efc4e5541f383d43`. The changes are left **uncommitted**.
- **Time:** start `date -u` = Fri Oct 9 18:40:00 UTC 2026; end: see §9.
- **Preceding gate:** `node tools/gates/validate.mjs --historical --stage DG3` exit **0** (`PASS gate DG3 (historical)`), log `T-DG4-BE-L2-evidence/validate-dg3-historical-start.txt`.
- **Product gates G1–G6 are business approvals inside the product.** Accepting a phase step is a procedural review, not a business approval. Nothing here submits or decides a gate, and nothing reads or writes DG0–DG7. All test people and records are synthetic.

## 0. For the orchestrator first: two frozen-file defects block acceptance items 2 and 3 in this tree

**Production wiring (D-107 lesson): nothing to wire.** BE-A already registered `registerPhaseStepRoutes` in `workflows/index.ts`, and `server.ts` registers the workflows module. The module needs no port or setter. `contract.test.ts` builds the real server through `startApi` without wiring anything by hand, and exercises all 10 routes (`exerciseP4BeL2PhaseOperations`). So does `phases.test.ts`.

Two frozen files outside my ownership need a one-line or quoting change. I did **not** edit either one in this tree. I verified the whole task in a disposable copy under `$TMPDIR` that equals this tree plus exactly these two edits (`T-DG4-BE-L2-evidence/verify-copy-delta.diff`):

1. **`docs/api/openapi.yaml`: YAML single quotes make the slice H key patterns unmatchable (architect, ARCH-07).** Seven lines write `pattern: '^…\\.[a-z_]{1,48}$'` in **single** quotes. In YAML single quotes a backslash is literal, so the regex is `\\.`: a literal backslash, then any character. No valid key matches. Every earlier dotted pattern in the file uses double quotes (e.g. line 20133 `key: … pattern: "^g[1-6]\\.[a-z_]{1,48}$"`).
   - **Mine:** line 17142 (`parameters.StepKey`) and line 27415 (`PhaseStep.stepKey`).
   - **BE-K2's:** line 17152 (`parameters.CriterionKey`) and lines 27517, 27552, 27588, 27625 (`criterionKey`). BE-K2 will hit the same failure.
   - **Fix:** change `'` to `"` on those 7 lines. Nothing else changes. `pnpm openapi:lint` passes either way, because the lint does not test patterns against values.
   - **Effect in this tree:** every successful `updatePhaseStep`, `requestPhaseStepReview`, `reviewPhaseStep` and `getPhaseStep` response fails the harness's contract check (`stepKey must match pattern`). That fails `phases.test.ts` and the BE-L exercise test in `contract.test.ts`. See §4 for the real counts.
2. **`apps/api/src/modules/workflows/workflows.test.ts` line 79: the route-access pin (P2 file).** The test pins every workflows `GET` to `transformation.read` except `GET /api/v1/dependency-types`.
   - The contract makes `listPhases` a global catalogue read for "any signed-in user", declaring 400/401/429 and no 403. So the route is `authenticated`, the same case as `dependency-types` (T-DG3-BE-C handback 7.1, integrated by the orchestrator).
   - With `transformation.read`, the access hook would refuse a signed-in user who holds no read right anywhere (e.g. ADM-only) with an undeclared 403.
   - **Fix:** `r.key === "GET /api/v1/dependency-types" || r.key === "GET /api/v1/phases" ? "authenticated" : "transformation.read"`.
   - **Effect in this tree:** 1 unit test fails, in both locales.

A third contract point does not block. The `getPhaseStep` summary says `ETag "0"` for a step without a row, but the shared `components.headers.ETag` pattern is `^"[1-9][0-9]{0,9}"$`. BE-L's change-control-policy GET has the same conflict, which BE-L reported. I send `ETag "0"`, as the summary and the BE-L precedent do. The single test call that reads a version-0 step uses the harness's documented `contract: false` and checks the body with its zod mirror. **Architect decision needed:** allow `"0"` in the ETag pattern (or in a dedicated header for these two GETs), or drop the header at version 0.

## 1. Files changed

| File | Purpose |
|---|---|
| `apps/api/src/modules/workflows/phase-steps.ts` | The 10 operations. The BE-A stub is replaced. The file holds the completion-rule evaluator, the review queue items, the next-step task and the exact ADR-0035 §11 refusals. |
| `packages/shared/src/schemas/phases.ts` (new) | The zod mirrors: `phaseDefinition(List)`, `phaseWorkspace(Phase)`, `phaseStep(Page)`, `phaseStepUpdate`, `phaseStepReview`, `phaseStepEvidence(Page)`, `phaseStepEvidenceLink`. |
| `packages/shared/src/schemas/index.ts` | One export line (appended). |
| `apps/api/src/modules/platform/db-errors.ts` | `mapP4PhaseStepError`, appended to the slice H block after BE-L's, plus its call line after BE-L's. It covers the `0051` phase-step guards (a race maps to the §11 problem, never a 500). |
| `apps/api/test/support/p4-pending-be-l2.ts` | The list is now empty (10 → 0). |
| `apps/api/test/integration/contract/p4-exercises-be-l.ts` | Appended: the shared fixtures `seedPhaseWorld`, `verifiedEvidence`, `startStep`, the 10 mirrors in `P4_MIRRORS_BE_L`, and `exerciseP4BeL2PhaseOperations`, called at the end of `exerciseP4BeLOperations`. The only pre-existing line changed is the harness import, which was widened. |
| `apps/api/test/integration/contract/contract.test.ts` | Media-type pin `[292, 291, 1]` → `[295, 294, 1]`, with a comment line. |
| `apps/api/test/integration/workflows/phases.test.ts` (new) | 14 integration tests against a real PostgreSQL (§3). |

There is no migration, no `server.ts` edit and no `workflows/index.ts` edit.

## 2. API endpoints added (all in `docs/api/openapi.yaml` 1.3.0-p4, tag `phases`)

| Operation | Route | Access |
|---|---|---|
| `listPhases` | `GET /api/v1/phases` | `authenticated` (any signed-in user) |
| `getPhaseWorkspace` | `GET /api/v1/transformations/{t}/phases` | `transformation.read` |
| `listPhaseSteps` | `GET …/phase-steps[?phase=&status=&cursor=&limit=]` (`status=in_review` is the review queue) | `transformation.read` |
| `getPhaseStep` | `GET …/phase-steps/{stepKey}` | `transformation.read` |
| `updatePhaseStep` | `PATCH …/phase-steps/{stepKey}` (`If-Match "0"` creates the row) | `phase_step.manage` (TL, TO) |
| `requestPhaseStepReview` | `POST …/phase-steps/{stepKey}/request-review` (bodiless) | `phase_step.progress`, step owner only |
| `reviewPhaseStep` | `POST …/phase-steps/{stepKey}/review` | `phase_step.review`, never the owner or requester |
| `listPhaseStepEvidence` | `GET …/phase-steps/{stepKey}/evidence` | `transformation.read` |
| `linkPhaseStepEvidence` | `POST …/phase-steps/{stepKey}/evidence` | `phase_step.progress`, step owner only |
| `removePhaseStepEvidence` | `POST …/phase-steps/{stepKey}/evidence/{id}/remove` (bodiless) | `phase_step.progress`, step owner only |

`config.consumes` is `application/json` on the three JSON-body routes and absent on the two bodiless POSTs (S-3). The media-types test enforces this (`consumesDrift` empty, in the copy run).

## 3. Behaviour delivered, per requirement row

### REQ-PB-014

Acceptance: _"A01;A02: API returns exactly six phases in order with names and purposes matching B0021; each phase page shows its objective text"_. Procedure: _"Each transformation shows its current phase, the phase purpose, source objective text and key outputs with completion status"_.

- `GET /api/v1/phases` returns the six `phase_definition` rows by ordinal: code, gate code, verbatim English name, title, purpose, key outputs and objective, the Arabic columns, and `arProvisional`.
- **Test:** `phases.test.ts` › "GET /phases: exactly six phases…". The test **parses `docs/source/playbook.md` at run time**, so it checks the source, not the seed. It compares:
  - the B0021 table rows (name, purpose, key outputs);
  - the `Objective:` sentences of B0027, B0046, B0054, B0068, B0091 and B0119.
- The test also covers: anonymous 401, an unknown query member 400, and the auditor 200.
- `GET …/transformations/{t}/phases` shows `currentPhase`, and per phase:
  - the definition (purpose, objective, key outputs);
  - `isCurrent` and the gate status, read only;
  - the steps with their statuses (the completion status);
  - `reviewQueueCount`.
- Outsider and ADM-only callers get 404.
- **The interpretation that "phase page" = the workspace phase entry** is the ADR-0035 §1 reading. The `screen_api` path `GET …/phases/{phase}` of REQ-S04-001 does not exist in the contract. The per-phase view is `GET …/phase-steps?phase=…` plus the workspace entry.

### REQ-S04-001

Acceptance: _"A02: each of the six phases shows steps, required evidence, owners and a review queue; a step with an unmet completion rule cannot be marked complete via the API"_. Automation: _"Step completed -> next step task"_.

- **Steps, required evidence, owners and the review queue.** The workspace lists 5/3/4/5/4/4 steps. Each step carries its procedure (EN/AR), required evidence (EN/AR), default owner role, reviewer role and completion rule.
  - A step without a row shows `not_started`, `ownerUserId: null` (Unknown) and version 0. It is never complete.
  - The review queue is `status=in_review` plus `reviewQueueCount`.
  - Test: "each of the six phases shows steps, required evidence, owners (Unknown when unassigned) and a review queue".
- **Completion rules are evaluated server-side.** All eight ADR-0035 §1 rules are read-only queries in the writing transaction. They run at `request-review` and again at accept.
  - An unmet rule gives 422 `phase_step.completion_rule_unmet` with the exact §11 detail. Example: "The completion rule of this step is not met: at least one verified evidence item must be linked.".
  - Unverified evidence does not count.
  - When a verified link is removed while the step is in review, the accept is refused 422 and the step stays `in_review`.
  - A direct SQL `UPDATE … status='complete'`, and an `in_review` row with `met:false`, are both refused by the `0051` CHECKs, so SQL cannot bypass the rule. Tests: "an unmet completion rule cannot be put in review or accepted (422); SQL cannot bypass the rule".
  - Seven of the eight unmet messages are asserted. `corrective_cases_owned` is shown met with no open case. Test: "other completion rules are evaluated server-side".
- **Owners and reviewers.**
  - The owner cannot accept their own step. BO holds both `progress` and `review`, and still gets 403 `phase_step.reviewer_is_owner`.
  - A non-owner gets 403 `phase_step.not_owner`, both on link and on request-review. Both 403s carry the denial for the failed-mutation audit.
  - A step without an owner gets 422 `phase_step.owner_required`.
- **Review queue items (ADR-0035 §7 item 3).** Request-review creates one `phase_step_review` work item per active holder of the definition's reviewer role with `phase_step.review` on the transformation, owner excluded. The items are created in the API transaction through `createWorkItemOnce`.
  - Accepting or returning marks the reviewer's item done and cancels the others. Each change has its audit event.
- **Step completed → next step task.** Accepting creates one `phase_step_enabled` item for the owner of the next step of the same phase, with dedupe `phase_step_next:<stepId>`. Nothing is created when the next step has no owner. Test: "the review queue: one task per reviewer-role holder…".
- **Return.** A note is required: 400 `phase_step.return_note_required` at `/note`. A blank note is 400 (S-1).
  - `returned` → `in_review` again; the previous review fields are cleared.
  - Owner changes during review, restarts and reviews of a step that is not in review get 422 `phase_step.invalid_transition`, with the exact "A step moves from {from} to {to} only as the phase procedure allows.".
  - A complete step is final. Its evidence is frozen: 422 `phase_step.complete`.

### REQ-S04-002 (first clause only; BE-K owns the G5/G6 snapshot)

Acceptance: _"completing every phase task leaves the gate Draft"_.

- Test "completing all five Diagnose steps leaves G1 draft…": every Diagnose step is completed through the API. Afterwards:
  - G1 `gate_instance` is still `draft`, with the same version and `updated_at`;
  - there is no `gate_submission`;
  - the workspace shows `gateStatus: draft`;
  - `transformation.current_phase` is unchanged.
- `phase-steps.ts` never writes a `gate_*` row. It only reads `gate_instance.status` for the workspace.

### Shared rules (S-1…S-14) that reviewers check

| Rule | How it is met | Proof |
|---|---|---|
| S-4 | Every mutation runs: the read gate (404 outside scope), then the permission re-checked at commit time (`openWrite … atCommit`), then validation (zod strict; S-1 `freeText` on the note), then `If-Match`. Missing `If-Match` → 428; stale → 409; `"0"` names "no row yet"; a create is version 1. One audit event per mutation in the same transaction; no remote I/O. | Tests: "AUD (read-only) gets 403 on every write and nothing is written; an outsider gets 404" and "If-Match: 428 … 409 …" |
| S-2 | Strict UTF-8 through the shared parser | No route-local parser |
| S-6 | Work items store `messageKey` + `messageParams` only | — |
| S-11 | Exact §11 codes and texts | — |
| S-13 | Work items only through `createWorkItemOnce` | — |
| S-14 | No approval is involved | — |

## 4. Checks actually run (real exit codes; logs under `T-DG4-BE-L2-evidence/`)

Node 24.21.0, offline. `df -h .` before the full runs: 20 GB free (above the 3 GB floor). Harness ports used: 24650–24699 only. `apps/api/.claude/.cc-writes` was empty and was removed before the tests.

**In this tree (`/home/user/wt/dg4-be-l2`):**

| Command | Exit | Result |
|---|---|---|
| `node tools/gates/validate.mjs --historical --stage DG3` | 0 | PASS (start of task; re-run at the end, see §9) |
| `pnpm -r typecheck` | 0 | `typecheck.txt` |
| `pnpm -r build` | 0 | `build.txt` |
| `pnpm lint` | 0 | `lint.txt` (after one fix: a type-only import) |
| `git ls-files -co --exclude-standard -z \| xargs -0 npx prettier --check --ignore-unknown` | 0 | "All matched files use Prettier code style!" (`prettier.txt`; re-run at the end, §9) |
| `pnpm openapi:lint` | 0 | "PASS docs/api/openapi.yaml: OpenAPI 3.1.1, 645 operations" |
| `pnpm test`, locale unset | **1** | unit-node + unit-web: **1 failed** \| 2292 passed (2293), 120 files. The single failure is the frozen `workflows.test.ts` pin (§0 item 2). Because `pnpm test` chains its invocations with `&&`, the second invocation (`unit-formula-nocodegen`) **did not run**. (`unit-locale-unset.txt`) |
| `LANG=C.UTF-8 LC_ALL=C.UTF-8 pnpm test` | **1** | Identical: 1 failed \| 2292 passed; the second invocation did not run. (`unit-c-utf8.txt`) |
| `QA_PG_PORT=24660 MTH_PORT_POOL=24661-24699 tests/qa/support/with-pg.sh pnpm test:integration` | **1** | **14 failed \| 1482 passed (1496)**, 143 files (2 failed). All 14 come from §0 item 1 (13 `Error: contract: … body violates the schema: data/stepKey must match pattern`): the 12 new `phases.test.ts` tests; the BE-L exercise test (my appended exercise aborts at the first `updatePhaseStep`); and its cascade, "covers every operation with at least one success…", which lists the 9 phase operations without a validated success. The 1482 pre-existing tests all pass. (`integration-tree.txt`) |

An earlier in-tree unit run, before I removed two computed keys from `phase-steps.ts`, failed 3 tests: the two ADR-0002 checker tests ("computed member … bypasses the module-interface check") and the same `workflows.test.ts` pin. The computed keys are fixed; the checker tests now pass.

**In the disposable verification copy** (`$TMPDIR/verify`: this tree plus only the two §0 edits, delta in `verify-copy-delta.diff`):

| Command | Exit | Result |
|---|---|---|
| `QA_PG_PORT=24652 MTH_PORT_POOL=24653-24699 tests/qa/support/with-pg.sh pnpm test:integration` | 0 | **143 files, 1496/1496 passed** (D-107 baseline 1482 + 14 new in `phases.test.ts`). `integration-verify-copy.txt` |
| `pnpm test`, locale unset | 0 | Invocation 1: 120 files, **2293/2293**. Invocation 2 (`unit-formula-nocodegen`): 3 files, **259 passed \| 2 skipped** (`unit-verify-copy-locale-unset.txt`) |
| `LANG=C.UTF-8 LC_ALL=C.UTF-8 pnpm test` | 0 | Identical: **2293/2293**; **259 passed \| 2 skipped** (`unit-verify-copy-c-utf8.txt`) |

**First runs, disclosed:**

- The first targeted run in this tree: 12 of 13 phase tests failed on the openapi quoting defect. That is how I found §0 item 1.
- The first run in the copy failed 2 tests:
  - the `ETag "0"` header conflict (§0, third point);
  - an outsider getting 403 rather than 404, because commit-time re-authorisation converts a read denial into 403. Fixed by running the read gate first (the BE-D2 corrective-case precedent).
- The second run in the copy: 59/59 (`phases.test.ts` + `contract.test.ts`).

**Pinned counts:**

- Media-type pin: `[292, 291, 1]` → `[295, 294, 1]` (+3 JSON bodies: `updatePhaseStep`, `reviewPhaseStep`, `linkPhaseStepEvidence`).
- Integration: +14 tests (1 new file).
- Unit: no count change (2293).

## 5. Operations routed: delta to `p4-pending-be-l2.ts`

10 → 0. Removed and routed: `listPhases`, `getPhaseWorkspace`, `listPhaseSteps`, `getPhaseStep`, `updatePhaseStep`, `requestPhaseStepReview`, `reviewPhaseStep`, `listPhaseStepEvidence`, `linkPhaseStepEvidence`, `removePhaseStepEvidence`. Each is exercised through `ctx.mirrored` in `exerciseP4BeL2PhaseOperations`, with its zod mirror registered in `P4_MIRRORS_BE_L`.

## 6. Contract and schema needs (for the orchestrator)

1. `openapi.yaml`: 7 lines from single to double quotes (§0 item 1). **Required** for acceptance in this tree, and for BE-K2.
2. `workflows.test.ts` line 79: add `GET /api/v1/phases` as `authenticated` (§0 item 2). **Required.**
3. The ETag `"0"` decision for `getPhaseStep` and `getChangeControlPolicy` (§0). Not blocking.
4. **No schema change and no migration.** `0051`/`0053` suffice.
5. **i18n (FE-A/FE-F):** the message keys `gates.task.phase_step_review` and `gates.task.phase_step_enabled` (the latter shared with BE-K's worker), and every ADR-0035 §11 `phase_step.*` code, need EN/AR texts.

## 7. Interpretations made (ADR text silent or ambiguous); for the reviewers

1. **Review-item dedupe key.** ADR §7 item 3 gives `phase_step_review:<stepId>:<reviewRequestedAt>`, but there is one item **per holder**, and the key is unique per organization. I append `:<userId>`, following the ADR-0025 `<rule>:<subject>:<slot>[:<recipient>]` form.
2. **No reviewer-role holder.** No item is created, and the step still appears in the review queue. ADR §7 item 3 states no notification, unlike the gate routing in item 1.
3. **A re-request clears the previous review fields** (`reviewed_by/at`, outcome, note). The history stays in the audit trail.
4. **Owner change or restart while in review or complete.** This gives 422 `phase_step.invalid_transition` with from = to = the current status (for an owner change), because §11 has no dedicated code.
5. **Removing an already-removed link** gives the generic 422 `invalid_transition` "The evidence link is already removed." (no §11 code).
6. **`evidence_linked`** counts active links to `review_status = 'verified'` evidence, as the ADR says. The evidence's own archive status is not considered.
7. **The reviewer** must hold `phase_step.review` and be neither the owner nor the requester (§8). The reviewer is not required to hold the definition's reviewer role; the queue tasks go to that role's holders.
8. **No check that a newly assigned owner holds `phase_step.progress`.** Only an active user of the organization is required (`validation.user_invalid` otherwise).

## 8. What remains / not done

- The two frozen-file edits of §0. Until the orchestrator applies them, `phases.test.ts`, the BE-L contract exercise and one `workflows.test.ts` test fail in this tree.
- Administrator configuration of steps and rules (REQ-S04-001 "configure:ADM") is DG5, by ADR-0035 §12. It is not built and not claimed.
- REQ-PB-014 and REQ-S04-001 are complete on the API side once §0 is applied. The FE-F phase workspace page is a separate task.

## 9. Merge instructions and end-of-task checks

- **Merge:** no migration to run.
- **`db-errors.ts`:** my block and call line sit after BE-L's. BE-K2 also appends to the slice H block, so expect a textual conflict at the same spot. Keep both blocks, and keep an explicit `return null`/`default` per function. Each block is its own function, so nothing falls through.
- **`p4-exercises-be-l.ts`:** my code is appended at the end. The only edits above it are the import block and the map entries.
- **`contract.test.ts` pin:** +3 from base `[292, 291, 1]`.

End-of-task results: see the "Final" lines below.

**Final** (on the final tree; the code is unchanged since the test runs above):

- `node tools/gates/validate.mjs --historical --stage DG3`: exit 0, "PASS gate DG3 (historical)" (`validate-dg3-historical-end.txt`).
- `pnpm -r typecheck`: exit 0.
- `pnpm -r build`: exit 0 (re-run after the computed-key fix).
- `pnpm lint`: exit 0.
- `pnpm openapi:lint`: exit 0 (645 operations).
- Prettier check over `git ls-files -co --exclude-standard`: exit 0 (re-run after this handback was written).
- End time `date -u`: Fri Oct  9 20:05:34 UTC 2026. Elapsed: about 85 minutes, within the 100-minute mark.
