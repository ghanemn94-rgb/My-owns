# P2 independent domain review: governance, planning, business gates, documents

| Item | Value |
|---|---|
| Reviewer | carveout-domain-analyst (REVIEW mode, separate context). This reviewer did not author the code under review. |
| Revision reviewed | `38f947c` on `claude/mobily-transformation-hub` (review start). Re-verified at `4f05318` (branch tip on 2026-09-30), merged into the review worktree as `059bf12`. The P2 changes between the two revisions were reviewed as a delta (see §2). |
| Review branch | `worktree-agent-ad6825862e4d15ed3`. This review added only this report and `apps/api/test/reviews/p2-domain.spec.ts` (defect probes). |
| Date | 2026-09-29 / 2026-09-30 |
| Scope | Modules `governance`, `planning`, `gates`, `documents` (API services, domain rules `packages/domain/src/{governance,gates,workflows,measurement,planning,documents}.ts`, policy matrix), template `packages/db/seed/templates/dc-carveout.v1.json`, P2 demo seeds, tests `apps/api/test/{governance,planning,gates,documents}`, E2E specs `e2e/tests/p2-*.spec.ts` (read only), and the web screens only where they show a rule outcome (plan health, My Work). All 85 `phase: P2` requirements in `docs/requirements/requirements.yaml`. |
| Spec | `docs/MASTER_PROMPT.md` §3 (gates), §4 (committee, decisions), §9 (planning, measurement rules), §2 and §14 (sources, evidence, reassessment), §20 (AT-01, AT-04, AT-05, AT-07, AT-11..AT-16, AT-19, AT-27, AT-30). Platform governance docs: `docs/governance/{authority-matrix,business-gates,committee-charter-draft,decision-workflow}.md`. |
| **Verdict** | **FAIL.** 5 High, 7 Medium and 9 Low findings. No Critical. The P2 domain gate cannot pass with open High findings. |

This review makes no legal, tax, zakat, accounting or regulatory determination. Where a finding touches such a rule
(for example, how abstentions count), the report states the conflict between implementation and the platform's own
documented rule. The owning function has to confirm the rule ("Assessment pending — specialist / governance owner").

---

## 1. Commands and real results

All commands were run from `transformation-hub/` in the review worktree against the reviewer's own database
`hub_test_domrev`. No shared database was touched and no process started by others was stopped.

```
$ HUB_DATABASES=hub_test_domrev bash scripts/dev/pg-init-roles.sh
roles hub_owner/hub_app and databases ready: hub_test_domrev
$ pnpm install --frozen-lockfile --prefer-offline && pnpm build:packages      # OK (domain, contracts, db built)
```

### 1.1 At `38f947c` (review start)

```
$ pnpm --filter @hub/domain test
 Test Files  13 passed (13)
      Tests  233 passed (233)

$ TEST_DATABASE_URL=postgres://hub_app:hub_dev_only@127.0.0.1:5432/hub_test_domrev \
  TEST_DATABASE_MIGRATION_URL=postgres://hub_owner:hub_dev_only@127.0.0.1:5432/hub_test_domrev \
  pnpm --filter @hub/api test
 Test Files  50 passed (50)
      Tests  437 passed (437)
   Duration  349.78s
```

### 1.2 At `4f05318` (merged tip) plus the defect probes

```
$ pnpm --filter @hub/domain test
 Test Files  14 passed (14)
      Tests  238 passed (238)

$ (same env) pnpm --filter @hub/api exec vitest run test/reviews/p2-domain.spec.ts
 Test Files  1 failed (1)
      Tests  12 failed (12)        <- all 12 are DEFECT probes that fail at the defect assertion (reproductions, §4)

$ (same env) pnpm --filter @hub/api test        # full suite including the probe file
 Test Files  2 failed | 56 passed (58)
      Tests  12 failed | 493 passed | 3 skipped (508)
   Duration  244.03s
   -> the 12 failures are exactly the DEFECT probes of test/reviews/p2-domain.spec.ts;
   -> the other failed file, test/p1/p1-closure-empty-db.spec.ts (3 skipped), failed in setup on an environment
      precondition: "Cannot create the throwaway database hub_test_domrev_boot: hub_owner lacks CREATEDB …".

$ HUB_DATABASES="hub_test_domrev hub_test_domrev_boot" bash scripts/dev/pg-init-roles.sh
$ (same env) pnpm --filter @hub/api exec vitest run test/p1/p1-closure-empty-db.spec.ts
 Test Files  1 passed (1)
      Tests  3 passed (3)
```

Net result at `4f05318`: every pre-existing API test passes (493, plus 3 after provisioning the boot database). The only
failures are this review's 12 defect probes.

Each probe first creates a synthetic project and runs the legitimate setup through the real API. All setup steps passed.
Each of the 12 probes failed only on its final assertion, which is the rule the specification requires. The assertion
messages are quoted in §4.

**NOT EXECUTED by this reviewer:** Playwright E2E (`pnpm test:e2e`). It needs a production web build and a running stack.
The existing evidence `docs/test-evidence/e2e-p1-p2-run.txt` was not re-verified. UI requirements below are therefore
rated only where an API or rule outcome decides them.

## 2. Delta `38f947c` → `4f05318` (P2 scope)

`git diff --stat 38f947c 4f05318` over the P2 modules, domain, contracts and tests covers 32 files. I reviewed the
rule-relevant changes:

- **QA-P1-14 gate blocker codes** (`packages/domain/src/gates.ts`, new `messages.ts`). `evaluateGate` and
  `gateDecisionIssue` now build blockers with `blocker(kind, ref, code, params)`. The rendered message comes from
  `GATE_MESSAGES_EN`, and `messageI18n` holds the code and parameters. **The conditions, their order and the returned
  `kind`/`ref` are unchanged.** Every emitted code has an English template, and `blocker()` throws if a template is
  missing. `gate-evaluation-rules.spec.ts` now also asserts `messageI18n`. Domain rules intact.
- `gates.service.ts`: adds `purposeAr` from the pinned template version and `blockerI18n` on decision DTOs. Presentation
  only.
- `change-control.service.ts`: workstream-scoped reads of baselines and change requests, plus change-request
  creation/submission by a workstream-scoped requester for a subject in its own workstream. **The approval paths
  (`approveBaseline`, `crCommand('approve')`) are unchanged**, so DOM-P2-03 still applies.
- Governance, planning and documents services: sort allow-lists (`orderBySort`) and `nameAr`/`titleAr` fields. The demo
  seed for planning is now idempotent. No rule change.

## 3. Requirement and acceptance-test coverage

Legend. **Correct**: the implemented rule matches the spec, and an executed test covers it. **Deviation**: implemented,
but the rule differs from the spec or the platform's governance docs (finding cited). **Missing**: not implemented.
**Not domain-reviewed**: UI or security requirement outside this review's depth; existing tests only.

### 3.1 Acceptance tests mapped to P2

| AT | P2 requirement(s) | Result | Evidence / finding |
|---|---|---|---|
| AT-01 historical statuses | SRC-003/004 (P1), UX-016 | **Deviation** | Historical claims are never applied or auto-updated (`at-01-historical-claims.spec.ts` passes). A reviewer can re-classify `historical_unverified` → `proposed` → `confirmed`, and a change proposal can then be raised: DOM-P2-04. |
| AT-03 isolation | ENT-010, ENT-013, UX-016, UX-021 | Not domain-reviewed | Isolation tests pass (P1 and `at-03-documents-isolation`). Cross-project dependency feature missing: DOM-P2-17. |
| AT-04 outside delegation | GOV-010, -022, -023, UX-007, PHS-004, SET-013 | **Deviation** | Decision level correct: a passing vote outside the mandate becomes `recommended`, and the gate refuses a recommendation (`at-04-*` pass). **Bypasses:** a gate accepts a within-mandate decision of any type, or one without a gate key (DOM-P2-01). Baseline and change-request approvals ignore the authority matrix (DOM-P2-03). |
| AT-05 quorum / recusal / self-approval | GOV-015, -016, -022, SEC-004, SEC-005, PHS-004 | **Deviation** | At vote time: quorum, recused voter and requester rejected and audited (`at-05-*` pass). After votes are cast, a secretariat member can record recusals for voters, which discards their votes and flips the outcome (DOM-P2-06). The tally ignores abstentions, contrary to the documented rule (DOM-P2-02). |
| AT-07 (P2 side) | PLN-013, UX-015 | **Deviation** | A re-baseline needs an approved change request, and the previous baseline is superseded and preserved (`at-16` passes). Change-request approval is not bound to authority (DOM-P2-03). |
| AT-11 (gate side) | template, business-gates.md §3 | Correct | G5 prerequisite is only G1 (template). E2E `p2-gates (a)` asserts it (not executed here). |
| AT-12 (gate side) | LCY-011, PLN-018 | Correct | `at-12-gate-side.spec.ts`, `gate-evaluation-rules.spec.ts` (all tasks done → gate not ready; AI/service cannot decide or waive). |
| AT-13 | LCY-012, LCY-013 | Correct | `at-13-non-waivable.spec.ts`: non-waivable request rejected and audited; wrong authority, self-approval and stale approval refused. |
| AT-14 | LCY-015, DAT-014 | **Deviation** | Conflicting evidence: undecided cycles marked conflicting; decided cycles flagged, escalated and reopened as a new cycle (`at-14-*` pass). Evidence **rejected as defective or superseded** on an approved gate is not flagged (DOM-P2-05). Conflicting source claims are flagged on one side only (DOM-P2-19). |
| AT-15 | PLN-008/009/023/024, UX-008 | Correct | `at-15-delay-impact.spec.ts`, `schedule-rules.spec.ts`. Critical path not re-derived by hand. |
| AT-16 | PLN-004, PLN-013 | Correct | `at-16-baseline-concurrency.spec.ts` (one of two concurrent approvals gets 409; snapshot hash; DB trigger freezes `snapshot`). |
| AT-19 (PLT-008) | PLT-008 | **Missing** | No notification read API or UI (DOM-P2-11). |
| AT-27 | DAT-010 | Correct (not re-reviewed in depth) | `at-27-legal-hold.spec.ts` passes. |
| AT-30 (P2 part) | GOV-018, UX-018 | Deviation | Action → verified closure works (`decision-lifecycle.spec.ts`). My Work misses several approval types (DOM-P2-09). |

