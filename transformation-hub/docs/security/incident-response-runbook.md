# Incident Response Runbook — Application Level

| Field | Value |
|---|---|
| Version / date | 0.1 (P0 draft), 2026-09-29 |
| Status | **Draft. Nothing in this runbook is implemented yet.** Every product capability is marked **Planned — verify at P7**, with the phase in which it is built. It must be exercised (tabletop plus a technical containment test, SEC-T-47) before P7 can pass. |
| Author | security-privacy-reviewer (authoring mode); independent review required |
| Scope | Incidents involving the Transformation & Transactions Hub application, its data, its integrations and its AI runtime. This runbook is **subordinate to Mobily's enterprise incident-response process**: Mobily's CSIRT/SOC leads and decides severity mapping, escalation, external notification and regulatory reporting. |
| Spec | Master prompt §12.4 (emergency stop), §15 (sensitive-access logs, incident-response runbook, revocation tests), §16 (runbooks) |
| Related | `threat-model.md` (T-xx, C-xx, DF-xx), `access-matrix.md` (permission keys), `ai-threat-cases.md` |

> This runbook does not decide whether an incident is a notifiable personal-data breach, a regulatory event or a contractual breach with a partner. Those determinations belong to Mobily Privacy/Legal/Regulatory Affairs. The runbook only preserves the evidence they need.

---

## 1. Principles

1. **Contain first for confidentiality incidents, but never destroy evidence.** The audit log is append-only, so containment actions do not erase history. Take a forensic DB snapshot *before* any restore or bulk correction.
2. **Use in-product containment before infrastructure measures** where possible. It is faster, scoped and audited.
3. **Two-person rule for reversal.** Releasing the AI kill switch, reactivating a suspended user and re-enabling external access are done by someone other than the person who activated them (`not_self`).
4. **No automatic external communication.** The platform never contacts partners, regulators or the public. Mobily's authorised roles do.
5. **Honest status.** Record what was actually done and verified. "Contained" means verified contained.

---

## 2. Roles (all Role — To be confirmed by Mobily)

| Role | Responsibility | Platform permissions used |
|---|---|---|
| Incident Commander | Leads response; declares severity; approves containment and recovery | none required (directs others) |
| Platform Operator | Executes account, session, access, connector and AI containment | `platform_admin`: `admin.sessions.revoke`, `admin.users.manage`, `admin.access.suspend`, `admin.external_access.suspend`, `integrations.connection.disable`, `ai.killswitch.activate`, `audit.security_event.read`, `audit.chain.verify` |
| Data Owner (affected project) | Decides on content-level containment (rooms, disclosures, AI mode) and business impact | `sponsor`: `jv.room.lock`, `jv.room.revoke_access`, `jv.disclosure.revoke`, `ai.killswitch.activate`, `ai.settings.manage` |
| Legal / Clean-team counsel | Partner and clean-team containment; legal hold; contractual assessment | `legal_restricted`: `jv.room.lock`, `jv.room.revoke_access`, `jv.disclosure.revoke`, `documents.legal_hold.manage` |
| Evidence Custodian | Exports and verifies audit evidence; keeps chain of custody | `auditor`: `audit.event.export`, `audit.chain.verify`, `audit.event.read` |
| Privacy Officer / DPO | Personal-data breach assessment and notification decisions | none in platform (receives evidence) |
| Communications | Internal and external messaging | none in platform |
| Engineering on-call | Diagnosis, fixes, secret rotation, restore under change control | infrastructure access via Mobily PAM only (C-35); no standing content access |
| Mobily IT Operations / Network | Forensic snapshot, network egress block, backups, restore | infrastructure |

---

## 3. Detection sources

Initial thresholds are proposals, to be tuned by Mobily SOC. Every row is **Planned — verify at P7**; the build phase is shown.

