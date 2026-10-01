# AI runtime — tool and action permission matrix (spec §12.3, access-matrix §2.7)

Source of truth in code: `packages/domain/src/ai.ts` (`AI_TOOLS`, `AI_ACTION_PERMISSION`, `AI_PROHIBITED_ACTIONS`,
`AI_AUTOPILOT_ELIGIBLE`) and `packages/domain/src/policy/policy-matrix.json` (`ai` flag). Served live at
`GET /api/v1/projects/:projectId/ai/tools`. The unit test `ai-runtime.test.ts` fails if any tool maps to a permission
whose `ai` flag differs from the tool kind, or if any proposable action maps to an `ai: none` permission.

**Effective AI permission for a call** = permission has `ai ∈ {retrieve, propose}` ∩ the delegating user holds it NOW
(re-resolved in the worker) ∩ the project mode allows the tool. Project and room scope come from the run context; no tool
takes a project or room id.

## Retrieval tools (invoked by the runtime, never by the model)

| Tool | Permission (`ai` flag) | Modes | Side effects | Notes |
|---|---|---|---|---|
| `search_documents` | `documents.document.read` (retrieve) | advisory, assisted, autopilot | none | One SQL statement over `document_chunk` ⋈ live `document` ACL; classification + room predicates in `WHERE` before `ts_rank`; current version only; quarantined/pending versions excluded |
| `list_overdue_work` | `planning.plan.read` (retrieve) | " | none | tasks/milestones past forecast/planned finish; workstream reach (`reachSql`); CPM delay impact via `delayImpact` |
| `list_missing_owners` | `planning.plan.read` | " | none | |
| `list_stale_updates` | `planning.plan.read` | " | none | no submitted/accepted update in 14 days |
| `get_delay_impact` | `planning.plan.read` | " | none | deterministic CPM; the model never computes schedule numbers |
| `list_decisions_awaiting_action` | `governance.decision.read` | " | none | decisions (classification in SQL), overdue actions, pending approvals > 5 days |
| `get_gate_blockers` | `gates.gate.read` | " | none | mandatory + blocking criteria not met |
| `list_closing_conditions` | `jv.deal.read` | " | none | status, evidence counts, waivability, gate link |
| `list_tsa_expiring` | `readiness.register.read` | " | none | ends ≤ 60 days, no accepted replacement; exit never declared |
| `list_readiness_blockers` | `readiness.register.read` | " | none | workstream reach applied |
| `get_status_dimensions` | `portfolio.dashboard.read` | " | none | |
| `get_partner_status` | `jv.partner.read` | " | none | identity only "confirmed" with an approved deal scenario; demo rows excluded in non-demo projects |
| `get_approved_financials` | `finance.record.read` | " | none | approved values only, currency + unit scale; no model arithmetic |

A model-issued call to any retrieval tool is refused (`retrieval_is_runtime_controlled`, audited `AI_TOOL_DENIED`).

## Propose tools (the model may call them; they create an `ai_proposal` only)

| Tool | Action | Underlying permission (`ai` flag) | Created in | Executable | Autopilot eligible |
|---|---|---|---|---|---|
| `propose_internal_notification` | `create_internal_notification` | `notifications.message.send` (propose) | advisory+ | assisted: after bound human approval; autopilot: if allowlisted | yes |
| `propose_owner_update_request` | `request_update_from_owner` | `notifications.message.send` | advisory+ | same | yes |
| `propose_follow_up_task` | `create_follow_up_task` | `planning.task.manage` (propose) | advisory+ | assisted (stored as a **draft** artefact; the planning module creates tasks) | no |
| `propose_risk_flag` | `flag_risk` | `planning.raid.manage` (propose) | advisory+ | assisted / autopilot → draft artefact | yes |
| `propose_agenda_draft` | `draft_agenda` | `governance.agenda_request.create` (propose) | advisory+ | assisted → draft | no |
| `propose_minutes_draft` | `draft_minutes` | `governance.minutes.draft` (propose) | advisory+ | assisted → draft | no |
| `propose_decision_paper_draft` | `draft_decision_paper` | `governance.decision.draft` (propose) | advisory+ | assisted → draft | no |
| `propose_status_summary_draft` | `draft_status_summary` | `planning.status_update.submit` (propose) | advisory+ | assisted / autopilot → draft | yes |
| `prepare_request_for_human` | `prepare_approval_request` | none (AI workspace text only) | advisory+ | **never** — text addressed to a human, no record | no |

