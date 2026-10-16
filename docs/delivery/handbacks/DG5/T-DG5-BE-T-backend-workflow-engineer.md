# T-DG5-BE-T handback: the International Roaming dataset, its chains, the coverage conditions (backend-workflow-engineer)

- **Stage:** P5, gate DG5 (BUILDING). Task T-DG5-BE-T, p5-work-split §J.2. Wave W15 (D-160).
- **Invocation:** `{"kind":"claude-code-cli-session","run_id":"DG5-T-DG5-BE-T-backend-workflow-engineer-20261016T111556Z-02eb52fa","session_id":"02eb52fa-5ccf-4c04-9e14-43161e50a2c2"}`.
- **Assignment:** `docs/delivery/assignments/DG5/T-DG5-BE-T.md`, sha256 `f99bc5bc4fb7e733182d604642dd6b59585851626701a9b658712cb8327be537` (checked with `sha256sum`).
- **Base:** branch `dg5/be-t` at `4a05c4f` ("DG5 W15 assignments: BE-T, BE-R2, FE-C, FE-D (D-160)"). Changes are **uncommitted**, as asked.
- **Time:** start `2026-10-16T11:16:12Z`, end `2026-10-16T12:59:00Z` (`date -u` at both). That is about 1 h 43 min; I stopped at the ~100-minute mark, as the assignment asks, while the full integration run was still going (§3 C).
- **Preceding gate:** `node tools/gates/validate.mjs --historical --stage DG4` printed `PASS gate DG4 (historical)`, exit 0, before any edit; re-run in the final check run (§3).
- **Engineering agent only.** Nothing here grants a real business, Finance or IT approval. The dataset is synthetic (B0144 "Illustrative example only. Replace assumptions with validated company data."); every seeded decision is a synthetic record by a demo user and approves nothing real. Product gate G6 never implies DG7; nothing here reads or writes DG0–DG7.

## 1. Files changed

