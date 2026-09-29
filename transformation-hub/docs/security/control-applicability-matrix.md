# Control Applicability Matrix — Cybersecurity, Data Protection and Sector Requirements

> **This is NOT a declaration of compliance.** It is a working matrix of *potentially relevant* control areas, for Mobily's functions to assess.
> - It does not state that any requirement applies, or that the platform or Mobily meets any requirement.
> - Every applicability decision belongs to the named Mobily function. Every row's status is **Not assessed**.
> - Control areas are referenced at the level of domains/areas only. **No control numbers or clause texts are quoted.** Where a precise reference is needed, it reads *"control reference to be confirmed by Mobily Cybersecurity"* (or the relevant function).
> - Framework names and versions must be verified against the current official publications (NCA, SDAIA, CST) during assessment. Publications change.

| Field | Value |
|---|---|
| Version / date | 0.1 (P0 draft), 2026-09-29 |
| Author | security-privacy-reviewer (authoring mode); independent review required |
| Spec | Master prompt §15 ("compliance applicability matrix … not automatic declarations of compliance"), §16, reference list (NCA ECC, NCA DCC, SDAIA) |
| Platform capability status | Every capability below is **Designed (P0)**, not implemented. The phase in which the evidence becomes producible is shown as *(Pn)*. Evidence items are **Planned** until produced and verified. |
| Companion docs | `threat-model.md` (controls C-xx, data flows DF-xx), `access-matrix.md`, `ai-threat-cases.md`, `incident-response-runbook.md` |

**Columns:**
- **Area**: source and control area.
- **Potential requirement**: paraphrased; not quoted.
- **Applicability status**: always "To be assessed by Mobily ⟨function⟩".
- **Platform capability that may support it**: references design controls.
- **Evidence the platform can produce**: planned.
- **Control owner**: Role — to be confirmed.
- **Status**: always "Not assessed".

---

## 1. NCA Essential Cybersecurity Controls (ECC)

*Current ECC version and control references are to be confirmed by Mobily Cybersecurity. The areas are grouped by the ECC main domains: governance, defence, resilience, third-party and cloud, industrial control systems.*

