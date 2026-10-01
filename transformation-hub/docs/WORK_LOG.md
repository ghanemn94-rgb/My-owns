# Work log (checkpoint)

> Resumption: read this file, then `git log --oneline -15`, then follow "Next action". See CLAUDE.md → Resumption procedure.

## Current state — 2026-09-30

- **Branch:** `claude/mobily-transformation-hub` (repository `My-owns`, project directory `transformation-hub/`).
- **Checkpoint revision:** `3735be4`.

### Phases

- **P0:** PASS.
- **P1:** gate PASS WITH CONDITIONS at `65b53e9` (`docs/phases/P1-gate-report.json`). The P2 reviews confirmed every P1 closure.
- **P2:** gate **PASS WITH CONDITIONS** at `bddb637` (`docs/phases/P2-gate-report.json`; CI run 50 green: API 871 passed + 14 expected fail, Playwright 314 passed). Conditions: the P2 residuals (19 musts) before the P3 gate; the domain part of C2 in the P3 domain review; Low items with owners; governance-owner questions.
  All findings of the three P2 reviews are fixed and merged.
  - P2 residuals, governance/planning part merged: GOV-002, GOV-019 (422/409 variance recorded), GOV-027, GOV-009, DAT-013, WS-003, UX-018 → Tested; GOV-008 (retention, P7) and GOV-012 (requester notification, P6) stay Implemented. P2 musts: 68 Tested, 15 Implemented, 2 Deferred. Screens part merged too (Kanban over the task status command, overview with committee charter version and approved baseline, metric drill-downs whose list total equals the tile, setup-wizard steps 5–6 that never approve, raise a change request from a risk, Gantt baseline variance, the E2E acceptance tests): PLN-002, SET-013, SET-014, UX-006/007/008/009/015/022/023/024 Tested. P2 musts now 79 Tested, 4 Implemented (GOV-008 retention → P7, GOV-012 notification → P6, ENT-010 owner variance, PLN-023 → P5 review), 2 Deferred — P2 gate condition C1 met. The implementer's full Playwright run: 415 passed + 1 skipped.
  - Security review: PASS WITH CONDITIONS. Access-matrix §2.2 option B is in place: the strict rule, plus 4 project-level read exceptions pending Mobily data governance (AMQ-09). The governance lists apply the grant filter.
  - Domain final review (`docs/reviews/P2-domain-final-review.md`): PASS WITH CONDITIONS. DOM-P2F-01 and -03 fixed by the lead; DOM-P2F-08 and -09 fixed with the P4 decision-reuse fixes (part 2). The Low items DOM-P2F-02, -04, -05, -06, -07, -10 and DOM-P2R-06, -08 go to the P2 gate report with owners.
  - QA final re-review (`docs/reviews/P2-qa-final-review.md`): PASS WITH CONDITIONS. QA-P2F-02, QA-P2F-03 and the QA-P2-05 residual are fixed; C1 (disposition of the 23 P2 musts still Implemented) and C4 addressed; C2 goes into the P3/P4 reviews.
  - Open questions for the governance owner: Q-40, Q-43, O-1, A-50/52/53, DOM-P2R-06/08; from P4: the 30-day long-stop warning, an extension decision type, and whether a decision paper can name a closing / model version / TSA / cutover plan (subject rule `required`).