Execution rules (worker, `ai.execute_proposal`): kill switch → mode (`assertActionExecutable`) → requester still holds
the permission and `ai.assistant.use` → approver still holds `ai.proposal.approve` + the underlying permission and is not
the requester → payload hash, target version, expiry (`isApprovalStillValid`) → the message recipient may still read the
target AND every record the run sent to the model (a draft: the delegating user may) → quiet hours (deferred) → ONE
transaction as the accountable human: (autopilot: per-project advisory lock `hub_ai_autopilot:<projectId>`) → proposal row
lock (after the per-key deduplication lock `hub_ai_dedupe:<key>`) → re-check of status, version, approval, emergency stop, mode /
autopilot policy / daily limit, and that no twin was executed within the project's cooldown (QA-P5-01,
`scheduling-policy.md`) → effect + approval
consumed + proposal executed (only while still pending at the checked version) + audit (SEC-P5-02, SEC-P5-06). Messages
are in-app only; e-mail / Teams / SMS are recorded in the delivery ledger as `disabled`. The delivered title carries the
platform's marker "AI-generated:" ("AI-generated (Simulated):" for the mock; Arabic for an Arabic run) — never left to
the model (SEC-P5-I7).

Content follows the recipient (SEC-P5-01, AIT-07; see `knowledge-sources.md`): a message is proposed, approved and sent
only to a recipient who may read its target and every record its run gave the model — refused at creation (audited
`DESTINATION_NOT_APPROVED`), at approval and revision (422 `ai.recipient_not_cleared`, the proposal invalidated and
audited), and at execution (invalidated, nothing sent). Autopilot never sends such content.

Approval (`ai.proposal.approve`): the approver must hold the underlying permission (authority) and must not be the
person on whose behalf the AI proposed (separation of duties). The AI is never an approver.

## Prohibited — no tool exists (any mode, even "approved")

`approve_gate, approve_decision, record_vote, change_baseline, change_budget, change_ownership, grant_vdr_access,
contact_partner, sign_agreement, execute_payment, change_permissions, delete_evidence, declare_closing, create_waiver,
verify_condition`. A model request for these (or any unknown tool whose name signals such a capability) is refused and
audited `AI_PROHIBITED_ACTION_REQUESTED`; a user request for them yields only a prepared request text.

## Route permissions of the AI API

| Route | Permission |
|---|---|
| `GET/PUT …/ai/settings` | `ai.settings.manage` |
| `POST …/ai/autopilot-policy/approve` | `ai.autopilot_policy.approve` (not the proposer) |
| `POST …/ai/autopilot-policy/revoke` | `ai.settings.manage` |
| `POST …/ai/killswitch/activate` / `release` | `ai.killswitch.activate` / `ai.killswitch.release` (not the activator) |
| `POST …/ai/ask`, `GET …/ai/tools`, `GET …/ai/artifacts`, `POST …/ai/proposals/:id/revise` | `ai.assistant.use` (revise: requester only) |
| `GET …/ai/runs`, `GET …/ai/runs/:id` | own runs only: `ai.run.read`, or the permission that produced them — `ai.assistant.use` (questions) or `ai.briefing.subscribe` (the briefings delivered to the caller) (QA-P5-02); another user's run is 404 for everyone |
| `GET …/ai/status` | `ai.run.read` (the status shows the caller's own last run — SEC-P5-I2) |
| `GET …/ai/costs` | `ai.operations.read` |
| `GET …/ai/proposals` | `ai.proposal.read` held **project-wide** (a project-level register, access-matrix §2.2 strict rule — a workstream-only grant gets 403, OBS-P5-01); rows filtered by the reader's visibility of the target and the run inputs (SEC-P34R-05) |
| `GET …/ai/proposals/:id` | as the list: `ai.proposal.read` project-wide and the row's visibility, else 404 (QA-P5-08). The DTO names the delegating user, the message recipient and the approvers (`people`, QA-P5-05) — only the people of that proposal, so an approver who cannot list the members still sees who will receive the message |
| `POST …/ai/proposals/:id/approve` / `reject` | `ai.proposal.approve` / `ai.proposal.reject` |
| `GET/POST …/ai/briefings` | `ai.briefing.subscribe` |
| `GET …/ai/detections` | `planning.plan.read` (rules only; works with AI off) |