| ID | Source | Signal examples | Where it appears | Built in |
|---|---|---|---|---|
| DS-01 | Security events | Sign-in failures spike; session anomalies (new IP or UA mid-session); platform_admin created; role or clearance grants outside business hours; self-assignment attempts refused | `audit_event` (security category), SIEM export | P1 (events) / P7 (export) |
| DS-02 | Authorization denials | Bursts of 404s on sequential or foreign IDs (enumeration); repeated `SELF_APPROVAL_PROHIBITED`, `OUTSIDE_AUTHORITY`, `CLASSIFICATION_EXCEEDS_CLEARANCE` | Audit, API metrics | P1–P2 |
| DS-03 | Sensitive-read anomalies | Mass downloads (proposed: > 50 document downloads/hour/user, or > 20 from a single room); new grantee downloading a whole room; export spikes; after-hours room access | Audit (`auditRead` events) | P2 / P4 |
| DS-04 | Partner-boundary signals | External downloads right after grant; disclosure release followed by quick revocation; external login from an unexpected location (IdP) | Audit, disclosure log, IdP | P4 |
| DS-05 | AI signals | `AI_PROHIBITED_ACTION_REQUESTED`, `AI_TOOL_DENIED`, `AI_EGRESS_BLOCKED`, `AI_CITATION_INVALID` spikes; budget exhaustion; approval invalidations | Audit, AI run records | P5 |
| DS-06 | Integrity checks | Audit hash-chain verification failure; export sequence gap; document checksum mismatch (C-40) | Scheduled verification job; download path | P1 / P2 / P7 |
| DS-07 | Upload and import | Scanner detections; quarantine events; imports containing formulas, external links or URLs | Audit, quarantine queue | P2 / P6 |
| DS-08 | Egress | In-app egress guard refusals; network-policy deny logs | App logs, Mobily network logs | P1 / P7 |
| DS-09 | Jobs and outbox | Dead-letter growth; `uncertain` deliveries; duplicate-delivery reconciliation | Jobs health view | P2 |
| DS-10 | Configuration | Boot refused for unsafe production config; changes to the egress allowlist, AI provider or ceilings, connector destinations, or `HUB_MODE` | Security events, deployment logs | P1 / P7 |
| DS-11 | IdP / SOC | MFA fatigue patterns, impossible travel, disabled accounts still active in the Hub | IdP / SIEM correlation | P7 (with MQ-02) |
| DS-12 | Human reports | User, secretariat or partner reports a wrong disclosure, a strange AI answer, or an unexpected approval | Service desk (Mobily) | n/a |
| DS-13 | Vulnerability advisories | Advisories for Next.js, NestJS, PostgreSQL, exceljs, openid-client, base images | SBOM plus scanner | P7 |

---

## 4. Severity levels (proposed; to be mapped to Mobily's scheme)

| Severity | Definition (platform-specific examples) | Proposed initial response |
|---|---|---|
| **SEV-1 Critical** | Confirmed disclosure of restricted, strictly_confidential or clean-team data to an unauthorised party, especially an external counterparty. An unauthorised approval, waiver, closing or disclosure recorded as valid. platform_admin or DB-owner credential compromise. AI sent classified content to an unapproved destination. Audit chain broken with signs of tampering. | Incident Commander engaged immediately; containment starts at once; Data Owner, Legal and Privacy informed at once |
| **SEV-2 High** | Cross-project or classification leakage among internal users. Suspected account takeover. Malware released from quarantine and downloaded. AI prohibited-action attempt that produced a proposal or partial effect. Duplicate or misdirected notifications carrying confidential titles. | Commander within the SOC's High target; containment the same day |
| **SEV-3 Medium** | Repeated blocked attacks (enumeration, prompt injection) with no data impact. Integration failure with possible duplicate internal messages. Dead-letter build-up affecting scheduled reports. | Next business day |
| **SEV-4 Low** | A single blocked attempt; a false positive; a policy misconfiguration found before use | Backlog with owner |

**Triage checklist (record the answers in the incident record):**
1. Which data, at which classification? Which projects, rooms and counterparties?
2. Is personal data involved? This triggers PDPL-07 assessment by Privacy.
3. Is an external party involved (partner, provider, vendor)?
4. Is the incident ongoing? Are there active sessions, scheduled jobs or queued messages?
5. Is the AI involved, and in which mode and provider?
6. Is the integrity of approvals, gates, CPs, votes or evidence affected? If so, list the affected records.
7. What is the time window (UTC), and has the audit chain been verified for it?

---

