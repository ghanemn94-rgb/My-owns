# Delegation / Authority Matrix — Structure and Demo Policy

# مصفوفة تفويض الصلاحيات — الهيكل والسياسة التجريبية

> **Status: proposed structure (P0).** No approved Mobily authority matrix is available in this environment. This
> document defines (1) the structure the platform uses to hold an approved matrix and (2) a **DEMO POLICY (synthetic,
> not Mobily policy)** for the sandbox. Quorum, thresholds and spending limits for real projects must come from an
> approved source (spec §4.1).

## 1. Activation rule (قاعدة التفعيل)

1. **Production approval authority is not activated until an approved matrix is loaded.** A matrix version has a
   lifecycle: `draft → approved → active → superseded | expired`. Only one version is `active` per committee at a time.
2. Loading a matrix requires an approval record (evidence type `approved_document` or `board_resolution`) that
   references the approving authority; the loaded values must match the approved document (G0-C03). **As implemented
   (P2 fix DOM-P2-12):** approving a non-demo matrix requires `approvalDocumentId` — the approval record uploaded as a
   document of the documents module (a free-text `approvalReference` alone is refused with
   `422 governance.authority_matrix.evidence_required`). The approval is then *pending verification*: the version stays
   `draft` and the previous version stays in force until a second person verifies the evidence
   (`POST …/authority-matrix-versions/:id/verify-approval`, permission `documents.evidence.verify`; the verifier is not the
   drafter, not the approver and not the uploader of the document version bound at approval — 403 otherwise). Accept
   brings the version into force (`approved`, previous version superseded); reject (reason required) clears the approval
   so it can be approved again with the correct record. The DEMO policy (demo projects only) is synthetic, has no approving
   authority to evidence, and takes effect on approval.
3. In a non-demo project without an `active` matrix, the server does not allow any decision to reach `approved`, and
   dependent gates stay blocked. **As implemented (P2):** because quorum and voting thresholds come from the approved
   matrix, recording votes, quorum checks and outcomes is refused with `422 governance.matrix.not_usable` until a
   matrix is approved and in date; the committee can still meet, deliberate and minute its discussion. (An earlier
   draft of this rule allowed votes to be recorded as "Recommended — pending authority activation"; it was replaced
   because a quorum computed without approved rules would not be meaningful. Mobily may choose otherwise — Q-06.)
   **Baselines and change requests (P2 fix DOM-P2-03):** an individual approval (`planning.baseline.approve`,
   `planning.change_request.approve`) is refused with `422 change_control.no_usable_matrix` in a non-demo project without an
   approved, in-force matrix of an active steering committee, unless it is backed by a final governance decision (§3.1).
   In a demo project that has no approved matrix at all, the DEMO policy of §4 is used (sandbox; audited as
   `demo_sandbox_policy`).
4. The Demo policy is accepted only in projects flagged `is_demo = true`. Any attempt to attach it to a non-demo
   project is rejected and logged. Decisions made under the Demo policy carry a visible `Demo` badge and are excluded
   from actual reporting.

## 2. Matrix structure (هيكل المصفوفة)

### 2.1 Matrix header

| Field | Description |
|---|---|
| `matrixId`, `version` | Identifier and version; versions are immutable once approved |
| `committeeId` | The committee (or other body) the matrix delegates to |
| `isDemoPolicy` | `true` only for the synthetic sandbox policy |
| `status` | `draft`, `approved`, `active`, `superseded`, `expired` |
| `effectiveFrom`, `effectiveTo` | Validity of the delegation (business dates, project timezone) |
| `approvalReference` | Resolution / record number and the evidence document id |
| `quorum` | `minVotingMembersPresent` (integer) and `minFractionPresent` (fraction of appointed voting members — active voting seats held by a named person; vacant "Role — To be confirmed" seats are not appointed and not counted) |
| `approvalThreshold` | `simple_majority` or `two_thirds` |
| `tieRule` | `chair_casting_vote` or `escalate` |
| `alternatesPermitted`, `proxyVotingPermitted` | Whether nominated alternates / proxies are allowed |
| `selfApprovalProhibited` | Always `true` (platform invariant, not configurable) |
| `recusedMembersExcludedFromQuorum` | Always `true` (platform invariant, not configurable): recused members never count toward the quorum of the item (they stay in the appointed-members denominator of `minFractionPresent`, §3 step 4) |

