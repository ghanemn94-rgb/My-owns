# Access Matrix — RBAC + ABAC Policy (draft `policy-2026.09-draft`)

| Field | Value |
|---|---|
| Status | **Implemented and tested; business inputs still to be confirmed.** The matrix in §11 is the source of `packages/domain/src/policy/policy-matrix.json` (drift test `policy.test.ts`) and is enforced by `PolicyService` in the API (P1/P2 gates). §2.2 was amended after the P2 security review (option B, `docs/reviews/P2-security-review.md` §3) to the stricter workstream rule the code implements; the §2.2.1 exception list is **pending confirmation by Mobily data governance**. Role holders, clearances, the authority matrix and the classification scheme remain Mobily inputs (row "Business inputs"). |
| Author | security-privacy-reviewer (authoring mode). An author cannot approve their own work, so this needs independent review by solution-architect and qa-test-engineer in separate contexts. |
| Implements | Master prompt §5 (multi-level roles, partner/clean-team separation), §8 (partner workspace), §12.3 (AI prohibitions), §15 (authorization and data security) |
| Implementation target | `packages/domain/src/policy/` (pure policy evaluation) and `apps/api/src/platform/policy/` (`PolicyService.assert(ctx, permission, resource)`) |
| Verified by | SEC-T-03…SEC-T-10, SEC-T-28, SEC-T-29, SEC-T-35, SEC-T-37 (catalogue in `threat-model.md` §9); AT-03, AT-04, AT-05, AT-12, AT-13, AT-17, AT-19 |
| Business inputs | Role holders, clearances, the authority/delegation matrix and the classification scheme must come from Mobily (**Role — To be confirmed**). The role set follows master prompt §15. |

---

## 1. How to read this document

**Role abbreviations used in the matrix**

| Abbr. | Role key | Abbr. | Role key |
|---|---|---|---|
| PLA | `platform_admin` | WSL | `workstream_lead` |
| PFA | `portfolio_admin` | CON | `contributor` |
| SPO | `sponsor` | FAP | `functional_approver` |
| CHR | `committee_chair` | FIN | `finance_restricted` |
| SEC | `secretary_cpmo` | LEG | `legal_restricted` |
| PM | `project_manager` | CLT | `clean_team` |
|  |  | AUD | `auditor` |
|  |  | EXT | `external_partner_limited` |

**Legend**

- ● means the permission is granted to the role, but only within the scope of the assignment (§2.2) and only if every condition passes.
- ⓟ after the conditions marks a project-level read (§2.2.1): a workstream-scoped grant of it also covers the project's records of that type with no workstream and no room.
- **Cond.** column: `C` classification · `R` room · `T` clean_team · `S` not_self · `A` authority · `W` own_workstream · ⓐ an audited sensitive read. Each condition is defined normatively in §2.4.
- **AI** column: `R` means the AI runtime may use the permission for retrieval on behalf of the user. `P` means the AI may *propose* the action, which runs only after a bound human approval (or under an approved autopilot policy). `–` means the AI can never exercise it. See §2.7.

---

## 2. Evaluation model (normative)

### 2.1 Decision function

```
authorize(ctx, permissionKey, resource):
  0. ctx.session must be valid, unexpired and unrevoked, else 401.
     An unknown permissionKey is a programming error: the route registry refuses to boot (dev/test) and the request is denied in prod.
  1. If ctx.actor is the ai_runtime service principal:
        require permission.ai ∈ {retrieve, propose} and permission ∈ project AI-mode allowlist (§2.7)
        then evaluate steps 2–5 as ctx.delegatingUser, using that user's CURRENT assignments (never a cached snapshot).
  2. grants := active, unexpired role assignments of the user whose role includes permissionKey
              and whose scope covers the resource (§2.2).
  3. visible := the user can read the resource under §2.2–2.4 (scope + classification + room + clean_team).
     If not visible, return 404 NOT_FOUND. Existence is never leaked.
  4. If grants is empty, return 403 FORBIDDEN (the resource is visible but the action is not permitted).
  5. For every condition in permission.conditions ∪ universal attribute conditions (§2.4.1):
        if the condition fails, return 403 with a condition code (e.g. SELF_APPROVAL_PROHIBITED, OUTSIDE_AUTHORITY).
  6. Allow. Denials in steps 4–5 for mutating permissions write an audit_event (AT-05).
     Allowed permissions with auditRead write an audit_event inside the same transaction as the read response.
```

Default is **deny**: any permission a role does not list, and any scope an assignment does not cover, is refused.

### 2.2 Scopes and coverage

The scope hierarchy is `organization ⊃ portfolio ⊃ project ⊃ {workstream, partner_room}`.

| Assignment scope | Covers |
|---|---|
| `organization` | All resources of the organization. Content access is still limited by the role's permission list (platform_admin has no content permissions). |
| `portfolio` | Programs and projects in that portfolio, and everything below them. |
| `project` | All resources with that `project_id`, including all its workstreams. **Room-bound resources additionally require the `room` condition.** |
| `workstream` | Resources with that `workstream_id`. A workstream-scoped grant does **not** cover project-level records (`workstream_id IS NULL`, or record types without a workstream) nor other workstreams, **except** the read permissions listed in §2.2.1, which also cover the project's records of that type that belong to no workstream and are not room-bound; classification, room and clean-team conditions still apply. Mutating permissions cover only the assigned workstream. |
| `partner_room` | Only resources with that `room_id`. It never covers project-level records. |

The `app.project_ids` setting used by PostgreSQL RLS is computed server-side from the user's active assignments and room grants at the start of each transaction. It is **never** taken from request parameters or job payloads.

Lists, counts and search apply the same coverage in SQL as the single-record check (§2.5): a list never shows a record — or a document title — that the same caller would be refused when opening it. **Known deviation (open, after the P2 security fixes):** the governance lists (decisions, committees, meetings, actions, escalations) and the activity feed's type filter still check the type's read permission RBAC-only, so a workstream-only principal lists governance titles / events that `GET` refuses (403). Pinned by the `OBSERVED` test in `apps/api/test/reviews/p2-sec-access-matrix.spec.ts`; the fix belongs to the governance and portfolio modules (require a project-wide grant, e.g. `PolicyService.grantSql(…, {})`, which is `false` for a workstream-only grant of a non-§2.2.1 permission).
**Record-level rules of project-level registers (SEC-P34-12, P3/P4 security review).** Wherever a record is shown through
`RecordVisibility` for a non-auditor — the activity feed, the labels of a task's / milestone's prerequisites, evidence
targets — the project-level registers **decision** (`governance.decision.read`), **agreement** and **consent**
(`carveout.register.read`) and **regulatory requirement** (`newco.register.read`) need a PROJECT-WIDE grant of their read
permission, exactly like their own modules (`grantSql(…, {})`, `assertProjectWide`, `assertProjectRead`): a workstream-only
reader no longer sees their code / title / state there (`apps/api/src/platform/record-visibility.ts`, rule `ws: <read>, wsCol: null`).
Tests: `apps/api/test/reviews/p34-sec-jv.spec.ts` (SEC-P34-12, agreement prerequisite) and
`apps/api/test/reviews/p34-sec-fixes.spec.ts` (decision prerequisite and decision events in the activity feed).

#### 2.2.1 Project-level read exceptions for workstream-scoped grants

**Status: pending confirmation by Mobily data governance** (AMQ-09; P2 security review §3, option B). Until confirmed, the list below is the
implemented rule; removing an entry makes the strict §2.2 rule apply to that permission as well.

A workstream-scoped assignment (for example `workstream_lead`, or a workstream-scoped `contributor` / `functional_approver`)
that grants one of these read permissions also covers the project's records **of that type** with no workstream and no room.
Every other permission — every mutation, and every other read (finance, governance, planning aggregates, carve-out, NewCo,
readiness, JV, AI, reports, imports) — covers only the assigned workstream(s). A record in a room is never covered through this
exception (room grants and room-scoped roles apply as in §2.4).

| Permission | Why the workstream role needs it | What becomes readable |
|---|---|---|
| `gates.gate.read` | Gate owner and reviewer roles can be workstream-scoped (a workstream lead owns G1/G4/G5/G6 and reviews several criteria); gates and criteria carry no workstream | The gate register: definitions, criteria, cycles, evaluations and waivers. Linked governance decisions stay governed by `governance.decision.read` (shown only to its project-wide holders) |
| `documents.document.read` | Documents carry no workstream; the role reads the evidence of its own tasks and gate criteria (linking evidence is a mutation and stays strict: `documents.evidence.link` is not in this list) | Metadata, versions and evidence counters of project documents that are not room-bound, up to the caller's clearance; list and search show exactly these documents. The source register (`documents.document.read` is also its read permission) follows the same rule |
| `documents.document.download` | As above (audited read) | Download of the same documents |
| `portfolio.project.read` | The project header and status dimensions frame the role's work | Project overview, parties, status dimensions (counts inside it keep their own permission's reach) |

Machine-readable list (`policy.test.ts` checks that it equals the permissions flagged `"projectLevelRead": true` in §11 and in
`packages/domain/src/policy/policy-matrix.json`):

```json
{"projectLevelRead": ["gates.gate.read", "documents.document.read", "documents.document.download", "portfolio.project.read"], "status": "pending confirmation by Mobily data governance"}
```

Implementation: `PolicyService.check` (a workstream-scoped grant of a flagged permission applies to a resource with no
workstream and no room), `PolicyService.permissionReach` / `reachSql` (`col in (…) or col is null` for flagged permissions) and
`PolicyService.grantSql` (the same coverage for lists, including room-scoped roles). Tests:
`apps/api/test/reviews/p2-sec-access-matrix.spec.ts` (gate register, project header, documents incl. restricted / room /
room-grant cases, finance stays strict, decisions stay 403), `apps/api/test/reviews/p2-sec-probes.spec.ts` (§2.2 / SEC-P2-07 /
SEC-P2-08), `finance-isolation.spec.ts` (project-level finance records stay hidden), `packages/domain/src/policy/policy.test.ts`.

### 2.3 Classification and clearance

Order: `public < internal < confidential < restricted < strictly_confidential`.

- Documents and classified records carry `classification`, `domain` (proposed: `general | finance | legal | regulatory | commercial | technical | hr | strategy`, to be confirmed by Mobily Data Governance), optional `room_id` and `clean_team` flag.
- **Effective clearance** for (user, resource) is the maximum of:
  - for each active assignment covering the resource: `role.domainClearance[resource.domain]` if defined, else `role.defaultClearance`;
  - active unexpired `admin.clearance.grant` records for that user and project (optionally domain-limited).
- A clearance from a `partner_room`-scoped role (clean_team, external_partner_limited) applies **only** to resources in that room.
- **Proposed default classification by record type.** Every row is to be confirmed by Mobily Data Governance, and an authorised user may override the default per record.

| Record type | Default | Domain |
|---|---|---|
| WBS, tasks, milestones, RAID, readiness checks, periodic updates | internal | general |
| Committee papers, decisions, minutes, votes | confidential | general |
| Perimeter, transfers, agreements, consents, TSA | confidential | legal / commercial |
| NewCo incorporation, regulatory register | confidential | legal / regulatory |
| Budget, costs, benefits, KPIs | confidential | finance |
| Financial snapshots, business plan/valuation outputs | restricted | finance |
| Partner list, proposals, DD findings | restricted | legal |
| Ownership scenarios, negotiation positions, valuation models | strictly_confidential | finance / legal |
| Clean-team room content | strictly_confidential + `clean_team=true` | as tagged |
| Derived artefacts (snapshots, reports, AI outputs, notifications) | max of inputs (§2.6) | union of input domains |

### 2.4 Conditions (normative semantics)