| File | Status | Purpose |
|---|---|---|
| `packages/db/src/demo/data/roaming-ids.ts` | new | BE-T's fixed id scheme `01995000-1<block>-7000-8000-<n>` (second group starts with 1; KBE-H's start with 4, the anchors keep `0000`), one block per table. |
| `packages/db/src/demo/data/roaming.ts` | new | Module `roaming.foundation` (order 100): the organization, business unit, the eight demo role users `roaming.user.{sp,tl,bo,fin,kds,wl,to,cm}` with demo-IdP identities and transformation-scope role assignments, the roaming transformation (End-to-End, B0144 on its overview), and the product's whole starter structure **with fixed ids** (methodology/scoring-defaults/forms pins, the six seeded T01 rows, the ten TOM canvas cells, G1–G6 gate instances, the four B0079 waves, the T06 source-default weight set, the T11/T12 matrices, decision rights and RACI cells, the five forums), then a call of `p4_instantiate_transformation` that must add **0** rows. Module `roaming.elements` (order 110): the seven B0145 elements verbatim (North Star, charter + version 1 with the case for change, outcomes, initiatives, governance and benefits; the TOM focus in every canvas cell), the three B0147 chains' findings, TOM gaps, `issue_gap` trace links, initiatives INI-01..03 (the `DEMO_ANCHORS` ids) and gap links, T06 scores, the T04 design decision, the **overdue** T16 executive decision (due 2026-08-22, open), the T08 dependency, the T15 risk, the T13 stakeholder group and intervention, and the **adoption gap** (INI-01 `adoption_status = at_risk`). |
| `packages/db/src/demo/data/roaming-chains.ts` | new | Module `roaming.chains` (order 500, after KBE-H's 400–440): per chain the outcome KPI on KBE-H's KPI definition and the initiative → outcome contribution. Module `roaming.zz_code_counters` (order 900): `record_code_counter` rows for the seeded codes, so the product's next code (e.g. INI-04, DEC-02, DEP-02) never collides with a seeded one. |
| `packages/db/src/demo/data/roaming-states.ts` | new | Module `roaming.states` (order 600): 25 phase steps (every `phase_step_definition`, the six phases), the 90-day launch plan (B0134, start 2026-07-03) with every template task, performance area PA-01 with cycle 1 and a **draft** BAU handover HO-01, and one **submitted** 25-question health assessment (25 answers, top 3 actions, score from the database's `p5_health_assessment_result`). |
| `packages/db/src/demo/data/index.ts` | edited (BE-S stub, BE-T-owned) | `DEMO_DATASET_MODULES` = BE-T's modules + `KBE_H_DATASET_MODULES`. |
| `packages/db/src/demo/coverage.ts` | edited (BE-T's named lines) | Every ADR-0050 §5 condition now has its count query (none is `null`); KBE-H's `countStaleKpis`/`countSharedBenefits` are loaded with a dynamic import (a static import would be a module cycle through `kpis.ts`). The framework (`runCoverage`, `CoverageCondition`, `DEMO_TRANSFORMATION_ID`) is unchanged. |
| `packages/db/src/demo/coverage.test.ts` | new | Unit test (unit-node): the condition list equals ADR-0050 §5 in order, and every condition has a query. |
| `packages/db/test/integration/demo-roaming.test.ts` | new | Integration test: seeds the **default** dataset through BE-S's `seedDemo` into a scratch database; REQ-PB-088, REQ-PB-090, REQ-S18-002 and determinism (66 tests). |
| `packages/db/migrations/0093_p5_roaming_example_source_working.sql` | new | Rule A-7: `source_element` `roaming_example.international_roaming` → `feature_status = 'working'` (one row; raises otherwise). |
| `packages/db/test/integration/demo.test.ts` | edited (BE-S's test, 1 assertion block) | The assertion "No condition SQL yet (BE-T fills it): coverage `{}`, every code not implemented" was true only before this task. It now expects every condition counted (0 on BE-S's three-row test dataset, which has no roaming transformation), none unimplemented, run incomplete. |
| `apps/api/test/integration/environment/environment.test.ts` | edited (BE-S's test, 1 line) | Same reason: `coverage: {}` → `coverage: seeded.coverage`. |
| `docs/delivery/handbacks/DG5/T-DG5-BE-T-*` | new | This handback and its evidence logs. |

The two BE-S test edits are outside "my files" in the narrow sense. They are the minimum needed for the suite to stay green once the conditions' SQL exists, which §J.1 itself hands to BE-T ("conditions as named queries; BE-T fills their SQL"). I disclose them here for the orchestrator.

## 2. Behaviour delivered, per requirement row

The dataset seeds **412 registered records** (BE-T's and KBE-H's) in one transaction. Every engine guard and deferred constraint runs at commit. Two seeds into fresh databases give identical record counts and checksum (asserted).

### REQ-PB-088 — met (the BE-T part)

Acceptance: "A01: the demo transformation's North Star equals 'Make international roaming effortless, trusted and economically accretive.'; the production initialization contains no demo records".

- `north_star.statement` (current) = "Make international roaming effortless, trusted and economically accretive.", and the charter points to it (asserted with the literal string).
- The seven B0145 elements are carried **verbatim**, copied from `docs/source/playbook.md` B0145 (`B0145` in `roaming.ts`):
  - case for change → `charter.case_for_change` (equality asserted);
  - North Star → `north_star`;
  - outcomes and initiatives → `charter.in_scope`;
  - TOM focus → all ten canvas cells' target designs;
  - governance → `charter.governance_forum`;
  - benefits → `charter.success_definition`.
- The B0144 sentence is the transformation's description (overview).
- "The production initialization contains no demo records": this is BE-S's path, and BE-S's test of it (`demo.test.ts`, REQ-S18-003) passes with the real dataset.

### REQ-PB-090 — partly met (the line differs in its last two labels; see §6 item 1)

Acceptance: "A01: the traceability view shows 'Low activation -> Proposition + journey -> Pass redesign + digital activation -> Attach rate / activation -> Revenue uplift'".

- Each of the three B0147 chains is one line of linked records in the DG4 traceability model (`traceability_edge`, ADR-0038 §1):
  - diagnostic finding "Low activation";
  - `issue_gap` → TOM gap "Proposition + journey";
  - `gap_initiative` → initiative "Pass redesign + digital activation";
  - `initiative_kpi` → outcome "Attach rate / activation";
  - `outcome_kpi_of` → outcome KPI (KBE-H's "Roaming attach rate");
  - `kpi_benefit_measure` → benefit (KBE-H's B01 "Roaming revenue uplift").

  The same holds for "High complaints" and "Partner cost pressure". The test walks the edges and asserts the node types and the four B0147 labels verbatim.
- **The line is not the literal text.** The view labels an outcome KPI with its KPI definition's name, and a benefit with its title. Both are KBE-H's records, in files I may not edit: "Roaming attach rate" and "Roaming revenue uplift", where B0147 says "Attach rate / activation" and "Revenue uplift". The view therefore shows "Low activation -> Proposition + journey -> Pass redesign + digital activation -> Attach rate / activation -> Roaming attach rate -> Roaming revenue uplift". §6 item 1 gives the one-line fix.

### REQ-S18-002 — met (with KBE-H)

Acceptance: "A01;A02: a seed-coverage test finds at least one record for each of T01-T16, G1-G6, the six phases, ten TOM dimensions and six dashboard areas, plus one each of: stale KPI, overdue decision, shared benefit, adoption gap, BAU handover, missing evidence, pending approval".

`demo-roaming.test.ts` asserts `coverageComplete = true` and a count ≥ 1 for each of the 52 conditions. All of them are records of the one roaming transformation, linked into its chains and registers. The counts of the final seed:

| Conditions | Count rule (named lines in `coverage.ts`) | Seeded |
|---|---|---|
| T01–T16 | T01 active diagnostic items; T02 active outcomes with an active outcome KPI; T03 TOM gaps; T04 design decisions; T05 initiatives; T06 scores with an active weight set; T07 waves; T08 dependencies; T09 benefit formulas (KBE-H); T10 dashboard areas with data; T11 decision rights; T12 RACI deliverables; T13 stakeholder groups with an intervention; T14 benefits (KBE-H); T15 RAID entries; T16 executive decisions | 6, 3, 3, 1, 3, 15, 4, 1, 3, 6, 4, 6, 1, 3, 1, 1 |
| G1–G6 | a gate instance of each | 1 each |
| six phases | phase steps of the phase (`phase_definition` ordinal order) | 5, 3, 4, 5, 4, 4 |
| ten TOM dimensions | a canvas cell with a target design | 1 each |
| six dashboard areas | outcomes: active outcome KPIs; value: benefits with plan values; portfolio: initiatives; dependencies: open ones; decisions: open executive decisions; people & adoption: assessed initiatives + stakeholder groups | 3, 3, 3, 1, 1, 2 |
| health assessment | submitted with 25 answers | 1 |
| stale KPI / shared benefit | KBE-H's `countStaleKpis` / `countSharedBenefits` | 1 / 1 |
| overdue decision | open executive decision due before the synthetic clock's date | 1 |
| adoption gap | initiative with `adoption_status = 'at_risk'` | 1 |
| BAU handover | a handover of the transformation (a draft) | 1 |
| missing evidence | a phase step whose definition requires evidence (`evidence_linked`) with no active evidence attached | 25 |
| pending approval | pending `approval` + submitted/under-review gate + **queued Finance validation** | 1 (KBE-H's queued B01 August validation) |

### Determinism and identity (REQ-S18-001 with BE-S; §J.8)

- Every registered id is a fixed `01995000-…` literal (asserted for all 412).
- Every time derives from the synthetic clock.
- The starter structure is the product's own, written with fixed ids (`p4_instantiate_transformation` adds 0 rows, enforced in the seed).
- BE-S's CLI test "seed-demo, then reset-demo twice gives identical counts and checksums" now runs on this shipped dataset and passes.
- Demo users have no credential. Their `user_identity` rows name only `DEMO_IDP_ISSUER = https://demo-idp.mth.invalid/realms/roaming-demo` (the `.invalid` TLD, RFC 2606), with subject `roaming.user.<role>`.

### Migration `0093`

`0093_p5_roaming_example_source_working.sql` moves the single `roaming_example` source element to `working` (rule A-7). I wrote it after the dataset passed the complete coverage check. `source-coverage.test.ts` and `reader-search-provenance.test.ts` read the status from the database, and both pass.

## 3. Checks actually run

Environment:
- Node 24.21.0 (`/opt/nvm/versions/node/v24.21.0/bin`), offline.
- Worktree `/home/user/wt/dg5-be-t`. Harness ports 23200–23249 only (exploration clusters 23200/23210–23212, targeted runs 23220–23239, the final integration 23240–23249).
- Empty `.claude/.cc-writes` folders removed before every test run.

Logs are in `docs/delivery/handbacks/DG5/T-DG5-BE-T-evidence/`. Each log starts with its command and ends with `EXIT=<status>`.

**Final run** (`$TMPDIR/checks.sh`, one step after another, from 12:05Z, on the final code). The load average was 17–24 throughout: four W15 agents were running.

| # | Command | Exit | Result | Log |
|---|---|---|---|---|
| 1 | `pnpm -r typecheck` | **0** | all packages | `typecheck.log` |
| 2 | `pnpm -r build` | **0** | all packages | `build.log` |
| 3 | `pnpm lint` | **0** | clean | `lint.log` |
| 4 | `git ls-files -co --exclude-standard -z \| xargs -0 npx prettier --check --ignore-unknown` | **0** | "All matched files use Prettier code style!" (this handback was written after this step; I re-ran prettier on it, see the end) | `prettier.log` |
| 5 | `pnpm openapi:lint` | **0** | "PASS docs/api/openapi.yaml: OpenAPI 3.1.1, 846 operations" (unchanged) | `openapi-lint.log` |
| 6 | `node tools/gates/validate.mjs --historical --stage DG4` | **0** | "PASS gate DG4 (historical)" | `validate-dg4-historical.log` |
| 7 | `pnpm test`, locale unset (`env -u LANG -u LC_ALL -u LC_CTYPE -u LANGUAGE`) | **1** | unit-node 134 files: **2162 passed, 1 failed** (environmental, see A); unit-web 74 / **1429** passed; unit-formula-nocodegen 3 / **259** passed + 2 skipped by design | `unit-locale-unset.log` |
| 8 | `LANG=C.UTF-8 LC_ALL=C.UTF-8 pnpm test` | **1** | unit-node: **2159 passed, 4 failed** (A, plus 3 timeouts under load, see B); unit-web 74 / **1429** passed; nocodegen 3 / **259** passed + 2 skipped | `unit-c-utf8.log` |
| 9 | `QA_PG_PORT=23240 MTH_PORT_POOL=23241-23249 tests/qa/support/with-pg.sh pnpm test:integration` | **not finished** | Started 12:44:21Z. At 12:57:50Z, 38 files had passed and none had failed, of about 270. At this load the full run needs about 90 minutes, past the assignment's 2-hour limit, so I stopped waiting and wrote this handback (see C). | `integration.log` (still being written by the run) |
| 10 | re-run of the failed unit files, locale unset: `npx vitest run --project unit-node apps/api/src/architecture.test.ts packages/reporting/src/pdf/pdf.test.ts` | **1** | 150 passed, **2 timed out** (B); the structural failure A is gone | `unit-rerun-failed-files-unset.log` |
| 11 | the same, C.UTF-8 | **1** | 151 passed, **1 timed out** (B); A is gone | `unit-rerun-failed-files-c-utf8.log` |

**A. The environmental failure (steps 7 and 8).**
- **Test:** `apps/api/src/architecture.test.ts` › "has only mapped module directories …".
- **What it reported:** `expected [ '.claude' ] to deeply equal []`.
- **Cause:** the sandbox's write tracking had created an empty `apps/api/src/modules/.claude/` folder. My pre-test cleanup removed only the empty `.cc-writes` child, not the `.claude` parent.
- **Fix:** I removed every empty `.claude` folder under `apps/`, `packages/` and `tests/`. In the isolated re-runs (steps 10 and 11) this test passes. No source file is involved.

**B. Timeouts under load (steps 8, 10 and 11).** All are in files this task does not change (`git diff --stat` shows nothing under `apps/api/src` or `packages/reporting`). They are the F-DG4-148 class that D-146 records, and KBE-H's handback describes the same architecture-test margin.
- `architecture.test.ts` › "every import respects dependsOn …" timed out at 30 s.
- `packages/reporting/src/pdf/pdf.test.ts` › Arabic PDF tests timed out at 5 s.

  Each one passes or fails depending on the run, and they reproduced in isolation at load 21. I could not get a low-load window inside the time limit. **So `pnpm test` did not pass in either locale in this session.** That is unproven rather than shown failing for a code reason. It needs a re-run at low load by the orchestrator.

**C. Integration.** The full `pnpm test:integration` result is **not available**. What I can show:
- the targeted integration runs below (129 tests, 7 files, every file this task touches or depends on), all passed;
- the partial full run (38 files passed, 0 failed when I stopped watching).

The run's process lives in another sandbox namespace, which I cannot signal from my shell. It kept running after the handback was written. The session's background limit (90 minutes for the whole check script, started 12:05Z) stopped it before it finished. At 13:33:48Z, `integration.log` showed **213 files passed and 0 failed**, with no summary and no `EXIT=` line. The suite therefore has no final result. **Acceptance item 3 is not met in this session.**

**Targeted runs during development (disclosed; not a substitute for the above).**
- Two runs of `tests/qa/support/with-pg.sh npx vitest run --project integration <files>`:
  - (a) `demo-roaming`, `demo`, `demo-numbers` and `environment`: 4 files, 86 passed + 9 todo. That was before the last four conditions were seeded; the todo marks were removed afterwards.
  - (b) the same files plus `source-coverage`, `reader-search-provenance` and `migrate`: 7 files, **129 passed**, after 0093.
- The development seeds went through a scratch script (`$TMPDIR/try.ts`) on a private cluster. They failed on the way (wrong column names, guard refusals such as `bau_handover_starts_draft`, `health_assessment_answer_response_allowed`, `launch_task_template_match`, `decision_ask_options`), and each failure was fixed before the runs above.
- Three of my long-lived exploration-cluster background commands were stopped at their time limit. They were scratch clusters only, and no check depended on them.

**Pinned counts:** no operation was routed, so the media-type triple and the rate-limit floor change by **+0**. Test-count deltas: unit-node +3 (`coverage.test.ts`); integration +66 (`demo-roaming.test.ts`).

## 4. Operations routed (delta to the pending list)

None. §J.2 assigns no operation, and this task has no `p5-pending-be-t.ts` or `p5-exercises-be-t.ts`. Pending-list delta: none. Contract delta: none (`pnpm openapi:lint` is unchanged).

## 5. Contract, schema or dependency needs

- **Dependency:** none.
- **Contract:** none.
- **Migration:** `0093` only (assigned).
- **Refusal codes:** none added.
- **Configuration (for the orchestrator and devops, D-142 Q7):** the demo deployment's OIDC issuer must be `DEMO_IDP_ISSUER` (`roaming.ts`), with subjects `roaming.user.<role>`, so that the seeded demo users can sign in. Alternatively, a configuration key could name the issuer, and the seed would read it. Nothing in the repository holds a credential. The compose `demo` profile is still the devops request of ADR-0050 §1.

## 6. Decisions and follow-ups for the orchestrator

1. **REQ-PB-090's literal line (KBE-H's files).**
   - **Proposed fix (one line each in `benefits.ts` and `kpis.ts`):** KBE-H's B0147 benefit titles become "Revenue uplift", "CX + care cost" and "Margin improvement", and the KPI names become "Attach rate / activation", "Complaint rate" and "Cost/MB, margin".
   - **My matching change:** `roaming-chains.ts` then names the outcome KPI in the contribution (`outcome_kpi_id`), so the view's line has exactly five nodes, "Low activation -> Proposition + journey -> Pass redesign + digital activation -> Attach rate / activation -> Revenue uplift". The test would then assert the literal string.
   - **Alternative:** accept today's six-node line, which carries the B0147 KPI text on the outcome node.
2. **"Pending approval" is a queued Finance validation.** The dataset has no pending `approval` row and no submitted gate.
   - I counted the queued Finance validation because Finance validation is a business approval in the product (it carries the synthetic approval label of ADR-0050 §2(c)).
   - §J.2's file list also names "G1–G6 instances (synthetic decisions, one pending approval)". G1–G6 exist as **draft** instances only: no synthetic gate decision is seeded (see §8).
3. **The BAU handover is a draft.** `bau_handover_guard` requires an active control of the area and an attached evidence file to submit. The dataset has no evidence file (evidence content storage, ADR-0010). Walkthrough step 11 ("accept BAU handover") works on the demo user's own transformation, so it is unaffected.
4. **Missing evidence** = phase steps that require evidence and have none. All 25 steps are `not_started`, while the transformation's `current_phase` is `transform`; no step is complete, because completion needs evidence and a review. The dataset therefore exercises missing evidence, but not a realistically advanced phase history.
5. **Unregistered rows.** `record_code_counter` has no `id` column, so its rows cannot go through `ctx.insert` or the registry. They are deterministic, but outside the checksum; the counts are identical across seeds.
6. **KBE-H's open items stay open:** the `ctx.update` attribution (§6.2 of their handback), read-time staleness after the synthetic clock (§6.3), and the `benefit_lifecycle_history` trigger's generated ids (§6.4). The test-only anchors in `packages/db/test/demo-roaming-anchors.ts` (KBE-H's) are no longer needed by the shipped dataset; KBE-H's test still uses them on its own.

## 7. User-facing texts made untrue

None found:
- I searched `apps/web/src/i18n/{en,ar}` and the API texts. No string calls the demo dataset, the roaming example or the seed "planned" or "later".
- The source-coverage report reads `feature_status` from the database, so `0093` makes it say "working".
- The `studio.json` label "Roaming example" / "مثال التجوال" is a set name, and it stays true.

## 8. What remains

- **Checks (acceptance items 2 and 3).** These must be re-run at low load:
  - `pnpm test` in both locales; the failures were the stray `.claude` folder, now removed, and load timeouts in files this task does not change (§3 A, B);
  - the full `pnpm test:integration`, which was not finished (§3 C).

  Typecheck, build, lint, prettier, openapi:lint and the DG4 historical validator all exit 0.

- **REQ-PB-090 literal text:** §6 item 1 (KBE-H's files, an orchestrator decision).
- **§J.2 list items not seeded:**
  - synthetic G1–G6 **decisions** (all six gates are draft instances) and a pending gate approval;
  - a submitted or accepted BAU handover (needs a control and an evidence file);
  - an evidence item at all, and therefore no linked evidence on any step.

  "Ten TOM canvas cells", "the six dashboard areas", the overdue executive decision, missing mandatory evidence, an adoption gap, a BAU handover, a submitted health assessment and a launch plan **are** seeded.
- **Separable second half (D-059/D-070):** "the gate history". That means synthetic G1–G4 submissions and decisions by the demo Sponsor (each labelled "Synthetic demonstration - approves nothing real"), one gate left submitted as the pending gate approval, the evidence items with content, the T03-linked phase-step evidence, and a submitted handover. It is all additive in `demo/data/**`, with the coverage queries unchanged.
