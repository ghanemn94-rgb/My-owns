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
3. **Within authority** (same rule as §3 step 3: type within the committee's delegation, same currency, amount ≤
   `maxAmount`, decimal arithmetic) → the approver may approve (`basis: delegated_authority`).
4. **Outside authority** → refused with `422 change_control.outside_delegated_authority` and the body to escalate to. The
   change is routed to the committee through the existing decision flow: a decision paper of the matching type with the
   amount; a passing vote above the limit becomes `recommended` and is escalated; the authorized body's decision is
   recorded with verified evidence (transition 9). The approval then names that decision (`decisionId`): it must be
   final (approved within the mandate, or approved by the external authority and recorded), of the matching type, carry an
   amount in the same currency that covers the change, belong to the project, and back one approval only
   (`change_control.decision_not_final`, `…decision_type_mismatch`, `…decision_amount_missing`, `…decision_amount_currency`,
   `…decision_amount_insufficient`, `…decision_already_used`; 404 for a decision of another project). The change request /
   baseline stores `decisionId` (`basis: governance_decision`).
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
| `gate_decision_operational` | Approve passage of gates G1–G4 and G7 | — | Yes | Not applicable — within committee authority (demo) |
| `day1_go_no_go` | Day-1 go/no-go decision | — | Yes | Not applicable — within committee authority (demo) |
| `tsa_approval_or_extension` | Approve a TSA or a TSA extension | 2,000,000 DEMO-SAR | Yes, up to limit | Delegating authority — to be confirmed |
| `partner_outreach_and_access` | Approve partner outreach and materials access | — | Yes | Not applicable — within committee authority (demo) |
| `criterion_waiver` | Approve a waiver of a waivable gate criterion | — | Yes | Not applicable — within committee authority (demo) |
| `preferred_partner_selection` | Select the preferred partner | — | No | Board of Directors — to be confirmed |
| `valuation_and_ownership_terms` | Approve valuation and ownership terms | — | No | Board of Directors — to be confirmed |
| `jv_signing_authorization` | Authorize JV signing (G5) | — | No | Board of Directors — to be confirmed |
| `jv_closing_confirmation` | Confirm a JV closing (G6) | — | No | Board of Directors — to be confirmed |
| `opening_balance_sheet` | Approve the opening balance sheet | — | No | NewCo board / authorized finance approver — to be confirmed |
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
    { "key": "gate_decision_operational", "name": { "en": "Approve passage of gates G1–G4 and G7", "ar": "اعتماد اجتياز البوابات من الأولى إلى الرابعة والسابعة" }, "maxAmount": null, "currency": "SAR", "unitScale": 1, "withinCommitteeAuthority": true, "escalateTo": "Not applicable — within committee authority (demo)" },
    { "key": "day1_go_no_go", "name": { "en": "Day-1 go/no-go decision", "ar": "قرار المضي أو عدمه لليوم الأول" }, "maxAmount": null, "currency": "SAR", "unitScale": 1, "withinCommitteeAuthority": true, "escalateTo": "Not applicable — within committee authority (demo)" },
    { "key": "tsa_approval_or_extension", "name": { "en": "Approve a TSA or a TSA extension", "ar": "اعتماد اتفاقية خدمات انتقالية أو تمديدها" }, "maxAmount": "2000000.0000", "currency": "SAR", "unitScale": 1, "withinCommitteeAuthority": true, "escalateTo": "Delegating authority — to be confirmed" },
    { "key": "partner_outreach_and_access", "name": { "en": "Approve partner outreach and materials access", "ar": "اعتماد التواصل مع الشريك ومنحه الوصول إلى المواد" }, "maxAmount": null, "currency": "SAR", "unitScale": 1, "withinCommitteeAuthority": true, "escalateTo": "Not applicable — within committee authority (demo)" },
    { "key": "criterion_waiver", "name": { "en": "Approve a waiver of a waivable gate criterion", "ar": "اعتماد الإعفاء من معيار بوابة قابل للإعفاء" }, "maxAmount": null, "currency": "SAR", "unitScale": 1, "withinCommitteeAuthority": true, "escalateTo": "Not applicable — within committee authority (demo)" },
    { "key": "preferred_partner_selection", "name": { "en": "Select the preferred partner", "ar": "اختيار الشريك المفضل" }, "maxAmount": null, "currency": "SAR", "unitScale": 1, "withinCommitteeAuthority": false, "escalateTo": "Board of Directors — to be confirmed" },
    { "key": "valuation_and_ownership_terms", "name": { "en": "Approve valuation and ownership terms", "ar": "اعتماد التقييم وشروط الملكية" }, "maxAmount": null, "currency": "SAR", "unitScale": 1, "withinCommitteeAuthority": false, "escalateTo": "Board of Directors — to be confirmed" },
    { "key": "jv_signing_authorization", "name": { "en": "Authorize JV signing", "ar": "تفويض توقيع المشروع المشترك" }, "maxAmount": null, "currency": "SAR", "unitScale": 1, "withinCommitteeAuthority": false, "escalateTo": "Board of Directors — to be confirmed" },
    { "key": "jv_closing_confirmation", "name": { "en": "Confirm a JV closing", "ar": "تأكيد إتمام المشروع المشترك" }, "maxAmount": null, "currency": "SAR", "unitScale": 1, "withinCommitteeAuthority": false, "escalateTo": "Board of Directors — to be confirmed" },
    { "key": "opening_balance_sheet", "name": { "en": "Approve the opening balance sheet", "ar": "اعتماد الميزانية الافتتاحية" }, "maxAmount": null, "currency": "SAR", "unitScale": 1, "withinCommitteeAuthority": false, "escalateTo": "NewCo board / authorized finance approver — to be confirmed" },
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
