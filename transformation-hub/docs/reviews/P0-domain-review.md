# P0 independent domain review: requirements, data model, domain rules

| Item | Value |
|---|---|
| Reviewer | carveout-domain-analyst (REVIEW mode, run as a general-purpose subagent in a separate context) |
| Revision | `e2daae7` (`e2daae79e6c936f4894e555362207cc011c01f0d`), branch `claude/mobily-transformation-hub` |
| Working tree | Other contexts were working at the same time (at review start `.gitignore` was modified; at the end there were untracked `apps/web` config files). None of the reviewed files had uncommitted changes. This review only added `docs/reviews/P0-domain-review.md`. |
| Date | 2026-09-29 |
| Scope (not authored by this reviewer) | `docs/requirements/requirements.yaml`, `docs/PRD.md`, `packages/db/src/schema/*.ts`, `docs/architecture/data-dictionary.md`, `packages/domain/src/*.ts` |
| Out of scope | Templates (`packages/db/seed/templates/**`) and governance docs (`docs/governance/**`), which another analyst context authored, plus security/RLS, API and UI |
| Spec | `docs/MASTER_PROMPT.md` §§2–9, §12.2, §20–21 |
| **Verdict** | **FAIL**: 3 High, 14 Medium and 10 Low findings. Critical: none. |

> Context: at `e2daae7`, the only modules in `apps/api/src/modules/` are `identity` and `portfolio`. No governance, gates, carve-out,
> TSA or JV service calls the domain rules yet. `packages/domain` is the designated "domain rule" step of the mandatory
> mutation flow (CLAUDE.md), so this review judges the rule layer and data model as the future enforcement point. Findings
> are rule and model gaps, not API defects.

---

## 1. Commands and real output

```
$ git -C /home/user/My-owns log --oneline -1
e2daae7 P0 docs and P1 foundation: API platform, identity, portfolio, demo seed

$ cd transformation-hub/packages/domain && npx vitest run
 RUN  v4.1.11 /home/user/My-owns/transformation-hub/packages/domain
 Test Files  5 passed (5)
      Tests  75 passed (75)
   Duration  659ms
```

The verbose run showed test files `calendar.test.ts`, `policy/policy.test.ts`, `rules.test.ts`, `schedule.test.ts` and
`governance.test.ts`, all passing.

**Reviewer reproduction.** A scratch script outside the repository imports `packages/domain/src/index` and was run with
`packages/domain/node_modules/.bin/tsx <scratchpad>/repro.ts`. Real output:

```
R1 N/A on non-waivable mandatory criterion -> ready = true
R2 blocking non-mandatory met w/o evidence -> ready = true
R3 waived blocker -> goDecisionBlockers = []
R3 assertGoAllowed: GO permitted
R4 stale + open blocker -> status = stale | aggregate redCritical = []
R5 recommended --record_approval--> approved
R6 missing fields = []
R7 closingBlockers (verified CP, validity lapsed) = []
R8 TSA expired_unresolved --record_extension--> extended
R9 commands from approved = ["reopen"] | any command -> superseded: false
R10 ops dimension = {"key":"operational_readiness","state":"day1_ready","explanation":"All mandatory readiness checks passed."}
R11 day1 position transferable (unassessed) = {"ok":true}
R12 weightedProgress (no approval flag in input) = 100
```

Inputs for each case (abbreviated; the full script is in the reviewer scratchpad and is not committed):

- **R1:** `{mandatory:true, blocking:true, waivable:false, evidenceRequired:true, activeEvidenceCount:0, status:'not_applicable'}`
- **R2:** the same criterion with `mandatory:false, status:'met'`
- **R3:** readiness `{mandatory:true, blocker:true, status:'waived'}`, with runbook, rollback and communications present
- **R4:** `lastUpdatedOn` 59 days old, with `hasOpenBlocker:true`
- **R6:** a paper with `requiredAuthority:null` and no dependencies or requester
- **R7:** a verified blocking CP. No validity input exists.
- **R10:** a mandatory check that passed, plus a check with `blocker:true, mandatory:false` still `in_progress`