- **P3:** gate **PASS WITH CONDITIONS** at `bb8a373` (`docs/phases/P3-gate-report.json`; CI run 65 green: API 1060 passed + 2 expected fail, Playwright 395 passed + 1 skipped). Conditions: independent re-verification of the last fixes and a QA re-check of the P3 verdict in the P5 QA review; owner questions (Q-P3-*, Q-P34R2-01).
- **P3 and P4 security review** (`docs/reviews/P3-P4-security-review.md`, at `5bf274b`): P3 PASS WITH CONDITIONS (Medium SEC-P34-01 P3 part, -02, -05, -07 to fix before the P3 gate), P4 PASS WITH CONDITIONS (Medium SEC-P34-01 P4 part, -03, -04 before the P4 gate); the P2 closure re-check (C2) confirmed SEC-P2-02/03/05/06 and SEC-P2-01 with Low residuals SEC-P34-12/13. P4 / AI / governance part fixed and merged (SEC-P34-01 for CPs, closing deliverables, obligations, benefits and action closure; -02, -03 — the P4 finance exit criterion now holds in the AI channel; -04, -09, -10 two-person "not required"; -12, -13, -17; -11 documented). The P3-module part (SEC-P34-01 readiness/NewCo, -05 to -08) is in the P3 fixes package.
- **P3 domain review** (`docs/reviews/P3-domain-review.md`, at `5bf274b`): **FAIL** — 4 High (DOM-P3-01 a field edit moves a failed blocker to another plan; -05 "not applicable" transfer aspects read as transferred; -06 an extension decision is not bound to its end date; -09 rejected sign-off evidence leaves a blocker passed), 8 Medium, 5 Low. Exit criteria "blockers prevent go-live" and "extensions await an approved decision" not met. The P2 closure re-check (C2) is CONFIRMED for all five domain probe files. All P3 domain findings (DOM-P3-01 … -17) and the P3-module security findings (SEC-P34-01 P3 part, -05, -06, -07, -08) are fixed and merged (readiness rebind command, evidence reactions, per-project readiness and dimension locks, transfer "not applicable" determination, extension terms bound to the decision, documented dimension vocabulary, Legal-only regulatory verification). Open owner questions recorded (Q-P3-*). Focused domain re-review (`docs/reviews/P3-P4-domain-rereview.md`, at `9a93951`): P3 FAIL — 2 High equivalent-path bypasses of the new rules (DOM-P34R-01 a plan's siteId PATCH moves it away from its failed blocker; -04 extension terms bound only to the currently linked decision), 4 Medium (-02 sign-off "not applicable" of a failed non-waivable blocker by one specialist, -03 no dimension recompute on GO/withdrawal/execution, -05 N/A aspects survive classify to Included, -06 transfer evidence rejection not reflected in the dimension); P4 PASS WITH CONDITIONS (all DOM-P4 fixes verified; Lows -07/-08/-09 and documented DOM-P4-13/-14 funds-flow/-15). All nine DOM-P34R findings fixed and merged at `4fde3ec` (plan site change as a guarded command; extension terms bound per decision in `tsa_extension_terms`; dimension recompute on every cutover step; transfer evidence reactions; non-blocking CPs Legal-only; reconciliation reviewer excludes every editor): the re-review probes pass plain (13/13); the implementer's full API run 129 files, 1007 passed + 2 expected fail. Security re-check (`docs/reviews/P3-P4-security-recheck.md`, at `4fde3ec`): P3 and P4 PASS WITH CONDITIONS — every SEC-P34 Medium/Low fixed with regression tests; new Medium SEC-P34R-07 (superseding / flagging evidence skips the link permission checks) and SEC-P34R-05 (AI proposals list ignores the reader's visibility; the P4 finance rule is not met in that list until fixed); Lows SEC-P34R-01..-04. All fixed and merged at `2ed5d55` (supersede/flag apply the link permission checks; AI proposals list and detail apply the reader's visibility of the target and of the run inputs; one "self" definition for evidence — linkers and uploaders; 404 before 403 on the new routes); full API suite 132 files, 1042 passed + 2 expected fail. Domain reviewer's re-check of the DOM-P34R fixes (§9 of `docs/reviews/P3-P4-domain-rereview.md`, at `2ed5d55`): seven of nine fully fixed; P3 still FAIL on one new High, DOM-P34R2-01 (extension terms can be bound for the first time to a decision that is already final, e.g. the TSA's own terms decision, with any end date); "blockers prevent go-live" is now met. P4 PASS WITH CONDITIONS confirmed. Fixed and merged: extension terms bind for the first time only while the paper is draft / submitted / under review (`tsa.extension.terms_after_outcome`); every extension needs its own paper (business-gates §6 rules 5–6, Q-P34R2-01 for the governance owner); fixtures refactored to table → request → approve → record; the re-check probes pass as regressions; implementer's full API run 137 files, 1058 passed + 2 expected fail. The reviewer's re-check (§9.10, at `c990f5c`): DOM-P34R2-01 FIXED (verified), P3 PASS WITH CONDITIONS; one Medium on the same path, DOM-P34R3-01 (terms bound after the votes, before the outcome is recorded) — fixed by the lead: a first binding is refused once any vote of the current round exists or voting was closed (`tsa.extension.terms_after_vote`); the probe passes as a regression; full API suite 138 files, 1060 passed + 2 expected fail. Next: CI on this revision, then the P3 gate report.
- **P3/P4 QA review** (`docs/reviews/P3-P4-qa-review.md`, at `5bf274b`): P3 FAIL (AT-09 and AT-10 failed through DOM-P3-01/-06/-09, since fixed), P4 PASS WITH CONDITIONS. Open: QA-P34-01 (Medium, English left on Arabic P3/P4 screens, items a–h), QA-P34-02/03/04/07 (Low; -07 is a debounce race in list row clicks that explains the intermittent `p3-readiness.spec.ts` REQ-SET-004 failure), -05/-06 Info. Fixed and merged (Arabic: server texts carry I18n codes, stored English sentences are matched back to their templates on read; 390 px; debounce race in SearchInput; P3 screens in the axe scan; requirement evidence corrected — REQ-UX-010 Tested, REQ-SET-012 lowered to Implemented with its gap stated). Full Playwright suite on the QA-fix branch: 396 passed.
- **P3:** backends and web screens merged. DOM-P2R-05, DOM-P2F-08 and DOM-P2F-09 fixed (readiness now uses the shared decision-use registry: kinds `tsa_service`, `tsa_extension`, `cutover_plan`). Reviews not run.
- **P4:** gate **PASS WITH CONDITIONS** at `d8ea39d` (`docs/phases/P4-gate-report.json`; CI run 64 green: API 1054 passed + 4 expected fail, Playwright 395 passed + 1 skipped). Conditions: independent re-verification of SEC-P34R-05/-07 and QA-P34-01 c/h / -07 fixes in the next review cycle; owner decisions (DOM-P34R-I1, Q-P34R-08, SEC-P34R-06, SEC-P34-14/15/18); Lows DOM-P4-13, -14 (funds flow), -15.
  - Backends and web screens merged.
  - Domain review FAIL (`docs/reviews/P4-domain-review.md`). All its High findings are fixed: part 1 (DOM-P4-02/03/04/05/09 and Lows) and part 2 (DOM-P4-01/06/07/08 on the decision-use registry). The lowered requirements are Tested again with regression evidence.
  - Security and QA reviews not run.
