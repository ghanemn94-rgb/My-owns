# Assumptions and open questions

Status legend: **A-** = assumption used for reversible engineering work · **Q-** = question for Mobily (non-blocking
unless marked). Each item names the part of the build it affects so that only that step waits for an answer (spec §1
rules 3–4).

## Consolidated critical questions for Mobily (single list)

| ID | Question | Owner (role) | Blocks | Current handling |
|---|---|---|---|---|
| Q-01 | Who chairs the DC Carve-out & JV Steering Committee, and who are its voting members? | Sponsor / Corporate Governance | Activating production approval authority | Charter uses "Role — To be confirmed"; demo users only |
| Q-02 | What is the approved delegation / authority matrix (decision types, limits, quorum, threshold, tie rule)? | Corporate Governance / Legal | Production committee approvals (spec §4.1) | A clearly labelled **Demo policy** ships; production authority stays inactive until an approved matrix is loaded |
| Q-03 | Target hosting environment (private cloud / on-prem Kubernetes / OpenShift), registry, storage class, ingress, certificates? | IT Infrastructure | Production deployment (P7/P8) | Helm chart + Compose + runbooks prepared for customization |
| Q-04 | Identity provider (Entra ID / ADFS / Keycloak / other), OIDC client registration, MFA policy, group→role mapping? | IAM | Production login | OIDC adapter implemented; dev login only in demo mode |
| Q-05 | Is any AI processing permitted? If yes: local model endpoint or approved gateway, data classification ceiling, retention, processing locations? | Cybersecurity / Data Governance | AI modes other than Off in production | Default AI mode Off; mock provider labelled Simulated |
| Q-06 | Data classification scheme names and handling rules (do Mobily levels map to public/internal/confidential/restricted/strictly confidential)? | Data Governance | Classification labels in production | Five-level proposal, configurable |
| Q-07 | Retention periods and legal-hold procedure for committee minutes, transaction documents, audit logs | Legal / Records Management | Disposal jobs | Retention fields + legal hold enforced; no automatic disposal |
| Q-08 | Confirmed expansions of ATA, MSA, CST and DCCo as used in the programme | Legal / PMO | Labels only | Kept as abbreviations; proposed expansions flagged "to be confirmed" |
| Q-09 | Current NewCo incorporation status and evidence | Legal | Incorporation dimension of the real project | Status "Unconfirmed" until evidence is uploaded on an approved environment |
| Q-10 | Approved route for loading real sources (image/Excel/minutes) into an approved environment | Data Governance / PMO | Real-data onboarding | Synthetic data only in this build |
| Q-11 | Corporate holidays calendar and whether Sunday–Thursday is the working week for all workstreams | PMO / HR | Schedule accuracy | Proposed Sun–Thu, editable holidays per project |
| Q-12 | SIEM / log-export destination for audit events | Cybersecurity | Independent audit store | Export job + format documented |
| Q-13 | Email/Teams sending authority and approved destinations | IT / Communications | External notifications | All external channels disabled; in-app only |
| Q-14 | Official Mobily branding assets (logo, colours) permitted in the tool | Brand / Communications | Visual identity | Restrained blue/white theme, no logo fabricated |

## Engineering assumptions (reversible)