### 2.2 Decision type rows

| Field | Description |
|---|---|
| `key`, `name {en, ar}` | Decision type identifier and bilingual name |
| `withinCommitteeAuthority` | Whether the committee may give final approval |
| `maxAmount`, `currency`, `unitScale` | Limit as a decimal string with ISO 4217 currency and unit scale (1 / 1000 / 1000000); `null` = no monetary limit applies |
| `conditions` | Additional conditions (e.g. required specialist review, budget availability) |
| `requiredRecommenders` | Functions that must review before the committee votes (e.g. Finance, Legal) |
| `escalateTo` | The body that decides when the item is outside delegation or above the limit |
| `quorumOverride`, `thresholdOverride` | Optional stricter rules for this decision type |
| `gateKeys` | Business gates whose passage this decision type may approve (e.g. `["G1","G2","G3","G4","G7"]`). A type without `gateKeys` approves **no** gate (fail closed). See §3 step 10 (DOM-P2-01). |

## 3. Server-side evaluation (التقييم على الخادم)

For every approval command the server evaluates, in one transaction, and logs the outcome:

1. **Matrix active?** If not, and the project is not a demo project → outcome capped at `recommended`.
2. **Decision type known?** Unknown type → treated as outside authority (escalate).
3. **Within authority?** `withinCommitteeAuthority = true` **and**, when an amount applies, the amount is in the same
   currency and unit scale as `maxAmount` and `amount ≤ maxAmount`. Amounts in another currency or unit scale are
   not compared without an explicit conversion basis; the item is treated as outside authority until one is recorded.
   Comparison uses decimal arithmetic, never floating point.
4. **Quorum** (per agenda item): eligible = voting members present **minus** recused members for that item **minus**
   the requester/owner of the item. Quorum is met when `eligible ≥ minVotingMembersPresent` and
   `eligible ÷ appointed voting members ≥ minFractionPresent`. *Clarified (DOM-P2-13):* "appointed voting members" are the
   voting seats held by a named person and active on the meeting date; vacant seats are not counted; recused members and
   the requester **remain** in this denominator (a recusal never lowers the bar) — the implementation used to take the
   fraction over the members left after recusals (`packages/domain/src/governance.ts` `computeQuorum`, aligned).
   Assumption A-06 in `docs/assumptions-and-open-questions.md` said "excluded from the quorum denominator", which
   contradicted this step; it was corrected to this rule. For a resolution by circulation, the eligible members who
   responded in the round are "present".
5. **Threshold**: `simple_majority` → approve votes > half of eligible votes; `two_thirds` → approve votes ×3 ≥ eligible
   votes ×2. Abstentions count as not approving. *Clarified (DOM-P2-02):* eligible votes = approve + reject + abstain
   votes cast in the round by eligible members (recused members and the requester cannot vote); members present who do not
   vote are not counted; a round without any approve or reject vote (abstentions only) records no outcome. This is the
   current written rule of this build and awaits confirmation by Mobily's governance owner (A-40 / Q-40, with the
   alternative).
   *Closing the vote (P2 re-review DOM-P2R-01) — PROPOSED default of this build, pending the governance owner's
   confirmation (Q-40); not a Mobily policy:* an outcome is recorded only when the vote is complete —
   (a) every eligible member expected to vote has voted (approve, reject or abstain): in a meeting, the appointed voting
   members recorded present, minus members recused from the item and the requester; for a resolution by circulation,
   every appointed eligible voting member (the circulation is sent to all of them); or
   (b) the committee's **chair** (the chair seat holder on the meeting date) closed voting on the round with a reason
   (`POST …/decisions/:id/close-voting`, audited `governance.decision.close_voting`); no further vote is accepted in that
   round (`422 governance.vote.voting_closed`); or
   (c) for a circulation only, its response deadline has passed.
   Otherwise `422 governance.outcome.votes_outstanding` (in a meeting, a quorum missing from the attendance is reported
   first, `governance.outcome.no_quorum`, since no vote could be cast). Members who had not voted when the vote closed are listed in the
   tally snapshot (`voting.notVoted`) and are **not counted** — abstention handling is unchanged. A new round (resume,
   return to draft) reopens voting. The alternative reading (non-voters present count as not approving, A-40) remains open
   for the governance owner.
   *Declarations before voting (REQ-GOV-015, F-01):* a member votes on an item only after recording, **in their own name**,
   a conflict-of-interest declaration for that item — "no conflict" (given with the vote, `conflictDeclaration:
   "no_conflict"`, or earlier in the meeting's conflict register) or a declared interest (the chair may then rule a
   recusal). A member with a conflict records a recusal instead of voting. A declaration recorded by someone else on the
   member's behalf does not satisfy the rule (`422 governance.vote.declaration_required`). Whether an interest declared
   without a chair's ruling may vote is for the governance owner to confirm (Q-40).