---

## 2. What is faithful (confirmed)

- **Independent status dimensions (§3, AT-06).** Four dimensions are modelled: `status_dimension` and `computeStatusDimensions`. Incorporation lives on `legal_entity` and is independent of `perimeter_item.transfer_status`. `isCarveOutComplete` requires incorporation, transfer and operations each to be complete. A NewCo that is incorporated while its transfer is incomplete is representable and is tested.
- **Decisions (§4.2).** The 10 decision states match the spec exactly. `authority_outcome` has the values `within_mandate`, `pending_external_authority` and `not_assessed`, and `external_authority_reference` exists. Approval does not equal implementation: `approved → start_implementation → implementation_pending → verify_implementation`, and this is tested.
- **Committee rules (§4.1–4.2, AT-05).** Quorum excludes recused members when the policy says so. Vote eligibility rejects non-members, advisory members, expired terms, recused members and the requester. Votes are immutable: `REVOKE UPDATE, DELETE` plus a trigger in `packages/db/sql/post-migrate.sql:122,144`. Each vote stores `member_role_at_vote`.
- **Delegated authority (AT-04, AT-29).** `checkAuthority` treats unknown types, reserved types, missing amounts, currency mismatches and over-limit amounts as outside the mandate.
- **TSA (§7.3).** The 9 TSA states match the spec. `assessTsaExpiry` and `assertTsaExitAcceptable` implement "end date ≠ exit", and nothing extends a TSA automatically. The schema carries every §7.3 attribute, plus `is_enduring_arrangement`.
- **Partner access (§8).** An NDA does not grant access: `partnerMayAccessRoom` requires an executed NDA, stage ≥ `materials_access` and an explicit `room_grant`. Outreach approval is a separate stage.
- **Signing and closing (§8).** Signing is separate from closing (`closing.kind`). Multiple closings are supported (`closing.sequence`). Closing is blocked by blocking CPs, the long-stop date and unverified deliverables, and it requires signing. Funds flow is recorded only (`funds_flow_item`), with no payment execution.
- **Gates (§3).** `evaluateGate` has no task-percentage input. Evidence conflicts block (AT-14). `assertWaiverAllowed` rejects non-waivable criteria, unauthorized approvers, self-approval and a missing basis or impact (AT-13).
- **Registers (§7.1–7.2, §8).** Every §7.1 perimeter field is present. `agreement.kind_label` has `kind_expansion` and `kind_expansion_confirmed`, and a comment records that abbreviations are never auto-expanded. The six contract transfer classes are present, with `class_assessed_by`. The regulatory, external and internal approval register has conditions and validity. The cutover plan carries all nine §7.4 elements. Finance covers baseline/forecast/actual with currency, unit scale, period, source and approval. Budget lines have committed and spent amounts. Valuations have an EV/equity basis. CPs carry reference, owner, parties, blocking, waivability and authority, validity, long-stop date and verified state. DD Q&A has release approval and a disclosed version. Findings record valuation, document and CP implications.
- **Measurement (§9).** Rules 2, 4, 6 and 8 are implemented. Rules 1, 3 and 5 are mostly implemented; see M7 and L1. Rule 7 is a reporting concern that the domain layer does not cover, so it was not verified here.
- **Runtime AI (§12.2).** Prohibited actions include `approve_gate`, `create_waiver`, `verify_condition` and `declare_closing`, and they are rejected in every mode.

---

## 3. Findings