| ID | Assumption | Where it applies | How to reverse |
|---|---|---|---|
| A-01 | The reference image and Excel workbook are unavailable; the prompt's summary is second-hand preliminary input | Source register, template | Upload real sources through the runtime Source Register |
| A-02 | One organization tenant per deployment is typical; schema supports several | Identity, RLS | n/a |
| A-03 | A committee is anchored to one project (the programme's main project) for isolation; it may reference a programme | Governance | Add a programme-scope committee model if cross-project committees are needed |
| A-04 | Sites are project-scoped records (the same physical site in two projects is two records) | Portfolio | Promote site to org level with project links |
| A-05 | Decision requester may not vote on their own decision when the policy says self-approval is prohibited | Governance | Policy flag in authority matrix |
| A-06 | Recused members are excluded from the quorum COUNT of the item (they cannot make up its quorum); the quorum fraction is taken over all appointed voting members (corrected in P2, DOM-P2-13: this entry used to say "denominator", which contradicted `authority-matrix.md` §3 step 4 — see A-42) | Governance | Policy flag |
| A-07 | Business dates use the Gregorian calendar in Asia/Riyadh; Hijri display is a future option | UI, calendar | Add calendar display preference |
| A-08 | Five-level classification (public → strictly confidential) with user clearance | Security | Configure labels |
| A-09 | Gate criteria are *proposed* and default to non-waivable until a specialist sets waivability and waiver authority | Gates | Specialist updates criteria through admin |
| A-10 | Weighted progress uses integer deliverable weights 1–5 as proposed defaults; weights must be approved per project | Measurement | Edit weights; approval flag |
| A-11 | RAG thresholds default: green ≤ 0 working-day slip, amber ≤ 10, red > 10; stale after 14 days | Measurement | Project settings |
| A-12 | PostgreSQL full-text search (`simple` config) is adequate for bilingual retrieval at pilot scale; embeddings optional | AI | Add pgvector adapter |
| A-13 | NestJS 11.2 (CJS) + TypeScript 5.9 rather than NestJS 12 (ESM-only) / TS 7 | Architecture | Planned upgrade (ADR-0002) |
| A-14 | Demo monetary values use a fictional unit label "DEMO-SAR" in narrative and currency code SAR in data, always with the Demo flag | Demo sandbox | Excluded from real reporting by `is_demo` |

## Additional assumptions from P0 domain design (carveout-domain-analyst)

| ID | Assumption | Where it applies |
|---|---|---|
| A-15 | G0 (mandate & governance) is approved by the Sponsor, not the committee (a committee cannot approve its own mandate) | Gates template |
| A-16 | Gate prerequisites: G2 requires G1; G5 requires only G1 (JV preparation runs in parallel with separation, spec §3); G6 requires G5; G7 requires G4 and G6. Whether closing needs separation completed is expressed as deal-specific CPs, not a fixed gate link | Gates template |
| A-17 | "Blocking" criteria are always mandatory; unmet non-mandatory criteria are observations | Gate evaluation |
| A-18 | Only two criteria are proposed as waivable (G3-C08 cutover rehearsal, G5-C01 partner comparative assessment), pending specialist confirmation; all others default non-waivable | Gates template |
| A-19 | Requester/owner of an item may not vote on it and does not count toward its quorum; the same person may not both record and confirm an external decision; an action owner may not verify their own action | Governance |
| A-20 | A non-demo project with no approved authority matrix cannot progress a decision beyond "Recommended — pending external authority" | Governance |
| A-21 | Proposed abbreviation expansions (to be confirmed): ATA = Asset Transfer Agreement; MSA = Master Services Agreement; CST = Communications, Space and Technology Commission; DCCo = Data Center Company | Glossary / labels (Q-08) |
| A-22 | WBS durations are "assumed" where given; regulator/counterparty-dependent activities are TBD (so the real schedule is "Incomplete" until owners supply durations) | Template WBS |
| A-23 | Secretary and CPMO are treated as one role (`secretary_cpmo`) until the charter separates them | Roles |

## Additional open questions from the requirements analysis (delivery-orchestrator draft)

| ID | Question | Current handling |
|---|---|---|
| Q-15 | Could any G5/G6 decision fall within the committee's delegated authority, or are they always reserved? | Demo policy reserves JV signing/closing to a higher authority |
| Q-16 | Tie, alternate and proxy rules; quorum/threshold for resolutions by circulation | Demo policy: ties escalate; circulation uses the same quorum/threshold |
| Q-17 | Does the opening balance sheet also require a NewCo board resolution? | Modelled as evidence type `board_resolution` where applicable |
| Q-18 | Data room: minimal internal VDR (implemented) or integration with an approved external VDR? | Internal access-controlled partner rooms implemented; VDR adapter documented |
| Q-19 | Who approves deliverable weights, and what applies before approval? | Weights default 1–5 (proposed) and are flagged unapproved until approved |
| Q-20 | Multiple closings: tranches or per-entity? | Model supports ordered sequences of signing/closing events |
| Q-21 | Which "low-impact" actions may be allowlisted for AI autopilot? | Autopilot-eligible list limited to internal notifications, update requests, status drafts, risk flags; requires approved policy |
| Q-22 | Performance / availability / RPO / RTO targets | PRD proposals (e.g. RPO ≤ 1 h, RTO ≤ 8 h) pending Mobily infrastructure approval |

## P2 domain review — governance / authority rules (implementation 2026-09-30)

Rules made explicit while fixing DOM-P2-02, -03, -06, -12, -13 and -20 (`docs/reviews/P2-domain-review.md`). They are the
current written rules of this build (`docs/governance/authority-matrix.md` §3, §3.1; `committee-charter-draft.md` §10–14),
not Mobily determinations; each can be changed once the governance owner decides.

| ID | Assumption | Where it applies | How to reverse |
|---|---|---|---|
| A-40 | **Abstentions count as not approving.** The threshold is measured over the eligible votes cast (approve + reject + abstain); present members who do not vote are not counted; a round with abstentions only records no outcome | `packages/domain/src/governance.ts` `tallyVotes` | Alternative (Q-40): abstentions not counted (majority of approve vs reject votes cast), or denominator = eligible members present; make it an approved matrix parameter (`abstentionsCountAs`) |
| A-41 | **Casting vote** = the side the chair voted for prevails in a tie; the chair has no second vote; a chair who abstained, did not vote or is not eligible for the item cannot break the tie (escalated) | `tallyVotes` | Alternative (Q-41): an additional casting vote cast after the tie is declared |
| A-42 | **Quorum fraction over appointed voting members** — voting seats held by a named person on the meeting date; vacant seats not counted; recused members and the requester stay in the denominator | `computeQuorum` | Q-42: count vacant seats (stricter) or exclude recused members from the denominator |
| A-43 | **Individual approvals of baselines and change requests** by holders of `planning.baseline.approve` / `planning.change_request.approve` exercise the governing steering committee's delegation for `baseline_approval` / `change_request_budget`; outside it they need a final committee decision (recommendation → external approval). A change request's monetary impact is its structured `costImpact`; a cost stated in text only blocks approval until quantified; a baseline's is its approved budget total | `apps/api/src/modules/planning/change-control.service.ts`, `evaluateDelegatedApproval` | Q-43: every baseline / change request by committee vote only; add schedule-impact limits or individual delegation levels to the matrix structure |
| A-44 | In a **demo** project without any approved matrix, the labelled DEMO policy governs change-control approvals (sandbox); a non-demo project is refused | `governingMatrix` | Remove the sandbox fallback (demo projects would then also need an approved DEMO matrix) |
| A-45 | **Rejections** of baseline proposals and change requests are within the approver's role (the matrix limits approvals only) | change control | Evaluate the matrix for rejections too |
| A-46 | **Attendance is frozen** while an item tabled at the meeting has votes in its current round and no outcome; corrections after voting = record the outcome, or restart the round (defer → resume) | `MeetingsService.recordAttendance` | An audited correction command that recomputes quorum and flags the decision |
| A-47 | **Evidence of approvals**: a non-demo matrix approval needs the approval document and a second-person verification (holder of `documents.evidence.verify`, not drafter / approver / uploader) before it is in force; an external authority decision needs a verified evidence link on the decision, verifier ≠ recorder. The DEMO policy (demo projects only) is exempt | `CommitteesService`, `DecisionsService.recordExternalApproval` | Q-44: which function verifies approval records (Legal / Corporate Secretary) — add a dedicated permission |
| A-48 | **No recusal after voting** in the same round (own or on behalf); on-behalf recusals need a reason and are audited with the recorder | `GovernanceSupport.insertRecusal` | Allow a member-initiated vote withdrawal (new append-only record) followed by the recusal |
| A-49 | **Closing the vote (DOM-P2R-01), proposed:** an outcome is recorded only when every eligible member expected to vote has voted (meeting: present; circulation: all appointed), or the chair closed voting with a reason, or (circulation) the deadline passed; non-voters are listed and not counted | `DecisionsService.recordOutcome` / `closeVoting`, domain `assertVotingComplete` | Q-40: count present non-voters as not approving instead; allow the secretariat to close on the chair's instruction |
| A-50 | **Declarations before voting (REQ-GOV-015), proposed:** the member's own "no conflict" or declared interest for the item precedes the vote; on-behalf declarations do not count; a declared interest without a chair's ruling may vote | `DecisionsService.castVote`, domain `assertConflictDeclared` | Q-40: whether a declared interest requires a chair ruling before the member votes |
| A-51 | **Requester-stated cost impact (DOM-P2R-02), conservative option:** decides delegated authority only once an assessor other than the requester records or confirms it; a stated figure can still refuse an approval | `ChangeControlService` (`costImpactRecordedBy`), domain `evaluateDelegatedApproval` | Q-43: require Finance specifically as the assessor when a cost is stated; or a stated-vs-quantified discrepancy flag instead |
| A-52 | **One decision per record:** a decision paper names its subject (change request / baseline version / perimeter version), fixed from submission; a perimeter version needs a G1 decision that backed no other version; a gate decision linked to any earlier cycle (approved **or rejected**) cannot back a later cycle | `DecisionsService`, `ChangeControlService.evaluateAuthority`, `PerimeterVersionsService.approve`, `GatesService.decide` | O-1 (QA): confirm the rejected-cycle case; allow one decision to authorize several records explicitly |
| A-53 | **Prerequisite removal (DOM-P2R-07):** a reason is required; while it still blocks, the person accountable for the task / milestone (task `accountableUserId`, milestone owner) cannot remove it | `PrerequisiteService.remove` | Route removals on baselined tasks through change control |

| ID | Question | Owner (role) | Current handling |
|---|---|---|---|
| Q-40 | Do abstentions count as "not approving" (current documented rule) or are they excluded from the threshold? When does voting close, and do present members who did not vote count (DOM-P2R-01)? Must a declared interest be ruled on by the chair before the member votes (REQ-GOV-015)? | Corporate Governance / governance owner — Assessment pending | A-40, A-49, A-50 (documented proposals implemented) |
| Q-41 | Does the chair have an additional casting vote, or does the side the chair voted for prevail? | Corporate Governance | A-41; the Demo policy escalates ties |
| Q-42 | Do vacant voting seats count in the quorum fraction? Do recused members stay in its denominator? | Corporate Governance | A-42 |
| Q-43 | May an individual approver (sponsor / chair) approve a baseline or change request within the committee's delegation, or must each go to a committee vote? Are there schedule-impact limits? | Corporate Governance / PMO | A-43 |
| Q-44 | Which function verifies the approval record of a delegation matrix and of external authority decisions? | Corporate Secretary / Legal | A-47 (any holder of `documents.evidence.verify`, with separation of duties) |