### 3.2 P2 requirements (85)

| Requirement | Result | Note |
|---|---|---|
| PLT-008 in-app notifications via outbox | **Missing** | DOM-P2-11 |
| LCY-001 lifecycle separate, gates from template | Correct | gates created from the pinned template version |
| LCY-002 G0 template | Correct | G0 criteria and approver (sponsor) match spec §3 and business-gates.md |
| LCY-005 applicability set by specialists | Deviation (Low) | DOM-P2-15 |
| LCY-010 complete gate structure | Deviation (Low) | DOM-P2-16 (gate owner/reviewer not enforced) |
| LCY-011 task completion never unlocks a gate | Correct | task progress is not an input to `evaluateGate` |
| LCY-012 non-waivable | Correct | AT-13 |
| LCY-013 waiver authority and record | Correct | basis, impact, authority role, not requester, payload hash bound to target version |
| LCY-015 controlled reassessment | **Deviation (High)** | DOM-P2-05 |
| GOV-001, -002, -004, -005, -006, -009 | Correct | committee kinds, charter versions, placeholder seats "Role — To be confirmed", cadence proposal flag |
| GOV-003 committee ≠ NewCo/JV boards | Deviation | kinds are distinct, but a gate reserved to a board is not bound to one (DOM-P2-01) |
| GOV-007 quorum, voting, ties, conflicts | **Deviation (High)** | DOM-P2-02, DOM-P2-13 |
| GOV-008 classification, retention, escalation | Implemented (charter fields) | not verified in depth |
| GOV-010 no production approval before matrix | **Deviation (High)** | votes and outcomes need a usable matrix (correct); baselines and change requests do not (DOM-P2-03) |
| GOV-011 demo matrix only in demo projects | Correct | `approveMatrix` plus `matrixUsable`; see DOM-P2-12 for the self-declared flag |
| GOV-012, -013 agenda screening and numbering | Correct | |
| GOV-014 decision paper completeness | Deviation (Low) | DOM-P2-14 |
| GOV-015 quorum and conflict checks | **Deviation (High)** | DOM-P2-06 |
| GOV-016 voting, circulation, records | **Deviation (High)** | DOM-P2-02, DOM-P2-20 |
| GOV-017 minutes, GOV-018 actions, GOV-019 state machine, GOV-020 approval ≠ implementation, GOV-021 frozen packs, GOV-024 immutable votes, GOV-025 escalations, GOV-027 internal approvals | Correct | executed tests in `apps/api/test/governance` |
| GOV-022 approvals enforce delegated authority | **Deviation (High)** | DOM-P2-01, DOM-P2-03 |
| GOV-023 out-of-mandate → recommendation | Deviation (High) | correct for decisions; gates bypass (DOM-P2-01) |
| ENT-004 portfolio views | Not domain-reviewed | P1 tests |
| ENT-010 cross-project dependencies | **Missing** | DOM-P2-17 |
| ENT-013 no inference of confidential documents | Not domain-reviewed | AT-03 tests pass |
| WS-003 workstream required elements | Correct | data-quality flags (no lead, no owner, no duration) |
| PLN-001, -003, -004, -005, -007, -008, -009, -010, -012, -014, -015, -016, -017, -020, -021, -022, -024 | Correct | executed tests in `apps/api/test/planning` and domain unit tests |
| PLN-002 list/table/Kanban/Gantt | Not domain-reviewed | UI |
| PLN-006 dependencies to approvals/agreements/evidence/decisions/gates | **Missing** | DOM-P2-18 |
| PLN-011 task states and acceptance | Deviation (Medium) | DOM-P2-07 |
| PLN-013 change requests and rebaselining | **Deviation (High)** | DOM-P2-03 |
| PLN-018 green average never hides red | Deviation (Low) | workstream aggregate correct; project override (DOM-P2-10) |
| PLN-019 configurable RAG thresholds | **Missing** | DOM-P2-08 |
| PLN-023 schedule-based forecasts | Correct (planning side) | the AI-schema part belongs to P5 |
| UX-005..UX-009, UX-015, UX-016, UX-021..UX-024 | Not domain-reviewed | E2E not executed by this reviewer |
| UX-018 My Work | Deviation (Medium) | DOM-P2-09 |
| DAT-010 retention and legal hold | Correct (not re-reviewed) | AT-27 |
| DAT-013 domain commands only | Correct | no PATCH changes a status column (tests) |
| DAT-014 reassessment on change | **Deviation (High)** | DOM-P2-05 |
| SEC-004 segregation of duties | Correct at command level | not_self on vote, outcome, review, minutes, closure, baseline, change request, waiver, claim and evidence; see DOM-P2-06 |
| SEC-005 protected quorum | Deviation | client quorum fields ignored (test); quorum changeable after votes (DOM-P2-06, DOM-P2-20) |
| SEC-013, SEC-019 | Not domain-reviewed | security scope |
| PHS-004 P2 exit: authorized decision journey | **Deviation (High)** | the journey works end to end; "block decisions outside authority" fails for gates, baselines and change requests |
| SET-013, SET-014 wizard steps | Not domain-reviewed | `carveout/setup-wizard.spec.ts` passes |

### 3.3 Invented facts in seeds and templates

No invented facts found. `dc-carveout.v1.json` contains no dates, amounts, percentages or person names (pattern
search). All 113 WBS activities are `status: draft` / `verificationStatus: proposed`. Efforts are `Assumed: …` or
`TBD`. All criteria are `applicability: proposed`. Waivable criteria carry `waivabilityBasis: "Proposed — to be confirmed
by <function> specialist"`. Tax, zakat, legal and regulatory items are phrased as "specialist-assessed". In the demo
seeds (`governance.seed.ts`, `planning.seed.ts`, `gates.seed.ts`, `documents.seed.ts`), every value is marked DEMO or
synthetic: amounts in "DEMO-SAR", dates relative to today, persona seats "Demo persona — role to be confirmed", board
chairs "Role to be confirmed", external approval reference "synthetic reference — not a real resolution", and a
"fictional Partner Alpha" (spec §21 allows two fictional partners). CLM-009 ("Completed; On Track") is kept as
`historical_unverified`.

## 4. Findings

Severity: **High** = a mandatory rule named in the spec or P2 exit criterion can be bypassed through the API, or the
implementation contradicts the platform's governance rule. **Medium** = a mandatory requirement is missing or partially
enforced, but a manual workaround exists. **Low** = a gap in precision, documentation or hardening.

### DOM-P2-01 — High — A gate approval accepts any final decision, whatever its decision type, deciding body or gate

- **Location:** `packages/domain/src/gates.ts:190-202` (`gateDecisionIssue` checks only the status, the authority
  outcome and a *non-null* `gateKey`). `apps/api/src/modules/gates/gates.service.ts:195` (`linkDecision`) and `decide`.
- **Spec:** §4.2 "approval interfaces enforcing delegated authority; decisions beyond the committee's mandate becoming
  Recommendation or Pending external authority". AT-04 "route to the authorized body and keep the gate blocked".
  business-gates.md G0 ("the committee cannot approve its own mandate"). authority-matrix.md §4.2:
  `gate_decision_operational` covers G1–G4 and G7 only; G5 and G6 are reserved to the Board. REQ-GOV-003.