| # | Area | Potential requirement (paraphrased) | Applicability status | Platform capability that may support it | Evidence the platform can produce | Control owner (Role — to be confirmed) | Status |
|---|---|---|---|---|---|---|---|
| ECC-01 | Governance — cybersecurity roles, responsibilities and policies (control reference to be confirmed by Mobily Cybersecurity) | Security responsibilities for a new business system are defined and aligned with approved policies | To be assessed by Mobily Cybersecurity | Documented role model with separation of platform administration from content access (access-matrix §3); agent/reviewer separation in delivery | `access-matrix.md`; role-assignment export (P1); phase review reports | Cybersecurity Governance lead — to be confirmed | Not assessed |
| ECC-02 | Governance — cybersecurity risk management (reference TBC) | New systems undergo documented risk assessment, with risk treatment and acceptance by an accountable owner | To be assessed by Mobily Cybersecurity | STRIDE threat model with inherent ratings, controls, residual risks (RR-xx), open questions (MQ-xx) | `threat-model.md`; residual-risk register; security review reports per phase | Cybersecurity Risk — to be confirmed | Not assessed |
| ECC-03 | Governance — cybersecurity in information technology projects / secure development (reference TBC) | Security requirements, secure coding and security testing are embedded in the project lifecycle before go-live | To be assessed by Mobily Cybersecurity | Phase gates with independent security review; named security tests SEC-T-xx; dependency/SBOM/image scanning (C-38); config validation rejecting unsafe production settings (C-04) | Phase gate reports with real test results (P1–P8); CI logs; SBOM and scan reports (P7) | Application Security — to be confirmed | Not assessed |
| ECC-04 | Governance — compliance with legislation and regulations (reference TBC) | Applicable laws and regulations are identified and tracked for the system | To be assessed by Mobily Cybersecurity with Legal | This matrix; the NewCo/regulatory register can also hold assessment items (newco module) | This matrix with assessed statuses (after Mobily input) | Compliance — to be confirmed | Not assessed |
| ECC-05 | Governance — periodic cybersecurity review and audit (reference TBC) | Security controls of the system are reviewed and audited periodically | To be assessed by Mobily Cybersecurity / Internal Audit | Read-only `auditor` role; audit export with hash-chain proof (C-10); chain verification; access-review report (C-45) | Audit extracts and chain-verification report (P7); access-review report (P7) | Internal Audit — to be confirmed | Not assessed |
| ECC-06 | Governance — cybersecurity in human resources (joiners/movers/leavers) (reference TBC) | Access is granted, changed and removed in line with employment status | To be assessed by Mobily Cybersecurity with HR | IdP-bound accounts ((iss, sub)); session revocation; account disable; expiring grants; access review (C-01, C-02, C-45) | Security events for account and role changes (P1); dormant-account report (P7) | IAM — to be confirmed | Not assessed |
| ECC-07 | Governance — awareness and training (reference TBC) | Users receive security awareness relevant to the system | To be assessed by Mobily Cybersecurity | User guides include handling rules for classification, partner rooms and AI use (P8) | Arabic/English user guides (P8) | Security Awareness — to be confirmed | Not assessed |
| ECC-08 | Defence — asset management (reference TBC) | System components and dependencies are inventoried | To be assessed by Mobily Cybersecurity | SBOM; Helm/compose manifests; integration register with honest status | SBOM (P7); deployment manifests (P7); integration status page (P6) | IT Asset Management — to be confirmed | Not assessed |
| ECC-09 | Defence — identity and access management (reference TBC) | Unique identities, MFA, least privilege, privileged-access control and periodic review | To be assessed by Mobily Cybersecurity | OIDC with MFA at the IdP (C-01); server-side sessions (C-02); deny-by-default RBAC + ABAC (C-05, C-06); admin/content separation; `not_self`; step-up for high-impact actions (C-46, proposed) | Access matrix; SEC-T-01/03/10/11/28/29 results (P1–P4); role and grant exports; security events | IAM — to be confirmed | Not assessed |
| ECC-10 | Defence — information system and processing facilities protection (malware, hardening) (reference TBC) | Systems are hardened and protected against malware | To be assessed by Mobily Cybersecurity | Upload quarantine and scanner adapter (C-14, D-10); non-root, read-only containers (C-38); sandboxed conversion (C-44) | Config-validation output; scan logs; SEC-T-16/36 results (P2–P7) | Infrastructure Security — to be confirmed | Not assessed |
| ECC-11 | Defence — email protection (reference TBC) | Email channels are protected against phishing and misuse | To be assessed by Mobily Cybersecurity | Platform sends only through Mobily's relay; notifications minimised; no approval via email link or reply (C-33) | Notification policy configuration; SEC-T-33 (P6) | Messaging Security — to be confirmed | Not assessed |
| ECC-12 | Defence — network security management (segmentation, egress) (reference TBC) | Network access is segmented and outbound traffic restricted | To be assessed by Mobily Cybersecurity | Private mode with default-deny egress and allowlist; in-app egress guard; no external fonts, CDNs or telemetry (C-18) | NetworkPolicy manifests (P7); AT-22 / SEC-T-19 results (P7) | Network Security — to be confirmed | Not assessed |
| ECC-13 | Defence — mobile devices (reference TBC) | Access from mobile devices is controlled | To be assessed by Mobily Cybersecurity | Responsive web only; `no-store` caching; session lifetimes; no offline content caching (C-26) | SEC-T-23 results | Endpoint Security — to be confirmed | Not assessed |
| ECC-14 | Defence — data and information protection (reference TBC) | Data is protected according to its classification | To be assessed by Mobily Cybersecurity with Data Governance | Five-level classification, clearance, room and clean-team conditions; derived-data classification; audited sensitive reads (access-matrix §2) | Classification distribution report (P2); audit of sensitive reads (P2/P4) | Data Protection — to be confirmed | Not assessed |
| ECC-15 | Defence — cryptography (reference TBC) | Approved cryptography protects data in transit and at rest, with managed keys | To be assessed by Mobily Cybersecurity | TLS at ingress (P7); session-token hashing and HMAC-bound CSRF (C-02, C-03); relies on Mobily-provided DB, object and backup encryption and KMS (MQ-17) | TLS configuration (P7); key-management evidence comes from Mobily infrastructure | Cryptography / PKI — to be confirmed | Not assessed |
| ECC-16 | Defence — backup and recovery management (reference TBC) | Backups are taken, protected and restore-tested | To be assessed by Mobily Cybersecurity with IT Operations | Backup/restore runbook with session invalidation and job quiescence (C-34) | Restore test report with measured recovery (AT-23, P7) | IT Operations — to be confirmed | Not assessed |
| ECC-17 | Defence — vulnerability management (reference TBC) | Vulnerabilities are identified and remediated on schedule | To be assessed by Mobily Cybersecurity | Dependency and image scanning, SBOM, update procedure (C-38) | Scan reports; upgrade runbook (P7) | Vulnerability Management — to be confirmed | Not assessed |
| ECC-18 | Defence — penetration testing (reference TBC) | Systems are penetration-tested before and after significant change | To be assessed by Mobily Cybersecurity | Test environment with synthetic data; SEC-T catalogue as scope input | Pen-test report (Mobily-commissioned; MQ-18) | Offensive Security — to be confirmed | Not assessed |
| ECC-19 | Defence — cybersecurity event logs and monitoring (reference TBC) | Security events are logged, protected and monitored centrally | To be assessed by Mobily Cybersecurity (SOC) | Append-only, hash-chained `audit_event`; security events; export to external log store/SIEM with minimised payloads (C-10, C-11) | Export samples; chain-verification report; event catalogue (P7) | SOC — to be confirmed | Not assessed |
| ECC-20 | Defence — cybersecurity incident and threat management (reference TBC) | Incidents are detected, contained, investigated and reported | To be assessed by Mobily Cybersecurity (SOC/CSIRT) | Application IR runbook with in-product containment (revoke sessions, suspend user or external access, lock room, AI kill switch, disable connector) | `incident-response-runbook.md`; tabletop exercise record (P7) | CSIRT — to be confirmed | Not assessed |
| ECC-21 | Defence — physical security (reference TBC) | Physical protection of processing facilities | To be assessed by Mobily Cybersecurity (infrastructure scope) | Not an application capability | Infrastructure evidence from Mobily | Facilities Security — to be confirmed | Not assessed |
| ECC-22 | Defence — web application security (reference TBC) | Web applications are protected against common attacks and use secure architecture | To be assessed by Mobily Cybersecurity | CSP and headers (C-26); CSRF (C-03); contract validation; query safety (C-47); output encoding (C-27); rate limits (C-28); WAF at ingress (Mobily) | SEC-T-12/16/23/24/26/41 results (P1–P6) | Application Security — to be confirmed | Not assessed |
| ECC-23 | Resilience — cybersecurity aspects of business continuity (reference TBC) | Critical services continue or recover under cyber events | To be assessed by Mobily Cybersecurity with BCM | Operation with AI Off, over budget or provider down (AT-21); restore (AT-23); degraded modes | AT-21 and AT-23 results (P5/P7) | Business Continuity — to be confirmed | Not assessed |
| ECC-24 | Third-party and cloud — third-party cybersecurity (reference TBC) | Security requirements cover vendors, support providers and outsourced processing | To be assessed by Mobily Cybersecurity with Procurement | Separate data-flow register for AI processing, backups and support access (DF-07, DF-11, DF-12); support-access controls (C-35); AI gateway (C-19) | Data-flow register (threat-model §4); AI gateway configuration export (P5) | Third-Party Risk — to be confirmed | Not assessed |
| ECC-25 | Third-party and cloud — cloud computing and hosting cybersecurity (reference TBC) | Cloud/hosting use meets security and data-location requirements | To be assessed by Mobily Cybersecurity | Portable deployment (Helm/compose), no SaaS dependency for core functions, egress control, configurable storage and backup targets | Deployment documentation (P7) | Cloud Security — to be confirmed | Not assessed |
| ECC-26 | Industrial control systems (reference TBC) | OT/ICS-specific protections | To be assessed by Mobily Cybersecurity | The platform is designed **without** any control over DC devices, networks or power (spec §7.4); it only records evidence | Architecture documentation showing no OT interfaces | OT Security — to be confirmed | Not assessed |

