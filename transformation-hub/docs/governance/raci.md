# RACI — Workstreams, Gates and Key Decisions

# مصفوفة المسؤوليات — مسارات العمل والبوابات والقرارات الرئيسية

> **Status: proposed (P0).** Functions are listed by name only; no individuals are assigned. The actual organizational
> structure may merge or split functions. The workstream matrix below is identical to the `raci` arrays in
> `packages/db/seed/templates/dc-carveout.v1.json`, which is the machine-readable source.

## Legend (المفتاح)

| Code | Meaning | Arabic |
|---|---|---|
| **R** | Responsible — does the work | المسؤول عن التنفيذ |
| **A** | Accountable — owns the outcome and signs it off; exactly one per row (and also carries out the work unless another function is R) | المساءل |
| **C** | Consulted — two-way input before decisions | المُستشار |
| **I** | Informed — kept up to date | المُبلَّغ |

Function names (proposed): CPMO (Corporate PMO / committee secretariat), Strategy & DC Business, Finance, Legal,
Regulatory, Technology & IT, Cybersecurity, Operations, HR, Procurement, Commercial, Corporate Development.

## 1. Workstream RACI (12 workstreams × functions)

| Workstream | CPMO | Strategy & DC Business | Finance | Legal | Regulatory | Technology & IT | Cybersecurity | Operations | HR | Procurement | Commercial | Corporate Development |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| WS01 Program Governance & PMO | A | C | C | C | I | I | C | I | I | I | I | C |
| WS02 Strategy & Transaction Perimeter | I | A | R | C | C | R | I | R | C | C | R | C |
| WS03 Corporate Legal & Regulatory | I | C | C | A | R | I | I | I | C | C | C | C |
| WS04 Finance, Tax & Accounting | I | C | A | C | I | C | I | I | C | C | C | C |
| WS05 Assets, Sites & Facilities | I | C | R | R | C | C | C | A | I | C | I | I |
| WS06 Technology, Data & Cybersecurity | I | I | C | C | C | A | R | C | C | C | I | I |
| WS07 Operations, Continuity & TSA | I | C | C | C | I | R | C | A | C | C | C | I |
| WS08 People & Organization | I | C | C | C | I | C | I | C | A | I | I | I |
| WS09 Commercial, Customers & GTM | I | C | R | C | C | C | I | C | I | I | A | C |
| WS10 Procurement & Suppliers | I | I | C | C | I | C | I | C | I | A | I | I |
| WS11 Business Plan, Valuation & Partner Process | I | C | R | C | C | I | C | C | I | I | C | A |
| WS12 JV Execution & Post-close | C | C | R | R | C | I | I | C | C | I | I | A |

Notes:
- **CPMO is Informed on most delivery workstreams** because it receives their weekly updates and consolidates reporting
  through WS01. It is Consulted on WS12 because post-close handover and program closure run through WS01.
- **Tax and zakat** sit under Finance (WS04) with specialist assessment; the platform records the assessment and makes
  no determination.
- **Cybersecurity** is Responsible in WS06 (control applicability, security readiness test) and Consulted where
  physical security (WS05), clean-team/VDR access (WS11) or classification (WS01) are involved.
- Individual WBS activities name a `proposedOwnerFunction` that may differ from the workstream's accountable function
  (e.g. title review in WS05 is owned by Legal).

## 2. Platform role mapping (ربط الأدوار بالمنصة)

| Platform role (`roleKey`) | Typical holder | Main RACI use |
|---|---|---|
| `sponsor` | Program sponsor — Role — To be confirmed | A for G0 approval; escalation target |
| `committee_chair` | Chair acting for the committee under delegated authority | A for gate decisions G1–G7 within delegation |
| `secretary_cpmo` | Committee secretary / CPMO | R for packs, minutes, actions; owner of G0 |
| `project_manager` | Program manager | R for integrated plan, gate assessments G3 and G7 |
| `workstream_lead` | Lead of the accountable function for a workstream | R for workstream deliverables and gate evidence |
| `functional_approver` | Authorized specialist (Finance, Legal, Regulatory, Cyber, Operations, HR) | Reviews and signs off evidence; applicability and waivability assessments |
| `finance_restricted` / `legal_restricted` | Finance / Legal users with restricted data access | Evidence owners for financial and legal criteria |
| `clean_team` | Clean team members | Access to competitively sensitive partner material only |
| `auditor` | Internal audit / assurance | I on all gates; reviewer of G7 records archiving |
| `external_partner_limited` | Partner users in a partner room | No RACI role in internal decisions |