- **Problem:** Whether a gate decision is "within mandate" depends only on the decision type the drafter picks. The server
  does not check that it is the decision type the authority matrix assigns to *that* gate. It also does not check which
  body decided. A decision with `gateKey = null` can back any gate.
- **Reproduction (executed):** `p2-domain.spec.ts` DOM-P2-01a. A committee paper `gate_decision_operational` with
  `gateKey: 'G0'` is approved within mandate, and the sponsor then approves G0 → `201 {"status":"approved"}` (expected
  422). DOM-P2-01b: a `baseline_approval` decision with no gate key is approved, and the chair approves G1 with it →
  `201` (expected 422).
- **Recommendation:** Add an explicit gate → decision-type (and deciding body) map to the authority matrix or the
  template, for example `G0: gate_decision_mandate` (reserved) and `G5: jv_signing_authorization`. Require
  `decision.gateKey === gate.key` and a matching `decisionTypeKey` both in `linkDecision` and in `decide`. The demo
  seed currently uses `charter_amendment` as a stand-in for "G0 passage"; replace it with the dedicated type.

### DOM-P2-02 — High — The vote tally ignores abstentions, contrary to the documented rule

- **Location:** `packages/domain/src/governance.ts:127-152` (`tallyVotes`: `cast = approve + reject`; simple majority
  `approve > reject`; two-thirds `approve*3 >= cast*2`; a tie is `approve == reject`).
- **Spec and docs:** §4.1 "quorum, voting, ties … must use approved data". authority-matrix.md §3 steps 5–6: "simple
  majority → approve votes > half of eligible votes; two_thirds → approve ×3 ≥ eligible votes ×2. **Abstentions count
  as not approving.** Tie: approve votes equal non-approve votes". committee-charter-draft.md §11.
- **Reproduction (executed):** DOM-P2-02 (domain). One approve and four abstentions give `outcome: 'approve'`. Two
  approve, one reject and two abstain under `two_thirds` give `approve`. DOM-P2-02 (API): with all five voting members
  present, one approve and four abstentions return
  `{"status":"approved","explanation":"Simple majority (1 to 0). Within delegated authority."}`.
- **Impact:** With the DEMO matrix, a single member's vote can approve a decision within delegated authority (for
  example a budget change up to the limit).
- **Recommendation:** Implement the documented semantics, or make abstention treatment an explicit, approved matrix
  parameter (`abstentionsCountAs: 'not_approving' | 'not_cast'`) with a documented default. Choosing the rule is for
  the governance owner (Assessment pending — governance owner). Clarify the casting vote at the same time: the code
  uses the chair's own vote as the casting vote (DOM-P2-13).

### DOM-P2-03 — High — Baseline and change-request approvals bypass the authority matrix

- **Location:** `apps/api/src/modules/planning/change-control.service.ts:329-332` (`approveBaseline`: `planning.baseline.approve`
  with `requesterUserId` only) and `:586` (change-request approve). `withinAuthority` is never passed, and the
  policy engine treats a missing value as allowed (`packages/domain/src/policy/engine.ts:77-78`). `change_request.decisionId` is
  never required. A change request has no money amount at all (impacts are free text).
- **Spec and docs:** §4.1 "Do not activate production approval authority before the delegation matrix is approved.
  Quorum, thresholds, and spending limits must use approved data". authority-matrix.md §1.3 and §4.4 ("Change request
  for 1,500,000 DEMO-SAR → above the demo limit → recommended, escalated", AT-04). G0-C05 (baseline v1 evidenced by a
  `committee_decision`). The DEMO matrix lists `baseline_approval` and `change_request_budget` as committee decision
  types. P2 exit: "block decisions outside authority".
- **Reproduction (executed):** DOM-P2-03a. In a non-demo project with **no** approved authority matrix, the sponsor
  approves baseline v1 → `201 {"status":"approved"}` (expected 422). DOM-P2-03b. A change request with cost impact
  "1,500,000 DEMO-SAR … above the DEMO committee limit" is approved by the sponsor alone → `201` (expected 422).
- **Recommendation:** Require a linked governance decision of the matching type (`baseline_approval`,
  `change_request_budget`, …) that is final (`approved` within mandate, or externally approved) before
  `approveBaseline` and change-request `approve`. Alternatively, evaluate `checkAuthority` against the usable matrix, add
  a structured `amount` to change requests, and compute `withinAuthority`. Make the policy engine fail closed when an
  `authority` condition is not evaluated.

### DOM-P2-04 — Medium — A historical-unverified claim can be laundered to "confirmed"

- **Location:** `packages/domain/src/documents.ts:345` (`assertClaimReview` blocks only the direct
  `historical_unverified → confirmed` step). `apps/api/src/modules/documents/sources.service.ts:392-396`.
- **Spec:** §2 "Historical statuses … retained as source-reported values only, not treated as approved current
  operational status". AT-01. The domain docstring says historical claims "can never become the confirmed CURRENT value".
- **Reproduction (executed):** DOM-P2-04. The same reviewer moves a `historical_unverified` claim to `proposed`
  (201) and then to `confirmed` with `confirmedValue: 'done'` (201). The row ends `confirmed`, so `propose-change`
  becomes available. No record is changed automatically, so AT-01's "no automatic update" still holds.
- **Recommendation:** Treat historical-unverified as terminal for confirmation. Store the original status and refuse
  `confirmed` for any claim that was ever `historical_unverified`, or allow only `unknown` and `conflicting`. A current
  value must come from a new source.

### DOM-P2-05 — High — Evidence found defective on an approved gate does not trigger a reassessment

- **Location:** `apps/api/src/modules/gates/gates.service.ts:554-600` (`processEvidenceConflicts` reacts only to
  `conflicting` links). `evidence.changed` for `rejected` or `superseded` links reaches the job, but no flag is set.
  `gateRag` returns green for an approved cycle.
- **Spec:** §3 "If approved evidence is found defective, reopen the assessment through a controlled process while
  preserving previous status and decisions". §14 "Evidence … changes must trigger reassessment of affected derived
  records". REQ-DAT-014 ("superseding evidence flags gate for reassessment"). REQ-LCY-015.
- **Reproduction (executed):** DOM-P2-05. G0 is approved; a second person verifies the only G0-C01 evidence link as
  `reject` ("Defective: wrong charter version") → 201; the worker runs. Afterwards G0-C01 has `evidence.active = 0`,
  but `assessment.reassessment.needsReassessment` is `false` and `rag` is `"green"`.
- **Recommendation:** Extend the reassessment job. When a link relied upon by a decided cycle (criterion
  `met`/`evidence_submitted`, evidence required) becomes `rejected`, or is superseded leaving no active evidence, set
  the same flags, escalation and notifications as for conflicts, and flag downstream gates.

### DOM-P2-06 — High — The secretariat can flip a vote outcome by recusing voters after they voted

- **Location:** `apps/api/src/modules/governance/decisions.service.ts:257-262` (recusal on behalf needs only
  `governance.meeting.manage`; it is allowed while `under_review` even after the member voted). `:414` (`recordOutcome`
  drops the votes of members recused later and removes them from quorum).
- **Spec and docs:** §4.2 "Quorum/conflict checks → Discussion/voting". §15 "protect quorum calculations". AT-05.
  committee-charter-draft.md §14 ("Members declare conflicts …; recused … where the chair rules").
- **Reproduction (executed):** DOM-P2-06. All five voting members are present. Votes: chair and sponsor approve;
  finance, legal and approver reject, so the vote is rejected as cast. The secretary (a non-voting seat) records
  recusals for finance and legal → both 201. The secretary records the outcome →
  `{"status":"approved","explanation":"Simple majority (2 to 1). Within delegated authority."}`.
- **Recommendation:** Refuse recusals on behalf of a member who has already voted in the current round, or require
  the member's own declaration or a recorded chair ruling. Any recusal after votes should invalidate the round
  (`voteRound + 1`) instead of silently dropping votes. Record who recused whom in the tally snapshot.

### DOM-P2-07 — Medium — The task approver role is not enforced at acceptance

- **Location:** `apps/api/src/modules/planning/wbs.service.ts:313-316`. Acceptance needs only
  `planning.deliverable.accept` (workstream_lead, functional_approver) and not_self. `task.approverRole` (template:
  sponsor, committee_chair, functional_approver) is stored but never checked. It can also be edited by
  `planning.task.manage`.
- **Spec:** §6 (each activity has an "approver role"). §9 "Completion requires acceptance when the task type demands it".
- **Reproduction (executed):** DOM-P2-07. A task with `approverRole: 'sponsor'` is accepted by a functional approver →
  `201 {"status":"accepted"}` (expected 403).
