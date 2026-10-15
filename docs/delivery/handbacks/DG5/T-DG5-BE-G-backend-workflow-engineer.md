# Handback T-DG5-BE-G (backend-workflow-engineer): output adapters, the coverage view, the S16-015 entity group

## Continuation run (T-DG5-BE-GB)

- **This run.** Assignment `docs/delivery/assignments/DG5/T-DG5-BE-GB.md` (sha256 `70dfb1ed…3e3f`, verified at start). Invocation reference `{"kind":"claude-code-cli-session","run_id":"DG5-T-DG5-BE-GB-backend-workflow-engineer-20261014T232532Z-dbe0463d","session_id":"dbe0463d-3776-4582-b333-53e69c42e104"}`. `date -u` at start: `Wed Oct 14 23:25:43 UTC 2026`; at end: `Thu Oct 15 00:24:48 UTC 2026` (§8).
- **The interrupted run.** `DG5-T-DG5-BE-G-backend-workflow-engineer-20261014T214708Z-22b53452` stopped at a container restart (exit 143, no result; D-151, D-147 procedure). Its tree is WIP commit `a90d124` on `dg5/be-g`, which is this worktree's `HEAD`. Its run material is kept for provenance only under `docs/delivery/test-evidence/DG5/BE-G-orphaned/` in the main checkout.
- **What I found.**
  - Every file in §1 exists and holds what §1 says. No source or test file is truncated: each ends at its closing `});` or `}`. `p5-pending-be-g.ts` is `[]`.
  - The handback was complete except for §4. Its last four result rows and the end time were still placeholders (`UNIT_UNSET_EXIT`, `INTEG_COUNTS`, `VAL_END_EXIT`, `TIME_END`, …).
  - The interrupted run's logs (no `-B` suffix) are **not evidence**:
    - `integration.log` stops mid-run (1123 lines, no summary, no exit line).
    - `unit-locale-unset.log` has no exit status.
    - `unit-c-utf8.log` was never written.
    - `validate-dg4-end.log` was never written.
    - The other logs predate this run.
  - §8's defect D1 is still true in the merged code: `procedures/steps.ts` line 653 returns when `step.transformation_id === null`.
  - The en/ar coverage texts (`nav.json` `methodologyCoverage`; FE-D's placeholder route) are still true.
- **What I finished.** No code was missing, so I changed no source or test file. I re-ran every acceptance check on the final tree into `-B` logs, and replaced the placeholders in §4 and §8 with those results. Nothing else in §1–§8 needed correcting: I re-checked the files and their tail ends, the pending list, D1 and the user-facing texts.
- **The files this run changed**, all uncommitted:
  - this handback;
  - `docs/delivery/handbacks/DG5/T-DG5-BE-G-evidence/*-B.log`.

  Everything else is in WIP commit `a90d124`. The orchestrator integrates the diff `b8c9769..` plus the uncommitted files.
- **Acceptance re-run (all on this tree; details in §4).**

  | Check | Exit | Result |
  | --- | --- | --- |
  | historical DG4 validator, start | 0 | |
  | `pnpm -r typecheck` | 0 | |
  | `pnpm -r build` | 0 | |
  | `pnpm lint` | 0 | |
  | prettier | 0 | |
  | `pnpm openapi:lint` | 0 | |
  | `pnpm test`, locale unset | 0 | |
  | `pnpm test`, `C.UTF-8` | 0 | |
  | integration | 0 | 2246/2246 |
  | historical DG4 validator, end | 0 | |

- **Stage:** P5, gate DG5 (BUILDING). Section `docs/architecture/p5-work-split.md` §C.3. Wave W8 (D-150).
- **Assignment:** `docs/delivery/assignments/DG5/T-DG5-BE-G.md` (sha256 `32d97864…f1644`, verified at start).
- **Invocation reference:** `{"kind":"claude-code-cli-session","run_id":"DG5-T-DG5-BE-G-backend-workflow-engineer-20261014T214708Z-22b53452","session_id":"22b53452-0cef-47b6-ac6d-b9d18beae074"}`.
- **Base:** branch `dg5/be-g`, `HEAD` `b8c9769f50aab36363ba4127fc63de5292240cfc` for the interrupted run. The continuation run's `HEAD` is WIP commit `a90d124`, which holds the interrupted run's tree; see the top section. (The tree was clean apart from the environment dotfiles that were already untracked). Changes are left **uncommitted** for the orchestrator.
- **Time:** `date -u` at start `Wed Oct 14 21:47:21 UTC 2026`; at end: see §8.
- **Two gate systems.** Nothing here reads or writes DG0–DG7 records. Every approval and decision in the tests is a synthetic demo **business** approval decided by a synthetic business approver (Sponsor, receiving BO, Finance) through the canonical approval or the owning DG2–DG4 operation; nothing approves anything real, and no adapter, seed or job decides an approval.

## 1. Changed files

| File | Purpose |
|---|---|
| `apps/api/src/modules/procedures/coverage.ts` (new) | `getMethodologyCoverage` (`GET /api/v1/admin/coverage?versionId=`): every counted source element with its form/procedure links and a **live** status Covered / Planned / Not covered, integer totals; the zod mirror `methodologyCoverage` (ADR-0042 §6, §9, §11) |
| `apps/api/src/modules/procedures/outputs/kit.ts` (new) | The adapter kit: the verify-and-link factory `outputAdapter(spec)`, the scope / produced-since-launch / not-another-instance's-output / earlier-output checks, the exact ADR-0042 §10 refusals |
| `apps/api/src/modules/procedures/outputs/{transformations,kpi,workflows,portfolio,benefits,governance,sustainment,evidence}.ts` (new) | One adapter per output record type of the ADR-0042 §3 closed set (12; `approval` is the engine's own), grouped by owning module, each with the state its modes require |
| `apps/api/src/modules/procedures/outputs/index.ts` (new) | `PROCEDURE_OUTPUT_ADAPTERS` and `registerProcedureOutputAdapters()` |
| `apps/api/src/modules/procedures/outputs/outputs.test.ts` (new) | Unit tests: the adapter set equals the closed set minus `approval`; exact texts; named-record, earlier-output and scope rules; the coverage status rule |
| `apps/api/src/modules/procedures/routes.ts` | Two named lines: `registerProcedureOutputAdapters()` and `...registerMethodologyCoverageRoutes(app, deps)` (the "BE-G registers here" slot) |
| `apps/api/test/integration/procedures/coverage.test.ts` (new) | REQ-S01-003 integration test (4 tests) |
| `apps/api/test/integration/procedures/seeded-procedures.test.ts` (new) | REQ-S06-003 and REQ-S06-002's output clause (13 tests) |
| `apps/api/test/integration/procedures/entity-group.test.ts` (new) | REQ-S16-015 (5 tests) |
| `apps/api/test/integration/contract/p5-exercises-be-g.ts` | Exercises `getMethodologyCoverage` (200 default and named; 400; 403; 404 unknown and wrong kind) and registers its mirror |
| `apps/api/test/support/p5-pending-be-g.ts` | `getMethodologyCoverage` removed; the list is now empty |
| `docs/delivery/handbacks/DG5/T-DG5-BE-G-evidence/*.log` | Command logs cited in §4 |

**No migration.** `0073` (my reservation, D-145) is **unused**: no adapter needed a constraint or seed change. No new dependency. No edit outside my file ownership (no DG2–DG4 file, no `server.ts`, no `steps.ts`).

## 2. Design: what an adapter does, and the deviation I must disclose

ADR-0042 §3 and p5-work-split §C.3 have each adapter "call the owning module's exported service with the acting user", and say "a missing exported service is requested in the handback, never re-implemented". Two facts decided the implementation:

1. **procedures may import only** `platform, audit, access, organization, transformations, methodology, forms, evidence, tasks` (`apps/api/src/modules.ts`), and `architecture.test.ts` forbids any P5 module importing `workflows`. `kpi`, `portfolio`, `benefits`, `governance` and `sustainment` are not in procedures' `dependsOn`.
2. **None of the owning modules exports a create/decide service** for these records (baseline create/validate, KPI actual submit/accept, gate submission, gate decision, change request, ranking snapshot, Finance validation decision, executive decision, BAU handover, transformation create). The logic lives in their route handlers.

So every adapter **verifies and links** instead of creating: the person produces the record through the owning module's own operation (every DG2–DG4 rule, permission, SoD and audit event applies there), then completes the step naming it in `outputRecordId`; the adapter checks it **read-only** and the engine links it in `procedure_instance_link`. Nothing writes a domain table; nothing re-implements a domain rule.

| Mode | The adapter's check (refusal) |
|---|---|
| `create` | a record of the step's type is named (else 422 `procedure_step.output_required`); it exists in the instance's organization and transformation — an organization-scope instance: in the transformation its intake created (else 422 `procedure_step.output_record_invalid`); it was **produced since the launch** (its `created_at`, or `submitted_at` / `decided_at` where that is the act) and is **not already another instance's output** (else `output_record_invalid`); its state shows it was produced (else `output_required`) |
| `advance` | acts on the record an **earlier step** of the instance linked (else `output_required`); naming a different record → `output_record_invalid`; the record must be in the advanced state (else `output_required`) |
| `link` | a named, in-scope record in the state the step requires (else `output_record_invalid`) |

States per type: baseline `active` / advance `validation_status = validated`; KPI actual submitted-or-decided / advance `accepted`; TOM canvas cell link `ready`; ranking snapshot `current`; gate submission `pending|decided`, its `gate_code` equal to the instance's `gateCode` input / advance `decided`; change request not `draft|withdrawn` / advance `approved|rejected|executed`; Finance validation `approved|rejected` (a queued one is not a Finance decision); decision `open|decided|deferred` / advance `decided`; BAU handover `draft|submitted|accepted` / advance `accepted`; evidence `active`; transformation and charter: existence and scope.

**For approval steps whose output is `advance`** (gate_decision, decide_change, executive_decision, accept_handover) the adapter runs inside workflows' deciding transaction (BE-F2's `onApprovalOutcome`). If the domain record is not yet decided/accepted, the business approver's approval of the step is refused with 422 `procedure_step.output_required` and the approval stays **pending** (tested). The approver first decides the domain record, then approves the step.

**Why the `create` check is "produced since launch" and not "produced by the acting person".** The seeded `baseline_validation` makes the BO responsible for `record_baseline`, but BO does not hold `baseline.edit` (TL and KDS do; `0018`). A creator-equals-actor rule would make the seeded procedure unrunnable. I chose: produced in scope since the launch, by whoever holds the right in the owning module, and not taken by another instance. See request R2.

## 3. Behaviour delivered, per requirement row

### REQ-S01-003 (BE-G: the coverage view; completes with QA-E's A02)

Acceptance: *"A01;A02: every seeded methodology element shows a linked form or procedure in the coverage view; the guided scenario passes through input, validation, approval, output, monitoring, correction and sustainment on persisted records"*. My clause is the coverage view (p5-work-split §C.5; D-142 R1).

- `GET /api/v1/admin/coverage` (`methodology.read`; AUD and ADM_METHOD read; 403 without it; 400 bad/unknown query; 404 unknown version or a version of another configuration kind; default = newest published `playbook` methodology version). It reports the newest published `procedures` and `forms` versions it resolved against.
- Status per element, computed live on every read: **covered** when a link resolves to a working form (registered, `feature_status = working`) or to a procedure present and not removed in the newest published `procedures` version; **planned** when only planned targets are linked; **not_covered** otherwise. Planned and Not covered are never "covered".
- Tests (`coverage.test.ts`): 80/80 elements, each with ≥ 1 link, equal to the `source_element` inventory; integer totals that add up (covered 52, planned 28, not covered 0); the 3 launch windows and 25 health questions are **planned** with `resolved` planned form links; every other element covered; the status is live (moving `launch_plan` to working in a rolled-back owner transaction turns the launch windows covered, planned 28 → 25); auth/refusals.

### REQ-S06-002 (BE-F2 instances; BE-G outputs)

Acceptance: *"A02: a baseline-validation instance shows its current step and assignee; completing it creates a validated baseline record linked to the instance"*. p5-work-split's literal test: *"completing `baseline_validation` creates a baseline, the FIN step validates it, and the validated baseline is linked to the instance"*.

- `seeded-procedures.test.ts` › *"completing it creates a baseline, the FIN step validates it, and the validated baseline is linked"*: BO launches; `record_baseline` is current with assignee role BO; evidence linked; a KDS records the baseline through `POST …/baselines`; completing without naming it → 422 `output_required` (exact text); BO completes naming it → linked, one `procedure_instance_link.output` audit event in the request; FIN completing before validating → 422 `output_required`, nothing written; FIN validates through `POST …/baselines/{id}/validation`; naming another record → 422 `output_record_invalid`; FIN completes → instance **completed**, the baseline linked and `validation_status = validated` in the database.
- Refusals: a baseline from before the launch, from another transformation, a record of another type, or a baseline already another instance's output → 422 `output_record_invalid`, nothing written; AUD → 403.
- **Honest scope note:** "creates" is met by the verify-and-link design of §2 — the baseline is created through the DG2 operation by its right holder during the procedure and taken as the step's output. The adapter does not itself call a create service (none is exported; request R1).

### REQ-S06-003 (architect seed in `0069`; BE-G the launch/complete test)

Acceptance: *"A01;A06: the ten procedures exist after initialization and each can be launched and completed in the A02 scenario"*.

- Exist: `procedures` v1 (`01920005-0300-…0001`) is published with the ten codes in the M0153 order, none removed, each with a trigger and a completion rule; 31 steps; every output record type the seed names has an adapter or is the step's own approval; `GET /procedure-definitions` lists all ten to AUD.
- Each launches: nine in a transformation pinned to v1 (TO), the intake at organization scope (`transformationId: null`).
- **Completed end to end through the real DG2–DG4 operations and the adapters: 9 of 10**:

| Procedure | What the test drives |
|---|---|
| `baseline_validation` | baseline (DG2) → Finance validation (DG2) |
| `kpi_submission` | KPI actual submitted (DG4 review route) → accepted by its reviewer |
| `tom_approval` | a draft cell refused; the cell made ready (DG2) and linked; both parallel reviews; the Sponsor's approval links itself |
| `initiative_prioritization` | DG3 scores; ranking snapshot by TO; the Sponsor's approval |
| `gate_review` | G1 made ready and submitted (DG2); `finance_review` **not_applicable** (condition false); the step approval refused until the Sponsor's G1 decision, then completes |
| `scope_target_change` | a draft change request refused; submitted (DG4); decided through its own approval; then the step approval |
| `benefit_validation` | evidence and a Finance decision in parallel (a queued validation refused); `recovery_plan` not_applicable |
| `executive_escalation` | decision raised (T04/T16 register); the step approval refused while it is open; decided by its owner; the skippable step completed |
| `bau_handover` | prepared and submitted (DG4 sustainment); the BO's step approval refused until the receiving BO accepts; schedule_reviews by TO |

- **`new_transformation_intake` does not complete — a W7 engine defect, not in my files (see §6 D1).** The test proves the intake creates the transformation (DG1 create, TL), links its charter (DG2 create), refuses another transformation's charter, then shows `confirm_sponsor` active with `approvalId: null` and next action `procedures.next_action.await_approval_unrouted`. REQ-S06-003 is therefore **not complete** for the intake.

### REQ-S16-015 (BE-G the entity-group test; architect ERD §1m and `0069`)

Acceptance: *"…an integration test creates and reads each one through the API with authorization enforced"*.

`entity-group.test.ts` (5 tests):

| Entity | Create | Read |
|---|---|---|
| TOMDimension | `putConfigElement` in a methodology draft (D-142 Q4); an eleventh dimension → 422 `config_version.source_element_protected` | `listConfigElements?elementType=tom_dimension` |
| TOMCanvas | filling a cell (`updateTomCanvasCell`) | `getTomCanvas` (10 cells), `getTomCanvasCell` |
| Capability, Gap, Journey, Process | `createCapability`, `createTomGap`, `createJourney` (kind journey and process) | `getCapability`, `getTomGap`, `getJourney` (owner and status present) |
| ProcedureDefinition | `putProcedureDefinition` in a procedures draft | `getProcedureDefinition?versionId=` |
| ProcedureInstance | `launchProcedureInstance` | `getProcedureInstance` |

Authorization: AUD 403 on every write; an outsider gets 404 on every scoped read, and 403 on platform-wide Studio configuration, which has no record scope (the REQ-S16-012 precedent).

### Shared rules (p5-work-split §2)

- **Rule 4 (mutations).** My only route is a read. Adapters add no route: they run inside BE-F2's step-completion and approval-decided transactions, which carry the lock, commit-time authorization, `If-Match` and audit. An adapter refusal rolls the whole completion back (tested: version unchanged, no link). No remote or client I/O happens in the transaction; the adapters only read.
- **Rule 15 (exact refusals).** Only ADR-0042 §10 codes and texts (texts asserted in tests). Proposal P1 in §6.
- **Rules 13 and 8.** Tests pin their transformations to `procedures` v1, because other suites publish newer synthetic versions. No growing delivery folder is read. Ports were in 23851–23899.

## 4. Checks run

The environment for every command: worktree `/home/user/wt/dg5-be-g`, Node 24.21.0, offline. Logs are in `docs/delivery/handbacks/DG5/T-DG5-BE-G-evidence/`.

| Command | Exit | Result / counts | Log |
|---|---|---|---|
**These are the continuation run's results (T-DG5-BE-GB). They were run on the final tree, sequentially, with nothing else of mine running.**

The logs without `-B` belong to the interrupted run and are not evidence: see the top section.

| Command | Exit | Result / counts | Log |
|---|---|---|---|
| `node tools/gates/validate.mjs --historical --stage DG4` (start, 23:26Z) | 0 | `PASS gate DG4 (historical)` | (console; the same command is re-run at the end) |
| `pnpm -r typecheck` | 0 | | `typecheck-B.log` |
| `pnpm -r build` | 0 | | `build-B.log` |
| `pnpm lint` | 0 | `eslint . --max-warnings=0`, no output | `lint-B.log` |
| `git ls-files -co --exclude-standard -z \| xargs -0 npx prettier --check --ignore-unknown` | 0 | All matched files use Prettier code style | `prettier-B.log` |
| `pnpm openapi:lint` | 0 | `PASS docs/api/openapi.yaml: OpenAPI 3.1.1, 846 operations` | `openapi-lint-B.log` |
| `pnpm test` (LANG, LC_ALL, LC_CTYPE, LANGUAGE unset; 23:33–23:43Z) | 0 | unit-node 106 files, 1893/1893; unit-web 72 files, 1400/1400; unit-formula-nocodegen 3 files, 259 passed + 2 skipped (261) | `unit-locale-unset-B.log` |
| `LANG=C.UTF-8 LC_ALL=C.UTF-8 pnpm test` (23:43–23:54Z) | 0 | unit-node 1893/1893; unit-web 1400/1400; unit-formula-nocodegen 259 passed + 2 skipped | `unit-c-utf8-B.log` |
| `QA_PG_PORT=23851 MTH_PORT_POOL=23852-23899 tests/qa/support/with-pg.sh pnpm test:integration` (23:55–00:22Z) | 0 | 232 files, 2246/2246. Mine: `coverage.test.ts` 4, `seeded-procedures.test.ts` 13, `entity-group.test.ts` 5; `contract.test.ts` 74/74 | `integration-B.log` |
| `node tools/gates/validate.mjs --historical --stage DG4` (end) | 0 | `PASS gate DG4 (historical)` | `validate-dg4-end-B.log` |

None of the `-B` runs had a failed, flaky or retried test or a timeout. The word "retry" appears in the integration log only in test names.

The 2 skipped tests in unit-formula-nocodegen are `it.skipIf(NOCODEGEN)` in `packages/shared/src/formula/fuzz.test.ts` (lines 600 and 833). That project skips them by design. They are not mine.

**Pinned counts.** The `contract.test.ts` media-type triple `[361, 360, 1]` is unchanged (delta 0: my route is a bodiless GET). The rate-limit floor delta is 0. The operation count is unchanged (846; the operation existed in the contract).

**Non-zero intermediate runs (disclosed).** These were my own targeted runs, each fixed before the final runs:
- `coverage.test.ts`: a POST probe on the read-only path failed because the harness validates every call against the contract. I removed the probe.
- `seeded-procedures.test.ts`, three failures in my tests:
  - The intake launch needs an explicit `transformationId: null`.
  - My refusal test created a baseline before its own launch, so it was correctly refused.
  - An org-level TL gets 403 on `POST /transformations`. I added a BU-level TL grant, as DG1 requires.
- `entity-group.test.ts`: my unrun assumption that TL lacks `methodology.read` was wrong (TL reads drafts). I removed that assertion and kept the verified 403.
- First lint: one `consistent-type-imports` error in `kit.ts`, fixed.
- The first full procedures+contract run (`exit=1`) was the entity-group assertion above, fixed and rerun (5/5).
- **The first full `pnpm test` (locale unset, 22:32–22:53) exited 1.** Its log was overwritten by the final run, and the counts are quoted here.
  - unit-node: 2 failed | 1891 passed (1893). Both were genuine defects in my `kit.ts`:
    - `architecture.test.ts` "every import respects dependsOn…" flagged a computed member with a non-literal key (`state[c] = row[c]`) as a way around the module-interface check.
    - `advisory-locks.test.ts` "no module source outside the registry spells a class number" flagged the lock number `730254`, which I had written in a comment.
    - Both are fixed: state columns are now picked with `Object.entries(…).filter`, and the comment names the lock class `procedureInstanceStep`. Typecheck, build, lint and format were rerun after the fix (§4).
  - unit-web: 2 failed | 1398 passed (1400): `raid.test.tsx` "action register … edit sends If-Match" and `transformations.test.tsx` "effective permissions refresh after create (ar)".
    - Both are `findByRole` lookups that timed out. They ran while my own targeted vitest runs, and from 22:48 the integration suite, loaded the machine.
    - I changed no web file. The final sequential runs in §4 are the ones that count.
  - unit-formula-nocodegen: 259 passed + 2 skipped.
  - That background job then started a second, stale `C.UTF-8` run on the pre-fix code. I could not stop it (its processes run in another PID namespace, and `pkill -f` is forbidden), so it ran until the tool stopped it. Its partial output was discarded and replaced by the final run.
- The first `architecture.test.ts` rerun after the fix timed out (30 s) when run together with other files while the stale job was running. Run alone it passed. The final runs are sequential.

## 5. Operations routed (pending-list delta)

`apps/api/test/support/p5-pending-be-g.ts`: **−1 `getMethodologyCoverage`**, so the list is now `[]`. It is exercised in `p5-exercises-be-g.ts` through `ctx.mirrored`:
- 200: default, and a named methodology version;
- 400: bad `versionId`;
- 403: no `methodology.read`;
- 404: unknown version, and a `scoring_defaults` version.

401 is covered by the harness's unauthenticated suite. 429 belongs to the rate limiter's suite.

## 6. For the orchestrator: defects, requests and proposals

- **D1 (defect in merged W7 code, `procedures/steps.ts`, BE-F2's file): organization-scope approval steps are never routed.**
  - `requestStepApproval` returns when `step.transformation_id === null`.
  - The step instances of an organization-scope instance always carry `transformation_id = NULL`, because they copy the instance's. So `new_transformation_intake` → `confirm_sponsor` never requests its approval, even after the intake's `transformation` output is linked. `approvalTransformationOf` already finds that transformation.
  - BE-F2's handback item 2 expected BE-G's create adapter to unblock this. It cannot: the guard is on the step row.
  - Fix candidate (owner BE-F2 or the orchestrator):
    1. route on `approvalTransformationOf(b)` alone;
    2. check whether the `procedure_step` approval subject provider (0072) and the `approval` row's scope accept a subject without a transformation, which may need a forward migration;
    3. re-request the approval when the transformation link appears, if the step was activated before it existed.
  - My test pins the current behaviour and labels it a known gap, so a fix will turn that assertion red on purpose. Update it then to approve and complete.
  - Until then REQ-S06-003 is incomplete for 1 of 10 procedures.
- **R1 (requested exported services, the ADR-0042 §3 intent).** Create/decide services callable in the caller's transaction with the acting principal, wired to procedures through `server.ts` ports, because procedures may not import these modules:
  - kpi: `createBaseline`, `validateBaseline`, KPI actual `submit` and `accept`;
  - workflows: gate `submit` and `decide`, change request `create`, `submit` and `decide`, executive decision `create` and `decide`;
  - portfolio: `recordRankingSnapshot`;
  - benefits: Finance validation `decide`;
  - sustainment: BAU handover `create`, `submit` and `accept`;
  - transformations: `createTransformation`, `createCharter`.

  With them, an adapter's `create` could produce the record from `outputInput` instead of verifying one. Until then the verify-and-link design (§2) applies, and the adapters do not re-implement any of it.
- **R2 (seed vs. permissions, product owner or architect).** In `0069`, `baseline_validation.record_baseline` names BO, but BO lacks `baseline.edit`. With a real create service, BO would be refused. Either the step's role becomes KDS or TL, or the policy is accepted as "BO confirms a baseline that a KDS or TL recorded" (what my adapter allows). Similar checks may be worth doing for the other seeded steps whose responsible role differs from the domain right holder: `kpi_submission` (BO submits, KDS accepts, which is the reverse of DG4's review route) and `prepare_handover` (TL, while WL holds `bau_handover.prepare`).
- **P1 (proposed refusal code, rule 15).** I used `procedure_step.output_required` for "the record exists but has not reached the state this step records" (not yet validated, accepted or decided). A narrower code would help the UI and FE-D: proposed 422 `procedure_step.output_not_ready`, *"The output record has not reached the state this step records yet."*. It is not implemented.
- **Q1 (shared mirror).** The `MethodologyCoverage` zod mirror lives in `procedures/coverage.ts`, because `packages/shared/src/schemas/procedures.ts` is BE-F's. FE-D will probably want it in `@mth/shared/schemas`. That is a move of about 30 lines, plus a barrel line.
- **Events.** No new outbox event. ADR-0042 §7's `procedure_step.completed` and the other events remain not emitted (BE-F2 handback).

## 7. User-facing texts (F-DG4-160)

I checked the en/ar strings for the coverage view and procedure outputs. The `admin/coverage` web route is FE-D's placeholder (`router.tsx`, `owner: "FE-D"`), and its texts describe the screen. The screen is still not shipped, so they remain true. `nav.json`'s `methodologyCoverage` summary ("Each methodology element with the form or procedure that implements it.") is true now that the API exists. **No string became untrue, and I edited none.** The coverage view returns `messageKey`-free data: codes, labels from `source_element` in en and ar, and statuses. FE-D renders the status labels in both languages.

## 8. What remains

1. **D1** (above): `new_transformation_intake` cannot complete until the organization-scope approval routing is fixed in `steps.ts`. This is outside my ownership. REQ-S06-003 stays incomplete for that procedure.
2. **R1**: adapters that *create* through exported domain services, once those services exist (ADR-0042 §3's intent). Today they verify and link.
3. QA-E's A02 guided scenario (REQ-S01-003's second clause) and FE-D's coverage screen.

End (continuation run T-DG5-BE-GB): `date -u` = `Thu Oct 15 00:24:48 UTC 2026`. The historical validator at the end is in §4.