6. **Tie** (approve votes equal non-approve votes): `chair_casting_vote` → the chair's casting vote decides (only if
   the chair is eligible for the item); `escalate` → the item is recorded as tied and escalated; no approval.
   *Clarified (DOM-P2-13):* the chair has no second vote — the casting vote is exercised through the chair's own vote in
   the round: the side the chair voted for prevails, only when the chair cast an eligible approve or reject vote;
   otherwise (chair abstained, did not vote, is recused or requested the item) the tie is escalated (A-41 / Q-41).
7. **Self-approval**: a user cannot approve or vote on an item they requested or own; a single-approver action (waiver,
   evidence acceptance, action verification) requires an approver different from the submitter.
8. **Outcome**: within authority and passed → `approved`; outside authority or above the limit and passed →
   `recommended` with `pendingExternalAuthority = true` and the `escalateTo` body recorded; failed → `rejected`.
9. Historical votes are evaluated against the matrix version active at the time of the vote and never re-evaluated
   when the matrix or membership changes.
10. **Integrity of the round** (P2 fixes DOM-P2-06, DOM-P2-20): every vote cast in the round counts. A recusal cannot be
    recorded for a member who already voted in the round (`422 governance.recusal.after_vote`, own or on behalf); a
    recusal recorded on behalf of a member needs a reason and is audited with the recorder and shown in the tally snapshot.
    Attendance of a meeting is frozen while a decision tabled at it has votes in its current round and no outcome
    (`422 governance.attendance.frozen_voting_open`). A conflict or attendance correction discovered after voting is
    handled by restarting the round (defer → resume). If the votes and the eligibility records disagree anyway (a vote of a
    recused member, of the requester, or of a member no longer recorded present), the outcome is refused
    (`422 governance.outcome.vote_integrity`) — votes are never silently dropped.
11. **Gate approvals (DOM-P2-01, AT-04, REQ-GOV-022/023).** A gate decision (`gates.assessment.decide`) is backed only by a
    committee decision that (a) was raised for that gate (`gateKey` = the gate; a decision without a gate key backs no
    gate), (b) is final — approved within the mandate, or a recommendation approved by the authorized body with its
    reference recorded, (c) is of a decision type that the deciding committee's approved matrix (the version recorded with
    the committee outcome) assigns to that gate through `gateKeys`, and (d) was decided by the body holding that
    authority: a type reserved to a higher authority (`withinCommitteeAuthority = false`) backs the gate only through the
    recorded external approval. Linking a decision that fails (a) or (c) to a gate cycle is refused
    (`gates.decision.not_for_gate`); deciding on one is refused (`gates.decide.decision_not_for_gate` /
    `gates.decide.decision_not_final`). A committee without an approved matrix cannot back any gate.