- **Recommendation:** Require the actor to hold `task.approverRole` (as the gates module does for designated criterion
  reviewers). Change `approverRole` only through change control once the task is baselined.

### DOM-P2-08 — Medium — RAG thresholds are hard-coded

- **Location:** `apps/api/src/modules/planning/health.service.ts:104` (`const thresholds = DEFAULT_RAG_THRESHOLDS`).
  The template `ragPolicy` (for example `staleAfterDays`) is never read, and no API configures thresholds.
- **Spec:** §9 measurement rule 4 "Make RAG thresholds configurable, with proposed defaults and an explanation for each
  status". REQ-PLN-019 (P2, must).
- **Reproduction:** code inspection. No route exists in `packages/contracts/src/planning.ts`.
- **Recommendation:** Store thresholds per project (defaulted from the template), change them through an audited and
  approved command, and snapshot the thresholds used in frozen updates (already included in `frozenSnapshot`).

### DOM-P2-09 — Medium — My Work omits most governance and gate approvals

- **Location:** `packages/contracts/src/planning.ts:832` `MY_WORK_TYPES` (tasks, deliverables, milestones, updates,
  overrides, change requests, baselines, actions, votes only). Missing items include: gate criterion reviews,
  not-applicable determinations, gate decisions, waiver approvals, evidence verification, action-closure verification,
  agenda screening, minutes approval, external-authority recording and claim reviews.
- **Spec:** §10 screen 15 "today's actions, reviews, approvals, comments, and notifications". REQ-UX-018.
- **Reproduction (executed):** DOM-P2-09. A waiver on G3-C08 is requested (201). The waiver authority's
  (committee_chair) `/api/v1/me/work` contains no item at all (`types: ` empty).
- **Recommendation:** Add the missing item types, using the same policy checks as the commands (designated reviewer,
  waiver authority, not_self).

### DOM-P2-10 — Low — A project-level manual override can display Green while blockers are open

- **Location:** `apps/api/src/modules/planning/health.service.ts:217`. The project override replaces the effective RAG
  without the "open blocker is always red" cap that the workstream aggregation applies (`:200`).
- **Spec:** §9 rules 3 and 6. `measurement.ts` `calculateRag` ("an open blocker is always red").
- **Reproduction (executed):** DOM-P2-10. With a blocked task, an approved project override to green gives
  `project.rag.effective = "green"`, while `redCritical` is non-empty. The UI shows the calculated value and the
  red-critical list next to it, which is why this is Low.
- **Recommendation:** Cap the effective status at red while `redCritical` is non-empty, or refuse overrides to green or
  amber while blockers exist.

### DOM-P2-11 — Medium — In-app notifications cannot be read

- **Location:** `packages/contracts/src/notifications.ts:6` (`registerRoutes({})`). The notifications module is an empty
  shell. The gates module inserts `notification` rows directly (not through outbox delivery). No API or UI reads them.
- **Spec:** §12.4 "Internal notifications follow approved policy". REQ-PLT-008 (P2, must). AT-19. The AT-14 reassessment
  relies on notifying the reopen authorities.
- **Recommendation:** Add a scoped notification inbox (list, mark read), outbox-based delivery, and suppression after
  access revocation (AT-19).

### DOM-P2-12 — Low — Matrix and external-authority approvals rest on a free-text reference

- **Location:** `committees.service.ts:326-347` (`approveMatrix`: `approvalReference: string`; `isDemoPolicy` is
  declared by the client). `decisions.service.ts:500` (`recordExternalApproval`: `externalReference` string).
- **Docs:** authority-matrix.md §1.2 ("requires an approval record (evidence type `approved_document` or
  `board_resolution`)"). business-gates.md G5-C09 and G6-C06 (board resolution).
- **Recommendation:** Require a linked evidence document (or evidence link on the decision) for matrix approval and
  external approval, verified by a second person. Keep the separation of duties already implemented.

### DOM-P2-13 — Low — The quorum denominator and casting-vote semantics differ from the documentation

- **Location:** `governance.ts:71-73`. The fraction is computed over *eligible* voting members (appointed, minus
  recused, requester and vacant `Role — To be confirmed` seats). authority-matrix.md §3.4 says "eligible ÷ appointed
  voting members". `governance.ts:142`: the "casting vote" is the chair's own deliberative vote.
- **Recommendation:** Align code and docs after the governance owner decides. State in the charter whether vacant seats
  count, and whether the chair has an additional casting vote.

### DOM-P2-14 — Low — Decision-paper completeness omits evidence and attachments

- **Location:** `governance.ts:202` `missingDecisionPaperFields`. Spec §4.2 lists "evidence, and attachments" among the
  required paper contents.
- **Recommendation:** Require at least one evidence link or attachment, or an explicit "none — reason" entry, at submit.

### DOM-P2-15 — Low — Criterion applicability and waivability determinations are loosely bound

- **Location:** `gates.service.ts:469` `setWaivability`. Any holder of `gates.criterion.set_waivability`
  (functional/finance/legal) can set waivability on *any* criterion, and can do so while the gate is
  `ready_for_decision` or decided. `gate_criterion.applicability` stays `proposed` even after an approved
  not-applicable determination.
- **Spec:** §3 "Authorized specialists determine waivability and waiver authority". REQ-LCY-005.
- **Recommendation:** Bind the determination to the criterion's specialist function (reviewer role or a configured
  specialist role). Refuse it outside `CRITERION_EDITABLE_GATE_STATUSES`. Set `applicability` from the approved
  determination.

### DOM-P2-16 — Low — Gate-level owner and reviewer roles are not enforced

- **Location:** `gates.service.ts` `startAssessment`/`markReady`/`linkDecision` use `gates.assessment.submit` (held
  only by project_manager) for every gate. `gate.ownerRole` and `gate.reviewerRole` appear only in DTOs.
- **Spec:** §3 "Each gate must have … owner, reviewer, approver". REQ-LCY-010.
- **Recommendation:** Let the gate owner role submit, and record a gate-level review before `ready_for_decision`.

### DOM-P2-17 — Medium — Cross-project dependencies are not implemented

- **Location:** `packages/db/src/schema/planning.ts:194` defines `cross_project_dependency`. No service, route or UI
  uses it.
- **Spec:** §5 "Support cross-project dependencies while exposing only the minimum authorized information". REQ-ENT-010.

### DOM-P2-18 — Medium — Dependencies cannot link approvals, agreements, evidence, decisions or gates

- **Location:** `packages/domain/src/enums.ts:84` `SCHEDULE_NODE_TYPES = ['task', 'milestone']`. RAID dependency
  `dependsOn` is free text.
- **Spec:** §9 "Dependency graph … linking approvals, agreements, evidence, decisions, and gates". REQ-PLN-006
  ("task blocked by pending agreement dependency").

### DOM-P2-19 — Low — Conflicting source claims are flagged on one side only

- **Location:** `sources.service.ts:392-411`. Reviewing a claim as `conflicting` with `conflictWithClaimId` updates only
  that claim; the counterpart keeps its status (for example `confirmed`). Evidence links are handled correctly
  (both flagged).
- **Spec:** §2 "any conflict with a newer source". REQ-SRC-007 AT ("marks both Conflicting and preserves originals").
  AT-14.

### DOM-P2-20 — Low — Attendance can change after votes are cast

- **Location:** `meetings.service.ts:238-260` (attendance is upserted during `in_session`). `recordOutcome` computes
  quorum from the attendance at outcome time, and counts votes of members later marked absent.
- **Recommendation:** Freeze attendance per decision when voting opens, or append attendance changes and evaluate quorum
  at vote time.

### DOM-P2-21 — Low — The verification status of evidence is not used

- **Location:** `gates.evaluation.ts:188-196` and `planning-support.ts:160` `assertEvidence` count `status = 'active'`
  links, verified or not. The designated criterion reviewer or the acceptor acts as the checker, which is defensible,
  but the documents module's separate "evidence verification" (not_self) never affects any outcome.
- **Recommendation:** Document the rule in business-gates.md §4. Alternatively, require verified evidence for criteria
  whose `evidenceType` is `approved_document`, `board_resolution` or `regulatory_record`.

## 5. Things verified as correct (non-exhaustive, with executed tests)

- **Decision lifecycle:** explicit commands; the requester never votes or records the outcome; quorum is computed on
  the server (client flags ignored); the outcome needs a usable, approved matrix (demo matrix refused for non-demo
  projects); a passing vote outside the mandate becomes `recommended` with a system escalation. External approval needs
  a reference and a different recorder. Approval ≠ implementation: implementation needs owned and dated actions;
  verification needs all actions verified closed, an evidence note, and a verifier who owns none of them.
- **Votes, recusals and conflict declarations** are append-only (DB triggers). Ending a membership cannot rewrite
  history. A changed matrix invalidates the round.
