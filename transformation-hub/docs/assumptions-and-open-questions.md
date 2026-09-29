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
| A-06 | Recused members are excluded from the quorum denominator (demo policy flag) | Governance | Policy flag |
| A-07 | Business dates use the Gregorian calendar in Asia/Riyadh; Hijri display is a future option | UI, calendar | Add calendar display preference |
| A-08 | Five-level classification (public → strictly confidential) with user clearance | Security | Configure labels |
| A-09 | Gate criteria are *proposed* and default to non-waivable until a specialist sets waivability and waiver authority | Gates | Specialist updates criteria through admin |
| A-10 | Weighted progress uses integer deliverable weights 1–5 as proposed defaults; weights must be approved per project | Measurement | Edit weights; approval flag |
| A-11 | RAG thresholds default: green ≤ 0 working-day slip, amber ≤ 10, red > 10; stale after 14 days | Measurement | Project settings |
| A-12 | PostgreSQL full-text search (`simple` config) is adequate for bilingual retrieval at pilot scale; embeddings optional | AI | Add pgvector adapter |
| A-13 | NestJS 11.2 (CJS) + TypeScript 5.9 rather than NestJS 12 (ESM-only) / TS 7 | Architecture | Planned upgrade (ADR-0002) |
| A-14 | Demo monetary values use a fictional unit label "DEMO-SAR" in narrative and currency code SAR in data, always with the Demo flag | Demo sandbox | Excluded from real reporting by `is_demo` |