## 2. NCA Data Cybersecurity Controls (DCC)

*Current DCC version and control references are to be confirmed by Mobily Cybersecurity. Rows describe data-protection areas at a general level only.*

| # | Area | Potential requirement (paraphrased) | Applicability status | Platform capability that may support it | Evidence the platform can produce | Control owner (Role — to be confirmed) | Status |
|---|---|---|---|---|---|---|---|
| DCC-01 | Classification-based data protection (reference TBC) | Protection measures scale with the data classification level | To be assessed by Mobily Cybersecurity with Data Governance | Classification on documents and records, clearance checks, handling rules per level (threat-model §5.2); mapping to Mobily's scheme is pending (MQ-01) | Classification mapping table (after MQ-01); SEC-T-07 results (P2) | Data Governance — to be confirmed | Not assessed |
| DCC-02 | Data access privileges and need-to-know (reference TBC) | Access to classified data is limited to authorised need-to-know and reviewed | To be assessed by Mobily Cybersecurity | ABAC with room, clean-team and clearance grants that expire; 404 for out-of-scope; access-review report (C-06, C-45) | Grant and clearance exports; SEC-T-03/08/09 results (P1–P4) | IAM — to be confirmed | Not assessed |
| DCC-03 | Data leakage prevention (reference TBC) | Leakage channels are controlled and monitored | To be assessed by Mobily Cybersecurity | AI gateway ceilings and DLP (C-19); notification minimisation (C-33); audited downloads and exports; download watermark where supported (C-32); no copy prevention is promised | Audit of downloads and exports; gateway refusal log (P5) | Data Protection — to be confirmed | Not assessed |
| DCC-04 | Cryptographic protection of data by classification (reference TBC) | Encryption strength and key handling follow classification | To be assessed by Mobily Cybersecurity | TLS; infra encryption at rest (Mobily); field-level encryption for strictly_confidential is **not** designed and could be assessed (RR-01) | Configuration evidence (P7) | Cryptography — to be confirmed | Not assessed |
| DCC-05 | Secure data retention and disposal (reference TBC) | Data is retained per policy and disposed of securely, including copies | To be assessed by Mobily Cybersecurity with Records Management | Retention classes, legal hold, authority-conditioned disposal with audit (C-31); backup retention is Mobily's (MQ-09) | Disposal audit records; SEC-T-30 / AT-27 results (P3/P6) | Records Management — to be confirmed | Not assessed |
| DCC-06 | Data processed by third parties / outside the organisation (reference TBC) | Data shared with or processed by third parties is controlled | To be assessed by Mobily Cybersecurity | Data-flow register (DF-04, DF-07, DF-08, DF-11, DF-12); partner disclosure workflow with release approval and disclosure log | Disclosure log export (P4); data-flow register | Third-Party Risk — to be confirmed | Not assessed |
| DCC-07 | Data in non-production environments (reference TBC) | Production data is not used in development or test without protection | To be assessed by Mobily Cybersecurity | Synthetic Demo data only; `is_demo` flag; config separation; eval datasets synthetic only (AIT-34) | Seed/fixture documentation; config validation (P1) | Application Security — to be confirmed | Not assessed |
| DCC-08 | Data output channels (exports, printing, downloads) (reference TBC) | Outputs carry classification and are controlled | To be assessed by Mobily Cybersecurity | Reports and exports carry classification, as-of date and scope; audited export; formula-injection neutralisation (C-17) | Sample exports with labels (P6); audit records | Data Protection — to be confirmed | Not assessed |