| Condition | Holds when | Failure |
|---|---|---|
| `classification` | Read: `resource.classification ≤ effectiveClearance`. Create/update/classify: the **resulting** classification ≤ effectiveClearance, so no user can create or relabel content above their own clearance. | 404 when reading; 403 `CLASSIFICATION_EXCEEDS_CLEARANCE` when writing a visible resource |
| `room` | `resource.room_id IS NULL`, **or** the user has an active, unexpired, unrevoked `room_grant(user, room)` with level ≥ required level (`view` for read, `contribute` for create/draft, `manage` for room administration/grants) **and** the room is not locked. For **external** accounts, also: `room.type = 'partner'`, `room.counterparty_id = user.counterparty_id`, and the item is a **disclosed** version (released through `jv.disclosure.release`). An NDA stage or partner stage never implies a grant (§8 of master prompt). | 404 |
| `clean_team` | `resource.clean_team = false`, **or** the user holds an active `clean_team` role assignment on that room plus a room grant. For `jv.room.grant_access` into a clean-team room, the **grantee** must receive the clean_team assignment in the same command, with the clean-team attestation reference. Clean-team outputs lose the flag only through `jv.clean_team_output.release`. | 404 |
| `not_self` | `ctx.user.id ∉ resource.selfIds` (the per-resource list in §5) **and** the user is not recorded as recused/conflicted on the item. The AI principal is never an approver. | 403 `SELF_APPROVAL_PROHIBITED` / `RECUSED` |
| `authority` | The action is within delegated authority (§4 and §5.2): an active approved `AuthorityMatrixVersion` authorises the actor (or the actor's committee) for the decision type, and the amount is ≤ the limit **in the same currency and unit_scale** (a different currency is denied unless a recorded conversion basis exists). In production mode, with no active approved matrix, the result is **deny**. In `HUB_MODE=demo`, a Demo authority policy (`is_demo=true`) is used and outcomes are badged Demo. For assignment/grant/AI permissions the special meanings in §5.2 apply. | 403 `OUTSIDE_AUTHORITY` / `AUTHORITY_MATRIX_NOT_ACTIVE` |
| `own_workstream` | The user is the resource's accountable owner, an assignee, or its creator; **or** holds `workstream_lead` on the resource's workstream; **or** holds `project_manager` on the resource's project. A project-scope grant of any other role does **not** satisfy it. | 403 `NOT_OWNER` (404 if not visible) |

**`own_workstream` and create commands (decision, P3/P4 security review SEC-P34-11).** For a CREATE the actor is the
creator, so `W` holds by construction (the create commands pass the actor as owner). `W` therefore binds the commands on
EXISTING records (updates and the owner's status commands); a create is bound by the **scope of the grant**: a
workstream-scoped grant creates only inside its workstream(s) (`PolicyService.check`; `workstream_lead` is only ever
workstream-scoped), a project-scoped grant (project manager, a project-scoped contributor) creates in any workstream of the
project. This is the documented semantics, **not a vulnerability**: approvals and verifications of those records stay with
another person (`not_self` against the owner, the creator, the latest recorder and every evidence linker — §5.1). Open
for the domain owner, not changed (AMQ-10): whether a project-scoped contributor may set `blocker` / `signoffRole` on the
readiness checks it creates, and whether the readiness template instantiation (bulk creation of blocker-capable checks
bound to a site or cutover plan) should be limited to the project manager / workstream lead. Pinned by the `OBSERVED
SEC-P34-11` test in `apps/api/test/reviews/p34-sec-registers.spec.ts`.

#### 2.4.1 Universal attribute rule (defence in depth)

`classification`, `room` and `clean_team` are evaluated for **every** resource that carries the attribute, whether or not the permission lists the condition. The lists in the matrix record intent and drive the completeness tests (SEC-T-35). They are not a way to switch the check off.

### 2.5 404 vs 403, counts and search

- If the user cannot see the resource, the response is 404, with the same body shape and code as a genuinely missing ID.
- List `total`, facet counts, dashboard aggregates, search hits, snippets, AI retrieval and notification badges are computed **inside SQL with the same predicates** (project scope, classification, room, clean_team). Results are never fetched and then filtered.
- Unique constraints that could reveal existence across scopes (for example document titles) are scoped per project. A 409 message never names the conflicting record.
- **AI retrieval uses the owning module's predicate, not only classification (SEC-P34-02 / SEC-P34-03).** Every
  `AiKnowledgeService` source (detections, tool retrieval, briefings, `/ai/ask`) and the citation re-check
  (`visibleCitationKeys`) apply, inside SQL: the type's `RecordVisibility` rule with the workstream reach of its read
  permission (TSA: classification + readiness reach; readiness check: readiness reach; approved figures: finance-domain
  clearance + finance reach; approved valuations: finance-domain clearance + a project-wide finance grant — the finance
  module's `visibleSql`; action items / approval requests: their decision / subject), `grantSql(…, {})` for project-level
  registers without a record rule (decisions, closing conditions, partners, deal scenarios), and the documents list's grant
  coverage for document chunks (a workstream-scoped reader reaches room-less documents only). Tests:
  `p34-sec-registers.spec.ts` (SEC-P34-02, SEC-P34-03) and `p34-sec-fixes.spec.ts` (TSA reach, valuations, decisions,
  room documents).

### 2.6 Derived data

A report snapshot, export, meeting pack, AI answer, AI summary, notification or email body takes classification = **max** of its inputs, `room_id` = the input room (if exactly one; more than one room means the item is **not shareable** outside the intersection of grants), and `clean_team` = OR of the inputs. Access to the derived item is re-checked on every read, export and send (master prompt §11 and §12.1).

### 2.7 AI usage flag (`ai`)

- `none` is the default. Neither the AI runtime nor any AI tool may exercise the permission, even with a human approval. The AI can at most write a **prepared request**: a text artefact in the AI workspace, addressed to a human, which creates no domain record. The human then performs the action through the normal UI/API with an interactive session.
- `retrieve`: the AI may read under the delegating user's current ACL.
- `propose`: the AI may create an `ai_proposal` that executes the permission **only after** a human with that permission approves it via `ai.proposal.approve`. The approval is bound to the payload hash, target version, approver and expiry. Alternatively, it may run automatically if the permission is in an approved autopilot allowlist (`ai.autopilot_policy.approve`).
- Mode allowlist: `off` gives no permissions. `advisory` allows `retrieve` only. `assisted` allows `retrieve` plus `propose` with per-action approval. `autopilot` allows `retrieve` plus the approved subset of `propose` without per-action approval, with limits, rate, scope and expiry.
- No permission carrying `not_self` or `authority` is `propose`, with one exception: `notifications.message.send`, whose `authority` is the destination allowlist. The generator enforces this (SEC-T-35).

### 2.8 Account types

- `internal` accounts may hold any role except `external_partner_limited`.
- `external` accounts may hold **only** `external_partner_limited` (and, if Mobily Legal decides so, an external clean-team adviser variant, which is not modelled here). Each external account is bound to exactly one counterparty. External accounts never see the directory, other rooms, internal projections, AI features or notifications about internal records.
- Service principals (§9) are not users and hold no role assignments.

---

## 3. Roles

| Role | Purpose | Scope types | Default clearance | Domain clearance | Assigned by | Deliberately excluded |
|---|---|---|---|---|---|---|
| `platform_admin` | Accounts, sessions, IdP/infra settings, connectors, AI provider config, security events, emergency containment | organization | internal | — | platform_admin (another person) | **All transaction content**: documents, decisions, rooms, finance, AI answers, audit payloads. Only content-free admin and security views. |
| `portfolio_admin` | Portfolios/programs, project creation, templates, project role assignment | organization, portfolio | internal | — | platform_admin | Confidential+ content unless granted clearance; approvals |
| `sponsor` | Accountable executive: approves baselines, gates, waivers, go/no-go, partner contact, disclosures, signing/closing within authority | portfolio, project | strictly_confidential | — | portfolio_admin | Clean-team rooms (require explicit clean_team grant); room content without a room grant; admin |
| `committee_chair` | Chairs committee; votes; records outcomes; approves minutes; gate decisions within committee mandate | portfolio, project | restricted | — | portfolio_admin | Room content without grant; content editing |
| `secretary_cpmo` | Secretariat/CPMO: committee operations, agenda, packs, minutes, source register, imports, reporting | portfolio, project | restricted | — | portfolio_admin | Votes; gate/waiver approvals; rooms |
| `project_manager` | Day-to-day delivery: plan, RAID, registers, rooms (create), DD coordination, imports | project | confidential | — | portfolio_admin | Approvals of own proposals; granting room access; disclosure release; closing |
| `workstream_lead` | Leads one workstream: tasks, deliverable acceptance, readiness, updates | workstream | confidential | — | project_manager | Anything outside the assigned workstream(s), except the project-level reads of §2.2.1 |
| `contributor` | Updates own tasks/actions, raises RAID, uploads evidence | project, workstream | internal | — | project_manager | Approvals; records not owned/assigned (own_workstream) |
| `functional_approver` | Specialist reviewer/approver: deliverables, transfers, readiness sign-off, CP verification, evidence verification | project, workstream | confidential | — | portfolio_admin | Authoring the items they approve (not_self) |
| `finance_restricted` | Finance specialists: budgets, snapshots, models, benefits, KPIs, funds flow, finance DD | project | confidential | finance → strictly_confidential | portfolio_admin | Legal-domain strictly_confidential content |
| `legal_restricted` | Legal/regulatory specialists: agreements, consents, incorporation, regulatory, NDA, rooms/grants, disclosures, CPs, legal hold | project | confidential | legal, regulatory → strictly_confidential | portfolio_admin | Finance-domain strictly_confidential content; closing declaration |
| `clean_team` | Clean-team members analysing competitively sensitive material; submit outputs for release | partner_room | strictly_confidential (inside the room only) | — | legal_restricted via `jv.room.grant_access` | Everything outside the granted clean-team room |
| `auditor` | Read-only assurance incl. audit log, security events, chain verification | organization, portfolio, project | confidential | — | platform_admin (org/portfolio), portfolio_admin (project) | **All mutations** (the only exceptions are the audited exports and own notification preferences); rooms without an explicit grant |
| `external_partner_limited` | Counterparty users: view/download disclosed items, raise DD questions, upload submissions in own room | partner_room | confidential | — | sponsor or legal_restricted via `jv.room.grant_access` | Everything not disclosed into their own room; other counterparties; directory; AI |

---

## 4. Assignability (the `authority` condition for `admin.role_assignment.manage` and `jv.room.grant_access`)

| Assigner (holding the permission) | May assign | At scope | Additional rule |
|---|---|---|---|
| `platform_admin` | `platform_admin`, `portfolio_admin`, `auditor` | organization; portfolio (portfolio_admin, auditor) | not_self; creating a platform_admin writes a security event exported to the external log store |
| `portfolio_admin` | `sponsor`, `committee_chair`, `secretary_cpmo`, `project_manager`, `functional_approver`, `finance_restricted`, `legal_restricted`, `auditor` | portfolio (sponsor, committee_chair, secretary_cpmo, auditor) or a project in the assigner's portfolio | not_self |
| `project_manager` | `workstream_lead`, `contributor` | project or workstream within the assigner's project | not_self |
| `sponsor` via `jv.room.grant_access` | room grants (internal users); `external_partner_limited` | partner_room | not_self; partner stage ≥ *Materials access*; expiry required (proposed default ≤ 90 days, Mobily to confirm) |
| `legal_restricted` via `jv.room.grant_access` | room grants (internal users); `external_partner_limited`; `clean_team` | partner_room | not_self; clean_team only into `clean_team` rooms, with attestation reference |
| `sponsor` via `admin.clearance.grant` | clearance up to own effective clearance, per project (optionally per domain) | project | not_self; reason + expiry (proposed ≤ 12 months) |

Nobody can assign a role they could not be assigned by the table. A role assignment never grants room access on its own (§2.4 `room`).

---

## 5. Separation of duties

### 5.1 `selfIds` per resource type (who counts as "self" for `not_self`)

| Permission(s) | `selfIds` |
|---|---|
| `governance.decision.review`, `.vote`, `.record_outcome`, `.record_external_approval` | requester, submitter, paper author; plus recused/conflicted members for `vote` |
| `governance.decision.verify_implementation`, `governance.action.verify_closure` | owners/assignees of the implementing actions |
| `governance.agenda_request.screen` | requester |
| `governance.minutes.approve` | minutes drafter |
| `governance.charter.approve`, `governance.authority_matrix.approve`, `gates.definition.approve`, `carveout.perimeter.approve`, `config.template.publish`, `ai.autopilot_policy.approve` | author(s) of the version being approved |
| `config.template_migration.approve`, `planning.baseline.approve`, `planning.change_request.approve` | proposer / requester |
| `planning.deliverable.accept` | deliverable owner, submitter |
| `planning.rag_override.review`, `planning.status_update.review` | override setter / update submitter |
| `gates.assessment.review`, `gates.assessment.decide` | assessment submitter. As implemented (DOM-P2-16): a criterion review — the criterion's evidence submitter(s) or not-applicable proposer; the **gate-level review** — the person who started the cycle (and the submitter of the cycle must not be the endorsing gate reviewer, checked at mark-ready); `decide` — the submitter **and** the gate reviewer |
| `gates.waiver.approve`, `jv.cp.waive` | waiver requester |
| `carveout.transfer.verify`, `newco.incorporation.verify`, `newco.regulatory.verify`, `readiness.check.signoff`, `finance.benefit.verify`, `jv.cp.verify` | record owner and the person who recorded the status/evidence |
| `readiness.go_no_go.decide`, `readiness.tsa.approve_exit`, `jv.signing.record`, `jv.closing.declare`, `jv.partner.approve_contact`, `jv.nda.record` | requester of the decision/confirmation (a pending request by another person must exist) |
| `finance.snapshot.approve` | preparer; for an intercompany reconciliation its creator and every person who edited it (record history — DOM-P4-16, DOM-P34R-09) |
| `jv.dd_answer.review` | drafter |
| `jv.disclosure.release` | drafter/uploader of the item and release requester |
| `jv.clean_team_output.release` | submitter |
| `documents.evidence.verify` | evidence linker and document-version uploader |
| `documents.claim.verify` | claim extractor/proposer |
| `documents.document.declassify`, `documents.document.dispose` | requester of the change |
| `imports.batch.approve`, `imports.quarantine.release` | batch/file uploader |
| `integrations.send_authority.approve` | requester/configurer |
| `ai.killswitch.release` | activator |
| `admin.users.manage`, `admin.access.suspend`, `admin.role_assignment.manage`, `admin.clearance.grant`, `jv.room.grant_access` | the target user (grantee) |

**"The person who recorded the evidence" (SEC-P34-01, P3/P4 security review).** It is EVERY person who linked active
evidence of the record (`evidence_link.added_by`, status `active`), whoever ran the status command: a verifier who
supplied any of the evidence it is asked to verify is refused (403), as the gate criteria already did. Implemented for
`jv.cp.verify` (CP verify → `jv.cp.self_verification`; closing deliverable acceptance → `jv.checklist_item.self_acceptance`;
post-close obligation verify → `jv.obligation.self_verification`), `finance.benefit.verify` (realization verify →
`finance.benefit.verify_self`) and `governance.action.verify_closure` (the action's evidence linkers →
`governance.action.linker_verification`, in addition to the owners). The readiness sign-off, NewCo incorporation /
regulatory and carve-out transfer verifications are fixed with the P3-module findings (separate change). Considered and
not changed: `finance.snapshot.approve` (figures are validated and approved by two further people on a content hash, not
on evidence links) and `governance.decision.verify_implementation` (every implementing action must first be verified
closed by a non-linker). `jv.cp.verify` also decides a checklist item's "not required" request; its self is the requester
(SEC-P34-10). While a decision paper is `draft` or `submitted` only its requester links evidence to it (SEC-P34-13), so
the requester stays the only person who shaped the paper.

**"The person who recorded the evidence" — P3 commands as implemented (DOM-P3-10 / SEC-P34-01, P3 part).** Every person who
linked an active (or conflicting) evidence link of the record (`evidence_link.added_by`, read for the rule whatever the
caller may see) is an additional `not_self` subject, checked one by one (a refusal is 403 and audited as denied):
`readiness.check.signoff` (with the check's owner, creator and the recorder of its latest test —
`apps/api/src/modules/readiness/checks.service.ts`), `newco.incorporation.verify` (with the status recorder —
`newco/legal-entities.service.ts`), `newco.regulatory.verify` for the outcome (with the registrant) and for "conditions
satisfied" (with the recorder of the outcome — `newco/regulatory.service.ts`), `carveout.transfer.verify` (with the reporter —
`carveout/transfers.service.ts`). The specialist "transfer not applicable" determination on an in-scope item
(`carveout.transfer.verify`, DOM-P3-05) is not by the item's owner or creator. `newco.regulatory.verify` is held by the
Legal role only (REQ-AGR-004, SEC-P34-05): applicability determinations, outcomes and conditions are recorded by Legal.

Quorum, majority, recusal and tie rules are computed **on the server** from committee membership at the vote timestamp. Historical votes are never recomputed when membership or delegation changes later (master prompt §4.2).

### 5.2 Special meanings of `authority`

| Permission | `authority` means |
|---|---|
| `governance.charter.approve`, `governance.authority_matrix.approve` | The approving instrument (reference and evidence document) is attached and the actor is its approver of record. The platform records authority; it does not originate it. |
| Decision, gate, waiver, baseline, CR, perimeter, go/no-go, TSA exit, CP waiver, signing, closing, finance approval, partner contact, template migration, disposal, project archive | Active approved `AuthorityMatrixVersion` authorises the actor/committee for this decision type and amount (same currency and unit_scale) |
| `admin.role_assignment.manage`, `jv.room.grant_access` | Assignability table (§4) |
| `admin.clearance.grant` | Target clearance ≤ grantor's effective clearance; expiry set |
| `notifications.message.send` | Destination is on the project's approved destination list, send authority is active (`integrations.send_authority.approve`), and every recipient passes read authorization for the derived content (§2.6). Partner/external destinations are never reachable from an AI proposal. |
| `integrations.send_authority.approve` | Destinations ⊆ organisation-approved destination list configured by platform_admin |
| `ai.proposal.approve` | The approver passes `authorize(approver, proposal.actionPermission, proposal.target)` at approval time; the worker re-checks at execution time |
| `ai.autopilot_policy.approve` | Allowlist ⊆ permissions with `ai = propose`; limits ≤ organisation caps; expiry set |

---

## 6. Role × permission matrix (generated)

- Permission keys: **190** across **18** modules.
- Roles: **14**; service principals: **3** (not roles).
- Permissions carrying at least one ABAC condition: **162**.
  - `classification`: 141
  - `room`: 33
  - `clean_team`: 21
  - `not_self`: 54
  - `authority`: 25
  - `own_workstream`: 14
- AI usage: `retrieve` 18, `propose` 19, `none` 153.
- Audited reads (`auditRead`): `jv.room.read`, `jv.disclosure.view`, `jv.disclosure.download`, `documents.document.download`, `reports.snapshot.export`, `audit.event.export`.
- Project-level reads for workstream-scoped grants (`projectLevelRead`, §2.2.1, pending confirmation by Mobily data governance): `portfolio.project.read`, `gates.gate.read`, `documents.document.read`, `documents.document.download`.
- Permissions per role: PLA 25, PFA 25, SPO 75, CHR 37, SEC 63, PM 97, WSL 54, CON 27, FAP 39, FIN 58, LEG 74, CLT 10, AUD 35, EXT 7.

#### Identity & administration (`admin.*`, 11 permissions)

| Permission | Cond. | AI | PLA | PFA | SPO | CHR | SEC | PM | WSL | CON | FAP | FIN | LEG | CLT | AUD | EXT |
|---|---|---|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|
| `admin.directory.search` | – | – | ● | ● | ● | ● | ● | ● | ● | ● | ● | ● | ● |  |  |  |
| `admin.users.read` | – | – | ● | ● |  |  |  |  |  |  |  |  |  |  | ● |  |
| `admin.users.manage` | S | – | ● |  |  |  |  |  |  |  |  |  |  |  |  |  |
| `admin.sessions.revoke` | – | – | ● |  |  |  |  |  |  |  |  |  |  |  |  |  |
| `admin.access.suspend` | S | – | ● |  |  |  |  |  |  |  |  |  |  |  |  |  |
| `admin.external_access.suspend` | – | – | ● |  |  |  |  |  |  |  |  |  |  |  |  |  |
| `admin.role_assignment.read` | – | – | ● | ● | ● |  |  | ● |  |  |  |  |  |  | ● |  |
| `admin.role_assignment.manage` | S,A | – | ● | ● |  |  |  | ● |  |  |  |  |  |  |  |  |
| `admin.clearance.grant` | S,A | – |  |  | ● |  |  |  |  |  |  |  |  |  |  |  |
| `admin.org_settings.manage` | – | – | ● |  |  |  |  |  |  |  |  |  |  |  |  |  |
| `admin.service_account.manage` | – | – | ● |  |  |  |  |  |  |  |  |  |  |  |  |  |

#### Portfolio (`portfolio.*`, 8 permissions)

| Permission | Cond. | AI | PLA | PFA | SPO | CHR | SEC | PM | WSL | CON | FAP | FIN | LEG | CLT | AUD | EXT |
|---|---|---|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|
| `portfolio.portfolio.read` | – | R | ● | ● | ● |  | ● |  |  |  |  |  |  |  | ● |  |
| `portfolio.portfolio.manage` | – | – |  | ● |  |  |  |  |  |  |  |  |  |  |  |  |
| `portfolio.project.create` | – | – |  | ● |  |  |  |  |  |  |  |  |  |  |  |  |
| `portfolio.project.read` | C ⓟ | R |  | ● | ● | ● | ● | ● | ● | ● | ● | ● | ● |  | ● |  |
| `portfolio.project.update` | C | – |  |  | ● |  |  | ● |  |  |  |  |  |  |  |  |
| `portfolio.project.archive` | A | – |  | ● |  |  |  |  |  |  |  |  |  |  |  |  |
| `portfolio.dashboard.read` | C | R |  | ● | ● | ● | ● |  |  |  |  |  |  |  | ● |  |
| `portfolio.cross_dependency.manage` | C | – |  |  |  |  |  | ● |  |  |  |  |  |  |  |  |

#### Project configuration & templates (`config.*`, 6 permissions)

| Permission | Cond. | AI | PLA | PFA | SPO | CHR | SEC | PM | WSL | CON | FAP | FIN | LEG | CLT | AUD | EXT |
|---|---|---|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|
| `config.template.read` | – | – |  | ● | ● |  | ● | ● |  |  |  |  |  |  | ● |  |
| `config.template.manage` | – | – |  | ● |  |  |  |  |  |  |  |  |  |  |  |  |
| `config.template.publish` | S | – |  | ● |  |  |  |  |  |  |  |  |  |  |  |  |
| `config.template_migration.propose` | – | – |  | ● |  |  |  | ● |  |  |  |  |  |  |  |  |
| `config.template_migration.approve` | S,A | – |  |  | ● |  |  |  |  |  |  |  |  |  |  |  |
| `config.project_settings.manage` | – | – |  |  |  |  |  | ● |  |  |  |  |  |  |  |  |

#### Governance (committees, meetings, decisions, actions) (`governance.*`, 25 permissions)

| Permission | Cond. | AI | PLA | PFA | SPO | CHR | SEC | PM | WSL | CON | FAP | FIN | LEG | CLT | AUD | EXT |
|---|---|---|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|
| `governance.committee.read` | C | R |  |  | ● | ● | ● | ● | ● |  | ● | ● | ● |  | ● |  |
| `governance.committee.manage` | C | – |  |  |  |  | ● |  |  |  |  |  |  |  |  |  |
| `governance.charter.approve` | C,S,A | – |  |  | ● |  |  |  |  |  |  |  |  |  |  |  |
| `governance.authority_matrix.manage` | C | – |  |  |  |  | ● |  |  |  |  |  |  |  |  |  |
| `governance.authority_matrix.approve` | C,S,A | – |  |  | ● |  |  |  |  |  |  |  |  |  |  |  |
| `governance.meeting.read` | C | R |  |  | ● | ● | ● | ● | ● |  | ● | ● | ● |  | ● |  |
| `governance.meeting.manage` | C | – |  |  |  |  | ● |  |  |  |  |  |  |  |  |  |
| `governance.agenda_request.create` | C | P |  |  | ● | ● | ● | ● | ● |  | ● | ● | ● |  |  |  |
| `governance.agenda_request.screen` | C,S | – |  |  |  |  | ● |  |  |  |  |  |  |  |  |  |
| `governance.decision.read` | C | R |  |  | ● | ● | ● | ● | ● | ● | ● | ● | ● |  | ● |  |
| `governance.decision.draft` | C | P |  |  | ● |  | ● | ● | ● |  | ● | ● | ● |  |  |  |
| `governance.decision.submit` | C | – |  |  | ● |  | ● | ● | ● |  | ● | ● | ● |  |  |  |
| `governance.decision.review` | C,S | – |  |  |  |  | ● |  |  |  |  |  |  |  |  |  |
| `governance.conflict.declare` | – | – |  |  | ● | ● |  |  |  |  | ● | ● | ● |  |  |  |
| `governance.decision.vote` | C,S | – |  |  | ● | ● |  |  |  |  | ● | ● | ● |  |  |  |
| `governance.circulation.initiate` | C | – |  |  |  | ● | ● |  |  |  |  |  |  |  |  |  |
| `governance.decision.record_outcome` | C,S,A | – |  |  |  | ● | ● |  |  |  |  |  |  |  |  |  |
| `governance.decision.record_external_approval` | C,S | – |  |  |  | ● | ● |  |  |  |  |  |  |  |  |  |
| `governance.decision.verify_implementation` | C,S | – |  |  | ● |  | ● |  |  |  |  |  |  |  |  |  |
| `governance.minutes.draft` | C | P |  |  |  |  | ● |  |  |  |  |  |  |  |  |  |
| `governance.minutes.approve` | C,S | – |  |  |  | ● |  |  |  |  |  |  |  |  |  |  |
| `governance.action.manage` | C | P |  |  |  |  | ● | ● |  |  |  |  |  |  |  |  |
| `governance.action.update` | C,W | P |  |  | ● | ● | ● | ● | ● | ● | ● | ● | ● |  |  |  |
| `governance.action.verify_closure` | C,S | – |  |  |  |  | ● |  |  |  |  |  |  |  |  |  |
| `governance.escalation.raise` | C | P |  |  | ● | ● | ● | ● | ● |  |  |  |  |  |  |  |

#### Planning & delivery (`planning.*`, 17 permissions)

| Permission | Cond. | AI | PLA | PFA | SPO | CHR | SEC | PM | WSL | CON | FAP | FIN | LEG | CLT | AUD | EXT |
|---|---|---|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|
| `planning.plan.read` | C | R |  | ● | ● | ● | ● | ● | ● | ● | ● | ● | ● |  | ● |  |
| `planning.wbs.manage` | C | P |  |  |  |  |  | ● | ● |  |  |  |  |  |  |  |
| `planning.task.manage` | C | P |  |  |  |  |  | ● | ● |  |  |  |  |  |  |  |
| `planning.ownership.reassign` | C | – |  |  |  |  |  | ● | ● |  |  |  |  |  |  |  |
| `planning.task.update_progress` | C,W | P |  |  |  |  |  | ● | ● | ● |  |  |  |  |  |  |
| `planning.deliverable.accept` | C,S | – |  |  | ● | ● |  |  | ● |  | ● |  |  |  |  |  |
| `planning.dependency.manage` | C | P |  |  |  |  |  | ● | ● |  |  |  |  |  |  |  |
| `planning.baseline.propose` | C | – |  |  |  |  |  | ● |  |  |  |  |  |  |  |  |
| `planning.baseline.approve` | C,S,A | – |  |  | ● |  |  |  |  |  |  |  |  |  |  |  |
| `planning.change_request.create` | C | P |  |  | ● |  | ● | ● | ● |  |  |  |  |  |  |  |
| `planning.change_request.assess` | C | – |  |  |  |  |  | ● |  |  | ● | ● | ● |  |  |  |
| `planning.change_request.approve` | C,S,A | – |  |  | ● | ● |  |  |  |  |  |  |  |  |  |  |
| `planning.raid.manage` | C,W | P |  |  |  |  |  | ● | ● | ● |  |  |  |  |  |  |
| `planning.rag_override.set` | C,W | – |  |  |  |  |  | ● | ● |  |  |  |  |  |  |  |
| `planning.rag_override.review` | C,S | – |  |  |  |  | ● |  |  |  |  |  |  |  |  |  |
| `planning.status_update.submit` | C,W | P |  |  |  |  |  |  | ● | ● |  |  |  |  |  |  |
| `planning.status_update.review` | C,S | – |  |  |  |  | ● | ● |  |  |  |  |  |  |  |  |

#### Business gates (`gates.*`, 11 permissions)

| Permission | Cond. | AI | PLA | PFA | SPO | CHR | SEC | PM | WSL | CON | FAP | FIN | LEG | CLT | AUD | EXT |
|---|---|---|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|
| `gates.gate.read` | C ⓟ | R |  | ● | ● | ● | ● | ● | ● | ● | ● | ● | ● |  | ● |  |
| `gates.definition.manage` | C | – |  |  |  |  | ● | ● |  |  |  |  |  |  |  |  |
| `gates.definition.approve` | C,S,A | – |  |  | ● |  |  |  |  |  |  |  |  |  |  |  |
| `gates.criterion.set_waivability` | C | – |  |  |  |  |  |  |  |  | ● | ● | ● |  |  |  |
| `gates.evidence.attach` | C,W | P |  |  |  |  |  | ● | ● | ● |  | ● | ● |  |  |  |
| `gates.assessment.submit` | C,W | – |  |  |  |  | ● | ● | ● |  |  |  | ● |  |  |  |
| `gates.assessment.review` | C,S | – |  |  | ● |  | ● | ● | ● |  | ● | ● | ● |  |  |  |
| `gates.assessment.decide` | C,S,A | – |  |  | ● | ● |  |  |  |  |  |  |  |  |  |  |
| `gates.assessment.reopen` | C | – |  |  | ● | ● | ● |  |  |  |  |  |  |  |  |  |
| `gates.waiver.request` | C | – |  |  |  |  |  | ● | ● |  |  | ● | ● |  |  |  |
| `gates.waiver.approve` | C,S,A | – |  |  | ● | ● |  |  |  |  |  |  |  |  |  |  |

`gates.assessment.review` is narrowed per criterion by the gates service: the reviewer must also hold the criterion's designated `reviewerRole` in the project. That means a project-wide role; for `workstream_lead`, a `workstream_lead` role on any workstream of the project, since criteria carry no workstream. Otherwise the service refuses with 403 `gates.not_designated_reviewer`. This applies to accepting or returning a criterion, and to approving or rejecting an N/A proposal. `not_self` still applies: the evidence submitter never accepts their own evidence.

Gate roles (DOM-P2-16, REQ-LCY-010; business-gates.md §2.4). `gates.assessment.submit` (start, mark ready, back to assessment, link decision) is narrowed to the **gate's owner role** through `W`: `ownerRoles: [gate.ownerRole]`, so the owner-role holder — or the project manager (§2.4) — passes; a `workstream_lead` owner acts through the workstream it leads. Any other holder is refused with 403 `gates.not_gate_owner` (a workstream lead can submit G1 but not the legal-owned G2). The **gate-level review** (`POST …/assessment/review`, endorse or return) needs `gates.assessment.review` **and** the gate's `reviewerRole` (403 `gates.not_designated_gate_reviewer`), and `not_self` against the person who started the cycle. Mark ready needs an endorsement recorded after the cycle's last criterion change (422) and a submitter other than the endorsing reviewer (403 `gates.assessment.reviewer_cannot_submit`); `decide` is refused to the submitter and to the gate reviewer.

#### Carve-out (perimeter, transfers, agreements, consents) (`carveout.*`, 8 permissions)

| Permission | Cond. | AI | PLA | PFA | SPO | CHR | SEC | PM | WSL | CON | FAP | FIN | LEG | CLT | AUD | EXT |
|---|---|---|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|
| `carveout.register.read` | C | R |  |  | ● | ● | ● | ● | ● | ● | ● | ● | ● |  | ● |  |
| `carveout.perimeter.manage` | C,W | – |  |  |  |  |  | ● | ● |  |  |  |  |  |  |  |
| `carveout.perimeter.approve` | C,S,A | – |  |  | ● |  |  |  |  |  |  |  |  |  |  |  |
| `carveout.transfer.manage` | C,W | – |  |  |  |  |  | ● | ● |  |  |  |  |  |  |  |
| `carveout.transfer.verify` | C,S | – |  |  |  |  |  |  |  |  | ● | ● | ● |  |  |  |
| `carveout.agreement.manage` | C | – |  |  |  |  |  | ● |  |  |  |  | ● |  |  |  |
| `carveout.consent.manage` | C | – |  |  |  |  |  | ● | ● |  |  |  | ● |  |  |  |
| `carveout.contract.classify` | C | – |  |  |  |  |  |  |  |  |  |  | ● |  |  |  |

#### NewCo & regulatory (`newco.*`, 6 permissions)

| Permission | Cond. | AI | PLA | PFA | SPO | CHR | SEC | PM | WSL | CON | FAP | FIN | LEG | CLT | AUD | EXT |
|---|---|---|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|
| `newco.register.read` | C | R |  |  | ● | ● | ● | ● | ● | ● | ● | ● | ● |  | ● |  |
| `newco.legal_entity.manage` | C | – |  |  |  |  |  | ● |  |  |  |  | ● |  |  |  |
| `newco.incorporation.manage` | C | – |  |  |  |  |  | ● |  |  |  |  | ● |  |  |  |
| `newco.incorporation.verify` | C,S | – |  |  |  |  |  |  |  |  |  |  | ● |  |  |  |
| `newco.regulatory.manage` | C | – |  |  |  |  |  |  |  |  |  |  | ● |  |  |  |
| `newco.regulatory.verify` | C,S | – |  |  |  |  |  |  |  |  |  |  | ● |  |  |  |

#### Readiness, cutover & TSA (`readiness.*`, 7 permissions)

| Permission | Cond. | AI | PLA | PFA | SPO | CHR | SEC | PM | WSL | CON | FAP | FIN | LEG | CLT | AUD | EXT |
|---|---|---|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|
| `readiness.register.read` | C | R |  |  | ● | ● | ● | ● | ● | ● | ● | ● | ● |  | ● |  |
| `readiness.check.manage` | C,W | P |  |  |  |  |  | ● | ● | ● |  |  |  |  |  |  |
| `readiness.check.signoff` | C,S | – |  |  |  |  |  |  | ● |  | ● |  |  |  |  |  |
| `readiness.cutover.manage` | C,W | – |  |  |  |  |  | ● | ● |  |  |  |  |  |  |  |
| `readiness.go_no_go.decide` | C,S,A | – |  |  | ● | ● |  |  |  |  |  |  |  |  |  |  |
| `readiness.tsa.manage` | C,W | – |  |  |  |  |  | ● | ● |  |  |  |  |  |  |  |
| `readiness.tsa.approve_exit` | C,S,A | – |  |  | ● |  |  |  |  |  | ● |  |  |  |  |  |

#### Finance & value (`finance.*`, 7 permissions)

| Permission | Cond. | AI | PLA | PFA | SPO | CHR | SEC | PM | WSL | CON | FAP | FIN | LEG | CLT | AUD | EXT |
|---|---|---|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|
| `finance.record.read` | C | R |  |  | ● | ● | ● | ● | ● |  | ● | ● |  |  | ● |  |
| `finance.budget.manage` | C | – |  |  |  |  |  | ● |  |  |  | ● |  |  |  |  |
| `finance.snapshot.approve` | C,S,A | – |  |  |  |  |  |  |  |  |  | ● |  |  |  |  |
| `finance.model.manage` | C | – |  |  |  |  |  |  |  |  |  | ● |  |  |  |  |
| `finance.benefit.manage` | C | – |  |  |  |  |  | ● |  |  |  | ● |  |  |  |  |
| `finance.benefit.verify` | C,S | – |  |  |  |  |  |  |  |  |  | ● |  |  |  |  |
| `finance.kpi.manage` | C | – |  |  |  |  |  | ● |  |  |  | ● |  |  |  |  |

#### JV, partner rooms, due diligence & closing (`jv.*`, 37 permissions)

| Permission | Cond. | AI | PLA | PFA | SPO | CHR | SEC | PM | WSL | CON | FAP | FIN | LEG | CLT | AUD | EXT |
|---|---|---|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|
| `jv.partner.read` | C | R |  |  | ● | ● |  | ● |  |  |  | ● | ● |  | ● |  |
| `jv.partner.manage` | C | – |  |  | ● |  |  | ● |  |  |  |  |  |  |  |  |
| `jv.partner.approve_contact` | C,S,A | – |  |  | ● |  |  |  |  |  |  |  |  |  |  |  |
| `jv.partner.advance_stage` | C | – |  |  |  |  |  | ● |  |  |  |  | ● |  |  |  |
| `jv.nda.record` | C,S | – |  |  |  |  |  |  |  |  |  |  | ● |  |  |  |
| `jv.deal.read` | C | R |  |  | ● | ● |  | ● |  |  |  | ● | ● |  | ● |  |
| `jv.proposal.manage` | C | – |  |  |  |  |  | ● |  |  |  | ● | ● |  |  |  |
| `jv.scenario.manage` | C | – |  |  |  |  |  |  |  |  |  | ● | ● |  |  |  |
| `jv.negotiation.manage` | C | – |  |  | ● |  |  |  |  |  |  |  | ● |  |  |  |
| `jv.room.read` | R,T,C ⓐ | R |  |  | ● |  |  | ● | ● | ● | ● | ● | ● | ● | ● |  |
| `jv.room.manage` | R,T | – |  |  |  |  |  | ● |  |  |  |  | ● |  |  |  |
| `jv.room.grant_access` | R,T,S | – |  |  | ● |  |  |  |  |  |  |  | ● |  |  |  |
| `jv.room.revoke_access` | R | – |  |  | ● |  |  | ● |  |  |  |  | ● |  |  |  |
| `jv.room.lock` | R | – |  |  | ● |  |  |  |  |  |  |  | ● |  |  |  |
| `jv.dd_request.create` | R,C | – |  |  |  |  |  | ● |  |  |  | ● | ● |  |  | ● |
| `jv.dd_request.read` | R,T,C | R |  |  | ● |  |  | ● | ● | ● | ● | ● | ● | ● | ● |  |
| `jv.dd_request.read_external` | R | – |  |  |  |  |  |  |  |  |  |  |  |  |  | ● |
| `jv.dd_request.assign` | R,C | – |  |  |  |  |  | ● |  |  |  | ● | ● |  |  |  |
| `jv.dd_answer.draft` | R,T,C,W | P |  |  |  |  |  | ● | ● | ● |  | ● | ● | ● |  |  |
| `jv.dd_answer.review` | R,T,C,S | – |  |  |  |  |  |  |  |  | ● | ● | ● |  |  |  |
| `jv.disclosure.release` | R,C,S | – |  |  | ● |  |  |  |  |  |  |  | ● |  |  |  |
| `jv.disclosure.revoke` | R | – |  |  | ● |  |  |  |  |  |  |  | ● |  |  |  |
| `jv.disclosure.view` | R,C ⓐ | – |  |  |  |  |  |  |  |  |  |  |  |  |  | ● |
| `jv.disclosure.download` | R,C ⓐ | – |  |  |  |  |  |  |  |  |  |  |  |  |  | ● |
| `jv.disclosure_log.read` | R | – |  |  | ● |  |  | ● |  |  |  |  | ● |  | ● |  |
| `jv.submission.upload` | R | – |  |  |  |  |  |  |  |  |  |  |  |  |  | ● |
| `jv.finding.manage` | R,T,C | – |  |  |  |  |  | ● |  |  |  | ● | ● | ● |  |  |
| `jv.clean_team_output.submit` | R,T | – |  |  |  |  |  |  |  |  |  |  |  | ● |  |  |
| `jv.clean_team_output.release` | R,T,S | – |  |  |  |  |  |  |  |  |  |  | ● |  |  |  |
| `jv.closing_checklist.manage` | C | – |  |  |  |  |  | ● |  |  |  |  | ● |  |  |  |
| `jv.cp.manage` | C | – |  |  |  |  |  | ● |  |  |  |  | ● |  |  |  |
| `jv.cp.set_waivability` | C | – |  |  |  |  |  |  |  |  |  |  | ● |  |  |  |
| `jv.cp.verify` | C,S | – |  |  |  |  |  |  |  |  | ● |  | ● |  |  |  |
| `jv.cp.waive` | C,S,A | – |  |  | ● |  |  |  |  |  |  |  |  |  |  |  |
| `jv.signing.record` | C,S,A | – |  |  | ● |  |  |  |  |  |  |  | ● |  |  |  |
| `jv.closing.declare` | C,S,A | – |  |  | ● |  |  |  |  |  |  |  |  |  |  |  |
| `jv.funds_flow.manage` | C | – |  |  |  |  |  |  |  |  |  | ● |  |  |  |  |

#### Documents & evidence (`documents.*`, 12 permissions)

| Permission | Cond. | AI | PLA | PFA | SPO | CHR | SEC | PM | WSL | CON | FAP | FIN | LEG | CLT | AUD | EXT |
|---|---|---|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|
| `documents.document.read` | C,R,T ⓟ | R |  |  | ● | ● | ● | ● | ● | ● | ● | ● | ● | ● | ● |  |
| `documents.document.download` | C,R,T ⓐ ⓟ | – |  |  | ● | ● | ● | ● | ● | ● | ● | ● | ● | ● | ● |  |
| `documents.document.upload` | C,R,T | – |  |  | ● |  | ● | ● | ● | ● |  | ● | ● | ● |  |  |
| `documents.document.classify` | C | – |  |  |  |  | ● | ● |  |  |  | ● | ● |  |  |  |
| `documents.document.declassify` | C,S | – |  |  | ● |  |  |  |  |  |  |  | ● |  |  |  |
| `documents.document.archive` | C,R,W | – |  |  |  |  |  | ● | ● | ● |  |  |  |  |  |  |
| `documents.evidence.link` | C,R,T | P |  |  | ● |  | ● | ● | ● | ● |  | ● | ● |  |  |  |
| `documents.evidence.verify` | C,S | – |  |  |  |  | ● |  |  |  | ● | ● | ● |  |  |  |
| `documents.source.manage` | C | P |  |  |  |  | ● | ● |  |  |  |  |  |  |  |  |
| `documents.claim.verify` | C,S | – |  |  |  |  | ● |  |  |  | ● | ● | ● |  |  |  |
| `documents.legal_hold.manage` | C | – |  |  |  |  |  |  |  |  |  |  | ● |  |  |  |
| `documents.document.dispose` | C,S,A | – |  |  |  |  |  |  |  |  |  |  | ● |  |  |  |

Evidence links (`documents.evidence.link`) also need the **target's** work permission (`EVIDENCE_TARGET_PERMISSION`, 403
`evidence.target_permission` without it). On a gate criterion that permission is `gates.evidence.attach` with its `W`
condition evaluated exactly as by the criterion commands (submit evidence, propose N/A, note): the criterion's `ownerRole`
or the project manager (§2.4). Anyone else is refused (403) — linking is refused exactly like submitting (SEC-P2-05). For the
other target types the link checks the RBAC grant of the target permission; their `W` conditions apply to the target's
own commands. On a **decision** in `draft` or `submitted` only the paper's requester links evidence (403
`governance.decision.not_requester`, an unknown requester fails closed): the paper's evidence is part of the paper
(DOM-P2-14) and the paper is written by its requester only (SEC-P2-02, residual SEC-P34-13).