- **Gates:** task progress is not an input; the server re-evaluates at decision time; a recommended or unfinished
  decision keeps the gate blocked; a decision cannot be reused across cycles; approved waivers force
  `approve_with_exceptions`. Reopen creates a new cycle and preserves the decided cycle. Only the designated reviewer
  may accept a criterion, never the evidence submitter. Not-applicable needs a basis and approval by the reviewer role.
  AI and service identities can never decide, review or waive.
- **Waivers:** non-waivable requests are rejected and audited in a detached transaction; the approval is bound to the
  payload hash and target version; expiry is honoured in evaluation.
- **Planning:** the baseline snapshot is immutable (DB trigger); a single pending proposal is allowed; a re-baseline
  needs an approved change request with `rebaseline = true`; concurrent approvals give 409. Weighted progress uses only
  approved weights, excludes cancelled items with a reason, and counts only accepted deliverables. Stale, unknown and
  not-updated are never green. An open blocker is red in the workstream aggregate. Overrides need reason, expiry
  (≤ 90 days) and a different reviewer, and the calculated value is retained. Accepted updates are frozen.
- **Documents:** claims can never be created as `confirmed`; historical claims are refused for `propose-change`, and
  the refusal is audited; "apply" only creates a pending proposal; the previous source is preserved and can be
  superseded only once. Conflicting evidence flags both links.

## 6. Verdict

**FAIL** for the P2 domain gate. There are 5 open High findings: DOM-P2-01, -02, -03, -05 and -06. Each is reproduced by
an executed test in `apps/api/test/reviews/p2-domain.spec.ts` that fails at the reviewed revision. Medium findings
DOM-P2-04, -07, -08, -09, -11, -17 and -18 are required work for P2 requirements (PLN-006, PLN-019, ENT-010, PLT-008,
UX-018). They may be scheduled with owners but must not disappear from scope. The P2 decision journey itself
(decision request → authorized approval → action → verified closure) works and is covered by passing tests. The
failure concerns the second P2 exit criterion, "block decisions outside authority", which is not enforced for gates,
baselines and change requests. The committee-outcome integrity rules (abstentions, recusals after voting) also fail.

**Next action for the implementer:** fix DOM-P2-01, -02 (after the governance owner confirms the abstention rule),
-03, -05 and -06. Re-run `apps/api/test/reviews/p2-domain.spec.ts`: the corresponding probes must pass without being
weakened. Then request a re-review.

## Fix status (implementation, 2026-09-30) — governance / authority findings

Appended by the implementing `backend-data-engineer` (not the reviewer); the reviewer's text above is unchanged. Scope of
this section: **DOM-P2-02, -03, -06, -12, -13, -20** only. DOM-P2-01, -04, -05, -07, -09, -10, -15, -16, -19 and -21 are
fixed by a separate implementation branch; DOM-P2-08, -11, -14, -17 and -18 are not addressed here.
Branch `worktree-agent-a479a6526cb335355` (from `claude/mobily-transformation-hub` @ `4f05318` + the review branch @
`640dc99`, merged with `claude/mobily-transformation-hub` @ `7751b98` — the P1 security fixes, whose policy conditions
now fail closed, I-R3). Commits: `d1e362b` (WIP), `c625c27` (merge of `7751b98`, migration regenerated), `9d4bb32` (WIP), `8f0142a`, `9505c89`
(fixes + this section), `eba2572` (merge of `411ee52`), and the commit that records the post-merge results below.

The probes of these findings keep their assertions and were renamed from `DEFECT DOM-P2-nn …` to `DOM-P2-nn …`
(`apps/api/test/reviews/p2-domain.spec.ts`: DOM-P2-02 (domain), DOM-P2-02 (API), DOM-P2-03a, DOM-P2-03b, DOM-P2-06).
New regression tests: `apps/api/test/governance/p2-governance-authority.spec.ts` (18 tests) and
`packages/domain/src/governance.authority.test.ts` (20 tests).

Verification (own databases `hub_test_govfix` / `hub_test_govfix_boot`, at commit `8f0142a`, i.e. the code of this
branch; this section is documentation only):

```
$ pnpm build:packages                                   # OK
$ (cd packages/domain && npx vitest run)      → Test Files 15 passed (15), Tests 268 passed (268)
$ (cd packages/contracts && npx vitest run)   → Test Files 2 passed (2),   Tests 69 passed (69)
$ TEST_DATABASE_URL=…/hub_test_govfix TEST_DATABASE_MIGRATION_URL=…/hub_test_govfix pnpm --filter @hub/api test
   Test Files  1 failed | 60 passed (61)
        Tests  7 failed | 550 passed (557)      Duration 337.80s
   → the 7 failures are the probes owned by the other implementation branch, each failing at its defect assertion:
     DEFECT DOM-P2-01a, -01b, -04, -05, -07, -09, -10 (the five probes of this section pass).
$ pnpm lint                                              # exit 0 (packages, api, web incl. i18n + hard-coded string checks, e2e)
$ python3 scripts/requirements/apply_status.py --check   # status-evidence.yaml OK (102 entries)
```
Count check: 527 tests at `7751b98` (P1 security fixes) + 12 review probes + 18 new API tests = 557.

Re-verified after merging `claude/mobily-transformation-hub` @ `411ee52` (P4 finance / JV) in `eba2572` (migration
regenerated; the finance test kit now records external approvals with verified evidence, DOM-P2-12):

```
$ pnpm --filter @hub/api test          → Test Files 1 failed | 73 passed (74), Tests 7 failed | 653 passed (660), 433.84s
                                          (the same 7 probes of the other branch; nothing else fails)
$ (cd packages/domain && npx vitest run)    → Test Files 17 passed (17), Tests 329 passed (329)
$ (cd packages/contracts && npx vitest run) → Test Files 2 passed (2),   Tests 98 passed (98)
$ pnpm lint                                  # exit 0
$ python3 scripts/requirements/apply_status.py --check   # OK (102 entries)
```

### DOM-P2-02 (High) — Fixed (documented rule implemented; confirmation pending)
- `tallyVotes` (`packages/domain/src/governance.ts`) implements `authority-matrix.md` §3 steps 5–6 as written: eligible
  votes = approve + reject + abstain votes of eligible members; simple majority = approve × 2 > eligible votes;
  two-thirds = approve × 3 ≥ eligible votes × 2; tie = approve equal to reject + abstain; abstentions only → no outcome
  (`insufficient_votes`, unchanged). The explanation states the counts and "abstentions count as not approving"; the tally
  snapshot carries `eligibleVotes`.
- Recorded in `docs/assumptions-and-open-questions.md` as A-40 / Q-40 (awaits confirmation by Mobily's governance owner;
  alternatives: abstentions not counted, or denominator = eligible members present, possibly as a matrix parameter).
- Tests: probes DOM-P2-02 (domain, API); `DOM-P2-02 — …` unit tests (simple majority, two-thirds, tie, abstentions only);
  API: 3 approve + 2 abstain → approved, 2 approve + 1 reject + 2 abstain → rejected, tie with an abstention → escalated.

### DOM-P2-03 (High) — Fixed
- Baseline approval and change-request approval evaluate the project's **approved, in-force authority matrix** (the most
  recently approved matrix of an active `program_steering` committee; the labelled DEMO policy only in a demo project that
  has no approved matrix) — `ChangeControlService.governingMatrix`, pure rule `evaluateDelegatedApproval`:
  decision type `baseline_approval` (amount = approved budget total of the snapshot) / `change_request_budget` (amount = the
  new structured `costImpact` money of the change request: `cost_impact_amount/currency/unit_scale`, check constraint).
- The result is passed **explicitly** as `withinAuthority` to `policy.assert` (the hard-coded `true` of the security merge
  is replaced for both approvals). Order: role → state/`expectedVersion` → separation of duties (403, before any amount) →
  delegated authority (422, audited by the problem filter) → policy assertion with the evaluated value.
- Refusal codes: `change_control.no_usable_matrix` (non-demo project without an approved, verified matrix),
  `change_control.outside_delegated_authority` (reserved / unknown type, above the limit, other currency — `details`
  carry `decisionTypeKey`, `escalateTo`, matrix source/version), `change_control.amount_unquantified` (cost stated in
  text only; recorded as `costImpact` through create / edit / assess).
- Out-of-authority changes are routed to the committee through the existing decision flow and approved on it: the approve
  commands accept `decisionId`; the decision must be final (approved within the mandate, or externally approved and
  recorded), of the matching type, cover the amount in the same currency, belong to the project (404 otherwise) and back
  one approval only (`change_control.decision_not_final | decision_type_mismatch | decision_amount_missing |
  decision_amount_currency | decision_amount_insufficient | decision_already_used`). `baseline_version.decision_id` (new)
  and `change_request.decision_id` store it; the audit event carries `after.authority` (basis, type, matrix source and
  version, decision) and the outbox events carry `decisionId`.