## 5. Containment actions available in the product

Route paths are **proposed** and follow `/api/v1` conventions. The contracts registry will fix them. Every action writes a security event and is itself audited.

| ID | Action | Permission | Proposed UI / API | Effect | Side effects / notes | Reversal | Status |
|---|---|---|---|---|---|---|---|
| CA-01 | Revoke all sessions of a user | `admin.sessions.revoke` | Admin › Users › *Revoke sessions*; `POST /api/v1/admin/users/:userId/sessions/revoke` | All the user's sessions fail on the next request | The user must re-authenticate at the IdP. It does not stop IdP access, so pair with CA-02 or an IdP action. | n/a | Planned (P1) — verify at P7 |
| CA-02 | Disable a user account | `admin.users.manage` | Admin › Users › *Disable*; `POST /api/v1/admin/users/:userId/disable` | Sign-in refused; sessions revoked; the user's scheduled jobs are cancelled at execution (C-13) | Pending approvals by the user are invalidated at execution (AIT-18) | Reactivate by another admin (`not_self`) | Planned (P1) — verify at P7 |
| CA-03 | Suspend all access of a user | `admin.access.suspend` | Admin › Users › *Suspend access*; `POST /api/v1/admin/users/:userId/access/suspend` | All role assignments and room grants suspended (content-free action) | Preserves the assignment history for later reinstatement | Reinstate by another admin plus the Data Owner | Planned (P1) — verify at P7 |
| CA-04 | Suspend all external (partner) access | `admin.external_access.suspend` | Admin › Security › *Suspend external access*; `POST /api/v1/admin/security/external-access/suspend` | All external sessions revoked; external sign-in refused organisation-wide | Affects every counterparty. Coordinate with Legal. | Re-enable by another admin | Planned (P4) — verify at P7 |
| CA-05 | Revoke a room grant | `jv.room.revoke_access` | Room › Access › *Revoke*; `POST /api/v1/projects/:projectId/rooms/:roomId/grants/:grantId/revoke` | The grantee loses access on the next request | Downloaded copies remain outside control (RR-03) | New grant (`not_self`) | Planned (P4) — verify at P7 |
| CA-06 | Lock a room | `jv.room.lock` | Room › *Lock*; `POST /api/v1/projects/:projectId/rooms/:roomId/lock` | All grants and downloads in the room suspended immediately | Internal work in the room pauses | Unlock by the Data Owner or Legal | Planned (P4) — verify at P7 |
| CA-07 | Withdraw a disclosure | `jv.disclosure.revoke` | Room › Disclosures › *Withdraw*; `POST /api/v1/projects/:projectId/rooms/:roomId/disclosures/:disclosureId/revoke` | The partner can no longer view or download that item | **No recall** of copies already downloaded; the disclosure log shows who downloaded what | Re-release through the normal approval | Planned (P4) — verify at P7 |
| CA-08 | AI kill switch (organisation or project) | `ai.killswitch.activate` | AI Center › *Emergency stop*; `POST /api/v1/ai/killswitch` / `POST /api/v1/projects/:projectId/ai/killswitch` | Blocks new and pending AI actions; cancels unsent messages; in-flight runs stop at the next check (C-22) | Deterministic features continue (AT-21) | `ai.killswitch.release` by a different person | Planned (P5) — verify at P7 |
| CA-09 | Set project AI mode to Off | `ai.settings.manage` | Project › AI settings | No data sent to any provider for the project | Scheduled briefings are skipped with a notice | Change the mode back (audited) | Planned (P5) — verify at P7 |
| CA-10 | Disable an integration connector | `integrations.connection.disable` | Admin › Integrations › *Disable*; `POST /api/v1/admin/integrations/:connectionId/disable` | No further sends or reads; pending sends marked `cancelled_connector_disabled` | Re-enabling requires validation, and status is not shown as connected until validated | `integrations.connection.manage` | Planned (P6) — verify at P7 |
| CA-11 | Rotate a connector secret | `integrations.connection.manage` | Admin › Integrations › *Rotate secret* | New credential; the old one is invalidated at the provider | Needs provider-side action | n/a | Planned (P6) — verify at P7 |
| CA-12 | Rotate platform secrets | Outside the app (secret manager and deployment) | Procedure §6.6 | See §6.6 | Rotating the session HMAC key invalidates **all** sessions | n/a | Planned (P7) — verify at P7 |
| CA-13 | Place a legal hold on affected records | `documents.legal_hold.manage` | Documents › *Legal hold* | Blocks archive, disposal and rollback (C-31) | Preserves evidence for the investigation | Release by Legal | Planned (P3) — verify at P7 |
| CA-14 | Pause job types or outbox dispatch | Deployment config (proposed `HUB_JOBS_PAUSED=<types>`) | Operator procedure | Stops sends and AI runs while keeping the queue | Queued items resume only after reconciliation | Unset the flag | Planned (P7) — verify at P7 |
| CA-15 | Read-only mode | Deployment config (proposed `HUB_READ_ONLY=true`) | Operator procedure | Refuses all mutations except containment and audit export | Committee operations are paused, so announce it | Unset the flag | Planned (P7) — verify at P7 |
| CA-16 | Block egress at the network | Mobily network team | Network policy / proxy | No outbound traffic except the allowlist, or none at all | AI and notifications stop | Network change | Mobily infrastructure (MQ-03) |
| CA-17 | Manual quarantine of an existing document version | **Gap: no permission in `policy-2026.09-draft`.** Proposed addition `documents.document.quarantine` (sponsor, legal_restricted) | — | Until it exists, use CA-06 (room lock) or CA-13 plus access revocation | — | — | Gap — decide at P2 |