#### Reporting (`reports.*`, 5 permissions)

| Permission | Cond. | AI | PLA | PFA | SPO | CHR | SEC | PM | WSL | CON | FAP | FIN | LEG | CLT | AUD | EXT |
|---|---|---|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|
| `reports.report.generate` | C,R,T | – |  | ● | ● | ● | ● | ● | ● |  | ● | ● | ● |  |  |  |
| `reports.snapshot.create` | C | – |  |  |  |  | ● | ● |  |  |  |  |  |  |  |  |
| `reports.snapshot.read` | C,R,T | R |  | ● | ● | ● | ● | ● | ● | ● | ● | ● | ● |  | ● |  |
| `reports.snapshot.export` | C,R,T ⓐ | – |  |  | ● | ● | ● | ● |  |  |  | ● | ● |  | ● |  |
| `reports.bi_view.read` | C | – |  |  |  |  |  |  |  |  |  |  |  |  |  |  |

#### Imports (`imports.*`, 5 permissions)

| Permission | Cond. | AI | PLA | PFA | SPO | CHR | SEC | PM | WSL | CON | FAP | FIN | LEG | CLT | AUD | EXT |
|---|---|---|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|
| `imports.batch.read` | C | – |  |  |  |  | ● | ● | ● |  |  | ● |  |  | ● |  |
| `imports.batch.create` | C | – |  |  |  |  | ● | ● | ● |  |  | ● |  |  |  |  |
| `imports.batch.approve` | C,S | – |  |  |  |  | ● | ● |  |  |  |  |  |  |  |  |
| `imports.batch.rollback` | C | – |  |  |  |  | ● | ● |  |  |  |  |  |  |  |  |
| `imports.quarantine.release` | S | – | ● |  |  |  |  |  |  |  |  |  |  |  |  |  |