| ID | Sev | Location | Description (with reproduction) | Spec / AT / REQ | Recommendation |
|---|---|---|---|---|---|
| D-01 | **High** | `packages/domain/src/gates.ts:62-64`; `packages/db/src/schema/gates.ts:62` (`gate_criterion.applicability` free `varchar`), `:108-130` (`criterion_assessment`) | `evaluateGate` counts `status='not_applicable'` as satisfied for **any** criterion, including mandatory, blocking and non-waivable ones, with no evidence, no applicability determination and no authority check. **R1:** a mandatory, blocking, non-waivable criterion with no evidence gives `ready = true`. Marking N/A is therefore an unaudited waiver that bypasses the non-waivable rule. The doc comment says "marked not applicable by the authorized specialist", but no input carries that attestation. The model also has no field for the N/A basis, who determined it, or approval. | §3 "An exception cannot override a non-waivable condition… Authorized specialists determine…"; AT-13; REQ-LCY-005, REQ-LCY-012 | Add an applicability determination to the criterion model: an enum (`assessment_pending`/`applicable`/`not_applicable`), `determined_by`, `determined_role`, `basis` and `determined_at`, routed through an approval command. In `evaluateGate`, count N/A only when the input carries an approved specialist determination. Treat N/A on a non-waivable mandatory criterion as a blocker unless it was determined at the criterion level. Add unit tests. |
| D-02 | **High** | `packages/domain/src/carveout.ts:61` (dimension counts `waived` as passed), `:169-173` (`goDecisionBlockers` treats `waived` as cleared); `packages/db/src/schema/carveout.ts:295-330` (`readiness_check`); `packages/db/src/schema/gates.ts:141` (`waiver.target_type` covers only `gate_criterion`/`closing_condition`); `packages/domain/src/enums.ts:295` | A mandatory Day-1 **blocker** set to `waived` clears the go/no-go guard and counts as passed in the operational dimension. **R3:** `goDecisionBlockers` returns `[]` and GO is permitted. `readiness_check` has no `waivable` flag, waiver authority or `waiver_id`, and the `waiver` table cannot target readiness checks. So no basis, approval or impact can be recorded for such a waiver. This is inconsistent with `closingBlockers`, which requires `waivable && hasValidWaiver`. | §3 ("Record every waiver's basis, approval, and impact"; non-waivable); §7.4 mandatory blockers; AT-09, AT-13; REQ-RDY-001, REQ-RDY-004, REQ-LCY-013 | Add `waivable`, `waiver_authority_role` and `waiver_id` to `readiness_check` (default non-waivable) and allow `waiver.target_type='readiness_check'`. Pass `waivable` and `hasValidWaiver` into `goDecisionBlockers` and the dimension computation, mirroring `closingBlockers`. Add a unit test showing that a waived non-waivable blocker still blocks GO. |
| D-03 | **High** | `packages/domain/src/workflows.ts:79-84` (`record_approval` from `under_review` and from `recommended`); `packages/domain/src/governance.ts:144-186`; `packages/domain/src/governance.test.ts:110-113` | No domain guard ties a decision outcome to the authority check. `record_approval` is allowed from `under_review` whatever `authority_outcome` is (an out-of-mandate item can skip `recommended`). It is also allowed from `recommended` with no `external_authority_reference` or evidence from the authorized body. **R5:** `recommended → approved` is unguarded. `AuthorityPolicy.isDemoPolicy` is never read, and nothing rejects an approval when no **approved**, non-demo authority matrix exists. The test titled "recommended (beyond mandate) decisions can only be approved via a recorded outcome" in fact asserts the unguarded transition. | §4.1 ("Do not activate production approval authority before the delegation matrix is approved"); §4.2; AT-04; REQ-GOV-010, -011, -022, -023 | Add a pure guard `assertDecisionOutcomeAllowed({ command, authorityOutcome, matrixStatus, matrixIsDemo, projectIsDemo, externalAuthorityReference, tally })`. It should: (a) allow committee approval only when the outcome is `within_mandate`, the matrix is `approved`, and a demo matrix applies only to a demo project; (b) route an out-of-mandate item to `recommended` only; (c) allow `recommended → approved` only with an external authority reference and evidence recorded by an authorized user. Rename or fix the test and add AT-04 negative tests. |
| D-04 | Medium | `packages/domain/src/gates.ts:50-60` | For `met` without evidence and for `waived` with an invalid waiver, the rule raises a blocker only when `mandatory` is true. The default branch uses `mandatory \|\| blocking`. **R2:** a blocking, non-mandatory criterion marked `met` with no evidence gives `ready = true`. | §3 mandatory/blocking flags; REQ-LCY-010, REQ-LCY-011 | Use `c.mandatory \|\| c.blocking` in all three branches and add a test. |
| D-05 | Medium | `packages/db/src/schema/carveout.ts:86-98` (`perimeter_item`), `:119-135` (`transfer_record`); `packages/domain/src/carveout.ts:42-57` | The §3 dimension is "legal/economic transfer". The model has only one `transfer_status` per item, plus free-text `legal_owner` and `economic_beneficiary`. It cannot express "economic transfer effective, legal title pending consent", which is common in carve-outs. REQ-PER-007 promises "Transfer records capture legal and economic transfer per item". | §3; §7.1; REQ-PER-007, REQ-LCY-006; AT-06 | Split the model into `legal_transfer_status` and `economic_transfer_status`, each with its own effective date. Alternatively, add a `transfer_aspect` column (`legal`\|`economic`\|`operational`) on `transfer_record`. Compute the perimeter dimension from both. |
| D-06 | Medium | `packages/domain/src/workflows.ts:205-209`; `packages/domain/src/rules.test.ts:187`; `packages/db/src/schema/carveout.ts:209-252` | TSA `record_extension` has no domain guard. **R8:** `expired_unresolved → extended` succeeds with no approved decision. `tsa_service` has no `extension_decision_id`, continuity-plan field or replacement-failure record. The only link is a single `escalation_id`. The test comment says "extension is an explicit command", but the test asserts the unguarded transition. | §7.3 ("escalation, continuity planning, and an extension decision; never automatically extend"); AT-10; REQ-TSA-004, REQ-TSA-005 | Add `extension_decision_id` (a composite FK to `decision`), `continuity_plan`, and `replacement_status`/`replacement_failed_at`. Add `assertTsaExtensionAllowed({ decisionStatus })`, which requires an `approved` decision. Add a negative test. |
| D-07 | Medium | `packages/domain/src/carveout.ts:234-255`; `packages/domain/src/rules.test.ts:198` | `closingBlockers` ignores CP **validity** (`closing_condition.valid_to`). **R7:** a verified CP whose approval or consent has lapsed does not block. It also accepts `status='verified'` without an evidence count. Gates check evidence, but closing does not. The AT-12 test named "…CP without evidence…" actually tests `status:'open'`. | §8 CP "validity… verified state"; AT-12; REQ-JV-013, REQ-JV-018 | Add `validTo` and `activeEvidenceCount` to the condition input. Block when `validTo < today` or when a verified CP has no active evidence. Rename the test or add the evidence case. |
| D-08 | Medium | `packages/domain/src/governance.ts:189-210` | `missingDecisionPaperFields` accepts `requiredAuthority` in its signature but never checks it. **R6:** it returns `[]` with `requiredAuthority:null`. It also does not check dependencies, requester, evidence or attachments. `impacts` passes with a single key, even though financial, operational and schedule impacts are all required. | §4.2 decision paper fields; REQ-GOV-014 | Check `requiredAuthority`, `dependencies`, `requesterUserId` and each of `impacts.financial/operational/schedule`. Evidence and attachments can be checked through an evidence or attachment count input. Allow "None" or "N/A" only as an explicit value. |
| D-09 | Medium | `packages/domain/src/workflows.ts:170-182`; `packages/db/src/schema/gates.ts:75-106` | The gate reopen semantics contradict each other. The schema comment says reopening creates a new `gate_assessment` row linked by `supersedes_assessment_id`, with the prior row preserved. The state machine instead moves the same record from `approved` to `reopened` to `in_assessment`. **R9:** no command reaches `superseded`. Following the machine overwrites the approved status of the prior cycle. | §3 ("reopen … while preserving previous status and decisions"); AT-14; REQ-LCY-015 | Model reopen as two operations: mark the prior assessment `superseded` (a new command from `approved`, `approved_with_exceptions` or `rejected`), and create a new assessment at `cycle+1` with status `reopened`. Test that the prior row keeps its decision fields. |
| D-10 | Medium | `packages/domain/src/measurement.ts:88-93` | `calculateRag` checks staleness **before** open blockers. **R4:** an item with a known open blocker and a stale update reports `stale` (severity 2) instead of `red`, so `aggregateRag().redCritical` omits it. A known blocker is hidden behind a data-quality label. | §9 rules 3 and 5; REQ-PLN (measurement) | Evaluate `hasOpenBlocker` first, returning red with a "data stale" qualifier, or return both a performance status and a freshness flag. Add a test. |
| D-11 | Medium | `packages/db/src/schema/governance.ts:278-300` (`vote_uq` on `(decision_id, user_id)`; `authority_matrix_version_id` nullable), `:157-208` (`decision.meeting_id` single) | Votes are immutable and unique per decision and user. A decision that is deferred and then resumed (`resume → under_review`) therefore cannot be voted again at a later meeting or circulation round. The nullable `authority_matrix_version_id` allows a vote with no recorded matrix version. | §4.2 (defer and resume; votes keep the matrix in force); AT-05; REQ-GOV-016, REQ-GOV-024 | Add a `voting_round` (or `meeting_id`) column to the unique key: `(decision_id, voting_round, user_id)`. Make `authority_matrix_version_id` NOT NULL for non-demo votes, or always. Record `decision_voting_round` history. |
| D-12 | Medium | `packages/db/src/schema/governance.ts:100-123` | `authority_matrix_version` has no `effective_from`/`effective_to`. Delegation expiry therefore cannot be represented or checked. The model has only a status plus `superseded`. | §4.2 ("when delegation expires"); §4.1; REQ-GOV-010, REQ-GOV-024 | Add effective dates. Resolve the matrix in force by date inside the D-03 guard. |
| D-13 | Medium | `packages/db/src/schema/governance.ts:262-275` | Conflicts of interest can be recorded only as a `recusal`. There is no declaration record ("no conflict" / "interest declared, no recusal") per member and per decision or meeting, so the "conflict check" step cannot be evidenced. | §4.1 conflicts of interest; §4.2 "Quorum/conflict checks"; REQ-GOV-015 | Add a `conflict_declaration` table with `decision_id`/`meeting_id`, `membership_id`, `declared` (none\|interest), `nature`, `recusal_required` and `recorded_by/at`. The pre-vote guard should require a declaration from every voting member present. |
| D-14 | Medium | `packages/domain/src/carveout.ts:175-187` | `assertGoAllowed` checks only runbook, rollback and communications. It ignores the §7.4 transition elements window, service-impact assessment, accountable owner and testing, although the schema has `window_start/end`, `service_impact`, `accountable_user_id` and `testing_summary`/`rehearsal_done`. | §7.4; AT-09; REQ-RDY-003 | Extend the cutover input and missing-list to include all required elements. Add a test. |
| D-15 | Medium | `packages/domain/src/carveout.ts:59-68`; schema has no "approved independence definition" record | The operational-independence dimension: (a) ignores TSAs and approved enduring arrangements, and the "approved definition of independence" has no storage; (b) considers only `mandatory` checks. **R10:** a check with `blocker:true, mandatory:false` still `in_progress` yields `day1_ready`, whereas `goDecisionBlockers` treats it as blocking. | §3 ("Operational independence does not mean eliminating every shared service… effect on the approved definition of independence"); REQ-LCY-014 | Add an `independence_definition` (a versioned, approved record) and TSA and enduring inputs to `DimensionInput`. Report active TSAs and enduring arrangements in the dimension. Treat `blocker \|\| mandatory` consistently. |
| D-16 | Medium | `packages/db/src/schema/finance.ts:30-63` | Intercompany reconciliations, opening balances and working capital exist only as `financial_category` values on a snapshot line. The model has no counterparty, balances on each side, difference, reconciliation status or reviewer, so "unreconciled intercompany difference flagged" (the REQ-FIN-004 AT) cannot be represented. | §7.5 ("track working capital, opening balances, and intercompany reconciliations"); REQ-FIN-004 | Add an `intercompany_reconciliation` table (both entities, both balances with currency and unit scale, difference, status, source and reviewer), or document how snapshot pairs represent a reconciliation. |
| D-17 | Medium | `packages/domain/src/carveout.ts:146-156` | `assertDay1ContractPosition` returns OK for `transferable` or `retain` without knowing whether the class was specialist-assessed. `consent.class_assessed_by` is never an input. **R11.** A class set by a non-specialist would pass the AT-08 check. | §7.2 ("based on specialist assessment"); AT-08; REQ-AGR-006 | Add `classAssessed: boolean`, derived from `class_assessed_by` plus role. Treat an unassessed class as `unknown`, which requires an interim arrangement and accountable owners. |
| D-18 | Low | `packages/domain/src/measurement.ts:8-55` | `weightedProgress` uses whatever weight it receives. `deliverable.weight_approved` is not part of the input, so unapproved weights count (**R12**). | §9 rule 1 | Add `weightApproved` and exclude unapproved weights, with a reason, or flag them. |
| D-19 | Low | `packages/domain/src/enums.ts:135` vs `requirements.yaml` REQ-GOV-012 | REQ-GOV-012 lists screening outcomes "accept, return, merge, reject", but `AGENDA_SCREENING_STATUSES` has no `merged`/`rejected`. | §4.2; REQ-GOV-012 | Align the enum or the requirement. |
| D-20 | Low | `packages/db/src/schema/gates.ts:158-172` | `status_dimension.state` is a free `varchar(48)` with no owner or evidence columns. REQ-LCY-006 says "each with its own state, evidence and owner". | §3; REQ-LCY-006 | Constrain the states per key (a check or an enum per dimension) and add `owner_role`/`owner_user_id`. |
| D-21 | Low | `packages/db/src/schema/carveout.ts:59` (`agreement.executed_document_id`), `jv.ts:311` (`closing_deliverable.document_id`), `governance.ts:61,139` (`charter_document_id`, `pack_snapshot_id`), `finance.ts:45` | Several document and snapshot references have no composite project FK, unlike the rest of the model. They risk dangling or cross-project links. | CLAUDE.md isolation convention; §14 | Add `projectFk` constraints where no import cycle prevents it. |
| D-22 | Low | `packages/db/src/schema/finance.ts:59` | The unique key `(project_id, kind, line_ref, period)` allows only one forecast per line and period. A re-issued forecast overwrites the previous one in place, with history only in `record_version`. | §7.5 versioning; §9 rule 7 | Add a `version_label`/`as_of` column to the key, or document reliance on `record_version`. |
| D-23 | Low | `packages/db/src/schema/jv.ts:180-184` | `diligence_request` stores a single `released_answer`/`released_version` and no `release_approved_at`. A supplementary release overwrites the prior disclosed text. | §8 "release approval, disclosed version"; REQ-JV-010 | Add `release_approved_at`, and keep disclosed versions in a child table (or `record_version` with an explicit rule). |
| D-24 | Low | `packages/db/src/schema/jv.ts:269-270`, `:361` | `closing_condition.closing_id` is nullable, so a CP can belong to neither signing nor closing. Conditions subsequent can live in `closing_condition` (`kind='condition_subsequent'`) or in `post_close_obligation` (`kind='condition_subsequent'`), which is ambiguous for reporting. | §8; REQ-JV-012, REQ-JV-016 | Require `closing_id` for CPs. Choose one home for CS. |
| D-25 | Low | `packages/domain/src/carveout.ts:205-211`, `workflows.ts:195-217` | `assessTsaExpiry` returns `ok` after the end date when `replacementAccepted` is true but the exit is not yet accepted. `approved` has no path to `breached` or `expired_unresolved`. | §7.3 | Return `exit_acceptance_pending` in that case. Review the transitions out of `approved`. |
| D-26 | Low | `docs/requirements/requirements.yaml` REQ-AGR-001 AT; REQ-GOV-020 AT | REQ-AGR-001's AT introduces "SHA/JV", an abbreviation not in the source. REQ-GOV-020's AT says "approval leaves decision in Implementation Pending", but the implemented machine keeps it at `approved` until an explicit `start_implementation`. Neither is a legal determination; both are wording and consistency issues. | §7.2 (abbreviations); §4.2 | Write "Shareholders/JV Agreement" in full. Align the AT wording with the machine, or make `record_approval` land in `implementation_pending`. |
| D-27 | Low | `packages/domain/src/governance.ts:94-96` | With self-approval prohibited, the requester is blocked from **any** vote, including reject and abstain, although the message says "vote to approve". Whether abstention is allowed is a charter choice, not modelled. | §4.1; AT-05 | Make the scope of the self-vote restriction a policy parameter, and align the message. |