---

## 6. Procedures

### 6.1 First 30 minutes (any SEV-1 or SEV-2)
1. Open an incident record in Mobily's IR system. **Do not** track the incident inside the affected Hub project.
2. The Evidence Custodian runs `audit.chain.verify` for the time window and exports the audit extract (§7) **before** bulk changes. Containment may run in parallel because the audit log is append-only.
3. Apply the smallest effective containment from §5: user (CA-01/02/03), room (CA-05/06/07), AI (CA-08/09), connector (CA-10), external (CA-04).
4. If data may still be leaving: CA-14 pauses the relevant job types; CA-16 blocks egress if needed.
5. Confirm the containment took effect (§6.5), then complete the triage checklist (§4).

### 6.2 Suspected account compromise
CA-02, then CA-01, then an IdP-side disable or reset (Mobily IAM). Review the user's last 30 days of audit: downloads, grants given, approvals, AI proposals approved. List every approval by the user within the window for integrity review (PB-06).

### 6.3 Authorization defect (leak between projects or classifications)
1. Identify the endpoint and the permission.
2. CA-15 (read-only) if the defect is in a mutation path, or disable the feature flag for the route family.
3. Use audit and access logs to list the resources exposed and the users who saw them.
4. Add a regression test (SEC-T-03 family) **before** the fix is deployed.

### 6.4 AI incident
CA-08. Export the AI runs, proposals and approvals for the window. Verify that no prohibited-action records exist (the DB assertions in ai-threat-cases §4.3 serve as the checklist). Review the gateway refusal and egress logs. If data reached an external provider, the Privacy Officer and Legal assess the implications against the provider terms (MQ-06).

### 6.5 Verifying containment (SEC-T-47)
- The session holder's next request returns 401.
- The suspended user's API calls return 404/403.
- The external user's sign-in is refused.
- Locked-room downloads are refused.
- The kill switch shows no new `ai_run` or `outbox` sends after activation time T.
- A disabled connector records no delivery attempts.

Record the command or screen and the observed result.

### 6.6 Secret rotation (CA-12)

| Secret | Rotation effect | Order |
|---|---|---|
| Session/CSRF HMAC key | All sessions and CSRF tokens invalid; everyone re-authenticates | Rotate early when session theft is suspected |
| `hub_app` / `hub_owner` / `hub_bi` DB passwords | Rolling restart of API and worker; migrations use the owner role | Deploy the new secret, restart, then revoke the old one |
| OIDC client secret | Sign-ins fail until the IdP and the app are both updated | Coordinate with IAM |
| AI gateway credential | AI unavailable until updated (AT-21 behaviour) | Activate CA-08 first if the key leaked |
| Object-store keys | Uploads and downloads fail until updated | Rolling restart |
| SMTP/Graph credentials, webhook secrets | Sends or receipts fail until updated; webhooks need the new shared secret at the sender | CA-10 first |
| Audit-export credentials | Export paused; the exporter resumes from its last sequence number | Verify there is no gap afterwards |