12. **Relying on a decision (P2 re-review DOM-P2R-04).** Every time a decision is relied upon — gate approval, change-request
    or baseline approval, prerequisite satisfaction, perimeter-version approval — an approval recorded from the external
    authority counts only while its evidence link (DOM-P2-12) is still **active and verified**. A rejected (found
    defective), superseded or conflicting link stops the decision from backing any new approval
    (`change_control.decision_evidence_invalid`, `gates.decide.decision_evidence_invalid`, gate blocker
    `gate.blocker.decision_external_evidence_invalid`, prerequisite unsatisfied). A gate already approved on that decision is
    flagged for controlled reassessment (`reassessment.decisionEvidence`, escalation, notifications, `gate.blocked`,
    downstream gates flagged, status dimensions recomputed) — the recorded decision and the approved cycle are never
    modified.
13. **One decision, one record (DOM-P2R-03, DOM-P2R-05, QA-P2-01).** A decision paper names the record it authorizes
    (`subjectType` + `subjectId`: `change_request`, `baseline_version` or `perimeter_version`), chosen when the paper is
    drafted and fixed from its first submission (`governance.decision.subject_locked`). A change-request or baseline
    approval rests only on a decision raised for that record (`change_control.decision_no_subject` /
    `…decision_other_subject`); a perimeter-version approval rests on a G1 decision that backed no other version
    (`perimeter.version.decision_already_used`) and, when the decision names a subject, on one raised for that version.
    Every use is recorded in the **decision-use registry** (`decision_use`: decision, kind of use, record — unique per
    decision and kind; kinds `change_request`, `baseline_version`, `perimeter_version`, `gate_cycle`), checked under a row
    lock on the decision (`…decision_already_used`, 422) with the registry's unique index — and the partial unique indexes
    on `decision_id` — as the backstop (409). Gate decisions are bound by the gate key (rule 11) and cannot back a later
    cycle of the same gate, whether the earlier cycle was approved or rejected (`gates.decide.decision_reused`; the
    rejected-cycle case is a proposed rule, pending the governance owner — QA observation O-1). The mechanism is generic
    (docs/architecture/module-guide.md, "Relying on a governance decision") for later consumers (JV closings, valuations,
    budget lines).

### 3.1 Individual approvals under delegated authority — baselines and change requests (P2 fix DOM-P2-03)

The approval of a baseline (`planning.baseline.approve`) or of a change request (`planning.change_request.approve`) by
an individual approver is treated as an exercise of the governing steering committee's delegated authority for the
matching decision type (A-43 / Q-43). For every approval the server evaluates, in the request transaction, and records
the basis in the audit event (`after.authority`):

1. **Governing matrix**: the approved, in-force matrix of an **active** `program_steering` committee of the project (the
   most recently approved one if several exist). A demo project with no approved matrix at all uses the DEMO policy (§4).
2. **Decision type and amount**: baseline → `baseline_approval` with the total of the approved budget lines frozen in the
   snapshot (lines in several currencies or unit scales are not added up and count as unquantified); change request →
   `change_request_budget` with its structured budget impact `costImpact` (decimal + currency + unit scale; `0` = none).
   A change request whose `impacts.cost` states a cost in text only has an **unquantified** amount and is never assumed
   to be within a limit (`422 change_control.amount_unquantified`) — the assessor records `costImpact` first.
   *Who quantifies (P2 re-review DOM-P2R-02) — conservative option, PROPOSED pending the governance owner (Q-43):* the
   requester may state a `costImpact`, but a requester-stated amount can only make an approval FAIL (above a limit, not
   covered by a decision); it makes an approval PASS only once an assessor who is **not the requester** has recorded or
   confirmed it through the impact assessment (`costImpactRecordedBy` ≠ requester; otherwise
   `422 change_control.amount_unconfirmed`). The requester re-recording the amount does not confirm it. A change with no
   monetary impact stated at all (no amount, no cost text) is unaffected. Baseline amounts are the approved budget lines
   frozen in the snapshot (finance-approved) and count as confirmed.
3. **Within authority** (same rule as §3 step 3: type within the committee's delegation, same currency, amount ≤
   `maxAmount`, decimal arithmetic) → the approver may approve (`basis: delegated_authority`).