#### Integrations (`integrations.*`, 4 permissions)

| Permission | Cond. | AI | PLA | PFA | SPO | CHR | SEC | PM | WSL | CON | FAP | FIN | LEG | CLT | AUD | EXT |
|---|---|---|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|
| `integrations.connection.read` | – | – | ● | ● |  |  |  | ● |  |  |  |  |  |  | ● |  |
| `integrations.connection.manage` | – | – | ● |  |  |  |  |  |  |  |  |  |  |  |  |  |
| `integrations.connection.disable` | – | – | ● |  |  |  |  | ● |  |  |  |  |  |  |  |  |
| `integrations.send_authority.approve` | S,A | – |  |  | ● |  |  |  |  |  |  |  |  |  |  |  |

#### Notifications (`notifications.*`, 4 permissions)

| Permission | Cond. | AI | PLA | PFA | SPO | CHR | SEC | PM | WSL | CON | FAP | FIN | LEG | CLT | AUD | EXT |
|---|---|---|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|
| `notifications.inbox.read` | C,R,T | – | ● | ● | ● | ● | ● | ● | ● | ● | ● | ● | ● | ● | ● | ● |
| `notifications.preferences.manage_own` | – | – | ● | ● | ● | ● | ● | ● | ● | ● | ● | ● | ● | ● | ● | ● |
| `notifications.policy.manage` | – | – |  |  |  |  | ● | ● |  |  |  |  |  |  |  |  |
| `notifications.message.send` | C,A | P |  |  |  |  | ● | ● |  |  |  |  |  |  |  |  |

#### AI runtime PM (`ai.*`, 14 permissions)

| Permission | Cond. | AI | PLA | PFA | SPO | CHR | SEC | PM | WSL | CON | FAP | FIN | LEG | CLT | AUD | EXT |
|---|---|---|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|
| `ai.assistant.use` | C,R,T | – |  |  | ● | ● | ● | ● | ● | ● | ● | ● | ● |  |  |  |
| `ai.briefing.subscribe` | C | – |  |  | ● | ● | ● | ● | ● | ● | ● | ● | ● |  |  |  |
| `ai.proposal.read` | C | – |  |  | ● | ● | ● | ● | ● |  | ● | ● | ● |  | ● |  |
| `ai.proposal.approve` | C,S,A | – |  |  | ● |  | ● | ● | ● |  |  |  |  |  |  |  |
| `ai.proposal.reject` | C | – |  |  | ● |  | ● | ● | ● |  |  |  |  |  |  |  |
| `ai.settings.manage` | – | – |  | ● | ● |  |  |  |  |  |  |  |  |  |  |  |
| `ai.autopilot_policy.approve` | S,A | – |  |  | ● |  |  |  |  |  |  |  |  |  |  |  |
| `ai.provider.configure` | – | – | ● |  |  |  |  |  |  |  |  |  |  |  |  |  |
| `ai.killswitch.activate` | – | – | ● | ● | ● |  | ● | ● |  |  |  |  |  |  |  |  |
| `ai.killswitch.release` | S | – | ● | ● | ● |  |  |  |  |  |  |  |  |  |  |  |
| `ai.run.read` | C,R,T | – |  |  | ● |  | ● | ● |  |  |  |  |  |  | ● |  |
| `ai.operations.read` | – | – | ● | ● |  |  |  |  |  |  |  |  |  |  | ● |  |
| `ai.index.rebuild` | – | – | ● |  |  |  |  | ● |  |  |  |  |  |  |  |  |
| `ai.evaluation.run` | – | – | ● |  |  |  |  |  |  |  |  |  |  |  |  |  |