**Severity totals:** Critical 0, High 3 (D-01, D-02, D-03), Medium 14 (D-04 to D-17), Low 10 (D-18 to D-27).

---

## 4. Data model fit: gap table (§§3–4, 7–8)

| Area | Table(s) | Status | Missing column or state |
|---|---|---|---|
| Four status dimensions | `status_dimension`, `legal_entity` | Represented | Separate legal and economic transfer (D-05). Dimension owner and state constraint (D-20). Independence definition and TSA inputs (D-15). |
| NewCo incorporated while transfer is incomplete | `legal_entity.incorporation_status` and `incorporation_verification` vs `perimeter_item.transfer_status` | Represented | (optional) incorporation/registration date column |
| Perimeter §7.1 | `perimeter_item` | All listed fields present (`consent_required` boolean plus `consent` rows; evidence via `evidence_link`; version via `version` plus `record_version`) | Legal vs economic status (D-05). The typed `change_request.impacts` keys lack valuation, agreements, budget and schedule (the column is jsonb, so they can be added). |
| Agreements §7.2 | `agreement` | All fields present, and abbreviations are not expanded | FK on `executed_document_id` (D-21) |
| Contract transfer classes | `consent.transfer_class` | 6 classes, with `class_assessed_by` | Domain use of the assessment (D-17) |
| Approval registers | `regulatory_requirement` (`category` regulatory/external_party/internal) | Conditions, validity and applicability present | Per-condition satisfaction is free text (minor) |
| TSA §7.3 | `tsa_service` | All attributes, 9 states | `extension_decision_id`, continuity plan, replacement failure (D-06) |
| Readiness §7.4 | `readiness_check`, `readiness_test_run`, `cutover_plan` | Blockers, sign-off role/by/at, test history, all 9 cutover elements | Waivability/waiver for checks (D-02). Go/no-go history exists only in audit. |
| Finance §7.5 | `financial_snapshot`, `budget_line`, `financial_model_version`, `benefit` | Currency, unit, period, source and approval; one-off, recurring, stranded and TSA categories; committed vs spent; EV/equity basis; base/downside/upside cases | Intercompany reconciliation (D-16). Forecast versions (D-22). |
| Partner, DD and closing §8 | `partner`, `partner_room`, `room_grant`, `deal_scenario`, `negotiation_issue`, `diligence_request`, `diligence_finding`, `closing`, `closing_condition`, `closing_deliverable`, `funds_flow_item`, `post_close_obligation` | 10 stages; NDA separate from access; rooms and grants with revocation; Q&A release; findings with implications; signing and closing kinds; multiple closings; CP fields; funds flow tracking only | CP validity and evidence in the rule (D-07). DD disclosure versions (D-23). CP and CS placement (D-24). Proposals are free text (`proposal_summary`), with no proposal versions. |
| Committee §4 | `committee`, `committee_membership`, `authority_matrix_version`, `meeting`, `agenda_item`, `attendance`, `recusal`, `vote`, `decision`, `action_item`, `escalation` | Memberships with voting flag and term; versioned matrix with hash and demo flag; screening; attendance; recusal; immutable votes with role; all decision-paper fields; 10 states plus authority outcome; verified action closure; escalation with action, deadline and options | Matrix effective dates (D-12). Conflict declarations (D-13). Re-vote rounds and a mandatory matrix version on votes (D-11). Screening `merged`/`rejected` (D-19). Committee hierarchy is a text `escalate_to` only. |
| Gates §3 | `gate_definition`, `gate_criterion`, `gate_assessment`, `criterion_assessment`, `waiver` | Criteria flags (mandatory, blocking, waivable, waiver authority, evidence required, owner/reviewer); assessment cycles; waivers with basis and impact | N/A determination and authority (D-01). Reopen or supersede semantics (D-09). |