4. **Outside authority** → refused with `422 change_control.outside_delegated_authority` and the body to escalate to. The
   change is routed to the committee through the existing decision flow: a decision paper of the matching type with the
   amount; a passing vote above the limit becomes `recommended` and is escalated; the authorized body's decision is
   recorded with verified evidence (transition 9). The approval then names that decision (`decisionId`): it must be
   final (approved within the mandate, or approved by the external authority and recorded, with that approval's evidence
   still active and verified — §3 rule 12), of the matching type, **raised for this change request / baseline version**
   (§3 rule 13), carry an amount in the same currency that covers the change, belong to the project, and back one approval
   only — checked in this order: `change_control.decision_not_final`, `…decision_evidence_invalid`,
   `…decision_type_mismatch`, `…decision_already_used` (422, or 409 when a concurrent approval won), `…decision_no_subject`,
   `…decision_other_subject`, `…amount_unquantified`, `…decision_amount_missing`, `…decision_amount_currency`,
   `…decision_amount_insufficient`, `…amount_unconfirmed`; 404 for a decision of another project). The change request / baseline stores `decisionId` (`basis: governance_decision`).
5. **Order of checks**: role (403/404) → state and `expectedVersion` (422/409) → separation of duties (the requester or
   proposer is refused whatever the amount, 403) → delegated authority (422) → the policy check with the evaluated
   `withinAuthority` (never assumed, I-R3). Refusals are audited (`outcome = rejected`).
6. Rejections of a baseline proposal or a change request are within the approver's role: the matrix limits approvals,
   not the decision to keep the approved plan unchanged (A-45).

## 4. DEMO POLICY (synthetic, not Mobily policy) — سياسة تجريبية (اصطناعية، وليست سياسة موبايلي)

> **DEMO ONLY.** All values below are synthetic, chosen only to exercise the platform's rules in the sandbox. They do
> not reflect any Mobily delegation, limit, quorum or practice. Amounts are shown in the fictitious unit **DEMO-SAR**;
> the machine-readable form uses the technical currency field `SAR` because the money model requires an ISO 4217 code,
> and is flagged `isDemoPolicy: true`.

### 4.1 Demo rules

| Rule | Demo value |
|---|---|
| Quorum | At least 3 eligible voting members present, and at least one half of appointed voting members |
| Approval threshold | Simple majority of eligible votes |
| Tie rule | Escalate (no casting vote in the demo) |
| Recused members | Excluded from quorum for the item |
| Self-approval | Prohibited |

### 4.2 Demo decision types

| Key | Decision type | Demo limit | Within committee authority | Escalate to |
|---|---|---|---|---|
| `baseline_approval` | Approve baseline and rebaseline | — | Yes | Not applicable — within committee authority (demo) |
| `change_request_budget` | Approve a change request with budget impact | 1,000,000 DEMO-SAR | Yes, up to limit | Delegating authority — to be confirmed |
| `separation_spend_commitment` | Approve a separation spend commitment | 5,000,000 DEMO-SAR | Yes, up to limit | Delegating authority — to be confirmed |
| `gate_decision_operational` | Approve passage of gates G1–G4 and G7 (`gateKeys` G1, G2, G3, G4, G7) | — | Yes | Not applicable — within committee authority (demo) |
| `day1_go_no_go` | Day-1 go/no-go decision | — | Yes | Not applicable — within committee authority (demo) |
| `tsa_approval_or_extension` | Approve a TSA or a TSA extension | 2,000,000 DEMO-SAR | Yes, up to limit | Delegating authority — to be confirmed |
| `partner_outreach_and_access` | Approve partner outreach and materials access | — | Yes | Not applicable — within committee authority (demo) |
| `criterion_waiver` | Approve a waiver of a waivable gate criterion | — | Yes | Not applicable — within committee authority (demo) |
| `preferred_partner_selection` | Select the preferred partner | — | No | Board of Directors — to be confirmed |
| `valuation_and_ownership_terms` | Approve valuation and ownership terms | — | No | Board of Directors — to be confirmed |
| `jv_signing_authorization` | Authorize JV signing (`gateKeys` G5) | — | No | Board of Directors — to be confirmed |
| `jv_closing_confirmation` | Confirm a JV closing (`gateKeys` G6) | — | No | Board of Directors — to be confirmed |
| `opening_balance_sheet` | Approve the opening balance sheet | — | No | NewCo board / authorized finance approver — to be confirmed |
| `gate_decision_mandate` | Approve passage of gate G0 — the committee cannot approve its own mandate (`gateKeys` G0) | — | No | Delegating authority — to be confirmed |
| `charter_amendment` | Amend the committee charter or delegation | — | No | Delegating authority — to be confirmed |