#### Audit (`audit.*`, 4 permissions)

| Permission | Cond. | AI | PLA | PFA | SPO | CHR | SEC | PM | WSL | CON | FAP | FIN | LEG | CLT | AUD | EXT |
|---|---|---|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|
| `audit.event.read` | C,R,T | – |  |  |  |  |  |  |  |  |  |  |  |  | ● |  |
| `audit.security_event.read` | – | – | ● |  |  |  |  |  |  |  |  |  |  |  | ● |  |
| `audit.event.export` | C,R,T ⓐ | – |  |  |  |  |  |  |  |  |  |  |  |  | ● |  |
| `audit.chain.verify` | – | – | ● |  |  |  |  |  |  |  |  |  |  |  | ● |  |


---

## 7. Permission descriptions and source of truth

- Each key's description, conditions, `ai` flag and `auditRead` flag live **once**, in the JSON block (§11), one line per key. This avoids two copies drifting apart.
- The tables in §6 and the JSON in §11 were generated from a single definition and cross-checked: 190 rows, 0 mismatches between the table cells and the JSON role lists.
- Once `packages/domain/src/policy/` exists, **that TypeScript module becomes the source of truth**. This document should then be regenerated from it (or checked against it by SEC-T-35) and must not be hand-edited on its own.

---

## 8. AI-prohibited actions (master prompt §12.3) mapped to permissions

Every permission below has `ai: "none"`. **No AI tool exists** that calls it (tool registry test SEC-T-35 / AIT-22…AIT-25).

| Prohibited action | Permission keys (`ai: none`) |
|---|---|
| Approve gates / committee decisions | `gates.assessment.decide`, `gates.assessment.review`, `gates.definition.approve`, `governance.decision.vote`, `governance.decision.record_outcome`, `governance.decision.record_external_approval`, `governance.decision.verify_implementation`, `governance.minutes.approve`, `governance.charter.approve`, `governance.authority_matrix.approve`, `readiness.go_no_go.decide`, `readiness.check.signoff`, `readiness.tsa.approve_exit`, `planning.deliverable.accept`, `carveout.transfer.verify`, `newco.incorporation.verify`, `newco.regulatory.verify`, `jv.cp.verify`, `documents.evidence.verify`, `documents.claim.verify`, `finance.snapshot.approve`, `finance.benefit.verify`, `imports.batch.approve` |
| Waivers (AT-12, AT-13) | `gates.waiver.request`, `gates.waiver.approve`, `jv.cp.waive` |
| Change baselines / budgets / ownership | `planning.baseline.propose`, `planning.baseline.approve`, `planning.change_request.approve`, `planning.ownership.reassign`, `finance.budget.manage`, `finance.model.manage`, `jv.scenario.manage`, `carveout.perimeter.manage`, `carveout.perimeter.approve` |
| Grant VDR access | `jv.room.grant_access`, `jv.room.manage`, `jv.disclosure.release`, `jv.clean_team_output.release`, `admin.clearance.grant` |
| Contact a partner | `jv.partner.approve_contact`, `jv.partner.advance_stage`, `jv.nda.record`, `jv.disclosure.release`; `notifications.message.send` is `propose` **only** for internal approved destinations |
| Sign agreements | `jv.signing.record`, `carveout.agreement.manage` |
| Execute payments | none exist; `jv.funds_flow.manage` tracks flows only |
| Change permissions | all `admin.*`, `ai.settings.manage`, `ai.autopilot_policy.approve`, `integrations.*` |
| Delete evidence | `documents.document.archive`, `documents.document.dispose`, `documents.legal_hold.manage`, `imports.batch.rollback` |
| Declare transaction closing | `jv.closing.declare` |

---

## 9. Service principals

| Principal | Permissions | Notes |
|---|---|---|
| `ai_runtime` | Derived: `{p : p.ai ∈ {retrieve, propose}}` ∩ delegating user's **current** permissions ∩ project mode allowlist | Never an approver. Never holds role assignments. Every tool call and every execution re-runs `authorize` as the delegating user (AT-19). If the delegating user is disabled, the job is cancelled. |
| `bi_reader` | `reports.bi_view.read` | Explicit project list; max clearance internal unless raised through `admin.clearance.grant`; views are `security_invoker`; no room or clean-team data |
| `integration_adapter` | none | Authenticates to the external system only. Sends run under the approving/sending user's authority, re-checked at send time. |
| `svc-readiness` (worker jobs) | TSA expiry scan: `readiness.register.read`, `readiness.tsa.manage`; evidence reaction (DOM-P3-09, DOM-P34R-06): `readiness.register.read`, `readiness.check.manage`, `readiness.tsa.manage` (`apps/api/src/modules/readiness/readiness.jobs.ts`) | Marks a TSA expired-unresolved and escalates; returns a signed-off check whose evidence is no longer valid to in progress and flags the GOs it gated; withdraws a TSA replacement acceptance whose evidence is no longer valid. Never signs off, waives, decides a GO, extends, accepts or approves an exit |
| `svc-newco` (worker jobs) | Incorporation evidence reaction (DOM-P3-08): `newco.register.read`, `newco.incorporation.manage` (`apps/api/src/modules/newco/newco.jobs.ts`) | Returns a confirmed incorporation whose evidence is no longer valid to "proposed"; never verifies |
| `svc-carveout` (worker jobs) | Transfer evidence reaction (DOM-P34R-06): `carveout.register.read`, `carveout.transfer.manage` (`apps/api/src/modules/carveout/carveout.jobs.ts`) | Returns a verified transfer aspect whose evidence is no longer valid to in progress (`reject_evidence`, system entry); never reports, verifies or classifies |
| `svc-jv` (worker jobs) | One allowlist PER JOB (SEC-P34-17): the post-close overdue scan `jv.closing_checklist.manage`; the CP long-stop scan `jv.cp.manage` (`apps/api/src/modules/jv/jv.jobs.ts`) | Marks overdue / lapsed and raises system escalations only; never verifies, waives, extends, confirms or notifies externally (human-only commands refuse service principals). Test: `p34-sec-fixes.spec.ts` (SEC-P34-17) |

---

## 10. Invariants the implementation must test (SEC-T-35)

1. Every route in the contracts registry names exactly one permission key that exists in this matrix. The API refuses to boot otherwise (dev/test).
2. Every permission key in this matrix is used by at least one route or worker command, or is listed as reserved. Reserved (no route yet, fail-closed): `jv.submission.upload`, `jv.clean_team_output.submit`, `jv.clean_team_output.release` (P3/P4 security review, Info SEC-P34-17).
3. `auditor` holds no mutating permission except `audit.event.export`, `reports.snapshot.export`, `documents.document.download` (audited reads), `audit.chain.verify` (read-only verification) and `notifications.preferences.manage_own`.
4. `external_partner_limited` holds only room-conditioned `jv.*` permissions and own-notification permissions. External accounts cannot be assigned any other role.
5. `platform_admin` holds no permission with a `classification` or `room` condition (except its own inbox).
6. `clean_team` is only assignable at `partner_room` scope and only into rooms with `type = clean_team`.
7. No AI tool maps to a permission with `ai = none`. No permission with `not_self`/`authority` is `propose` (except `notifications.message.send`).
8. Every permission with `ai = retrieve` is a read action.
9. For every approval-type permission (`not_self`), a test proves the requester is refused (AT-05).
10. The JSON block below parses, validates against the policy schema, and equals the matrix tables (both are generated from one source).

---

## 11. Machine-readable matrix (JSON)

This block follows the requested schema, plus clearly optional **extensions** that the policy schema should accept:

- `permissions.<key>.ai` (`none | retrieve | propose`)
- `permissions.<key>.auditRead` (boolean, present only when true)
- `permissions.<key>.projectLevelRead` (boolean, present only when true; §2.2.1 — pending confirmation by Mobily data governance)
- `roles.<key>.domainClearance` (map of domain to clearance, finance_restricted/legal_restricted only)
- top-level `clearanceOrder`, `scopeOrder`, `servicePrincipals`

If the lead rejects an extension, drop it here and move the equivalent rule into code, keeping SEC-T-35 green.