`docs/architecture/data-dictionary.md` states that it is generated from the live schema (100 tables) and lists every §14
entity as present. Its structure matches the Drizzle files reviewed. It does not add or claim columns beyond the schema.

---

## 5. Requirements register and PRD

All 131 entries in LCY (15), GOV (27), PER (7), AGR (8), TSA (6), RDY (6), FIN (10), JV (19), WS (7) and SET (16) were
read, together with PRD §§1–4 and §§6–10.

- **Faithful and not distorted.** Every sampled statement restates the spec. The statements checked include: four independent dimensions; signing separate from closing, including multiple closings; task % never unlocks a gate; non-waivable conditions; specialist applicability, waivability and transferability; recommended = pending external authority with the gate kept blocked; TSA end date ≠ exit and no automatic extension; NDA ≠ access; closing blocked by blocking CPs; funds flow without payment; human financial validation; demo labelling; bootstrap without invented content. Some ATs are stricter proposals, for example "TSA without exit milestones cannot be Approved" and "weights sum validated". They are reasonable and labelled as proposed tests.
- **No legal determinations or invented facts found.** A search for authority names, currencies, percentages, licence or "must obtain" language and entity claims found none in requirement statements. CST, ATA and MSA appear only as source terms (REQ-AGR-002 and PRD open question 5 keep them unexpanded). The chair is `Role — To be confirmed` (REQ-GOV-006). Hosting, AI route, sources and matrix are open questions. PRD §1.1 paraphrases the spec's context faithfully.
- **Minor wording issues:** D-19 and D-26.
- **Traceability.** All 394 requirements are `Planned` with empty evidence. That is consistent with P0, but several requirements in these areas (REQ-GOV-010/-014/-023, REQ-TSA-005, REQ-RDY-004, REQ-LCY-015, REQ-JV-013) name behaviour that the current domain rules contradict (D-01 to D-03, D-06 to D-09). Their UT acceptance tests will fail against the current rules unless those rules are corrected.

---

## 6. Verdict

**FAIL.** There are 3 open High findings:

- **D-01:** an N/A status bypasses non-waivable, mandatory gate criteria.
- **D-02:** a waived Day-1 blocker is accepted with no waivability or waiver record.
- **D-03:** there is no domain guard binding decision approval to the approved authority matrix, the authority outcome or external authority.

All three are directly tied to AT-04, AT-09 and AT-13, and each was reproduced above. The data model otherwise fits
the carve-out → NewCo → JV lifecycle well, and the requirement register and PRD are faithful.

Re-review conditions:

1. Fix D-01 to D-03 with negative unit tests in `packages/domain`.
2. Schedule the Medium items to be fixed or explicitly accepted, each with an owner, before P2 (D-03, D-04, D-08, D-09 to D-13) or before P3/P4 (D-05 to D-07, D-14 to D-17).
3. Re-run `npx vitest run` in `packages/domain` and record the output.

## 7. Files changed by this review

- `docs/reviews/P0-domain-review.md` (this file). No other repository file was modified.
- The reproduction script is in the reviewer scratchpad only and is not committed.