- **P5:** AI backend and AI PM web screens merged (mock provider labelled Simulated). Security review (`docs/reviews/P5-security-review.md`, at `c990f5c`): **FAIL** — High SEC-P5-01 (an AI message's recipient is checked against the target only, not the content the model saw: injected instructions can deliver confidential text to an uncleared member; AT-17 not met), Medium -02 (autopilot effect after a kill/cancel), -03 (committee actions classified internal for the provider ceiling), -04 (provider adapters follow redirects past the egress guard), Lows -05/-06. The lead's earlier approve() invalidation fix verified; P4 C1 SEC-P34R-05/-07 CONFIRMED. All fixed and merged at `0ab423e` (recipient cleared for the target AND every run input — at creation, approval, revision and execution; execution re-checks under a lock; committee actions inherit their decision's classification; one egress fetch refusing redirects; warnings and drafts re-checked on read; autopilot limit under a lock); REQ-AI-036 and REQ-SEC-018 Tested; implementer's full API run 141 files, 1098 passed + 2 expected fail. P5 QA review (`docs/reviews/P5-qa-review.md`, at `79d1f71`): **FAIL** — High QA-P5-03 (AI retrieval, briefings and detections ignore the PROJECT classification: a member cleared below it sees task titles / owners the screens refuse; AT-19 partly met); Medium -01 (no dedup / cooldown of AI actions across runs), -02 (six briefing subscriber roles cannot open their briefing), -04 (English template titles and raw status values in Arabic AI output), -05 (approver sees ids instead of names); Lows -06/-07 (Arabic remainders). Exit criteria: scheduled briefing after the browser closes MET (worker alone), no duplicate actions MET for retries, prompt-injection resistance MET (Simulated providers only), valid citations/permissions NOT MET. P3 QA re-check: PASS WITH CONDITIONS (P3 gate C2 met). P4 C1 QA items CONFIRMED. Recommended P5 statuses: 25 Tested / 17 Implemented / 3 Planned. Fixes assigned (ai-runtime-engineer). Fixed before the review: `ai-proposals.service.ts` `approve()` wrote the invalidation (payload / target version changed) and its audit row and then threw 409, so the rollback discarded them; they are now written in an autonomous transaction (`invalidateDetached`), with tests in `at-18-ai-approval-binding.spec.ts` that fail without the fix. **P5 QA fixes merged** (ai-runtime-engineer, `c3c7e59`..`d63f171`; Fix status in `docs/reviews/P5-qa-review.md`): QA-P5-03 every AI channel applies the PROJECT classification against the reader's current clearance (404 like the planning routes; worker paths skip with `owner_access_revoked`); -01 dedupe key + per-project `actionCooldownHours` (default 24) under an advisory lock; -02 a user reads their own runs with `ai.run.read`, `ai.assistant.use` or `ai.briefing.subscribe`; -04 Arabic AI output uses Arabic template titles and translated statuses (`detailI18n`); -05 proposal DTO carries the involved people's names; -06 TSA escalation texts translated in the register; -08 GET proposal by id; -09 409 text; -10 `ai_run.policy_version` NOT NULL. QA-P5-07 (Arabic KPI template texts) not fixed — assigned to the P6 configuration package. Earlier assertions that pinned the old behaviour were changed and are listed in the Fix status (to be judged by the re-checks). P5 statuses applied: **31 Tested / 11 Implemented / 3 Planned** (REQ-AI-029 accepted as Tested: the policy-version test now exists). Lead verification after the merge: `pnpm lint` and e2e typecheck pass, `apply_status.py --check` OK, full API suite **144 files, 1134 passed + 2 expected fail** (DOM-P2F-02/04), secret scan tree + history PASS. Next: independent P5 security and QA re-checks of these fixes, then the P5 gate.
- **P6:** reporting, KPI catalogue and exports package delivered on its agent branch (merge pending). Imports/integrations/notifications and configuration/wizard packages next.
- **P7–P8:** not started.

### Verified

- **Gates deadlock fixed:** a gate command and the worker's evaluation refresh could lock the same `gate_assessment` rows in opposite orders ("deadlock detected" → 409, seen once in the full Playwright run). Every gate writer now takes the per-project advisory lock `hub_gates:<projectId>` first (module guide, "One writer of a project's gate state at a time"). Regression `apps/api/test/gates/gate-lock-order.spec.ts` reproduces the 409 without the lock and passes with it.
- **API integration suite:** 101 files, 856 passed + 2 expected fail (DOM-P2F-02/04 probes) at `3735be4`. Domain 424/424, contracts 100/100, `pnpm typecheck` clean.
- **CI:** run 48 at `5bf274b`: every job green except one API test — the P2 QA race probe was written before the DOM-P2F-08 fix (a G1 paper must name the perimeter version) and met it at the merge; the fixture now raises the paper for the version, and the second concurrent G1 decide is asserted as 422 `gate_assessment.invalid_transition` (the gate lock makes it behave as a sequential second attempt). Playwright passed in run 48. Earlier: run 34 fully green at `4fadf91`. Run 38 at `40fac20` was red (shellcheck and an RTL-detector false positive), fixed in `a58218b`.
- **Lint:** root `pnpm lint` passes. Secret scan: tree and history pass.

## Done in this session (highlights)

- **P1 closures:**
  - REQ-SRC-002: template source map check.
  - REQ-ARC-011: module-boundary check in the API lint.
  - Evidence corrections.
  - Must-disposition update (register counts 58/22/2).
  - Secret-scan allow-list hardening: SEC-P1S-01/02/03/07. Every path-scoped entry now names its `targetRules`, and a `.gitleaksignore` file is refused.
- **Finance visibility:**
  - Evidence and history follow the finance-domain clearance and reach.
  - Finance detail counters count only readable evidence (SEC-P1S-04).
- **Policy grants:**
  - `planning.deliverable.accept` for the sponsor and the committee chair.
  - `gates.assessment.submit` for the gate-owner roles, with the own-workstream condition (DOM-P2-16).
- **DOM-P2-17/18:**
  - Guards: an organization-bound FK and same-project triggers.
  - `record_dependency` added to the activity feed.
  - The perimeter-version approval now follows the G1 gate-approval rule.
- **Requirements:**
  - P2/P3/P4 disposition in `docs/phases/P2-P4-requirement-disposition.md`.
  - Data dictionary and ERD regenerated (120 tables).

## In progress (parallel agents, worktree branches)

- P3 domain review; P3+P4 security review; P3+P4 QA review (each also covers the P2 closure re-check C2 where briefed).
- P2 residuals (the 19 P2 musts assigned in the disposition "Update at the P2 gate"): governance/planning and screens/e2e.
- Then: P3 and P4 gates, P5 reviews.

## Known failures, risks and open questions

- **Access-matrix §2.2:** decided (option B). The strict rule applies, with 4 project-level read exceptions
  (`projectLevelRead`) pending Mobily data governance (AMQ-09).
- **For the P3 security review:**
  - A Contributor can run the readiness "checklist from template" command (creator = owner, access-matrix §2.4).
  - The same self-owner claim appears in the readiness, cutover, TSA, RAID, status-update and perimeter create commands.
- **Open P2 gaps** listed in `docs/phases/P2-P4-requirement-disposition.md` §4:
  - DOM-P2-14;
  - GOV-012, GOV-013, GOV-015, GOV-008, GOV-009;
  - WS-003;
  - UX-005, UX-006, UX-018, UX-024;
  - SET-013, SET-014;
  - PLN-002.
  The domain re-review will say which of them block the P2 gate.
- **Low findings carried** in `docs/phases/P1-gate-report.json`: QA-P1-09, QA-P1R-04/05, SEC-P1S-05/06/08.
- **Build-machine capacity:** 4 cores and 15 GB shared by the lead and every agent. On 2026-09-30 the session process was
  restarted after memory ran out, with five agents running full API suites and two e2e stacks at once, and the whole
  container restarted again with four (PostgreSQL then needs `pnpm db:start`). Keep at most TWO agents with test runs in
  parallel; an agent starts a full suite or a Playwright run only with at least 6 GB free, never both at once, and stops
  its e2e stack by PID when done.
- **Environment limits:**
  - The reference image and Excel workbook are not available (image extraction NOT performed).
  - There is no Docker daemon here: images, Compose and Helm are validated only in CI, and Helm install is NOT EXECUTED.
  - pgvector is not installed: retrieval uses PostgreSQL full-text search (ADR-0008).

## Next action

1. Finish the P2 residuals, the P3 domain review, the P3/P4 QA review and the P3/P4 security fixes (agents; at most two
   running tests at once).
2. P3 and P4 gate reports.
3. P5 security and QA reviews (briefs ready), then P6 in three packages (reporting/exports; imports/integrations/
   notifications; configuration/setup wizard), P7 (enterprise readiness), P8 (pilot and handover).

Before every push:
- run the full API suite and `pnpm lint`;
- run the local secret scan (tree and history);
- regenerate the single migration if the schema changed;
- after gate-flow or UI changes, also run the full Playwright suite.