```json
{
  "version": "policy-2026.09-draft",
  "clearanceOrder": ["public", "internal", "confidential", "restricted", "strictly_confidential"],
  "scopeOrder": ["organization", "portfolio", "project", "workstream", "partner_room"],
  "permissions": {
    "admin.directory.search": {"description": "Search the internal user directory (display name, org unit, work email) to pick owners/assignees. Never returns external users, roles or clearances.", "conditions": [], "ai": "none"},
    "admin.users.read": {"description": "View user accounts: status, account type (internal/external), IdP issuer+subject binding, last sign-in.", "conditions": [], "ai": "none"},
    "admin.users.manage": {"description": "Create, disable and reactivate accounts; bind IdP issuer+subject; bind an external account to exactly one counterparty.", "conditions": ["not_self"], "ai": "none"},
    "admin.sessions.revoke": {"description": "Revoke all active sessions of a user; effective on the next request.", "conditions": [], "ai": "none"},
    "admin.access.suspend": {"description": "Emergency suspension of all role assignments and room grants of one user (content-free, reversible, audited).", "conditions": ["not_self"], "ai": "none"},
    "admin.external_access.suspend": {"description": "Emergency suspension of all external (partner) sign-ins and sessions organisation-wide.", "conditions": [], "ai": "none"},
    "admin.role_assignment.read": {"description": "View role assignments, room grants and clearance grants within scope.", "conditions": [], "ai": "none"},
    "admin.role_assignment.manage": {"description": "Assign or revoke roles at a scope, limited by the assignability table.", "conditions": ["not_self", "authority"], "ai": "none"},
    "admin.clearance.grant": {"description": "Raise a user's clearance for one project above the role default, with reason and expiry; never above the grantor's own clearance.", "conditions": ["not_self", "authority"], "ai": "none"},
    "admin.org_settings.manage": {"description": "Manage organisation technical settings (session lifetimes, OIDC client, egress allowlist entries, upload limits). Unsafe production values are refused by config validation.", "conditions": [], "ai": "none"},
    "admin.service_account.manage": {"description": "Create, rotate and disable service principals (BI reader, integration identities).", "conditions": [], "ai": "none"},
    "portfolio.portfolio.read": {"description": "View portfolio/program structure and the names of projects in scope.", "conditions": [], "ai": "retrieve"},
    "portfolio.portfolio.manage": {"description": "Create and edit portfolios and programs.", "conditions": [], "ai": "none"},
    "portfolio.project.create": {"description": "Create a project from a published template version.", "conditions": [], "ai": "none"},
    "portfolio.project.read": {"description": "View project overview, charter, parties, sites and the four independent status dimensions.", "conditions": ["classification"], "ai": "retrieve", "projectLevelRead": true},
    "portfolio.project.update": {"description": "Edit the project profile through commands (objective, parties, sites list).", "conditions": ["classification"], "ai": "none"},
    "portfolio.project.archive": {"description": "Administratively archive a project once its handover criteria are met.", "conditions": ["authority"], "ai": "none"},
    "portfolio.dashboard.read": {"description": "View portfolio/program health aggregates computed only over records the caller may read.", "conditions": ["classification"], "ai": "retrieve"},
    "portfolio.cross_dependency.manage": {"description": "Create or edit a cross-project dependency; caller must also hold planning.dependency.manage in both projects; the counterpart project sees minimum fields only.", "conditions": ["classification"], "ai": "none"},
    "config.template.read": {"description": "View template versions (phases, gates, fields, forms, workflows, KPIs).", "conditions": [], "ai": "none"},
    "config.template.manage": {"description": "Author draft template versions.", "conditions": [], "ai": "none"},
    "config.template.publish": {"description": "Publish a template version (publisher must not be its author).", "conditions": ["not_self"], "ai": "none"},
    "config.template_migration.propose": {"description": "Preview and propose moving a project to a newer template version (AT-26).", "conditions": [], "ai": "none"},
    "config.template_migration.approve": {"description": "Approve a previewed template migration for a project.", "conditions": ["not_self", "authority"], "ai": "none"},
    "config.project_settings.manage": {"description": "Project settings: working calendar and holidays, RAG thresholds, default classification, retention defaults, quiet hours.", "conditions": [], "ai": "none"},
    "governance.committee.read": {"description": "View committees, charter versions and membership.", "conditions": ["classification"], "ai": "retrieve"},
    "governance.committee.manage": {"description": "Create committees; draft charter versions; manage membership, quorum, voting and recusal rules (draft).", "conditions": ["classification"], "ai": "none"},
    "governance.charter.approve": {"description": "Approve a committee charter version.", "conditions": ["classification", "not_self", "authority"], "ai": "none"},
    "governance.authority_matrix.manage": {"description": "Draft delegation/authority matrix versions (decision types, thresholds with currency and unit).", "conditions": ["classification"], "ai": "none"},
    "governance.authority_matrix.approve": {"description": "Approve and activate an authority matrix version. Until one is active, production approvals that need authority are refused.", "conditions": ["classification", "not_self", "authority"], "ai": "none"},
    "governance.meeting.read": {"description": "View meetings, agendas, attendance, frozen meeting packs and minutes.", "conditions": ["classification"], "ai": "retrieve"},
    "governance.meeting.manage": {"description": "Schedule meetings, build numbered agendas, record attendance, freeze meeting-pack snapshots.", "conditions": ["classification"], "ai": "none"},
    "governance.agenda_request.create": {"description": "Request an agenda item.", "conditions": ["classification"], "ai": "propose"},
    "governance.agenda_request.screen": {"description": "Secretariat screening: accept, return, defer, merge or reject an agenda request (a reason is required except to accept).", "conditions": ["classification", "not_self"], "ai": "none"},
    "governance.decision.read": {"description": "View decision papers, states, votes and outcomes.", "conditions": ["classification"], "ai": "retrieve"},
    "governance.decision.draft": {"description": "Create and edit decision papers in Draft.", "conditions": ["classification"], "ai": "propose"},
    "governance.decision.submit": {"description": "Submit a decision paper (Draft to Submitted).", "conditions": ["classification"], "ai": "none"},
    "governance.decision.review": {"description": "Secretariat review: Submitted to Under Review, request information, return.", "conditions": ["classification", "not_self"], "ai": "none"},
    "governance.conflict.declare": {"description": "Declare a conflict of interest or recusal for an agenda item or decision.", "conditions": [], "ai": "none"},
    "governance.decision.vote": {"description": "Cast a vote. The server also requires active voting membership, quorum present and no recusal.", "conditions": ["classification", "not_self"], "ai": "none"},
    "governance.circulation.initiate": {"description": "Start a resolution by circulation.", "conditions": ["classification"], "ai": "none"},
    "governance.decision.record_outcome": {"description": "Record the outcome from the server-computed tally. Outside the committee's delegation only Recommended / Pending external authority is accepted (AT-04).", "conditions": ["classification", "not_self", "authority"], "ai": "none"},
    "governance.decision.record_external_approval": {"description": "Record a higher authority's decision together with its evidence.", "conditions": ["classification", "not_self"], "ai": "none"},
    "governance.decision.verify_implementation": {"description": "Mark a decision Implemented-Verified after checking closure evidence.", "conditions": ["classification", "not_self"], "ai": "none"},
    "governance.minutes.draft": {"description": "Draft minutes.", "conditions": ["classification"], "ai": "propose"},
    "governance.minutes.approve": {"description": "Approve minutes.", "conditions": ["classification", "not_self"], "ai": "none"},
    "governance.action.manage": {"description": "Create, assign and re-date committee actions.", "conditions": ["classification"], "ai": "propose"},
    "governance.action.update": {"description": "Update progress and evidence on actions the actor owns or is assigned.", "conditions": ["classification", "own_workstream"], "ai": "propose"},
    "governance.action.verify_closure": {"description": "Verify closure of a committee action.", "conditions": ["classification", "not_self"], "ai": "none"},
    "governance.escalation.raise": {"description": "Raise an escalation (requested action, decision deadline, options).", "conditions": ["classification"], "ai": "propose"},
    "planning.plan.read": {"description": "View WBS, tasks, milestones, deliverables, dependencies, baselines, RAID, change requests and periodic updates.", "conditions": ["classification"], "ai": "retrieve"},
    "planning.wbs.manage": {"description": "Create and edit WBS elements, milestones and deliverables (non-baselined fields).", "conditions": ["classification"], "ai": "propose"},
    "planning.task.manage": {"description": "Create and edit tasks and RACI entries. Changing an existing accountable owner needs planning.ownership.reassign.", "conditions": ["classification"], "ai": "propose"},
    "planning.ownership.reassign": {"description": "Change the accountable owner of an existing task, milestone, deliverable, risk or action.", "conditions": ["classification"], "ai": "none"},
    "planning.task.update_progress": {"description": "Update status, progress and actuals on tasks the actor owns or is assigned.", "conditions": ["classification", "own_workstream"], "ai": "propose"},
    "planning.deliverable.accept": {"description": "Accept a deliverable (evidence-verified progress).", "conditions": ["classification", "not_self"], "ai": "none"},
    "planning.dependency.manage": {"description": "Create and edit dependencies (cycle-checked on the server).", "conditions": ["classification"], "ai": "propose"},
    "planning.baseline.propose": {"description": "Propose a baseline or re-baseline.", "conditions": ["classification"], "ai": "none"},
    "planning.baseline.approve": {"description": "Approve a baseline version.", "conditions": ["classification", "not_self", "authority"], "ai": "none"},
    "planning.change_request.create": {"description": "Create a change request.", "conditions": ["classification"], "ai": "propose"},
    "planning.change_request.assess": {"description": "Record the impact assessment of a change request (time, cost, scope, readiness, transaction).", "conditions": ["classification"], "ai": "none"},
    "planning.change_request.approve": {"description": "Approve or reject a change request.", "conditions": ["classification", "not_self", "authority"], "ai": "none"},
    "planning.raid.manage": {"description": "Create and edit risks, assumptions, issues and dependency entries.", "conditions": ["classification", "own_workstream"], "ai": "propose"},
    "planning.rag_override.set": {"description": "Set a manual RAG override with reason and expiry (calculated value retained).", "conditions": ["classification", "own_workstream"], "ai": "none"},
    "planning.rag_override.review": {"description": "Review a manual RAG override.", "conditions": ["classification", "not_self"], "ai": "none"},
    "planning.status_update.submit": {"description": "Submit a periodic workstream update.", "conditions": ["classification", "own_workstream"], "ai": "propose"},
    "planning.status_update.review": {"description": "Review, accept or return a periodic update.", "conditions": ["classification", "not_self"], "ai": "none"},
    "gates.gate.read": {"description": "View gate definitions, criteria, evidence status, assessments, waivers and decisions.", "conditions": ["classification"], "ai": "retrieve", "projectLevelRead": true},
    "gates.definition.manage": {"description": "Draft project gate definitions, criteria and prerequisites.", "conditions": ["classification"], "ai": "none"},
    "gates.definition.approve": {"description": "Approve changes to a project's gate definitions.", "conditions": ["classification", "not_self", "authority"], "ai": "none"},
    "gates.criterion.set_waivability": {"description": "Specialist determination of a criterion's waivability and waiver authority.", "conditions": ["classification"], "ai": "none"},
    "gates.evidence.attach": {"description": "Attach evidence to gate criteria (evidence stays unverified until reviewed).", "conditions": ["classification", "own_workstream"], "ai": "propose"},
    "gates.assessment.submit": {"description": "Submit a gate for assessment.", "conditions": ["classification", "own_workstream"], "ai": "none"},
    "gates.assessment.review": {"description": "Record a reviewer's criterion-level assessment.", "conditions": ["classification", "not_self"], "ai": "none"},
    "gates.assessment.decide": {"description": "Record a gate decision. The server re-evaluates mandatory criteria, evidence and approvals; task completion alone never unlocks a gate.", "conditions": ["classification", "not_self", "authority"], "ai": "none"},
    "gates.assessment.reopen": {"description": "Reopen an assessment through the controlled process when relied-upon evidence is defective (AT-14); prior decisions are preserved.", "conditions": ["classification"], "ai": "none"},
    "gates.waiver.request": {"description": "Request a waiver with basis and impact.", "conditions": ["classification"], "ai": "none"},
    "gates.waiver.approve": {"description": "Approve a waiver. Non-waivable criteria are refused regardless of role (AT-13).", "conditions": ["classification", "not_self", "authority"], "ai": "none"},
    "carveout.register.read": {"description": "View perimeter, sites, transfers, agreements, consents and reconciliation.", "conditions": ["classification"], "ai": "retrieve"},
    "carveout.perimeter.manage": {"description": "Create and edit perimeter items and sites (post-baseline changes go through change control).", "conditions": ["classification", "own_workstream"], "ai": "none"},
    "carveout.perimeter.approve": {"description": "Approve a perimeter version.", "conditions": ["classification", "not_self", "authority"], "ai": "none"},
    "carveout.transfer.manage": {"description": "Maintain transfer records and their evidence links.", "conditions": ["classification", "own_workstream"], "ai": "none"},
    "carveout.transfer.verify": {"description": "Verify a transfer (verifyTransfer).", "conditions": ["classification", "not_self"], "ai": "none"},
    "carveout.agreement.manage": {"description": "Maintain agreement register entries (parties, scope, versions, negotiation stage, obligations).", "conditions": ["classification"], "ai": "none"},
    "carveout.consent.manage": {"description": "Maintain consents, novations and assignments tracking.", "conditions": ["classification"], "ai": "none"},
    "carveout.contract.classify": {"description": "Specialist transferability classification (transferable / consent / novation / retain / interim / unknown).", "conditions": ["classification"], "ai": "none"},
    "newco.register.read": {"description": "View legal entities, incorporation status and the regulatory requirement/approval registers.", "conditions": ["classification"], "ai": "retrieve"},
    "newco.legal_entity.manage": {"description": "Create and edit legal entities.", "conditions": ["classification"], "ai": "none"},
    "newco.incorporation.manage": {"description": "Record incorporation steps and proposed status with evidence.", "conditions": ["classification"], "ai": "none"},
    "newco.incorporation.verify": {"description": "Verify incorporation status against evidence.", "conditions": ["classification", "not_self"], "ai": "none"},
    "newco.regulatory.manage": {"description": "Maintain regulatory requirements and approval register entries (draft).", "conditions": ["classification"], "ai": "none"},
    "newco.regulatory.verify": {"description": "Record a specialist applicability assessment or a verified approval with validity (Legal / regulatory roles only — REQ-AGR-004, SEC-P34-05).", "conditions": ["classification", "not_self"], "ai": "none"},
    "readiness.register.read": {"description": "View readiness checks, cutover plans, go/no-go history and the TSA register.", "conditions": ["classification"], "ai": "retrieve"},
    "readiness.check.manage": {"description": "Maintain site/workstream readiness checks and blockers.", "conditions": ["classification", "own_workstream"], "ai": "propose"},
    "readiness.check.signoff": {"description": "Specialist sign-off of a readiness check.", "conditions": ["classification", "not_self"], "ai": "none"},
    "readiness.cutover.manage": {"description": "Maintain cutover plans, runbooks, windows and contingency.", "conditions": ["classification", "own_workstream"], "ai": "none"},
    "readiness.go_no_go.decide": {"description": "Record a go/no-go decision; blockers are re-evaluated on the server (AT-09).", "conditions": ["classification", "not_self", "authority"], "ai": "none"},
    "readiness.tsa.manage": {"description": "Maintain TSA services, SLAs, exit milestones and replacement services.", "conditions": ["classification", "own_workstream"], "ai": "none"},
    "readiness.tsa.approve_exit": {"description": "Approve a TSA exit (approveTSAExit); end date alone never means exit (AT-10).", "conditions": ["classification", "not_self", "authority"], "ai": "none"},
    "finance.record.read": {"description": "View financial snapshots, budget lines, commitments, costs, benefits and KPI observations.", "conditions": ["classification"], "ai": "retrieve"},
    "finance.budget.manage": {"description": "Edit budget lines, commitments and actuals (approved budget changes go through change control).", "conditions": ["classification"], "ai": "none"},
    "finance.snapshot.approve": {"description": "Human financial validation of statements, balances and financial snapshots.", "conditions": ["classification", "not_self", "authority"], "ai": "none"},
    "finance.model.manage": {"description": "Import and version business-plan/valuation model outputs and assumptions.", "conditions": ["classification"], "ai": "none"},
    "finance.benefit.manage": {"description": "Maintain the benefits register.", "conditions": ["classification"], "ai": "none"},
    "finance.benefit.verify": {"description": "Verify a benefit realisation against its verification source.", "conditions": ["classification", "not_self"], "ai": "none"},
    "finance.kpi.manage": {"description": "Define KPIs (definition, formula, unit, owner, thresholds) and record observations.", "conditions": ["classification"], "ai": "none"},
    "jv.partner.read": {"description": "View partner longlist/shortlist, criteria, stages and conflict disclosures.", "conditions": ["classification"], "ai": "retrieve"},
    "jv.partner.manage": {"description": "Maintain partner longlist/shortlist, criteria, weights and conflict disclosures.", "conditions": ["classification"], "ai": "none"},
    "jv.partner.approve_contact": {"description": "Approve a partner for contact (outreach approval).", "conditions": ["classification", "not_self", "authority"], "ai": "none"},
    "jv.partner.advance_stage": {"description": "Record an engagement stage transition with evidence; server enforces stage order (NDA does not imply materials access).", "conditions": ["classification"], "ai": "none"},
    "jv.nda.record": {"description": "Record NDA execution and its evidence.", "conditions": ["classification", "not_self"], "ai": "none"},
    "jv.deal.read": {"description": "View partner proposals, ownership/governance scenarios, negotiation issues and comparative assessments.", "conditions": ["classification"], "ai": "retrieve"},
    "jv.proposal.manage": {"description": "Maintain partner proposals and comparative assessments (facts separated from team judgement).", "conditions": ["classification"], "ai": "none"},
    "jv.scenario.manage": {"description": "Maintain versioned ownership, capital-contribution and governance scenarios.", "conditions": ["classification"], "ai": "none"},
    "jv.negotiation.manage": {"description": "Maintain terms and negotiation issues.", "conditions": ["classification"], "ai": "none"},
    "jv.room.read": {"description": "Open a partner/internal/clean-team room and view its index. Every access is audited.", "conditions": ["room", "clean_team", "classification"], "ai": "retrieve", "auditRead": true},
    "jv.room.manage": {"description": "Create a room (partner / internal / clean_team), manage its index and folders, set its AI-indexing flag.", "conditions": ["room", "clean_team"], "ai": "none"},
    "jv.room.grant_access": {"description": "Grant a user access to a room (level, expiry, basis). Partner must be at Materials-access stage; grants into clean-team rooms need a clean-team grantee.", "conditions": ["room", "clean_team", "not_self"], "ai": "none"},
    "jv.room.revoke_access": {"description": "Revoke a user's room grant.", "conditions": ["room"], "ai": "none"},
    "jv.room.lock": {"description": "Lock a room: suspend all grants and downloads immediately (containment).", "conditions": ["room"], "ai": "none"},
    "jv.dd_request.create": {"description": "Create a due-diligence request/question in a room.", "conditions": ["room", "classification"], "ai": "none"},
    "jv.dd_request.read": {"description": "View DD requests, internal drafts, assignees and review state (internal projection).", "conditions": ["room", "clean_team", "classification"], "ai": "retrieve"},
    "jv.dd_request.read_external": {"description": "View own room's DD requests in the external projection only (question, status, due date).", "conditions": ["room"], "ai": "none"},
    "jv.dd_request.assign": {"description": "Assign a DD request to an internal owner.", "conditions": ["room", "classification"], "ai": "none"},
    "jv.dd_answer.draft": {"description": "Draft an answer to an assigned DD request.", "conditions": ["room", "clean_team", "classification", "own_workstream"], "ai": "propose"},
    "jv.dd_answer.review": {"description": "Review a drafted DD answer.", "conditions": ["room", "clean_team", "classification", "not_self"], "ai": "none"},
    "jv.disclosure.release": {"description": "Approve release of a specific DD answer or document version into a partner room (creates the disclosure record).", "conditions": ["room", "classification", "not_self"], "ai": "none"},
    "jv.disclosure.revoke": {"description": "Withdraw a disclosed item from a room (cannot recall copies already downloaded).", "conditions": ["room"], "ai": "none"},
    "jv.disclosure.view": {"description": "View items disclosed into the actor's own room, disclosed version only. Audited.", "conditions": ["room", "classification"], "ai": "none", "auditRead": true},
    "jv.disclosure.download": {"description": "Download a disclosed document version from the actor's own room. Audited; watermarked where supported.", "conditions": ["room", "classification"], "ai": "none", "auditRead": true},
    "jv.disclosure_log.read": {"description": "View a room's disclosure and access history.", "conditions": ["room"], "ai": "none"},
    "jv.submission.upload": {"description": "Upload a partner submission into the actor's own room; enters quarantine and scanning.", "conditions": ["room"], "ai": "none"},
    "jv.finding.manage": {"description": "Maintain DD findings (materiality, risks, remediation, valuation/document/CP implications).", "conditions": ["room", "clean_team", "classification"], "ai": "none"},
    "jv.clean_team_output.submit": {"description": "Submit a clean-team output (aggregated/redacted) for release review.", "conditions": ["room", "clean_team"], "ai": "none"},
    "jv.clean_team_output.release": {"description": "Release a reviewed clean-team output to the wider deal team (clears the clean-team flag on that output only).", "conditions": ["room", "clean_team", "not_self"], "ai": "none"},
    "jv.closing_checklist.manage": {"description": "Maintain signing and closing checklists, closing deliverables, conditions subsequent and post-close obligations. Setting a checklist item not required is only a request, confirmed by a second person holding jv.cp.verify (SEC-P34-10).", "conditions": ["classification"], "ai": "none"},
    "jv.cp.manage": {"description": "Maintain closing conditions (reference, owner, evidence links, long-stop date).", "conditions": ["classification"], "ai": "none"},
    "jv.cp.set_waivability": {"description": "Legal specialist determination of a closing condition's blocking status, waivability and waiver authority (business-gates.md §7). Never releases a blocking condition (DOM-P4-03).", "conditions": ["classification"], "ai": "none"},
    "jv.cp.verify": {"description": "Verify a closing condition (verifyCP) against evidence; accept a delivered closing deliverable; verify a post-close obligation; confirm or reject the request to set a checklist item not required. Self: the owner, the submitter / deliverer / reporter / requester and every person who linked active evidence of the record (SEC-P34-01, SEC-P34-10).", "conditions": ["classification", "not_self"], "ai": "none"},
    "jv.cp.waive": {"description": "Waive a closing condition. Non-waivable conditions are refused (AT-12, AT-13).", "conditions": ["classification", "not_self", "authority"], "ai": "none"},
    "jv.signing.record": {"description": "Record signing of a transaction agreement with the executed copy.", "conditions": ["classification", "not_self", "authority"], "ai": "none"},
    "jv.closing.declare": {"description": "Authorised closing confirmation. Refused while any mandatory CP is unverified and unwaived (AT-12).", "conditions": ["classification", "not_self", "authority"], "ai": "none"},
    "jv.funds_flow.manage": {"description": "Track closing funds flows (the platform never executes payments).", "conditions": ["classification"], "ai": "none"},
    "documents.document.read": {"description": "List, search and view document metadata/preview. Titles, snippets and counts only for documents the caller may read.", "conditions": ["classification", "room", "clean_team"], "ai": "retrieve", "projectLevelRead": true},
    "documents.document.download": {"description": "Download a document version through the authorised streaming endpoint. Audited.", "conditions": ["classification", "room", "clean_team"], "ai": "none", "auditRead": true, "projectLevelRead": true},
    "documents.document.upload": {"description": "Upload a document or new version (enters quarantine/scan). Classification cannot exceed the uploader's clearance.", "conditions": ["classification", "room", "clean_team"], "ai": "none"},
    "documents.document.classify": {"description": "Set or raise a document's classification and domain tag.", "conditions": ["classification"], "ai": "none"},
    "documents.document.declassify": {"description": "Lower a document's classification.", "conditions": ["classification", "not_self"], "ai": "none"},
    "documents.document.archive": {"description": "Withdraw (soft-delete) a non-evidence document; refused under legal hold or when linked as evidence.", "conditions": ["classification", "room", "own_workstream"], "ai": "none"},
    "documents.evidence.link": {"description": "Link a document version as evidence to a record; also requires the update permission on the target record.", "conditions": ["classification", "room", "clean_team"], "ai": "propose"},
    "documents.evidence.verify": {"description": "Verify/accept linked evidence.", "conditions": ["classification", "not_self"], "ai": "none"},
    "documents.source.manage": {"description": "Maintain the source register, extraction results and source claims (claims enter as proposed/unknown).", "conditions": ["classification"], "ai": "propose"},
    "documents.claim.verify": {"description": "Set a source claim's verification status (confirmed / conflicting).", "conditions": ["classification", "not_self"], "ai": "none"},
    "documents.legal_hold.manage": {"description": "Place or release a legal hold; set retention class.", "conditions": ["classification"], "ai": "none"},
    "documents.document.dispose": {"description": "Authorised disposal after retention expiry; refused under legal hold (AT-27).", "conditions": ["classification", "not_self", "authority"], "ai": "none"},
    "reports.report.generate": {"description": "Generate a report/export from live data in scope; output classification is the maximum of its inputs.", "conditions": ["classification", "room", "clean_team"], "ai": "none"},
    "reports.snapshot.create": {"description": "Freeze an immutable-in-content report snapshot.", "conditions": ["classification"], "ai": "none"},
    "reports.snapshot.read": {"description": "View a report snapshot; permission is re-checked on every access.", "conditions": ["classification", "room", "clean_team"], "ai": "retrieve"},
    "reports.snapshot.export": {"description": "Download a snapshot as XLSX/PDF/PPTX/DOCX (formula-injection neutralised). Audited.", "conditions": ["classification", "room", "clean_team"], "ai": "none", "auditRead": true},
    "reports.bi_view.read": {"description": "Read BI views (service principal only; security-invoker views).", "conditions": ["classification"], "ai": "none"},
    "imports.batch.read": {"description": "View import batches, mapping, validation results and history.", "conditions": ["classification"], "ai": "none"},
    "imports.batch.create": {"description": "Upload an Excel/CSV file, map, validate and preview (values only, formulas never evaluated).", "conditions": ["classification"], "ai": "none"},
    "imports.batch.approve": {"description": "Approve merging a validated batch; approved records outside change control cannot be overwritten.", "conditions": ["classification", "not_self"], "ai": "none"},
    "imports.batch.rollback": {"description": "Roll back an import batch where feasible.", "conditions": ["classification"], "ai": "none"},
    "imports.quarantine.release": {"description": "Release a quarantined file after security review (content-free decision).", "conditions": ["not_self"], "ai": "none"},
    "integrations.connection.read": {"description": "View connectors, their honest status (Not configured / Disabled / Validated) and execution logs.", "conditions": [], "ai": "none"},
    "integrations.connection.manage": {"description": "Configure connectors (endpoint, OAuth scopes, destinations), validate connectivity, rotate connector secrets.", "conditions": [], "ai": "none"},
    "integrations.connection.disable": {"description": "Disable a connector immediately (containment).", "conditions": [], "ai": "none"},
    "integrations.send_authority.approve": {"description": "Approve a project's outbound sending authority and destination list for a write/send connector.", "conditions": ["not_self", "authority"], "ai": "none"},
    "notifications.inbox.read": {"description": "Read own notifications; content is re-authorised at render time.", "conditions": ["classification", "room", "clean_team"], "ai": "none"},
    "notifications.preferences.manage_own": {"description": "Manage own notification preferences.", "conditions": [], "ai": "none"},
    "notifications.policy.manage": {"description": "Manage project notification policy, quiet hours and digests.", "conditions": [], "ai": "none"},
    "notifications.message.send": {"description": "Send a message via an enabled adapter to approved internal destinations; each recipient is re-authorised for the content at send time.", "conditions": ["classification", "authority"], "ai": "propose"},
    "ai.assistant.use": {"description": "Ask questions and request drafts/briefings; retrieval is limited to the caller's ACL inside SQL.", "conditions": ["classification", "room", "clean_team"], "ai": "none"},
    "ai.briefing.subscribe": {"description": "Schedule own briefings (Asia/Riyadh schedule).", "conditions": ["classification"], "ai": "none"},
    "ai.proposal.read": {"description": "View AI proposals, rationale, evidence snapshot and diff.", "conditions": ["classification"], "ai": "none"},
    "ai.proposal.approve": {"description": "Approve an AI proposal. Approval binds payload hash, target version, approver and expiry; the approver must independently pass the underlying action's permission and conditions.", "conditions": ["classification", "not_self", "authority"], "ai": "none"},
    "ai.proposal.reject": {"description": "Reject an AI proposal.", "conditions": ["classification"], "ai": "none"},
    "ai.settings.manage": {"description": "Set a project's AI mode (off / advisory / assisted), budgets, schedules and room-indexing flags.", "conditions": [], "ai": "none"},
    "ai.autopilot_policy.approve": {"description": "Approve a policy-limited autopilot allowlist (actions, limits, scope, rate, expiry).", "conditions": ["not_self", "authority"], "ai": "none"},
    "ai.provider.configure": {"description": "Configure organisation provider adapters, the policy-gateway endpoint, approved destinations, classification ceilings and DLP rules.", "conditions": [], "ai": "none"},
    "ai.killswitch.activate": {"description": "Activate the AI emergency stop (organisation or project): blocks new/pending actions, cancels unsent messages.", "conditions": [], "ai": "none"},
    "ai.killswitch.release": {"description": "Release the AI emergency stop (releaser must not be the activator).", "conditions": ["not_self"], "ai": "none"},
    "ai.run.read": {"description": "View AI runs: prompts/outputs redacted to the viewer's clearance, tool calls, citations, costs.", "conditions": ["classification", "room", "clean_team"], "ai": "none"},
    "ai.operations.read": {"description": "View content-free AI health, cost, latency and error metrics.", "conditions": [], "ai": "none"},
    "ai.index.rebuild": {"description": "Trigger re-indexing or invalidation (content-free).", "conditions": [], "ai": "none"},
    "ai.evaluation.run": {"description": "Run evaluation suites on synthetic datasets only.", "conditions": [], "ai": "none"},
    "audit.event.read": {"description": "Read audit events in scope; payload fields above the reader's clearance are redacted.", "conditions": ["classification", "room", "clean_team"], "ai": "none"},
    "audit.security_event.read": {"description": "Read authentication, session, permission and administration events (content-free).", "conditions": [], "ai": "none"},
    "audit.event.export": {"description": "Export an audit extract with hash-chain proof. Audited.", "conditions": ["classification", "room", "clean_team"], "ai": "none", "auditRead": true},
    "audit.chain.verify": {"description": "Run hash-chain verification against the external anchor.", "conditions": [], "ai": "none"}
  },
  "roles": {
    "platform_admin": {
      "scopeTypes": ["organization"],
      "permissions": ["admin.directory.search", "admin.users.read", "admin.users.manage", "admin.sessions.revoke", "admin.access.suspend", "admin.external_access.suspend", "admin.role_assignment.read", "admin.role_assignment.manage", "admin.org_settings.manage", "admin.service_account.manage", "portfolio.portfolio.read", "imports.quarantine.release", "integrations.connection.read", "integrations.connection.manage", "integrations.connection.disable", "ai.provider.configure", "ai.killswitch.activate", "ai.killswitch.release", "ai.operations.read", "ai.index.rebuild", "ai.evaluation.run", "audit.security_event.read", "audit.chain.verify", "notifications.inbox.read", "notifications.preferences.manage_own"],
      "defaultClearance": "internal"
    },
    "portfolio_admin": {
      "scopeTypes": ["organization", "portfolio"],
      "permissions": ["admin.directory.search", "admin.users.read", "admin.role_assignment.read", "admin.role_assignment.manage", "portfolio.portfolio.read", "portfolio.portfolio.manage", "portfolio.project.create", "portfolio.project.read", "portfolio.project.archive", "portfolio.dashboard.read", "config.template.read", "config.template.manage", "config.template.publish", "config.template_migration.propose", "planning.plan.read", "gates.gate.read", "reports.report.generate", "reports.snapshot.read", "integrations.connection.read", "ai.settings.manage", "ai.killswitch.activate", "ai.killswitch.release", "ai.operations.read", "notifications.inbox.read", "notifications.preferences.manage_own"],
      "defaultClearance": "internal"
    },
    "sponsor": {
      "scopeTypes": ["portfolio", "project"],
      "permissions": ["admin.directory.search", "admin.role_assignment.read", "admin.clearance.grant", "portfolio.portfolio.read", "portfolio.project.read", "portfolio.project.update", "portfolio.dashboard.read", "config.template.read", "config.template_migration.approve", "governance.committee.read", "governance.charter.approve", "governance.authority_matrix.approve", "governance.meeting.read", "governance.agenda_request.create", "governance.decision.read", "governance.decision.draft", "governance.decision.submit", "governance.conflict.declare", "governance.decision.vote", "governance.decision.verify_implementation", "governance.action.update", "governance.escalation.raise", "planning.plan.read", "planning.deliverable.accept", "planning.baseline.approve", "planning.change_request.create", "planning.change_request.approve", "gates.gate.read", "gates.definition.approve", "gates.assessment.review", "gates.assessment.decide", "gates.assessment.reopen", "gates.waiver.approve", "carveout.register.read", "carveout.perimeter.approve", "newco.register.read", "readiness.register.read", "readiness.go_no_go.decide", "readiness.tsa.approve_exit", "finance.record.read", "jv.partner.read", "jv.partner.manage", "jv.partner.approve_contact", "jv.deal.read", "jv.negotiation.manage", "jv.room.read", "jv.room.grant_access", "jv.room.revoke_access", "jv.room.lock", "jv.dd_request.read", "jv.disclosure.release", "jv.disclosure.revoke", "jv.disclosure_log.read", "jv.cp.waive", "jv.signing.record", "jv.closing.declare", "documents.document.read", "documents.document.download", "documents.document.upload", "documents.document.declassify", "documents.evidence.link", "reports.report.generate", "reports.snapshot.read", "reports.snapshot.export", "integrations.send_authority.approve", "ai.assistant.use", "ai.briefing.subscribe", "ai.proposal.read", "ai.proposal.approve", "ai.proposal.reject", "ai.settings.manage", "ai.autopilot_policy.approve", "ai.killswitch.activate", "ai.killswitch.release", "ai.run.read", "notifications.inbox.read", "notifications.preferences.manage_own"],
      "defaultClearance": "strictly_confidential"
    },
    "committee_chair": {
      "scopeTypes": ["portfolio", "project"],
      "permissions": ["admin.directory.search", "portfolio.project.read", "portfolio.dashboard.read", "governance.committee.read", "governance.meeting.read", "governance.agenda_request.create", "governance.decision.read", "governance.conflict.declare", "governance.decision.vote", "governance.circulation.initiate", "governance.decision.record_outcome", "governance.decision.record_external_approval", "governance.minutes.approve", "governance.action.update", "governance.escalation.raise", "planning.plan.read", "planning.deliverable.accept", "planning.change_request.approve", "gates.gate.read", "gates.assessment.decide", "gates.assessment.reopen", "gates.waiver.approve", "carveout.register.read", "newco.register.read", "readiness.register.read", "readiness.go_no_go.decide", "finance.record.read", "jv.partner.read", "jv.deal.read", "documents.document.read", "documents.document.download", "reports.report.generate", "reports.snapshot.read", "reports.snapshot.export", "ai.assistant.use", "ai.briefing.subscribe", "ai.proposal.read", "notifications.inbox.read", "notifications.preferences.manage_own"],
      "defaultClearance": "restricted"
    },
    "secretary_cpmo": {
      "scopeTypes": ["portfolio", "project"],
      "permissions": ["admin.directory.search", "portfolio.portfolio.read", "portfolio.project.read", "portfolio.dashboard.read", "config.template.read", "governance.committee.read", "governance.committee.manage", "governance.authority_matrix.manage", "governance.meeting.read", "governance.meeting.manage", "governance.agenda_request.create", "governance.agenda_request.screen", "governance.decision.read", "governance.decision.draft", "governance.decision.submit", "governance.decision.review", "governance.circulation.initiate", "governance.decision.record_outcome", "governance.decision.record_external_approval", "governance.decision.verify_implementation", "governance.minutes.draft", "governance.action.manage", "governance.action.update", "governance.action.verify_closure", "governance.escalation.raise", "planning.plan.read", "planning.change_request.create", "planning.rag_override.review", "planning.status_update.review", "gates.gate.read", "gates.definition.manage", "gates.assessment.submit", "gates.assessment.review", "gates.assessment.reopen", "carveout.register.read", "newco.register.read", "readiness.register.read", "finance.record.read", "documents.document.read", "documents.document.download", "documents.document.upload", "documents.document.classify", "documents.evidence.link", "documents.evidence.verify", "documents.source.manage", "documents.claim.verify", "reports.report.generate", "reports.snapshot.create", "reports.snapshot.read", "reports.snapshot.export", "imports.batch.read", "imports.batch.create", "imports.batch.approve", "imports.batch.rollback", "notifications.policy.manage", "notifications.message.send", "ai.assistant.use", "ai.briefing.subscribe", "ai.proposal.read", "ai.proposal.approve", "ai.proposal.reject", "ai.killswitch.activate", "ai.run.read", "notifications.inbox.read", "notifications.preferences.manage_own"],
      "defaultClearance": "restricted"
    },
    "project_manager": {
      "scopeTypes": ["project"],
      "permissions": ["admin.directory.search", "admin.role_assignment.read", "admin.role_assignment.manage", "portfolio.project.read", "portfolio.project.update", "portfolio.cross_dependency.manage", "config.template.read", "config.template_migration.propose", "config.project_settings.manage", "governance.committee.read", "governance.meeting.read", "governance.agenda_request.create", "governance.decision.read", "governance.decision.draft", "governance.decision.submit", "governance.action.manage", "governance.action.update", "governance.escalation.raise", "planning.plan.read", "planning.wbs.manage", "planning.task.manage", "planning.ownership.reassign", "planning.task.update_progress", "planning.dependency.manage", "planning.baseline.propose", "planning.change_request.create", "planning.change_request.assess", "planning.raid.manage", "planning.rag_override.set", "planning.status_update.review", "gates.gate.read", "gates.definition.manage", "gates.evidence.attach", "gates.assessment.submit", "gates.assessment.review", "gates.waiver.request", "carveout.register.read", "carveout.perimeter.manage", "carveout.transfer.manage", "carveout.agreement.manage", "carveout.consent.manage", "newco.register.read", "newco.legal_entity.manage", "newco.incorporation.manage", "readiness.register.read", "readiness.check.manage", "readiness.cutover.manage", "readiness.tsa.manage", "finance.record.read", "finance.budget.manage", "finance.benefit.manage", "finance.kpi.manage", "jv.partner.read", "jv.partner.manage", "jv.partner.advance_stage", "jv.deal.read", "jv.proposal.manage", "jv.room.read", "jv.room.manage", "jv.room.revoke_access", "jv.dd_request.create", "jv.dd_request.read", "jv.dd_request.assign", "jv.dd_answer.draft", "jv.disclosure_log.read", "jv.finding.manage", "jv.closing_checklist.manage", "jv.cp.manage", "documents.document.read", "documents.document.download", "documents.document.upload", "documents.document.classify", "documents.document.archive", "documents.evidence.link", "documents.source.manage", "reports.report.generate", "reports.snapshot.create", "reports.snapshot.read", "reports.snapshot.export", "imports.batch.read", "imports.batch.create", "imports.batch.approve", "imports.batch.rollback", "integrations.connection.read", "integrations.connection.disable", "notifications.policy.manage", "notifications.message.send", "ai.assistant.use", "ai.briefing.subscribe", "ai.proposal.read", "ai.proposal.approve", "ai.proposal.reject", "ai.killswitch.activate", "ai.run.read", "ai.index.rebuild", "notifications.inbox.read", "notifications.preferences.manage_own"],
      "defaultClearance": "confidential"
    },
    "workstream_lead": {
      "scopeTypes": ["workstream"],
      "permissions": ["admin.directory.search", "portfolio.project.read", "governance.committee.read", "governance.meeting.read", "governance.agenda_request.create", "governance.decision.read", "governance.decision.draft", "governance.decision.submit", "governance.action.update", "governance.escalation.raise", "planning.plan.read", "planning.wbs.manage", "planning.task.manage", "planning.ownership.reassign", "planning.task.update_progress", "planning.deliverable.accept", "planning.dependency.manage", "planning.change_request.create", "planning.raid.manage", "planning.rag_override.set", "planning.status_update.submit", "gates.gate.read", "gates.evidence.attach", "gates.assessment.submit", "gates.assessment.review", "gates.waiver.request", "carveout.register.read", "carveout.perimeter.manage", "carveout.transfer.manage", "carveout.consent.manage", "newco.register.read", "readiness.register.read", "readiness.check.manage", "readiness.check.signoff", "readiness.cutover.manage", "readiness.tsa.manage", "finance.record.read", "jv.room.read", "jv.dd_request.read", "jv.dd_answer.draft", "documents.document.read", "documents.document.download", "documents.document.upload", "documents.document.archive", "documents.evidence.link", "reports.report.generate", "reports.snapshot.read", "imports.batch.read", "imports.batch.create", "ai.assistant.use", "ai.briefing.subscribe", "ai.proposal.read", "ai.proposal.approve", "ai.proposal.reject", "notifications.inbox.read", "notifications.preferences.manage_own"],
      "defaultClearance": "confidential"
    },
    "contributor": {
      "scopeTypes": ["project", "workstream"],
      "permissions": ["admin.directory.search", "portfolio.project.read", "governance.decision.read", "governance.action.update", "planning.plan.read", "planning.task.update_progress", "planning.raid.manage", "planning.status_update.submit", "gates.gate.read", "gates.evidence.attach", "carveout.register.read", "newco.register.read", "readiness.register.read", "readiness.check.manage", "jv.room.read", "jv.dd_request.read", "jv.dd_answer.draft", "documents.document.read", "documents.document.download", "documents.document.upload", "documents.document.archive", "documents.evidence.link", "reports.snapshot.read", "ai.assistant.use", "ai.briefing.subscribe", "notifications.inbox.read", "notifications.preferences.manage_own"],
      "defaultClearance": "internal"
    },
    "functional_approver": {
      "scopeTypes": ["project", "workstream"],
      "permissions": ["admin.directory.search", "portfolio.project.read", "governance.committee.read", "governance.meeting.read", "governance.agenda_request.create", "governance.decision.read", "governance.decision.draft", "governance.decision.submit", "governance.conflict.declare", "governance.decision.vote", "governance.action.update", "planning.plan.read", "planning.deliverable.accept", "planning.change_request.assess", "gates.gate.read", "gates.criterion.set_waivability", "gates.assessment.review", "carveout.register.read", "carveout.transfer.verify", "newco.register.read", "readiness.register.read", "readiness.check.signoff", "readiness.tsa.approve_exit", "finance.record.read", "jv.room.read", "jv.dd_request.read", "jv.dd_answer.review", "jv.cp.verify", "documents.document.read", "documents.document.download", "documents.evidence.verify", "documents.claim.verify", "reports.report.generate", "reports.snapshot.read", "ai.assistant.use", "ai.briefing.subscribe", "ai.proposal.read", "notifications.inbox.read", "notifications.preferences.manage_own"],
      "defaultClearance": "confidential"
    },
    "finance_restricted": {
      "scopeTypes": ["project"],
      "permissions": ["admin.directory.search", "portfolio.project.read", "governance.committee.read", "governance.meeting.read", "governance.agenda_request.create", "governance.decision.read", "governance.decision.draft", "governance.decision.submit", "governance.conflict.declare", "governance.decision.vote", "governance.action.update", "planning.plan.read", "planning.change_request.assess", "gates.gate.read", "gates.criterion.set_waivability", "gates.evidence.attach", "gates.assessment.review", "gates.waiver.request", "carveout.register.read", "carveout.transfer.verify", "newco.register.read", "readiness.register.read", "finance.record.read", "finance.budget.manage", "finance.snapshot.approve", "finance.model.manage", "finance.benefit.manage", "finance.benefit.verify", "finance.kpi.manage", "jv.partner.read", "jv.deal.read", "jv.proposal.manage", "jv.scenario.manage", "jv.room.read", "jv.dd_request.create", "jv.dd_request.read", "jv.dd_request.assign", "jv.dd_answer.draft", "jv.dd_answer.review", "jv.finding.manage", "jv.funds_flow.manage", "documents.document.read", "documents.document.download", "documents.document.upload", "documents.document.classify", "documents.evidence.link", "documents.evidence.verify", "documents.claim.verify", "reports.report.generate", "reports.snapshot.read", "reports.snapshot.export", "imports.batch.read", "imports.batch.create", "ai.assistant.use", "ai.briefing.subscribe", "ai.proposal.read", "notifications.inbox.read", "notifications.preferences.manage_own"],
      "defaultClearance": "confidential",
      "domainClearance": {"finance": "strictly_confidential"}
    },
    "legal_restricted": {
      "scopeTypes": ["project"],
      "permissions": ["admin.directory.search", "portfolio.project.read", "governance.committee.read", "governance.meeting.read", "governance.agenda_request.create", "governance.decision.read", "governance.decision.draft", "governance.decision.submit", "governance.conflict.declare", "governance.decision.vote", "governance.action.update", "planning.plan.read", "planning.change_request.assess", "gates.gate.read", "gates.criterion.set_waivability", "gates.evidence.attach", "gates.assessment.submit", "gates.assessment.review", "gates.waiver.request", "carveout.register.read", "carveout.transfer.verify", "carveout.agreement.manage", "carveout.consent.manage", "carveout.contract.classify", "newco.register.read", "newco.legal_entity.manage", "newco.incorporation.manage", "newco.incorporation.verify", "newco.regulatory.manage", "newco.regulatory.verify", "readiness.register.read", "jv.partner.read", "jv.partner.advance_stage", "jv.nda.record", "jv.deal.read", "jv.proposal.manage", "jv.scenario.manage", "jv.negotiation.manage", "jv.room.read", "jv.room.manage", "jv.room.grant_access", "jv.room.revoke_access", "jv.room.lock", "jv.dd_request.create", "jv.dd_request.read", "jv.dd_request.assign", "jv.dd_answer.draft", "jv.dd_answer.review", "jv.disclosure.release", "jv.disclosure.revoke", "jv.disclosure_log.read", "jv.finding.manage", "jv.clean_team_output.release", "jv.closing_checklist.manage", "jv.cp.manage", "jv.cp.set_waivability", "jv.cp.verify", "jv.signing.record", "documents.document.read", "documents.document.download", "documents.document.upload", "documents.document.classify", "documents.document.declassify", "documents.evidence.link", "documents.evidence.verify", "documents.claim.verify", "documents.legal_hold.manage", "documents.document.dispose", "reports.report.generate", "reports.snapshot.read", "reports.snapshot.export", "ai.assistant.use", "ai.briefing.subscribe", "ai.proposal.read", "notifications.inbox.read", "notifications.preferences.manage_own"],
      "defaultClearance": "confidential",
      "domainClearance": {"legal": "strictly_confidential", "regulatory": "strictly_confidential"}
    },
    "clean_team": {
      "scopeTypes": ["partner_room"],
      "permissions": ["jv.room.read", "jv.dd_request.read", "jv.dd_answer.draft", "jv.finding.manage", "jv.clean_team_output.submit", "documents.document.read", "documents.document.download", "documents.document.upload", "notifications.inbox.read", "notifications.preferences.manage_own"],
      "defaultClearance": "strictly_confidential"
    },
    "auditor": {
      "scopeTypes": ["organization", "portfolio", "project"],
      "permissions": ["admin.users.read", "admin.role_assignment.read", "portfolio.portfolio.read", "portfolio.project.read", "portfolio.dashboard.read", "config.template.read", "governance.committee.read", "governance.meeting.read", "governance.decision.read", "planning.plan.read", "gates.gate.read", "carveout.register.read", "newco.register.read", "readiness.register.read", "finance.record.read", "jv.partner.read", "jv.deal.read", "jv.room.read", "jv.dd_request.read", "jv.disclosure_log.read", "documents.document.read", "documents.document.download", "reports.snapshot.read", "reports.snapshot.export", "imports.batch.read", "integrations.connection.read", "ai.proposal.read", "ai.run.read", "ai.operations.read", "audit.event.read", "audit.security_event.read", "audit.event.export", "audit.chain.verify", "notifications.inbox.read", "notifications.preferences.manage_own"],
      "defaultClearance": "confidential"
    },
    "external_partner_limited": {
      "scopeTypes": ["partner_room"],
      "permissions": ["jv.disclosure.view", "jv.disclosure.download", "jv.dd_request.create", "jv.dd_request.read_external", "jv.submission.upload", "notifications.inbox.read", "notifications.preferences.manage_own"],
      "defaultClearance": "confidential"
    }
  },
  "servicePrincipals": {
    "ai_runtime": {"description": "Worker identity for the runtime AI PM. Holds no role assignments. Effective permissions per call = permissions with ai in {retrieve, propose} INTERSECT the delegating user's permissions evaluated at execution time INTERSECT the project's AI-mode allowlist. 'propose' permissions execute only after a bound human approval (assisted) or under an approved autopilot policy.", "permissions": "derived"},
    "bi_reader": {"description": "Restricted service account for BI-ready views. Explicit project list, maxClearance internal unless raised through admin.clearance.grant; never room or clean-team data.", "permissions": ["reports.bi_view.read"], "maxClearance": "internal"},
    "integration_adapter": {"description": "Per-connector identity used only to authenticate to the external system. Holds no content permissions; sends execute notifications.message.send under the approving/sending user's authority, re-checked at send time.", "permissions": []}
  }
}
```