## 3. Other NCA frameworks (applicability to be determined)

| # | Area | Potential requirement (paraphrased) | Applicability status | Platform capability that may support it | Evidence the platform can produce | Control owner (Role — to be confirmed) | Status |
|---|---|---|---|---|---|---|---|
| NCA-O1 | Cloud Cybersecurity Controls (if the selected hosting is a cloud service) (reference TBC) | Additional controls for cloud-hosted systems and cloud providers | To be assessed by Mobily Cybersecurity | Hosting-agnostic deployment; data-flow register | Deployment docs (P7) | Cloud Security — to be confirmed | Not assessed |
| NCA-O2 | Critical Systems Cybersecurity Controls (if the platform is designated a critical system) (reference TBC) | Enhanced controls for systems designated critical | To be assessed by Mobily Cybersecurity | Designed controls in `threat-model.md` §6 | As above | Cybersecurity Governance — to be confirmed | Not assessed |
| NCA-O3 | Telework cybersecurity controls (if staff use the platform remotely) (reference TBC) | Remote-access protections | To be assessed by Mobily Cybersecurity | IdP/MFA, session lifetimes, no offline content | Session configuration (P1/P7) | IAM — to be confirmed | Not assessed |

## 4. Saudi Personal Data Protection Law (PDPL, SDAIA) and implementing regulations