### 4.3 Machine-readable Demo policy

```json
{
  "isDemoPolicy": true,
  "quorum": { "minVotingMembersPresent": 3, "minFractionPresent": 0.5 },
  "approvalThreshold": { "type": "simple_majority" },
  "tieRule": "escalate",
  "decisionTypes": [
    { "key": "baseline_approval", "name": { "en": "Approve baseline and rebaseline", "ar": "اعتماد خط الأساس وإعادة خط الأساس" }, "maxAmount": null, "currency": "SAR", "unitScale": 1, "withinCommitteeAuthority": true, "escalateTo": "Not applicable — within committee authority (demo)" },
    { "key": "change_request_budget", "name": { "en": "Approve a change request with budget impact", "ar": "اعتماد طلب تغيير له أثر على الميزانية" }, "maxAmount": "1000000.0000", "currency": "SAR", "unitScale": 1, "withinCommitteeAuthority": true, "escalateTo": "Delegating authority — to be confirmed" },
    { "key": "separation_spend_commitment", "name": { "en": "Approve a separation spend commitment", "ar": "اعتماد التزام إنفاق على الفصل" }, "maxAmount": "5000000.0000", "currency": "SAR", "unitScale": 1, "withinCommitteeAuthority": true, "escalateTo": "Delegating authority — to be confirmed" },
    { "key": "gate_decision_operational", "name": { "en": "Approve passage of gates G1–G4 and G7", "ar": "اعتماد اجتياز البوابات من الأولى إلى الرابعة والسابعة" }, "maxAmount": null, "currency": "SAR", "unitScale": 1, "withinCommitteeAuthority": true, "escalateTo": "Not applicable — within committee authority (demo)", "gateKeys": ["G1", "G2", "G3", "G4", "G7"] },
    { "key": "day1_go_no_go", "name": { "en": "Day-1 go/no-go decision", "ar": "قرار المضي أو عدمه لليوم الأول" }, "maxAmount": null, "currency": "SAR", "unitScale": 1, "withinCommitteeAuthority": true, "escalateTo": "Not applicable — within committee authority (demo)" },
    { "key": "tsa_approval_or_extension", "name": { "en": "Approve a TSA or a TSA extension", "ar": "اعتماد اتفاقية خدمات انتقالية أو تمديدها" }, "maxAmount": "2000000.0000", "currency": "SAR", "unitScale": 1, "withinCommitteeAuthority": true, "escalateTo": "Delegating authority — to be confirmed" },
    { "key": "partner_outreach_and_access", "name": { "en": "Approve partner outreach and materials access", "ar": "اعتماد التواصل مع الشريك ومنحه الوصول إلى المواد" }, "maxAmount": null, "currency": "SAR", "unitScale": 1, "withinCommitteeAuthority": true, "escalateTo": "Not applicable — within committee authority (demo)" },
    { "key": "criterion_waiver", "name": { "en": "Approve a waiver of a waivable gate criterion", "ar": "اعتماد الإعفاء من معيار بوابة قابل للإعفاء" }, "maxAmount": null, "currency": "SAR", "unitScale": 1, "withinCommitteeAuthority": true, "escalateTo": "Not applicable — within committee authority (demo)" },
    { "key": "preferred_partner_selection", "name": { "en": "Select the preferred partner", "ar": "اختيار الشريك المفضل" }, "maxAmount": null, "currency": "SAR", "unitScale": 1, "withinCommitteeAuthority": false, "escalateTo": "Board of Directors — to be confirmed" },
    { "key": "valuation_and_ownership_terms", "name": { "en": "Approve valuation and ownership terms", "ar": "اعتماد التقييم وشروط الملكية" }, "maxAmount": null, "currency": "SAR", "unitScale": 1, "withinCommitteeAuthority": false, "escalateTo": "Board of Directors — to be confirmed" },
    { "key": "jv_signing_authorization", "name": { "en": "Authorize JV signing", "ar": "تفويض توقيع المشروع المشترك" }, "maxAmount": null, "currency": "SAR", "unitScale": 1, "withinCommitteeAuthority": false, "escalateTo": "Board of Directors — to be confirmed", "gateKeys": ["G5"] },
    { "key": "jv_closing_confirmation", "name": { "en": "Confirm a JV closing", "ar": "تأكيد إتمام المشروع المشترك" }, "maxAmount": null, "currency": "SAR", "unitScale": 1, "withinCommitteeAuthority": false, "escalateTo": "Board of Directors — to be confirmed", "gateKeys": ["G6"] },
    { "key": "opening_balance_sheet", "name": { "en": "Approve the opening balance sheet", "ar": "اعتماد الميزانية الافتتاحية" }, "maxAmount": null, "currency": "SAR", "unitScale": 1, "withinCommitteeAuthority": false, "escalateTo": "NewCo board / authorized finance approver — to be confirmed" },
    { "key": "gate_decision_mandate", "name": { "en": "Approve passage of gate G0 (mandate and governance)", "ar": "اعتماد اجتياز البوابة صفر (التفويض والحوكمة)" }, "maxAmount": null, "currency": "SAR", "unitScale": 1, "withinCommitteeAuthority": false, "escalateTo": "Delegating authority — to be confirmed", "gateKeys": ["G0"] },
    { "key": "charter_amendment", "name": { "en": "Amend the committee charter or delegation", "ar": "تعديل ميثاق اللجنة أو تفويضها" }, "maxAmount": null, "currency": "SAR", "unitScale": 1, "withinCommitteeAuthority": false, "escalateTo": "Delegating authority — to be confirmed" }
  ],
  "selfApprovalProhibited": true,
  "recusedMembersExcludedFromQuorum": true
}
```