- Rejections stay role-level (`withinAuthority: true`, commented): the matrix limits approvals, not the decision to keep
  the approved plan (A-45).
- Docs: `authority-matrix.md` §1.3 and new §3.1, §4.4 scenarios; `decision-workflow.md` invariant A; assumptions A-43,
  A-44, A-45, Q-43.
- Tests: probes DOM-P2-03a (422 `no_usable_matrix`) and DOM-P2-03b (422 `amount_unquantified`); API: within limit →
  approved with audited basis; 1,500,000 SAR → 422 with the escalation body; USD → 422; requester → 403 first;
  recommendation → `decision_not_final`; after the external approval (verified evidence) → approved on the decision; reuse,
  type mismatch, insufficient amount, foreign decision (404); non-demo project: refused without matrix and while the matrix
  approval awaits verification, approved (basis `delegated_authority`, matrix version audited) once verified.
- Existing tests updated because they encoded the old behaviour shown wrong by this finding: `planning/at-16-baseline-concurrency.spec.ts`
  and `planning/measurement.spec.ts` approved baselines in NON-demo projects without any matrix → they now set up an
  approved, verified non-demo matrix (`gov-fixtures.ts` `approvedNonDemoMatrix`); at-16's change request now records its
  cost impact as money (`costImpact` 0 next to the text "None (test)"). `carveout/carveout-kit.ts`
  `approveChangeRequest` records a synthetic `costImpact` 0 before approving (perimeter change requests state their budget
  effect in text). Demo seed: `carveout.seed.ts` records a synthetic zero `costImpact` (labelled "synthetic assessment, not
  a Finance assessment") before the demo approvals.

### DOM-P2-06 (High) — Fixed
- `GovernanceSupport.insertRecusal` (both entry points: `POST …/decisions/:id/recusals` and a `recused` meeting
  declaration) refuses a recusal for a member who already voted in the current round — own or on behalf —
  (`422 governance.recusal.after_vote`, audited); the conflict is handled by a new round (defer → resume). On behalf of a
  member it requires a reason (`governance.recusal.reason_required`); the member must hold a seat on the committee; the
  decision must be open. The recorder is stored, audited (`after.recordedBy`, `onBehalf`, `round`), returned in the
  decision detail (`recusals[].recordedBy/onBehalf`) and in the tally snapshot (`recusals`).
- Tally integrity (`assertTallyIntegrity`): cast votes are never dropped any more — a current-round vote of a recused
  member or of the requester refuses the outcome (`422 governance.outcome.vote_integrity`); `disregardedVotes` is always 0.
- Docs: `authority-matrix.md` §3 step 10, `committee-charter-draft.md` §14.5–14.6, `decision-workflow.md` (R, round
  integrity); A-48.
- Tests: probe DOM-P2-06 (recusals → 422, outcome rejected as cast); API: secretary on behalf / member own / meeting
  declaration after the vote → 422, audited, no row; defer → resume → recusal before voting → counted correctly with the
  recorder in the snapshot; on-behalf declaration without reason → 422; owner-inserted recusal of a voter → outcome 422.

### DOM-P2-12 (Low) — Fixed
- Matrix approval: a non-demo matrix needs `approvalDocumentId` (document of the documents module, visible to the approver,
  not disposed, with a version — bound as `approval_document_version_id`); without it `422
  governance.authority_matrix.evidence_required`. The approval is **pending verification** (version stays `draft`, previous
  version stays in force). New command `POST …/authority-matrix-versions/:id/verify-approval` (`documents.evidence.verify`):
  the verifier is not the drafter, the approver or the uploader of the bound version (403), must be able to read the
  document; accept → `approved` (supersedes the previous version), reject → reason required, approval cleared. The DEMO
  policy (demo projects only) takes effect on approval as before (synthetic, nothing to evidence).
- External authority decisions: `record-external-approval` requires `evidenceLinkId` — an active evidence link on the
  decision itself (documents module), verified by a second person (`reviewedBy`), and the recorder is not that verifier
  (403). Codes: `governance.external.evidence_required | evidence_other_target | evidence_not_active | evidence_unverified`.
  `decision.external_evidence_link_id` stores it.
- Docs: `authority-matrix.md` §1.2, `decision-workflow.md` row 9; A-47, Q-44.
- Tests: API (non-demo matrix: no document → 422; pending → not in force; approver / drafter → 403; reject without and with
  reason; accept → in force) and external approval (no / unverified / other-target evidence → 422, verifier as recorder →
  403, verified → recorded with the link). Existing tests updated because they recorded external approvals or approved a
  non-demo matrix on a free-text reference only: `governance/at-04-decision-outside-delegation.spec.ts` (last test),
  `gates/at-04-gate-blocked-by-recommendation.spec.ts`, `gates/gate-test-kit.ts` (`gateDecision` with `externalApproval`),
  `governance/governance-integrity.spec.ts` (non-demo matrix test). Demo seed: the G0 external approval rests on a note
  evidence link (PM) verified by Legal.

### DOM-P2-13 (Low) — Fixed (code aligned; docs clarified)
- Quorum: the `minFractionPresent` fraction is now taken over the **appointed** voting members (voting seats held by a
  named person on the date), as `authority-matrix.md` §3 step 4 says, instead of over the members left after recusals;
  `QuorumResult.appointedVoting`; the explanation names the basis. The docs were internally inconsistent on this point:
  assumption A-06 ("excluded from the quorum denominator") contradicted §3 step 4 — A-06 was corrected and cited.
- Casting vote: the documents did not define the mechanism; they now state one rule (`authority-matrix.md` §3 step 6,
  `committee-charter-draft.md` §12): the side the chair voted for prevails, no second vote, only if the chair cast an
  eligible approve/reject vote (A-41 / Q-41). Vacant seats are not counted (A-42 / Q-42).
- Tests: unit (8 appointed / 3 recused → 4 required; vacant seats; casting vote cases); API: 8-seat committee with 3
  recusals — 3 eligible present refused with the appointed-members explanation, a 4th eligible member present → vote accepted.

### DOM-P2-20 (Low) — Fixed
- `recordAttendance` refuses any change while a decision tabled at the meeting has votes in its current round and no
  outcome (`422 governance.attendance.frozen_voting_open`, lists the decisions); correct by recording the outcome or
  restarting the round. Defense in depth: in a meeting, an outcome whose round contains a vote of a member no longer
  recorded present is refused (`governance.outcome.vote_integrity`).
- Docs: `authority-matrix.md` §3 step 10, `committee-charter-draft.md` §16, `decision-workflow.md`; A-46.
- Tests: API (after the first vote → 422 audited and attendance unchanged; after the outcome → allowed; owner-pool absent
  voter → outcome 422).

### Needed outside this branch (reported, not changed here)
- **Web** (`apps/web`, not in this branch's scope): the decision page's external-approval dialog must send `evidenceLinkId`
  (pick a verified evidence link of the decision) — without it the command now returns 422; the authority-matrix approval
  needs an approval-document picker and a "verify approval" action; the change-request assess dialog needs a money field
  for `costImpact`; the approve dialogs of baselines / change requests an optional decision picker; show `pendingVerification`,
  recusal `recordedBy/onBehalf`, `costImpact`, `decisionId`.
- **Policy matrix / access-matrix.md** (lead-owned, unchanged): the matrix-approval verification uses
  `documents.evidence.verify`; a dedicated permission (e.g. `governance.authority_matrix.verify_approval` for Legal /
  Corporate Secretary) is suggested (Q-44).
- `apps/web` / e2e not run here: **NOT EXECUTED** (Playwright).

---

## Fix status (implementation, 2026-09-30) — gates, documents and planning findings

| Item | Value |
|---|---|
| Implementer | backend-data-engineer (implementation mode, separate context; not the author of this review) |
| Branch | `worktree-agent-a3eb13e67ee309a34`, started from `claude/mobily-transformation-hub` `4f05318` + this review (`640dc99`), with the lead branch merged in before the final runs (P1 security re-review fixes `7751b98`, then P4 finance / JV up to `b6e8d45`; migration conflicts resolved by regenerating the single migration) |
| Findings in scope | DOM-P2-01, -04, -05, -07, -09, -10, -15, -16, -19, -21; feature gaps DOM-P2-17, -18 |
| Not in scope | DOM-P2-02, -03, -06, -12, -13, -20 (governance / authority agent, working in parallel) |
| Re-phased, not done here | DOM-P2-08 → P6 configuration module (per-project RAG thresholds, approved change, snapshot in frozen updates); DOM-P2-11 → P6 notifications (scoped inbox API/UI, outbox delivery, suppression after revocation, AT-19) |

The reviewer's text above is unchanged. No probe was weakened. The seven probes of this finding set now pass and were
renamed `DEFECT DOM-P2-nn …` → `DOM-P2-nn …` (DOM-P2-01a, -01b, -04, -05, -07, -09, -10). The five remaining
`DEFECT` probes (DOM-P2-02 domain, DOM-P2-02 API, DOM-P2-03a, DOM-P2-03b, DOM-P2-06) belong to the governance agent and
still fail at this revision, as expected.

### Per finding

| Finding | Status | What changed | Evidence (executed) |
|---|---|---|---|
| **DOM-P2-01** (High) | **Fixed** | A gate approval is backed only by a decision that (a) was raised for this gate (a decision without a gate key backs no gate), (b) is final, (c) is of a decision type that the **deciding committee's approved authority matrix assigns to this gate** — new optional `gateKeys` on matrix decision-type rows; the matrix is the version recorded with the committee outcome (tally snapshot), otherwise the committee's approved version; a type without `gateKeys`, an unknown type or a committee without an approved matrix fail closed — and (d) was decided by the body holding the authority (a reserved type counts only through the recorded external approval). `link-decision` refuses a decision that can never back the gate (`gates.decision.not_for_gate`); `decide` refuses with `gates.decide.decision_not_for_gate` / `gates.decide.decision_not_final`. Six new blocker codes (`gate.blocker.decision_no_gate`, `…_no_matrix`, `…_type_missing`, `…_type_unknown`, `…_type_not_for_gate`, `…_body_not_authorized`) with `messageI18n`, en + ar web translations. The decision snapshot records `decisionTypeKey`, `gateKey`, `committeeId`, `matrixVersionId`. DEMO matrix: G1–G4/G7 → `gate_decision_operational`, G5 → `jv_signing_authorization`, G6 → `jv_closing_confirmation`, and a new reserved `gate_decision_mandate` → G0 ("the committee cannot approve its own mandate"); the demo seed's G0 decision now uses it instead of `charter_amendment`. authority-matrix.md §2.2, §3 step 10, §4.2, §4.3 (machine-readable policy regenerated from `demo-policy.ts`); business-gates.md §4 rule 1. | probes DOM-P2-01a/b; `apps/api/test/gates/p2-gate-authority-reassessment.spec.ts` (link refused for no-gate / wrong-type decisions, committee without matrix refused, G0 passes on the reserved type after the external approval with the snapshot recorded); `packages/domain/src/gates.test.ts` "DOM-P2-01 …" (5), `messages.test.ts` (every new code exercised) |
| **DOM-P2-05** (High) | **Fixed** | The decision snapshot records, per criterion, the evidence links relied upon (`activeEvidenceLinkIds`). The evidence job (`evidence.changed` → `gates.evidence_conflicts`) now flags an **approved** cycle (never modified) when relied-upon evidence became conflicting, was **rejected as defective** or was **superseded** (`decidedCriterionReassessment`; cycles decided before this change fall back to "required evidence with no active link left"): reassessment flags with the reason (`ReassessmentFlagDto.criteria[].reason`), one escalation, notifications to the reopen authorities, `gate.blocked` (`evidence_change_on_decided_gate` + reasons), downstream approved gates flagged for review, audit `gates.assessment.flag_reassessment`, and a status-dimension recompute: a flagged G4 approval no longer counts as standalone acceptance (`dimension.readiness.standalone_reassessment`, en + ar). On an **undecided** cycle, a criterion accepted as met whose accepted evidence is later rejected as defective returns to `unmet` (audit `gates.criterion.evidence_defective`; a ready gate is reported blocked). The gate RAG is red while flagged (unchanged rule). business-gates.md §4 rule 6. | probe DOM-P2-05; spec "superseding evidence relied upon by the approved G0 flags the gate (REQ-DAT-014) …" and "… returns to unmet …"; domain "DOM-P2-05 …" (4) and `messages.test.ts` (flagged G4 dimension) |
| **DOM-P2-04** (Medium) | **Fixed** | `source_claim.origin_status` (status the claim entered with, immutable) and `source_claim.verification_source_id` (composite FK to `source_record`). A claim of historical origin — whatever its current status — is confirmed only with `verificationSourceId`: a **different** source of the project that the verifier can read (404 otherwise; the claim's own source → 422 `claims.verification_source_same`), by a verifier who is neither the extractor (`claims.verifier_is_extractor`) nor the reviewer of the previous step (`claims.verifier_is_previous_reviewer`, 403). Without it: 422 `claims.historical_cannot_be_confirmed`, for the direct step and for every hop (proposed, assumed, unknown, conflicting). `propose-change` accepts a confirmed claim of historical origin only with its verifying source; nothing is ever applied automatically (AT-01). Claim DTO exposes `originStatus`, `verificationSourceId`. | probe DOM-P2-04; `apps/api/test/documents/at-01-claim-verification.spec.ts` (4); domain `documents.test.ts` "AT-01 invariant (DOM-P2-04) …" (3) |
| **DOM-P2-07** (Medium) | **Fixed** (policy gap reported) | Accepting or returning a task needs the task's designated `approverRole` (project roles + roles on the task's workstream) on top of `planning.deliverable.accept` and not_self (`planning.acceptance.not_approver_role`, 403, audited as denied); a deliverable produced by a task carries that task's approver role; `approverRole` cannot change while the task awaits acceptance (`task.approver_role_locked`); My Work offers task / deliverable acceptance only to that role. **Policy gap:** `planning.deliverable.accept` is held only by `workstream_lead` and `functional_approver`, but the DC template designates `sponsor` (5 activities) and `committee_chair` (39 activities) as approver roles; those tasks cannot be accepted by anyone until the policy grants `planning.deliverable.accept` to `sponsor` and `committee_chair` (policy JSON not edited here — lead decision). | probe DOM-P2-07; `apps/api/test/planning/approver-role-and-my-work.spec.ts` (3); domain `planning.test.ts` "DOM-P2-07 …" |
| **DOM-P2-09** (Medium) | **Fixed** | My Work adds `gate_decision` (the gate's approver role, not the submitter), `gate_criterion_review` (designated reviewer; evidence submitted or a pending not-applicable proposal; never the evidence owner / proposer), `waiver_approval` (current waiver authority role of the target, not the requester, target visible), `evidence_verification` (active unverified or conflicting links; not the linker nor the version uploader; document and target visible via `RecordVisibility`), `action_closure_verification` (not the reporter) and `minutes_approval` (not the drafter). Every item uses the same policy inputs as its command (fail-closed requester / authority). Web inbox: status enums and en + ar labels for the six types. | probe DOM-P2-09; gates spec "DOM-P2-09 …" (2); planning spec "DOM-P2-09 …" (3) |
| **DOM-P2-10** (Low) | **Fixed** | A project-level override is **capped at red** while a red critical item (open blocker, missed / overdue critical milestone) exists (`capOverrideAtOpenBlockers`): the approved override stays on record and applies again once the blockers are cleared (until it expires); the explanation says why it is not applied. Creating and approving the override are unchanged (the probe requires them to succeed). Workstream-level overrides are unchanged: the project aggregate already lists a blocked workstream as red critical ("does not hide the blocker"). | probe DOM-P2-10; domain `rules.test.ts` "DOM-P2-10 …" |
| **DOM-P2-15** (Low) | **Fixed** | Waivability is determined only by the criterion's **designated specialist** — its reviewer role when that role holds `gates.criterion.set_waivability`, otherwise `functional_approver` (403 `gates.waivability.not_designated_specialist`) — and only while the cycle is `not_started` / `in_assessment` / `reopened` (422 `gates.assessment.not_editable`); the record version names the determining role. `gate_criterion.applicability` is now set from the recorded determination: `not_applicable` when a not-applicable proposal is approved, `applicable` when it is rejected (versioned, audit `gates.criterion.set_applicability`). business-gates.md §2.1. | gates spec "DOM-P2-15 …" (2); domain "DOM-P2-15 …" (2) |
| **DOM-P2-16** (Low) | **Not fixed — blocked** | Enforcing the gate owner and reviewer roles needs changes outside this assignment: (1) policy — `gates.assessment.submit` is held only by `project_manager`, while the DC template's gate owners are `secretary_cpmo` (G0), `workstream_lead` (G1, G4, G5, G6), `legal_restricted` (G2) and `project_manager` (G3, G7), so "the owner submits" is impossible without granting `gates.assessment.submit` to those roles; and G0/G1 have `project_manager` as gate reviewer, the same role that submits today; (2) UI — a gate-level review is a new user action (the web scope of this assignment is limited to i18n and My Work), and requiring it without a button would break the gate journey. Design for re-phasing: grant the submit permission to the owner roles; `start` / `mark-ready` / `back` / `link-decision` require the gate's `ownerRole` (designated, like criterion reviewers); new command `POST …/gates/:gateId/assessment/review {expectedVersion, outcome: endorse \| return, note}` by the gate's `reviewerRole` (`gates.assessment.review`, not_self vs the owner-submitter), recorded on the cycle (`reviewed_by/at`, outcome, note); `mark-ready` requires an endorsement recorded after the cycle's last criterion change; `decide` stays not_self vs the submitter and additionally vs the gate reviewer; My Work item `gate_review`; the gate test kit and E2E fixture add the review step. | — **Update 2026-09-30: Fixed** in the follow-up implementation after the lead's policy grant (`a471265`) — see "DOM-P2-16 follow-up" at the end of this document. |
| **DOM-P2-19** (Low) | **Fixed** | Reviewing a claim as conflicting with another claim flags **both**: the counterpart becomes `conflicting` with the back-reference, keeps its extracted, source-reported and confirmed values, and its pending "apply" proposal is invalidated (`approval_request.status = invalidated`); separation of duties also applies to the counterpart (its own extractor cannot flag it — 403, nothing changes); audit `documents.claim.conflict`, `source.updated`. A claim that stops being confirmed has its pending proposal invalidated too. | documents spec "AT-14 …" (2) |
| **DOM-P2-21** (Low) | **Documented; made consequential** | business-gates.md §4 rule 9 states precisely where documents-module verification is decisive and where it is advisory: for gate criteria (and task / deliverable acceptance) the designated reviewer / approver — never the evidence owner — is the checker, so a positive verification is advisory for acceptance; a **rejection** (defective evidence) is decisive: the link stops counting at once, an accepted criterion of an undecided cycle returns to `unmet`, and an approved gate is flagged for controlled reassessment (DOM-P2-05). Unverified evidence now appears in the verifiers' My Work (DOM-P2-09), and an evidence prerequisite (DOM-P2-18) is satisfied only by **verified** evidence. A per-criterion "verification required before acceptance" parameter for `approved_document` / `board_resolution` / `regulatory_record` remains a possible template extension. | business-gates.md §4 rule 9; tests of DOM-P2-05 and DOM-P2-18 |
| **DOM-P2-17** (Medium, feature gap) | **Implemented (API)** | `cross_project_dependency` extended (dependent item, depended-upon task / milestone of another project, close reason/by/at, version) and routes `GET/POST /projects/:projectId/cross-project-dependencies`, `POST …/:dependencyId/close`. Minimum disclosure: a dependency — and anything about the other project's item — is listed, counted and addressable **only for users who can read both ends** (project membership, classification, workstream reach of `planning.plan.read`); everyone else gets nothing (not counted; 404). The other end is validated inside its own project (never a submitted id trusted); audited in the dependent project only; `atRisk` is schedule-based (item finish after `neededBy`). The Integrated-Plan UI for it is not part of this change. | `apps/api/test/planning/cross-project-and-prerequisites.spec.ts` "DOM-P2-17 …" (5) |
| **DOM-P2-18** (Medium, feature gap) | **Implemented (API)** | New `record_dependency` (non-schedule prerequisite of a task / milestone: `decision`, `gate`, `agreement`, `approval_request`, `evidence_link` of the same project) and routes `GET/POST /projects/:projectId/prerequisites`, `POST …/:prerequisiteId/remove`. Satisfied = decision final (never a recommendation), gate approved and not under reassessment, agreement signed / effective, approval approved, evidence active and verified. An unsatisfied prerequisite blocks **starting** the task and **reporting the milestone achieved** (422 `planning.prerequisite_pending`, count only — "task blocked by pending agreement dependency"). Lists show only prerequisites whose record the caller can see; the rule counts all. They are not CPM nodes (the schedule still computes on tasks / milestones only). UI not part of this change. | spec "DOM-P2-18 …" (3); domain `planning.test.ts` "DOM-P2-18 …" (3) |

### Existing tests changed, and why (the review shows they encoded the defect)

- `packages/domain/src/gates.test.ts`: the `assertGateDecisionAllowed` cases backed G1 with a decision **without a gate key** (the
  DOM-P2-01b bypass) and passed no authority. They now use a decision raised for G1 of the operational type with the DEMO
  authority; every assertion is kept.
- `packages/domain/src/documents.test.ts`: `assertClaimReview` / `claimApplicability` take the new explicit inputs
  (origin, verifying source, reviewers); the same assertions are kept and invariant tests added.
- `packages/domain/src/messages.test.ts`: exercises the new blocker / dimension codes (the test requires every code).
- `apps/api/test/gates/gate-test-kit.ts`: the G0 passage decision type `charter_amendment` (stand-in named by the review)
  is replaced by `gate_decision_mandate`.
- `e2e/tests/p2-gates.spec.ts` (d): it linked the demo's JV-signing recommendation — a decision raised for **no** gate — to
  G1, exactly the DOM-P2-01b bypass. It now links a G1 decision of the operational type that is still under review and
  expects "only an approved decision can back a gate approval". **NOT EXECUTED** (E2E needs the running stack).
- No API integration assertion was weakened; every pre-existing API test passes unchanged.

### Changes needed outside this assignment (proposed to the lead)

1. **Policy matrix** (`policy-matrix.json` / access-matrix.md — not edited): grant `planning.deliverable.accept` to
   `sponsor` and `committee_chair` (DOM-P2-07; otherwise tasks designating them cannot be accepted); for DOM-P2-16 grant
   `gates.assessment.submit` to `secretary_cpmo`, `workstream_lead`, `legal_restricted`.
2. **post-migrate.sql**: `ALTER TABLE cross_project_dependency ADD CONSTRAINT cross_project_dependency_other_org_fk
   FOREIGN KEY (org_id, other_project_id) REFERENCES project (org_id, id);` (same-organization guard for the other end;
   the service already requires membership of both projects), and register `('record_dependency', 'successor_type',
   'successor_id', 'successor')` in the same-project trigger list (predecessors are validated by the service; a DB guard
   for them needs `hub_target_table` entries for `gate` → `gate_definition`, `agreement`, `approval_request`,
   `evidence_link`).
3. **RecordVisibility** (`apps/api/src/platform/record-visibility.ts`): rules for `cross_project_dependency` (both ends)
   and `record_dependency` (successor + predecessor) if these audit entries should appear in activity feeds for
   non-auditors (today they are auditor-only, which is the safe default).
4. **Carve-out** (`perimeter-versions.service.ts`, not in this assignment) still backs a perimeter-version approval with
   `gateDecisionIssue` (finality only, no gate-key / decision-type check); switching it to `gateApprovalDecisionIssue` with
   the committee's matrix authority closes the same bypass there.

### Residuals

- DOM-P2-07: changing `approverRole` of a **baselined** task only through change control is not enforced (only while the
  task awaits acceptance); DOM-P2-09: agenda screening, external-authority recording and claim reviews are not yet My Work
  item types; DOM-P2-17 / -18: API only (no web screens), no CPM integration of prerequisites, no notification when the
  other project's item slips.

### Commands and real results (implementer's own databases `hub_test_gatefix`, `hub_test_gatefix_boot`)

```
$ HUB_DATABASES="hub_test_gatefix hub_test_gatefix_boot" bash scripts/dev/pg-init-roles.sh
roles hub_owner/hub_app and databases ready: hub_test_gatefix hub_test_gatefix_boot
$ pnpm build:packages                                               # OK
$ pnpm --filter @hub/domain --filter @hub/contracts run test
packages/domain test:     Test Files  16 passed (16)      Tests  328 passed (328)
packages/contracts test:  Test Files  2 passed (2)        Tests  100 passed (100)
$ TEST_DATABASE_URL=postgres://hub_app:…@127.0.0.1:5432/hub_test_gatefix \
  TEST_DATABASE_MIGRATION_URL=postgres://hub_owner:…@127.0.0.1:5432/hub_test_gatefix pnpm --filter @hub/api test
 Test Files  1 failed | 76 passed (77)
      Tests  5 failed | 664 passed (669)     Duration 452.85s      (merged tree, final run)
   -> the only failures are the governance agent's five DEFECT probes in test/reviews/p2-domain.spec.ts:
      DOM-P2-02 (domain), DOM-P2-02 (API), DOM-P2-03a, DOM-P2-03b, DOM-P2-06
$ pnpm lint     # tsc in every package + web i18n check (42 server message codes) + hard-coded-string check: passed
$ python3 scripts/requirements/apply_status.py --check      # status-evidence.yaml OK (102 entries)
$ node apps/api/dist/cli/openapi.js …      # 353 operations (incl. the 6 new DOM-P2-17/-18 routes)
```

NOT EXECUTED: Playwright E2E (`pnpm test:e2e`, needs the running stack and a production web build) — including the
updated `p2-gates.spec.ts` (d).