## 3. Gate decision RACI (G0–G7)

R = prepares the assessment and evidence; C = reviews evidence; A = gives the gate decision; I = informed.
"Specialists" means the functional approvers named by the gate's criteria.

| Gate | R (gate owner) | C (reviewer + specialists) | A (approver) | I | Beyond delegation |
|---|---|---|---|---|---|
| G0 Mandate & Governance | Secretary / CPMO | Project manager; Legal (charter, authority matrix) | Sponsor, on behalf of the delegating authority | Committee members, auditor | Charter and matrix approval by the delegating authority |
| G1 Perimeter & Strategy | Workstream lead (WS02) | Project manager; Finance, Legal, Tax (specialist-assessed) | Committee chair (committee) | Sponsor, all workstream leads | Escalate if the matrix reserves strategy approval |
| G2 Incorporation & Enablers | Legal | Functional approvers (Legal, Regulatory, Finance) | Committee chair (committee) | Sponsor, WS04, WS06 | Regulatory determinations remain with specialists |
| G3 Separation & Day-1 Readiness | Project manager | Functional approvers (Operations, IT, Cyber, HR, Finance, Commercial, Legal) | Committee chair (committee) — Day-1 go/no-go | Sponsor, all workstream leads | Escalate if outside delegation |
| G4 Standalone Acceptance | Workstream lead (WS07) | Functional approvers (Operations, Finance) | Committee chair (committee) | Sponsor | Opening balance sheet approval is outside the committee in the Demo policy |
| G5 JV Signing Readiness | Workstream lead (WS11) | Finance (restricted), Legal, Regulatory | Committee chair (committee) — recommendation | Sponsor | Signing authorization escalated (Board of Directors — to be confirmed) |
| G6 JV Closing | Workstream lead (WS12) | Legal (restricted), Finance | Committee chair (committee) — recommendation | Sponsor, auditor | Closing confirmation by the authorized body |
| G7 Stabilization & Handover | Project manager | Secretary / CPMO; business-as-usual owners; auditor | Committee chair (committee) | Sponsor | — |

## 4. Key decision RACI (القرارات الرئيسية)

| Decision | R | C | A | I |
|---|---|---|---|---|
| Perimeter change after baseline (change request) | WS02 lead | Finance, Legal, Operations, Corporate Development | Committee (within limit) / delegating authority (above) | All workstream leads |
| Criterion waiver (waivable criteria only) | Criterion owner (requester) | Specialist named in `waivabilityBasis`; Legal | Holder of `waiverAuthorityRole` — never the requester | Gate owner, auditor |
| Day-1 go/no-go | WS07 lead | All readiness sign-off specialists | Committee | Sponsor, all workstream leads |
| TSA approval or extension | WS07 lead | Finance, Legal, Procurement | Committee (within limit) | Sponsor |
| Partner outreach and materials access | WS11 lead | Legal (clean team), Cybersecurity (VDR) | Committee | Secretary / CPMO |
| Preferred partner selection | WS11 lead | Finance, Legal, Strategy | Board of Directors — to be confirmed (committee recommends) | Sponsor |
| CP waiver | Legal (WS12) | Finance, Corporate Development | Party entitled under the agreement, within approved authority | Committee, auditor |
| JV signing and closing confirmation | WS12 lead | Legal, Finance | Authorized body per matrix (committee recommends) | Sponsor, auditor |
| Opening balance sheet | Finance | Legal, external specialist where engaged | Authorized finance approver / NewCo board — to be confirmed | Committee |
| Action closure verification | Action owner | — | Verifier different from the action owner (Secretary / CPMO by default) | Committee |