---

## 12. Open questions for Mobily (policy-relevant)

| ID | Question | Owner (Role — To be confirmed) | Blocks |
|---|---|---|---|
| AMQ-01 | Mobily's classification scheme and labels, and how they map to the five levels here; who may declassify | Mobily Data Governance / Cybersecurity | Production classification defaults |
| AMQ-02 | Approved authority/delegation matrix (decision types, thresholds, currencies) per committee | Mobily Governance / CPMO | Production approvals (`authority`) |
| AMQ-03 | Whether the sponsor's default clearance should be `strictly_confidential` or granted per engagement | Program Sponsor (TBC) / Cybersecurity | Role defaults |
| AMQ-04 | Clean-team protocol owner, membership criteria, attestation evidence, output release rules | Mobily Legal (competition) | Clean-team rooms |
| AMQ-05 | Whether external partners use this platform directly or an external VDR (integration instead) | Mobily Legal / Corporate Development | External accounts |
| AMQ-06 | Whether auditors may see strictly_confidential material by default or per engagement | Mobily Internal Audit | Auditor clearance |
| AMQ-07 | Maximum room-grant and clearance-grant durations; periodic access-review cadence | Mobily Cybersecurity | Grant expiry defaults |
| AMQ-08 | Document domain list | Mobily Data Governance | `domainClearance` |
| AMQ-09 | Confirm the §2.2.1 project-level read exceptions for workstream-scoped roles (`gates.gate.read`, `documents.document.read`, `documents.document.download`, `portfolio.project.read`): may a workstream lead / workstream-scoped contributor read the gate register, the project's non-room documents up to its clearance, and the project header? | Mobily Data Governance | §2.2.1 (implemented, pending confirmation) |
| AMQ-10 | Contributor powers at creation (SEC-P34-11): may a project-scoped contributor set `blocker` / `signoffRole` on the readiness checks it creates, and instantiate a site's or cutover plan's whole readiness checklist from the template, or should both be project manager / workstream lead only? | Program PMO / Readiness owner (Role — To be confirmed) | §2.4 (current behaviour documented, not changed) |