After rotation: run SEC-T-27 (secret scan) against logs and reports from the incident window, and confirm the old credentials are refused.

---

## 7. Evidence preservation

| Evidence | How | Owner |
|---|---|---|
| Audit extract for scope and window, with chain proof | `audit.event.export` + `audit.chain.verify`; record the SHA-256 of the export file | Evidence Custodian |
| Security events | `audit.security_event.read` export | Platform Operator |
| AI runs, proposals, approvals, tool calls, gateway decisions | AI Center export (P5), classification-redacted to the exporter's clearance; the full copy is taken by Mobily IT under PAM if required | Data Owner + Evidence Custodian |
| Job and outbox rows (including `uncertain` and `cancelled`) | DB export under PAM (read-only) | Engineering on-call |
| Disclosure log and room access history | `jv.disclosure_log.read` export | Legal |
| Document version checksums | Document metadata export | Evidence Custodian |
| Forensic DB and object-store snapshot | Taken by Mobily IT **before** any restore or bulk correction | Mobily IT Operations |
| Ingress, network and IdP logs | Mobily infrastructure / SOC | SOC |

**Rules:**
- All timestamps in UTC; display Asia/Riyadh in reports.
- Keep a chain-of-custody record: who exported what, when, file hash, where it is stored.
- Place a legal hold (CA-13) on affected documents.
- **Never** edit or delete audit rows, sessions, jobs or AI records as part of clean-up.
- Evidence exports inherit the highest classification they contain.

---

## 8. Playbooks

Each playbook follows the same steps: contain, preserve, eradicate, recover, notify, verify. **Notify** means inform the listed Mobily roles. External notifications are decided by them.

| ID | Trigger | Default SEV | Contain | Eradicate / recover | Notify (Roles — TBC) |
|---|---|---|---|---|---|
| PB-01 | Compromised internal account | SEV-2 (SEV-1 if the user is platform_admin, sponsor or legal) | CA-02, CA-01, IdP reset; if admin: CA-12 for secrets the admin could reach | Review and reverse unauthorised changes via normal commands; access review | CSIRT, Data Owner(s), IAM |
| PB-02 | Authorization defect leaks across projects or classifications | SEV-2 (SEV-1 if restricted or above) | CA-15 or route feature-flag; CA-14 | Fix with a regression test; recompute exposure from audit | CSIRT, Data Owner(s), Privacy (if personal data) |
| PB-03 | Partner over-disclosure (wrong item, version or counterparty) | SEV-1 | CA-07, CA-05/06; CA-04 if widespread | Correct the release; document which versions were downloaded | Legal, Data Owner, CSIRT; partner contact **only** by Legal |
| PB-04 | Clean-team breach (non-clean-team user saw clean-team material) | SEV-1 | CA-06 on the clean room; CA-03 on the recipient(s) | Legal assesses the protocol breach; remediation per the clean-team protocol | Legal (competition), Data Owner |
| PB-05 | AI incident: injection effect, egress, hallucinated fact relied upon | SEV-1/2 | CA-08; CA-09; CA-16 if egress | Add an AIT regression case; re-verify gateway ceilings; correct records through normal commands | CSIRT, Data Owner, AI Product Owner, Privacy (if an external provider received data) |
| PB-06 | Unauthorised approval, waiver, closing or vote recorded | SEV-1 | CA-02/03 on the actor; CA-15 if systemic | **Do not delete.** Record a superseding decision and a reopened assessment through the controlled process (AT-14); the gate stays blocked | Committee Chair, Secretary/CPMO, Data Owner, Legal |
| PB-07 | Malicious upload detected, or malware downloaded | SEV-2 | CA-17 workaround; CA-05 for the uploader (if external); notify downloaders' endpoint team | Rescan the corpus; tighten the type allowlist | CSIRT, Endpoint Security |
| PB-08 | Audit integrity failure (chain break or export gap) | SEV-1 until explained | CA-15; forensic snapshot | Compare with the external log store; root-cause privileged access | CSIRT, Internal Audit |
| PB-09 | Secret exposed (repo, log, report, bundle) | SEV-2 (SEV-1 for DB owner, session key or AI gateway key) | CA-12 for the exposed secret; CA-08 if it is the AI key | Remove the exposure source; SEC-T-27 | CSIRT |
| PB-10 | Integration misfire (duplicate or misdirected notifications) | SEV-3 (SEV-2 if confidential titles went to wrong recipients) | CA-10; CA-14 | Reconcile `uncertain` deliveries; fix the recipient re-check | Data Owner, IT Collaboration |
| PB-11 | Privileged insider or support misuse | SEV-1 | Revoke PAM access (Mobily); CA-12 | Access review; RR-01 review | CSIRT, HR/Legal |
| PB-12 | Data loss or ransomware; restore needed | SEV-1 | CA-15; isolate | Restore per the DevOps runbook, then: invalidate sessions (CA-12 HMAC), keep jobs paused (CA-14), re-apply revocations recorded after the backup point from the external audit export, re-validate integrations, verify checksums and chain (AT-23) | CSIRT, IT Operations, all Data Owners |