*The platform is not built to process customer subscriber data. It does process personal data of users (identity), employees (People/HR workstream transfer lists and allocations, if imported), committee members and partner contact persons. Specific articles and regulations are to be confirmed by the Mobily Privacy Office / Legal.*

| # | Area | Potential requirement (paraphrased) | Applicability status | Platform capability that may support it | Evidence the platform can produce | Control owner (Role — to be confirmed) | Status |
|---|---|---|---|---|---|---|---|
| PDPL-01 | Lawful basis and purpose limitation | Personal data is processed for defined, lawful purposes only | To be assessed by Mobily Privacy Office | Purpose-scoped modules; import templates marking personal-data fields; `hr` domain classification | Personal-data field inventory (P3) | Privacy Office — to be confirmed | Not assessed |
| PDPL-02 | Data minimisation | Only necessary personal data is collected | To be assessed by Mobily Privacy Office | Minimal IdP claims (DF-02); import mapping lets users exclude columns; guidance in import templates | Claims configuration; import templates (P6) | Privacy Office — to be confirmed | Not assessed |
| PDPL-03 | Transparency / privacy notice | Data subjects are informed about processing | To be assessed by Mobily Privacy Office / Legal | Configurable notice text on sign-in (planned) | Screenshot of notice (P8) | Privacy Office — to be confirmed | Not assessed |
| PDPL-04 | Data subject rights (access, correction, destruction) | Requests are handled within required timelines | To be assessed by Mobily Privacy Office | Admin export of a user's personal data (planned); correction via profile/admin. Destruction may conflict with audit and retention (append-only audit), so the resolution is Mobily's decision | Export sample (P7); documented conflict resolution | Privacy Office — to be confirmed | Not assessed |
| PDPL-05 | Retention and destruction of personal data | Personal data is kept only as long as necessary | To be assessed by Mobily Privacy Office / Records | Retention classes, disposal workflow (C-31); backup retention (MQ-09) | Retention configuration (P3/P6) | Records Management — to be confirmed | Not assessed |
| PDPL-06 | Security of personal data | Appropriate technical and organisational measures | To be assessed by Mobily Privacy Office with Cybersecurity | All controls in `threat-model.md` §6 | SEC-T results per phase | Cybersecurity — to be confirmed | Not assessed |
| PDPL-07 | Personal-data breach notification (to the competent authority and to data subjects where required; timelines per regulations, to be confirmed) | Breaches are assessed and notified as required | To be assessed by Mobily Privacy Office / Legal | IR runbook evidence preservation and the "personal data involved?" triage step (IR runbook §4, §7); audit extracts identify the affected records and users | IR records; audit extracts | Privacy Office / DPO — to be confirmed | Not assessed |
| PDPL-08 | Records of processing activities | Processing activities are documented | To be assessed by Mobily Privacy Office | Data-flow register (threat-model §4) as input | Data-flow register | Privacy Office — to be confirmed | Not assessed |
| PDPL-09 | Impact assessment for relevant processing | A privacy impact assessment is performed where required | To be assessed by Mobily Privacy Office | Threat model and data flows as inputs (MQ-19) | DPIA input pack | Privacy Office — to be confirmed | Not assessed |
| PDPL-10 | Privacy accountability (e.g. privacy officer responsibilities where applicable) | Accountability roles are assigned | To be assessed by Mobily Privacy Office | Not an application capability | — | Privacy Office — to be confirmed | Not assessed |
| PDPL-11 | **Transfer of personal data outside the Kingdom** (implementing transfer regulation) | Cross-border transfers meet the transfer conditions and safeguards | To be assessed by Mobily Privacy Office / Legal | Separate flows that may cross borders: external AI provider (DF-07), cloud IdP (DF-02), email/Teams tenancy (DF-08), backups (DF-11), vendor support (DF-12), SIEM (DF-10). AI is Off by default; the gateway's classification ceilings and destination allowlist (C-19) and egress control (C-18) can keep data in place | Data-flow register; AI gateway destination config (P5); egress allowlist (P7) | Privacy Office / Legal — to be confirmed | Not assessed |
| PDPL-12 | Processors and sub-processors | Processing by service providers is governed by agreements | To be assessed by Mobily Privacy Office with Procurement | Inventory of potential processors: AI provider, hosting operator, support vendor, backup operator, scanner or OCR provider | Processor inventory (from data-flow register) | Procurement / Privacy — to be confirmed | Not assessed |
| PDPL-13 | Registration or other administrative obligations (if applicable) | Controller registration or similar requirements | To be assessed by Mobily Privacy Office | Not an application capability | — | Privacy Office — to be confirmed | Not assessed |
| PDPL-14 | Sensitive categories (e.g. health, other sensitive data in HR material) | Additional safeguards for sensitive data | To be assessed by Mobily Privacy Office with HR | `hr` domain, restricted classification, clearance limits | Classification report (P3) | Privacy Office / HR — to be confirmed | Not assessed |