### 4.4 Demo scenarios this policy is designed to exercise

| Scenario | Expected server outcome | Acceptance test |
|---|---|---|
| Committee votes to select the preferred partner | `recommended`, pending external authority; G5-C02 stays unmet | AT-04 |
| Vote recorded with only 2 eligible members present | Rejected (no quorum) and logged | AT-05 |
| Recused member casts a vote | Rejected and logged; not counted in quorum | AT-05 |
| Requester approves their own waiver | Rejected and logged | AT-05 |
| Change request for 1,500,000 DEMO-SAR | Individual approval refused (`422 change_control.outside_delegated_authority`); the committee decision of type `change_request_budget` for that amount becomes `recommended`, escalated; after the authorized body's approval is recorded with verified evidence, the change request is approved on that decision (§3.1) | AT-04, `apps/api/test/governance/p2-governance-authority.spec.ts` |
| Change request with a cost stated in text only | Not compared with the limit; approval refused until `costImpact` is recorded (`422 change_control.amount_unquantified`) | `apps/api/test/reviews/p2-domain.spec.ts` DOM-P2-03b |
| Change request in another currency without a conversion basis | Not compared; treated as outside authority | AT-29 |
| Baseline approval in a non-demo project without an approved, verified matrix | Refused (`422 change_control.no_usable_matrix`) | `apps/api/test/reviews/p2-domain.spec.ts` DOM-P2-03a |
| One approve and four abstentions (all present) | Not approved (abstentions count as not approving) | DOM-P2-02 probes |
| Secretariat records recusals for members who already voted | Refused (`422 governance.recusal.after_vote`) | DOM-P2-06 probe |

## 5. Open items for the real matrix (بنود مفتوحة)

- Delegating authority, decision types, limits and currencies — to be supplied from the approved corporate delegation
  of authority.
- Whether alternates or proxies are allowed; the tie rule; stricter rules per decision type.
- Whether gate decisions G5 and G6 are ever within committee authority for this program.
- Treatment of approvals that require a NewCo board resolution in addition to the committee's recommendation.