---

## 9. Communication

| Audience | When | Who decides | Channel |
|---|---|---|---|
| Mobily CSIRT/SOC | Every SEV-1/2, immediately | Platform Operator | Mobily IR process |
| Data Owner (Sponsor) of affected project(s) | SEV-1/2 | Incident Commander | Direct |
| Legal (and clean-team counsel) | Partner, clean-team or contractual exposure | Incident Commander | Direct |
| Privacy Officer / DPO | Any personal data possibly affected | Incident Commander | Direct |
| Committee Chair and Secretary/CPMO | Integrity of decisions, votes, gates or CPs affected | Data Owner | Direct |
| Regulatory Affairs | If regulatory notification may apply (Mobily decides) | Legal / Regulatory | Mobily process |
| Partners / counterparties | Only if Legal decides | Legal | Outside the platform |
| Platform users | Maintenance or read-only mode, forced re-authentication | Incident Commander | In-app banner (planned P7) and Mobily internal comms |

The platform never sends incident communications to external parties.

---

## 10. Recovery checklist
1. The root cause is fixed and a regression test has been added and passes (real output recorded).
2. Secrets rotated where relevant; old credentials verified as refused.
3. Access reinstated only after review, by a different person (`not_self`).
4. Paused jobs reconciled: `uncertain` deliveries resolved, then CA-14 is lifted.
5. The kill switch is released by a different person, with the AI mode reviewed.
6. Integrations re-validated (never marked "Connected" without validation).
7. Audit chain verified across the incident window, and the export confirmed gap-free.
8. Monitoring thresholds tightened for a watch period (proposed 14 days).

## 11. Post-incident review
- Hold a blameless review within a proposed 10 working days for SEV-1/2.
- Build the timeline from the audit extract.
- Record the root cause, which controls failed or were missing, and which controls worked.
- Update `threat-model.md` (new T-xx or re-rating), `ai-threat-cases.md` (new AIT-xx) and `access-matrix.md` if policy changed; each update goes through independent review.
- Track actions with owners and dates in Mobily's IR system.
- Record residual-risk acceptance by the accountable Mobily role where applicable.

## 12. Exercise and verification plan (P7)

| Exercise | Proves | Status |
|---|---|---|
| Tabletop: partner over-disclosure (PB-03) | Roles, decisions, communication path | Planned — verify at P7 |
| Tabletop: AI egress incident (PB-05) | AI containment and privacy assessment path | Planned — verify at P7 |
| Technical: SEC-T-47 containment timing (CA-01…CA-10) | Each action takes effect within one request or job cycle | Planned — verify at P7 |
| Technical: restore drill (PB-12, AT-23) | Restore with session invalidation, job quiescence and revocation re-application | Planned — verify at P7 |
| Technical: secret rotation drill (§6.6) | Rotation without data loss; old credentials refused | Planned — verify at P7 |