## 5. National data management and classification (SDAIA / NDMO publications)

| # | Area | Potential requirement (paraphrased) | Applicability status | Platform capability that may support it | Evidence the platform can produce | Control owner (Role — to be confirmed) | Status |
|---|---|---|---|---|---|---|---|
| NDM-01 | National data classification (specific instrument to be confirmed by Mobily Data Governance) | Data is classified per the applicable national/organisational scheme, and handled accordingly | To be assessed by Mobily Data Governance | Configurable classification levels and labels; mapping table pending (MQ-01) | Mapping table; classification report | Data Governance — to be confirmed | Not assessed |
| NDM-02 | Data governance and ownership (instrument TBC) | Data owners and stewards are defined per data domain | To be assessed by Mobily Data Governance | Document `domain` tags; owner per record; source register with verification status | Source register export (P2) | Data Governance — to be confirmed | Not assessed |

## 6. Sector requirements — Communications, Space & Technology Commission (CST)

| # | Area | Potential requirement (paraphrased) | Applicability status | Platform capability that may support it | Evidence the platform can produce | Control owner (Role — to be confirmed) | Status |
|---|---|---|---|---|---|---|---|
| CST-01 | Sector cybersecurity regulatory requirements for licensed service providers (specific instrument to be confirmed by Mobily Regulatory Affairs / Cybersecurity) | Sector-specific cybersecurity obligations that may extend to internal business systems | To be assessed by Mobily Regulatory Affairs with Cybersecurity | Controls in `threat-model.md` §6 | SEC-T results; review reports | Regulatory Affairs — to be confirmed | Not assessed |
| CST-02 | Cloud computing regulatory requirements (if hosted with a cloud service provider) (instrument TBC) | Data location, classification and provider obligations for cloud-hosted content | To be assessed by Mobily Regulatory Affairs / Cybersecurity | Hosting-agnostic deployment; storage and backup location configurable; data-flow register | Deployment docs; data-flow register | Regulatory Affairs — to be confirmed | Not assessed |
| CST-03 | Regulatory approvals and licensing relevant to the transaction itself (NewCo, DC business, transfers) | Obligations are identified and tracked by authorised specialists | To be assessed by Mobily Regulatory Affairs / Legal | Regulatory requirement and approval registers (newco module). The platform records specialist assessments and **does not determine applicability** (spec §7.2) | Register export (P3) | Regulatory Affairs — to be confirmed | Not assessed |
| CST-04 | Customer or subscriber data appearing in due-diligence material (instrument TBC) | Sector rules on customer data may constrain sharing it in DD or partner rooms | To be assessed by Mobily Regulatory Affairs / Privacy | Classification, room grants, release approval and disclosure log; redaction happens before upload (a human process) | Disclosure log (P4) | Regulatory Affairs / Privacy — to be confirmed | Not assessed |

## 7. Other legal and regulatory areas that shape platform controls

| # | Area | Potential requirement (paraphrased) | Applicability status | Platform capability that may support it | Evidence the platform can produce | Control owner (Role — to be confirmed) | Status |
|---|---|---|---|---|---|---|---|
| OTH-01 | Capital-market rules on confidential or inside information (if deal information is market-sensitive; MQ-16) | Access to inside information is restricted and recorded | To be assessed by Mobily Legal / Compliance | Room grants, audited access, and an access-history export of who accessed what and when | Room access and disclosure-log exports (P4) | Compliance — to be confirmed | Not assessed |
| OTH-02 | Competition law — information exchange between prospective partners before closing | Competitively sensitive information is handled under a clean-team protocol | To be assessed by Mobily Legal (competition) | Clean-team rooms, clean_team condition, output release workflow (access-matrix §2.4) | Clean-team grant and release records (P4) | Legal (competition) — to be confirmed | Not assessed |
| OTH-03 | Electronic transactions and signatures | Internal electronic approvals are not represented as certified signatures unless an approved solution is integrated (spec §4.2) | To be assessed by Mobily Legal | Approvals recorded as internal approvals, with an explicit UI label | UI text and export labels (P2) | Legal — to be confirmed | Not assessed |
| OTH-04 | Corporate records retention (minutes, resolutions, evidence) | Records are retained for required periods | To be assessed by Mobily Legal / Records Management | Retention classes and legal hold (C-31) | Retention configuration (P3) | Records Management — to be confirmed | Not assessed |
| OTH-05 | Mobily internal policies (information security, classification, acceptable use, third-party, AI use) | The platform aligns with internal policies | To be assessed by Mobily Cybersecurity / Data Governance | All designed controls; configuration hooks for session lifetimes, classification labels, egress and AI ceilings | Configuration exports | Policy owners — to be confirmed | Not assessed |

---

## 8. Evidence pack the platform is designed to produce (all Planned)

| Evidence | Produced by | Phase | Status |
|---|---|---|---|
| Access matrix (policy JSON) and role-assignment export | `packages/domain/src/policy/`, admin export | P1 | Planned |
| Security test results SEC-T-xx, AT-xx, AIT-xx with commands and outputs | CI and phase gate reports | P1–P7 | Planned |
| Audit extract with hash-chain verification | `audit.event.export`, `audit.chain.verify` | P1 / P7 | Planned |
| Security-event catalogue and SIEM export samples | Audit exporter | P7 | Planned |
| Data-flow register (hosting, AI, backups, support as separate flows) | `threat-model.md` §4 | P0 draft | Drafted (not reviewed) |
| AI gateway configuration (destinations, ceilings, DLP) and refusal log | AI module | P5 | Planned |
| Egress allowlist and private-mode test (AT-22) | Deployment + E2E | P7 | Planned |
| Backup/restore test report with measured recovery (AT-23) | DevOps runbook | P7 | Planned |
| SBOM, dependency and image scan reports | CI | P7 | Planned |
| Incident-response runbook and tabletop record | `incident-response-runbook.md` | P0 draft / P7 exercise | Drafted (not reviewed) |
| Disclosure log and room access history | JV module | P4 | Planned |

## 9. What the platform cannot evidence

Physical security, network perimeter, IdP and MFA internals, endpoint/DLP on user devices, SOC operations, key-management hardware, backup media handling, vendor contracts and personnel security. These need evidence from the responsible Mobily functions.

## 10. How to complete this matrix

1. The Mobily function named in each row confirms the framework version and the control reference, and records **Applicable / Not applicable / Partially applicable** with a rationale.
2. For applicable rows, map to Mobily policy and control IDs, name the control owner, and list the required evidence.
3. The engineering lead links the evidence produced in each phase (§8).
4. Status moves from **Not assessed** only by the Mobily function's decision. This platform, and its authors, never mark a row compliant.
