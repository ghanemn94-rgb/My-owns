# P2 independent domain RE-REVIEW: governance, planning, business gates, documents

| Item | Value |
|---|---|
| Reviewer | carveout-domain-analyst (REVIEW mode, separate context). This reviewer did not implement any of the fixes under review. |
| Revision reviewed | `1b30f4886bb413c009745d55cb2f7c2881537b03` (`1b30f48`) on `claude/mobily-transformation-hub`, identical to `origin/claude/mobily-transformation-hub` when fetched on 2026-09-30. The review worktree was frozen on it; nothing was merged in. |
| Review branch | `worktree-agent-af676bad6155171f5`. This re-review added only this report and two probe files: `apps/api/test/reviews/p2-domain-rereview.spec.ts` and `apps/api/test/reviews/p2-domain-rereview-perimeter.spec.ts`. No application code, test kit, seed, template or governance document was changed. |
| Date | 2026-09-30 |
| Input | First review `docs/reviews/P2-domain-review.md` (FAIL, DOM-P2-01..21), its two "Fix status" sections and the "DOM-P2-16 follow-up"; `docs/phases/P2-P4-requirement-disposition.md` (P2 part and "Updates after this disposition"); `docs/MASTER_PROMPT.md` §3, §4, §5, §9, §19 (P2 row), §20, §21. |
| **Verdict** | **FAIL** — see §7. The five original High findings are fixed and their probes pass. The re-review found **3 new High** findings: two in P2 scope (DOM-P2R-03, DOM-P2R-04) and one in P3 scope (DOM-P2R-05). It also found 1 Medium and 4 Low. |

This review makes no legal, tax, zakat, accounting or regulatory determination. Where a rule is a governance choice (for
example how non-voting members count), the report states the gap. The rule itself is for the governance owner to confirm
("Assessment pending — governance owner").

---

## 1. Commands and real results

All commands were run from `transformation-hub/` in the review worktree at `1b30f48`. The reviewer used only its own
databases: `hub_test_p2dr`, `hub_test_p2dr_boot` and `hub_test_p2dr_e2e`. Docker was not started. No database or process
of another agent was touched. Processes started by this review were stopped by PID (§1.4).

Note on evidence hygiene. The session scratchpad is shared with other agents. A first full-suite run wrote to a log name
that another agent also used, and that agent overwrote it. That run was stopped by PID and discarded. A second run was
stopped by PID after about 70 tests, because two probes were revised. Only the runs quoted below count as evidence. Their
logs are in a reviewer-specific directory.

```
$ git rev-parse HEAD
1b30f4886bb413c009745d55cb2f7c2881537b03
$ HUB_DATABASES="hub_test_p2dr hub_test_p2dr_boot" bash scripts/dev/pg-init-roles.sh
roles hub_owner/hub_app and databases ready: hub_test_p2dr hub_test_p2dr_boot
$ pnpm install --frozen-lockfile --prefer-offline      # Done
$ pnpm build:packages                                    # domain, contracts, db built
```

### 1.1 Unit tests (domain, contracts)

```
$ pnpm --filter @hub/domain --filter @hub/contracts run test
packages/domain test:     Test Files  17 passed (17)      Tests  357 passed (357)
packages/contracts test:  Test Files  2 passed (2)        Tests  100 passed (100)
```

### 1.2 API integration suite (real PostgreSQL), including all probes

```
$ pnpm --filter @hub/api run lint        # tsc --noEmit (incl. the new probe files) + module boundaries → exit 0
module boundary check passed: 32 cross-module imports, 14 module edges, acyclic, only published surfaces

$ TEST_DATABASE_URL=postgres://hub_app:hub_dev_only@127.0.0.1:5432/hub_test_p2dr \
  TEST_DATABASE_MIGRATION_URL=postgres://hub_owner:hub_dev_only@127.0.0.1:5432/hub_test_p2dr \
  pnpm --filter @hub/api test --reporter=verbose
 Test Files  2 failed | 80 passed (82)
      Tests  4 failed | 717 passed (721)
   Duration  1257.88s
```

Reading of the result:

- The **4 failures are exactly this re-review's DEFECT probes**. Each failed only at its final (defect) assertion; every
  setup step before it passed through the real API:
  - `DOM-P2R-03`: "change Y approved on the decision about change X: {"status":"approved"} — expected 201 to be 422".
  - `DOM-P2R-04a`: "rag=green; decision still approved — expected false to be true".
  - `DOM-P2R-04b`: "approved on a decision whose external-approval evidence is rejected: {"status":"approved"} — expected
    201 to be 422".
  - `DOM-P2R-05`: "v2 approved on the v1 decision: {"versionNo":2,"status":"approved"}; versions [v1 superseded, decision
    D; v2 approved, decision D] — expected 201 not to be 201".
- **Every pre-existing test passes: 709 tests in 80 files.** This includes `p1/p1-closure-empty-db.spec.ts` 3/3 on
  `hub_test_p2dr_boot`, and all 12 probes of the first review.

Per file (from the verbose log):

| File | Passed | Failed |
|---|---|---|
| `reviews/p2-domain.spec.ts` (first review's probes, DOM-P2-01a … -10) | 12 | 0 |
| `reviews/p2-domain-rereview.spec.ts` (this review) | 8 | 3 (DEFECT DOM-P2R-03, -04a, -04b) |
| `reviews/p2-domain-rereview-perimeter.spec.ts` (this review) | 0 | 1 (DEFECT DOM-P2R-05) |
| `governance/p2-governance-authority.spec.ts` (DOM-P2-02, -03, -06, -12, -13, -20) | 18 | 0 |
| `gates/dom-p2-16-gate-roles.spec.ts` | 11 | 0 |
| `gates/p2-gate-authority-reassessment.spec.ts` (DOM-P2-01, -05, -09, -15) | 9 | 0 |
| `planning/cross-project-and-prerequisites.spec.ts` (DOM-P2-17, -18) | 10 | 0 |
| `documents/at-01-claim-verification.spec.ts` (DOM-P2-04, -19) | 6 | 0 |
| `planning/approver-role-and-my-work.spec.ts` (DOM-P2-07, -09) | 6 | 0 |
| `carveout/setup-wizard.spec.ts` (perimeter version on a G1 decision) | 4 | 0 |
| `gates/at-14-reassessment.spec.ts`, `gates/at-04-gate-blocked-by-recommendation.spec.ts` | 4, 6 | 0 |
| `governance/at-04-decision-outside-delegation.spec.ts`, `governance/at-05-quorum-recusal-self-approval.spec.ts` | 6, 9 | 0 |

Before the full run, a first run of the review folder only (`vitest run test/reviews/`) gave `Tests 4 failed | 31 passed
(35)` in 314.94 s. That run used the first version of the probes, in which DOM-P2R-02 was still a DEFECT probe. It was
then downgraded to an OBSERVATION (§4) and DOM-P2R-04b was added. The full run above is the evidence.

### 1.3 Playwright E2E (P2 specs), own stack

The stack was set up as in the CI e2e job, on the reviewer's own database and ports: API :4761 and web :3761.

```
$ HUB_DATABASES="hub_test_p2dr_e2e" bash scripts/dev/pg-init-roles.sh
roles hub_owner/hub_app and databases ready: hub_test_p2dr_e2e
$ (env DATABASE_URL=…/hub_test_p2dr_e2e DATABASE_MIGRATION_URL=…/hub_test_p2dr_e2e HUB_MODE=demo NODE_ENV=development)
  node deploy/docker/api-entrypoint.cjs migrate      → [hub-entrypoint] post-migrate SQL applied (RLS, grants, triggers, audit chain); migrate: done
  node apps/api/dist/cli/seed-demo.js                → demo seed complete
  PORT=4761 HUB_RATE_LIMIT_PUBLIC_PER_MINUTE=1000 node apps/api/dist/main.js &   → /readyz {"status":"ready"}
  node apps/api/dist/worker.js &
$ HUB_API_URL=http://127.0.0.1:4761 pnpm --filter @hub/web run build     (NODE_ENV unset) → EXIT 0
$ next start -p 3761                                                         → /login HTTP 200
$ HUB_WEB_URL=http://127.0.0.1:3761 PLAYWRIGHT_BROWSERS_PATH=/opt/pw-browsers pnpm --filter @hub/e2e exec playwright test \
    tests/p2-documents.spec.ts tests/p2-gates.spec.ts tests/p2-governance.spec.ts tests/p2-planning.spec.ts \
    tests/p2-web-followups.spec.ts tests/p3-carveout.spec.ts --reporter=list
  21 passed (5.5m)
```

The 21 tests: p2-documents (a)–(d). p2-gates (a)–(e); (d) is "a gate cannot be approved on a decision that is not final
(AT-04, DOM-P2-01); the gate review precedes submission (DOM-P2-16)". p2-governance (recused vote refused in the UI).
p2-planning (a)–(c); (b) is the change-request lifecycle with the Sponsor's approval. p2-web-followups (a)–(d): external
approval on second-person-verified evidence, a change above the limit approved on that final decision, matrix approval
pending verification, cross-project dependency, and prerequisite refusal in English and Arabic. p3-carveout (a)–(d)
includes (a) AT-07, which failed in the disposition's run (F-13) and **passes** here.

**NOT EXECUTED:** the rest of the Playwright suite (`a11y`, `p1-*`, `p4-*`, `qa-p1-*`). It is outside this domain
review's P2 scope. The run rewrote tracked screenshots under `e2e/screenshots/`; they were restored with
`git checkout -- transformation-hub/e2e/screenshots` and are not part of this change.

### 1.4 Processes started and stopped

- E2E stack: API PID 7638, worker PID 7640, web wrapper PID 10985 and `next-server` PID 10986. Stopped with `kill` after
  the run. Afterwards `curl` to :4761/readyz and :3761/login returns no connection (`000`).
- Aborted API test runs of this review, stopped with `kill`: PIDs 20847 / 20874 / 21490 (the run whose log another agent
  overwrote) and 4140 / 4165 / 4665 (the run superseded by the revised probes).
- Left in place: the reviewer's own databases `hub_test_p2dr`, `hub_test_p2dr_boot` and `hub_test_p2dr_e2e`. Nothing
  else was left running.

## 2. Per-finding status (DOM-P2-01..21)

Legend. **Fixed**: the finding as written is resolved, and an executed test proves it. **Partially fixed**: part of it is
resolved. **Not fixed**: still open. **Accepted variance**: the behaviour differs from the recommendation, but it is
documented and acceptable for the P2 gate. **Re-phased**: moved to a later phase with an owner (REQ status `Deferred`).

"Probe" means `apps/api/test/reviews/p2-domain.spec.ts`, the first review's probes, now named `DOM-P2-nn`. "RE probe"
means this re-review's `p2-domain-rereview*.spec.ts`. The results are those of the full run in §1.2.

| Finding (first review) | Sev. | Status | Evidence (executed unless marked "code") | Residual / new finding |
|---|---|---|---|---|
| DOM-P2-01 gate approval on any final decision | High | **Fixed** (gate decisions) | Probes DOM-P2-01a and DOM-P2-01b pass. RE probe: an operational-type decision raised for G5 cannot even be linked to G5 (`422 gates.decision.not_for_gate`). RE probe: G0 is refused on the committee's recommendation (`422 gates.decide.decision_not_final`) and passes only on the reserved-type decision `gate_decision_mandate` after the external approval with verified evidence. Code: `packages/domain/src/gates.ts:277-312` (gate key, finality, `gateKeys` of the deciding committee's approved matrix, body), `apps/api/src/modules/gates/gate-authority.ts`, `gates.service.ts:283-300` (link), `:302-340` (decide). The perimeter-version approval uses the same rule (`perimeter-versions.service.ts:164-178`; `carveout/setup-wizard.spec.ts`: a final decision raised for no gate → 403). | Perimeter: the same G1 decision approves every later version → **DOM-P2R-05 (High, P3 scope)**. External-approval evidence is checked only when it is recorded → **DOM-P2R-04 (High)**. |
| DOM-P2-02 abstentions ignored | High | **Fixed** (documented rule; confirmation pending, A-40 / Q-40) | Probes DOM-P2-02 (domain) and DOM-P2-02 (API) pass: 1 approve + 4 abstain is not approved. `governance.ts:164-190`: eligible votes = approve + reject + abstain, simple majority `approve×2 > eligible`, two-thirds `approve×3 ≥ eligible×2`. `p2-governance-authority.spec.ts` DOM-P2-02 tests pass. | Present members who do not vote are not counted, and nothing closes the vote. **DOM-P2R-01 (Medium)**: one approve vote, recorded at once, approves 1 to 0. |
| DOM-P2-03 baseline / change-request approvals bypass the matrix | High | **Fixed** (matrix enforcement); new High in the decision-backed path | Probe DOM-P2-03a passes (`422 change_control.no_usable_matrix`, non-demo project without a matrix). Probe DOM-P2-03b passes (`422 change_control.amount_unquantified`: text-only cost). RE probe: a **structured** cost impact of 1,500,000 is refused to the sponsor alone (`422 change_control.outside_delegated_authority`), and the request stays `under_review`. `p2-governance-authority.spec.ts` DOM-P2-03 tests pass: within limit, above limit, USD, SoD first, recommendation not final, external approval, type, amount, reuse, 404, non-demo matrix. Code: `change-control.service.ts:717-795`, `governance.ts:389-429` `evaluateDelegatedApproval`. | A final decision is not bound to the change request or baseline it authorized → **DOM-P2R-03 (High)**. The requester alone may set the deciding amount → **DOM-P2R-02 (Low)**. A rejected external-approval record still backs an approval → **DOM-P2R-04 (High)**. |
| DOM-P2-04 historical claim laundered to confirmed | Medium | **Fixed** | Probe DOM-P2-04 passes. `documents/at-01-claim-verification.spec.ts` passes. `origin_status` + `verification_source_id` (a different source; verifier not the extractor nor the previous reviewer). | — |
| DOM-P2-05 defective evidence on an approved gate not reassessed | High | **Fixed** (criterion evidence) | Probe DOM-P2-05 passes (rejected link relied upon → `needsReassessment = true`, RAG not green). `gates/p2-gate-authority-reassessment.spec.ts` passes (supersede, reject, undecided → unmet). `gates.ts:403-472`. | The same rule is not applied to the evidence of the **decision** behind the gate → **DOM-P2R-04 (High)**. |
| DOM-P2-06 recusal after voting flips the outcome | High | **Fixed** | Probe DOM-P2-06 passes (recusals after the vote → 422; outcome rejected as cast). `governance.ts:239-254` `assertRecusalAllowed`, `governance.support.ts:185-206`, `assertTallyIntegrity` (`governance.ts:203`). `p2-governance-authority.spec.ts` DOM-P2-06 tests pass. | A secretariat recusal on behalf of a member **before** the member votes needs only a reason → **DOM-P2R-08 (Low)**. |
| DOM-P2-07 task approver role not enforced | Medium | **Fixed** | Probe DOM-P2-07 passes (functional approver refused on a sponsor-approved task, 403). The lead granted the policy that the fix needed: `planning.deliverable.accept` is now held by `sponsor`, `committee_chair`, `workstream_lead` and `functional_approver` (`packages/domain/src/policy/policy-matrix.json`, checked). | Residual (implementers' own note): `approverRole` of a *baselined* task is locked only while it awaits acceptance, not routed through change control. Low. |
| DOM-P2-08 RAG thresholds hard-coded | Medium | **Re-phased → P6** (REQ-PLN-019 `Deferred`) | Code: `health.service.ts` still uses `DEFAULT_RAG_THRESHOLDS`. | Acceptable for the P2 gate (§5). |
| DOM-P2-09 My Work omits approvals | Medium | **Fixed** (six item types) | Probe DOM-P2-09 passes. `planning/approver-role-and-my-work.spec.ts` and `gates/p2-gate-authority-reassessment.spec.ts` My Work tests pass. | Agenda screening, external-authority recording and claim reviews are still not My Work items (REQ-UX-018 stays `Implemented`, §5). |
| DOM-P2-10 project override Green over blockers | Low | **Fixed** | Probe DOM-P2-10 passes (override capped at red while a red-critical item exists). | — |
| DOM-P2-11 notifications unreadable | Medium | **Re-phased → P6** (REQ-PLT-008 `Deferred`) | Code: notifications contract still `registerRoutes({})`. | Acceptable for the P2 gate (§5). |
| DOM-P2-12 matrix / external approval on free text | Low | **Fixed** (when recorded) | `p2-governance-authority.spec.ts` DOM-P2-03/-12 and DOM-P2-12 tests pass: a non-demo matrix needs a document and stays `draft` until a second person verifies it; the verifier is not the approver, drafter or uploader. An external decision needs an active, verified evidence link on the decision; the verifier cannot record it. The gate kit and my RE probes use this path. | Verification is enforced only when the approval is recorded. A later rejection of that evidence changes nothing → **DOM-P2R-04 (High)**. |
| DOM-P2-13 quorum denominator / casting vote | Low | **Fixed** (code aligned; A-41 / A-42 pending governance owner) | RE probe (domain): 8 appointed, 3 recused, 3 eligible present → required 4, not met; 4 present → met. `p2-governance-authority.spec.ts` DOM-P2-13 test passes. | — |
| DOM-P2-14 paper completeness omits evidence / attachments | Low | **Not fixed** | Code: `governance.ts:525-552` `missingDecisionPaperFields` still has no evidence / attachment / "none — reason" entry. | Open Low. Disposition F-04. See §5 (REQ-GOV-014). |
| DOM-P2-15 applicability / waivability loosely bound | Low | **Fixed** | `p2-gate-authority-reassessment.spec.ts` DOM-P2-15 tests pass (designated specialist only, editable states only, applicability set from the determination). | — |
| DOM-P2-16 gate owner / reviewer not enforced | Low | **Fixed** (design judged in §3) | `gates/dom-p2-16-gate-roles.spec.ts` (11) passes. RE probe: an endorsement becomes `stale` after a second person verifies an evidence link, and mark-ready is refused (`422 gates.assessment.review_stale`). The PM, acting as owner, cannot submit the cycle it endorsed (`403 gates.assessment.reviewer_cannot_submit`). The owner (workstream lead) submits after a fresh endorsement. The chair decides on an operational-type G1 decision. | Role-level design gaps → **DOM-P2R-06 (Low)**. |
| DOM-P2-17 cross-project dependencies missing | Medium | **Partially fixed** (API; stricter-than-specified disclosure) | `planning/cross-project-and-prerequisites.spec.ts` DOM-P2-17 tests pass. | A reader of only one project sees nothing. The requirement asks for a redacted remote item (date and status) — F-08, REQ-ENT-010 `Implemented`. See §5. |
| DOM-P2-18 dependencies cannot link approvals etc. | Medium | **Fixed** (API) | `planning/cross-project-and-prerequisites.spec.ts` DOM-P2-18 tests pass. A pending decision, gate, agreement, approval or evidence blocks the task start or the milestone (`422 planning.prerequisite_pending`). | A prerequisite can be removed by the person it blocks, without a reason → **DOM-P2R-07 (Low)**. These are not CPM nodes (documented). |
| DOM-P2-19 conflict flagged on one side | Low | **Fixed** | `documents/at-14-conflicting-evidence.spec.ts` / at-01 claim tests pass (both claims conflicting, pending proposal invalidated). | — |
| DOM-P2-20 attendance mutable after votes | Low | **Fixed** | RE probe: after the first vote, an attendance change → `422 governance.attendance.frozen_voting_open`; after the outcome, attendance is free again. `p2-governance-authority.spec.ts` DOM-P2-20 tests pass. | — |
| DOM-P2-21 evidence verification unused | Low | **Accepted variance** (documented) | `business-gates.md` §4 rule 9. A rejection is decisive (DOM-P2-05). Prerequisites need **verified** evidence. Unverified evidence appears in the verifiers' My Work. | — |

## 3. DOM-P2-16 design judgement (gate owner, gate reviewer, gate-level review)

Checked against spec §3 ("Each gate must have criteria, evidence, owner, reviewer, approver …"), REQ-LCY-010 (security
rule "Owner, reviewer and approver must be distinct where policy requires"; AT "gate without approver cannot be assessed"),
the DC template (`packages/db/seed/templates/dc-carveout.v1.json`), `business-gates.md` §2.4 and `access-matrix.md` §2.4.

- **Template roles.** G0 owner `secretary_cpmo`, reviewer `project_manager`, approver `sponsor`. G1 owner `workstream_lead`,
  reviewer `project_manager`, approver `committee_chair`. G2 owner `legal_restricted`, reviewer `functional_approver`. G3
  owner `project_manager`, reviewer `functional_approver`. G4 owner `workstream_lead`, reviewer `functional_approver`. G5
  owner `workstream_lead`, reviewer `finance_restricted`. G6 owner `workstream_lead`, reviewer `legal_restricted`. G7 owner
  `project_manager`, reviewer `secretary_cpmo`. G1–G7 approver `committee_chair`. The three roles of every gate are
  present and distinct. `assertGateRolesComplete` refuses to start a cycle otherwise (422). This matches spec §3 and the AT.
- **Gate-level review step.** Only the designated reviewer role endorses or returns, and only while the cycle is
  `in_assessment`. An endorsement needs complete criteria (prerequisites aside). The review is recorded on the cycle with a
  SHA-256 of the canonical criterion state (`gateReviewBasis`): criterion definition versions, criterion-assessment row
  versions, every evidence link with status and version, and every waiver with status and version. Evidence links pin a
  `document_version_id` when created (`evidence.service.ts:182-196`). A new upload of the same document therefore cannot
  change reviewed content without changing the basis. Mark-ready needs `basis == current` (422 stale / returned /
  required). The endorsing reviewer cannot submit (403). Decide excludes both the submitter and the reviewer. **Sound.** The
  binding is conservative: a working-note edit also makes the endorsement stale. That is acceptable.
- **PM-override convention.** Under `own_workstream` (access-matrix §2.4), the project manager may act as the owner of any
  gate. For G0 and G1 the PM is also the template's **reviewer** role. At role level, the owner and reviewer functions can
  then both be carried by `project_manager` holders: PM A starts and submits, PM B endorses. The template owner (CPMO for
  G0, the workstream lead for G1) takes no part. Separation between individuals holds (starter ≠ reviewer ≠ submitter;
  approver ∉ {submitter, reviewer}). The role-distinctness invariant that `assertGateRolesComplete` checks on the template
  is not upheld at run time. This is documented (`business-gates.md` §2.4) → DOM-P2R-06 (Low): the governance owner
  should confirm it.
- **Workstream-lead owners.** `workstream_lead` owns G1, G4, G5 and G6 "through the workstream it leads". That can be
  *any* workstream. The demo seed has the Technology lead (WS06) start G1 (Perimeter & Strategy) and G5 (JV Signing
  Readiness). In the gate kit, the lead of the first template workstream starts and submits G1 (this review's RE
  DOM-P2-16 probe) and G4 (`dom-p2-16-gate-roles.spec.ts`). The template gate carries no owner workstream → part of
  DOM-P2R-06.
- **Conclusion.** The design matches the specification and the template at the level the specification states (roles
  present, distinct, enforced server-side; review before submission; endorsement bound to the reviewed state). DOM-P2-16 is
  **Fixed**. The two role-level gaps are Low and documented.

## 4. New findings

Severity scale as in the first review. **High**: a mandatory rule named in the spec or a P2 exit criterion can be bypassed
through the API, or the implementation contradicts the platform's governance rule. **Medium**: a mandatory requirement is
missing or only partly enforced, but a manual workaround exists. **Low**: a gap in precision, documentation or hardening.
Each DEFECT probe asserts the required behaviour and fails at `1b30f48` (§1.2). Each OBSERVATION probe records the current
behaviour and passes.

### DOM-P2R-03 — High — A committee decision authorizing one change can approve a different change

- **Location:** `packages/domain/src/governance.ts:404-428` (`evaluateDelegatedApproval` checks finality, decision type,
  currency and amount coverage only) and `apps/api/src/modules/planning/change-control.service.ts:738-775`
  (`evaluateAuthority`: same project, visible, not already used). A decision row has no link to the change request or
  baseline it authorizes (`packages/db/src/schema/governance.ts:189-249`; only `gate_key` binds a subject).
- **Spec:** §4.2 "approval interfaces enforcing delegated authority". AT-04 "route to the authorized body". P2 exit
  criterion "block decisions outside authority". REQ-GOV-022, REQ-PLN-013. The analogous gate rule (DOM-P2-01: "a decision
  raised for this gate") exists for gates only.
- **Reproduction (executed):** `p2-domain-rereview.spec.ts` "DEFECT DOM-P2R-03". Change X costs 1,500,000 and change Y
  costs 1,200,000; both are above the DEMO limit. The committee paper "Authorize change X only" (type
  `change_request_budget`, 1,500,000) becomes `recommended` and is approved by the external body with verified evidence.
  The sponsor then approves **change Y** with that decision → `201 {"status":"approved"}` (expected 422). Nobody with
  authority above 1,000,000 ever approved Y. X now needs another decision.
- **Recommendation:** Bind the decision to its subject. For example, add `subjectType` / `subjectId` to the decision paper
  (`change_request` / `baseline_version`), set when the paper is raised from the change request, and require it to match
  at approval. The web decision picker should then list only decisions raised for that change request. Keep
  `decision_already_used`.

### DOM-P2R-04 — High — An external approval whose evidence is later found defective still counts

- **Location:** `packages/domain/src/gates.ts:259` (`gateDecisionIssue`: a recorded `externalAuthorityReference` string is
  enough), `governance.ts:409` (`evaluateDelegatedApproval`: same), `packages/domain/src/planning.ts:92-95` (prerequisites:
  same). The evidence check of DOM-P2-12 runs only in `decisions.service.ts:530-583` (`recordExternalApproval`). The
  reassessment job reacts only to gate-criterion evidence (`gates.jobs.ts`, `processEvidenceConflicts`). Nothing reads
  `decision.external_evidence_link_id` after recording (grep: only the DTO and the write).
- **Spec:** §3 "If approved evidence is found defective, reopen the assessment through a controlled process while
  preserving previous status and decisions". §14 (evidence changes trigger reassessment of derived records). REQ-LCY-015,
  REQ-DAT-014. The DOM-P2-12 rule itself ("an external authority decision rests on a verified evidence link").
- **Reproduction (executed):** "DEFECT DOM-P2R-04a". G0 is approved on the reserved-type decision whose external approval
  rests on a verified evidence link. A third person (Finance) verifies that link as `reject` ("record does not match the
  resolution") → 201, and the worker runs. G0 keeps `needsReassessment = false`, `rag = green`, and the decision stays
  `approved`. "DEFECT DOM-P2R-04b": a `change_request_budget` decision for 1,500,000 is externally approved. Its evidence
  is then rejected. The sponsor approves a 1,500,000 change on it → `201` (expected 422).
- **Recommendation:** (1) Treat an external approval as final only while its evidence link is `active` and verified: check
  the link in `gateDecisionIssue` / `evaluateDelegatedApproval` / `prerequisiteSatisfied` (load the link with the decision).
  (2) When that link is rejected, superseded or marked conflicting, extend the DOM-P2-05 job. Flag every decided gate cycle,
  approved baseline, change request, perimeter version and satisfied prerequisite that relied on the decision. Record an
  escalation, and never change the recorded decisions (controlled reassessment).

### DOM-P2R-05 — High (P3 scope) — One G1 decision approves every later perimeter version

- **Location:** `apps/api/src/modules/carveout/perimeter-versions.service.ts:164-192`. The approval checks the G1 rule
  (DOM-P2-01) but not whether the decision already backed an earlier version, and not which snapshot the committee saw.
- **Spec / requirements:** §4.2 (approval interfaces enforcing delegated authority). §7.1 (versioned perimeter).
  REQ-SET-012 (P3, security rule "Approval per authority matrix"). AT-07 (preserve the previous version). The
  change-control analogue (`change_control.decision_already_used`) exists.
- **Reproduction (executed):** `p2-domain-rereview-perimeter.spec.ts` "DEFECT DOM-P2R-05". Version 1 is approved on G1
  decision D. A later site is added through an approved change request and applied, and version 2 is proposed. The sponsor
  approves **version 2 on the same decision D** → `201`. Both versions record `decision_id = D` (version 1 `superseded`,
  version 2 `approved`).
- **Scope:** REQ-SET-012 is a P3 requirement, and no P3 gate report exists yet. This finding blocks the **P3** gate. It
  does not change the P2 verdict on its own. It is reported here because the task asked for the perimeter-version rule to
  be re-verified under DOM-P2-01. Owner: backend-data-engineer (carve-out).
- **Recommendation:** Refuse a decision that already backed another perimeter version, or bind the decision to the version
  (`snapshotHash`) it approved.

### DOM-P2R-01 — Medium — An outcome can be recorded after one vote; present members who have not voted do not count

- **Location:** `decisions.service.ts:413-470` (`recordOutcome` needs only quorum by presence and at least one approve or
  reject vote). `governance.ts:164-190` (`tallyVotes`: denominator = votes cast). `authority-matrix.md` §3 step 5 as
  clarified by the DOM-P2-02 fix: "members present who do not vote are not counted".
- **Reproduction (executed):** "OBSERVATION DOM-P2R-01" (passes and records the current behaviour). Five eligible
  members are present. The chair votes approve, and the secretariat records the outcome at once →
  `approved`, "Simple majority of eligible votes (1 approve, 0 reject, 0 abstain of 1 eligible votes …)". The other four
  never had the chance to vote in that round.
- **Why it matters:** The first review's DOM-P2-02 impact ("a single member's vote can approve a decision within delegated
  authority") is reproducible again through timing, not through abstentions. The documents do not define when voting
  closes. The original wording of §3 step 5 ("approve votes > half of eligible votes", with "eligible" defined in step 4 as
  the eligible members *present*) also supports the reading that non-voters count as not approving. A-40 lists that
  reading as the alternative.
- **Recommendation (governance owner decides, Q-40):** Either count every eligible member present as a vote (non-voters =
  not approving), or add an explicit "close voting" step for the chair. The outcome would then be recordable only when every
  present eligible member has voted or abstained, or after the chair closes the vote, with non-voters recorded. Circulation
  already has a deadline. Owner: backend-data-engineer (governance) + governance owner.

### DOM-P2R-02 — Low — The requester alone may set the amount that decides delegated authority

- **Location:** `packages/contracts/src/planning.ts:639-650` (`costImpact` on create / edit by the requester).
  `change-control.service.ts:813-820` (`crAmount`: the structured amount wins over the text). No `not_self` between
  requester and assessor.
- **Reproduction (executed):** "OBSERVATION DOM-P2R-02". The PM raises a change stating "1,500,000 DEMO-SAR … above the
  DEMO limit" in the impact text, records `costImpact = 0` on the same request and starts the review. The sponsor approves →
  201, audited as `delegated_authority` with amount 0. The demo seed and the carve-out kit follow the same pattern (the PM
  records a "synthetic" 0).
- **Assessment:** A requester-entered amount checked by an independent approver is a normal maker-checker pattern, so
  this is not rated as an authority bypass. However, the server never reconciles the structured amount with the stated
  text, and nobody other than the requester has to confirm the amount.
- **Recommendation:** Require `costImpact` to be recorded or confirmed by an assessor other than the requester (Finance
  when a cost is stated), or show and audit a "stated vs quantified" discrepancy flag that the approver must acknowledge.
  Governance owner (Q-43).

### DOM-P2R-06 — Low — Gate ownership at role level: PM override on G0/G1 and "any workstream lead"

- See §3. The PM override lets `project_manager` holders carry both the owner and the reviewer function of G0/G1, and any
  workstream lead may own G1/G4/G5/G6. Both are documented in `business-gates.md` §2.4 and `access-matrix.md`.
- **Recommendation:** The governance owner should confirm the override for gates that the PM reviews, or disable it
  there. Add a proposed `ownerWorkstreamKey` per gate in the template (labelled "Proposed — to be confirmed"; the mapping is
  not a fact and is not invented here).

### DOM-P2R-07 — Low — A blocking prerequisite can be removed without a reason by the people it blocks

- **Location:** `prerequisites.service.ts:113-121`, and contract `planning.removePrerequisite` (`reason` optional,
  `packages/contracts/src/planning.ts:1128`). `planning.dependency.manage` is held by `project_manager` and
  `workstream_lead`, the same people whose task start the prerequisite blocks. The removal is audited.
- **Recommendation:** Require a reason. For a baselined task, route the removal through change control or a second person.

### DOM-P2R-08 — Low — A secretariat recusal on behalf of a member before the member votes needs only a reason

- **Location:** `governance.support.ts:185-206`, `governance.ts:239-254`. A holder of `governance.meeting.manage` can
  record a recusal for a member who has not voted yet. That excludes the member from the item. It is audited and shown in
  the tally snapshot.
- **Charter:** `committee-charter-draft.md` §14.1–14.2 ("members declare conflicts"; "recused … where the chair rules").
  §14.6 (added by the fix) accepts a secretariat recording with a reason.
- **Recommendation:** Record the member's own declaration or a chair ruling (`ruledBy`) for on-behalf recusals. Governance
  owner.

### Informational

- **Register status vs open findings.** `requirements.yaml` rates REQ-GOV-022 and REQ-PLN-013 (DOM-P2R-03), and
  REQ-LCY-015 and REQ-DAT-014 (DOM-P2R-04), as `Tested`. Until those findings are fixed, they should read `Implemented`
  with the gap named (lead-owned `status-evidence.yaml`).
- **Probe hygiene.** The docblock of `apps/api/test/reviews/p2-domain.spec.ts` still says the tests are `DEFECT` probes that
  fail. Probe DOM-P2-03b now passes through `amount_unquantified` (text-only cost), not through the limit. The limit path
  is covered by `p2-governance-authority.spec.ts` and by this re-review's RE probe.

## 5. P2 musts disposition check (`docs/phases/P2-P4-requirement-disposition.md`, P2 part)

**Register state at `1b30f48`** (`requirements.yaml`, executed count): P2 = 85 musts. **56 Tested, 27 Implemented,
2 Deferred, 0 Planned.** This equals the disposition (55 / 28 / 2) plus the update REQ-LCY-010 → Tested.
`python3 scripts/requirements/apply_status.py --check` → `status-evidence.yaml OK (263 entries)`. The "Updates after this
disposition" section checks out as follows:

- LCY-010 → Tested: confirmed by `dom-p2-16-gate-roles.spec.ts` (full run) and §3.
- F-13 fixed: the web change-request pages carry `costImpact` (`raid/changes/[changeRequestId]/page.tsx`,
  `components/planning/raid.tsx`), and the decision page carries the external-approval evidence picker. The E2E result is
  in §1.3.
- The P4 web screens are out of P2 scope.

**P2 exit criteria (§19, P2 row).** (1) Decision request → authorized approval → action → closure evidence: works and is
tested (`decision-lifecycle.spec.ts`). (2) Block decisions outside authority: **not yet**, because of DOM-P2R-03 and
DOM-P2R-04. (3) Domain plus QA review: this review is FAIL.

Gap-by-gap judgement (does it block the P2 exit criteria, or can it be re-phased):

| REQ | Gap (disposition) | Blocks P2 exit? | Recommendation | Owner → phase |
|---|---|---|---|---|
| GOV-015 | No conflict-of-interest declaration required before a vote (F-01; `castVote` has no declaration check — code confirmed) | **Yes, unless the governance owner decides otherwise.** "Quorum/conflict checks" is a step of the §4.2 journey that exit criterion 1 exercises, and the statement says "requires conflict-of-interest declarations". | Require a recorded declaration (none / conflict → recusal) per member per item before the vote. Or record the governance owner's decision that declarations are optional, as an AT variance. | backend-data-engineer (governance) + governance owner → **before the P2 gate** |
| GOV-012 | Screening lacks merge / reject; requester not notified | No (the journey works with accept / return / defer) | Add merge and reject (reason required). Notification with PLT-008. | backend-data-engineer (governance) → P3; notification → P6 |
| GOV-013 | Agenda numbers not unique under concurrency | No (hardening) | Unique index `(meeting_id, number)` for accepted items + a concurrency test (migration lead-owned) | backend-data-engineer + lead → P3 (or P7 hardening) |
| GOV-008 | Minutes retention is charter text only | No | Re-phase with REQ-DAT-011 (retention enforcement); keep the classification-inheritance test | backend-data-engineer (governance/documents) → with DAT-011's phase (P6/P7) |
| GOV-009 | No meeting series from the cadence | No | Accept "proposed cadence, flag only" as an AT variance (the statement asks for a configurable proposed cadence, which exists), or generate a Proposed series | lead decision at the P2 gate; else ux + backend → P6 |
| WS-003 | No-lead data-quality flag untested; per-element checks missing | No | A test for the existing flag now. Per-element coverage (objective, RACI, budget, linked gates…) with REQ-WS-002 | backend-data-engineer (planning) + carveout-domain-analyst → test before the P2 gate; element checks P3 |
| UX-005 | Cockpit "top decisions/blockers" and "committee asks" are `NotImplementedYet` labelled **P2**; no overall-health tile (F-05; confirmed at `page.tsx:195-197`) | Not an exit criterion, but "initial dashboard" is a **P2 required output**, and the UI labels these tiles P2 | Build the two tiles (data exists: decisions, escalations), or have the lead re-label them to a later phase with an owner. Do not pass P2 while the UI says "P2 — not implemented". | ux-frontend-engineer → before the P2 gate (or explicit lead re-phase) |
| UX-006 | Charter page lacks the committee charter version and the approved baseline | No | Add both | ux-frontend-engineer → P3 |
| UX-018 | My Work lacks agenda screening, external-authority recording and claim reviews; no comments; notifications in P6 | No, but external-authority recording is the step that completes reserved-matter decisions (AT-04) | Add the three item types. Comments and notifications → P6 | backend-data-engineer (My Work) + ux → P3; notifications P6 |
| UX-024 | No metric drill-down / contributors API | No | Contributors API + drill-down E2E | ux + backend → P6 (reporting) |
| SET-013 / SET-014 | No wizard steps 5 / 6 (setup-gap list only) | No | Accept "setup-gap links to Committee Hub / plan" as an AT variance if the gap list links there, or build the steps | lead decision at the P2 gate; else ux + backend → P8 (onboarding) |
| PLN-002 | No Kanban view (F-06) | No | Kanban over the same task data + E2E | ux-frontend-engineer → P6 |
| GOV-014 (also DOM-P2-14) | Evidence / attachments not required at submit | No | Small change: require an evidence link, an attachment or "none — reason" | backend-data-engineer (governance) → before the P2 gate preferred; else P3 |
| ENT-010 (DOM-P2-17) | Single-side readers see nothing (F-08) | No | Accept the stricter disclosure as a variance for P2 only. The user story (a PM without access to B sees a redacted constraint) must be delivered later. | backend-data-engineer (planning) + security-privacy-reviewer → P3 |
| PLN-019 / PLT-008 (DOM-P2-08 / -11) | Deferred to P6 | No — not exit criteria. For AT-14, the gate turns red and an escalation is recorded, which is a workaround for the missing inbox. | Keep them `Deferred` with owners. Fix the F-12 describe title that claims PLN-019. | backend-data-engineer (project-config); integration-reporting-engineer → P6 |

## 6. Invented facts in seeds and templates

Pattern scans (dates, percentages, money-like numbers, currencies, honorific + name, C-level titles) of
`packages/db/seed/templates/{dc-carveout,general-transformation}.v1.json`, `packages/db/seed/source-maps/dc-carveout.v1.json`,
`apps/api/src/modules/{governance,gates,planning,documents,carveout}/*.seed.ts`, `governance/demo-policy.ts` and
`apps/api/src/cli/seed-demo.ts`:

- **Templates:** no dates, percentages, amounts, currencies or person names. "incorporated" appears only as status-option
  keys and in activity text that is conditional on the NewCo's actual status. **No invented facts.**
- **Demo seeds:** every amount is DEMO-SAR and labelled DEMO (`250,000` / `1,500,000` decision papers, DEMO limits).
  Persona names are "Demo …" with "(synthetic persona)" titles. Chairs are "role to be confirmed". The external-authority
  reference is "synthetic reference — not a real resolution". Partners are the fictional "Partner Alpha". The demo NewCo is
  "Demo NewCo (fictional entity)" with `incorporation_in_progress` on a project described as "SYNTHETIC DEMO PROJECT … no
  real … dates". The fixed `plannedStart: '2026-10-04'` is a demo value on that labelled demo project. The zero cost impacts
  recorded by the carve-out seed are labelled "synthetic assessment (not a Finance assessment)". **No invented facts.**
- **Test fixtures** (not shipped seeds): synthetic and labelled; not re-reviewed in depth.

## 7. Verdict

**FAIL** for the P2 domain gate at `1b30f48`.

- The five original High findings (DOM-P2-01, -02, -03, -05, -06) are **fixed**. Their probes pass unchanged. Of the
  remaining original findings: 11 are fixed, DOM-P2-17 is partially fixed, DOM-P2-21 is an accepted variance, DOM-P2-08
  and DOM-P2-11 are re-phased to P6 (acceptable), and DOM-P2-14 (Low) is still open.
- Open **High** findings in P2 scope: **DOM-P2R-03** (a decision authorizing one change approves another) and
  **DOM-P2R-04** (external approvals whose evidence was rejected still count; nothing is flagged). Both defeat the second
  P2 exit criterion, "block decisions outside authority", through the API. Open High in P3 scope: **DOM-P2R-05** (blocks
  the P3 gate).
- The **Medium** DOM-P2R-01 (vote closure) and the GOV-015 conflict-declaration gap should be closed, or decided by the
  governance owner, before the P2 gate.

**Next action for the implementers:** fix DOM-P2R-03 and DOM-P2R-04 (and DOM-P2R-05 for P3). Make the DEFECT probes in
`apps/api/test/reviews/p2-domain-rereview*.spec.ts` pass without weakening them, and rename them without `DEFECT`. Obtain
the governance owner's decision on Q-40 / DOM-P2R-01 and F-01, or implement the recommended rule. Then request a focused
re-review of those findings. The rest of this review stands.

---

## Fix status (implementation, 2026-09-30)

Appended by the implementing `backend-data-engineer` (implementation mode, separate context; not the author of this
review). The reviewer's text above is unchanged. No probe was weakened: the five `DEFECT` probes of this re-review pass
and were renamed `… (fixed, regression)`; the two `OBSERVATION` probes (DOM-P2R-01, -02) now assert the implemented rule.
Branch `worktree-agent-a667570d205e1a5d2` (from `claude/mobily-transformation-hub` `e75f7fd` + this review branch, then
`5b2a3bc` — P2 QA review — and `1c6b375` merged in; the single migration regenerated). The P2 QA findings QA-P2-01,
QA-P2-03, O-1 and F-03 were fixed on the same branch (see `P2-qa-review.md`, "Fix status").

| Finding | Status | What changed (rule → where) |
|---|---|---|
| DOM-P2R-03 (High) | Fixed | A decision paper names the record it authorizes (`subjectType` + `subjectId`: change request, baseline version, perimeter version), validated in the project (404 otherwise), only while that record awaits approval (422 `governance.decision.subject_not_open`), fixed from the first submission (`governance.decision.subject_locked`); DB check + same-project trigger. Change-request and baseline approvals rest only on a decision raised for that record (`change_control.decision_no_subject` / `…decision_other_subject`); a perimeter version on a G1 decision raised for it or for no record. Web: paper form subject fieldset; decision pickers offer only matching decisions; "Raise decision paper" from the change request and baseline pages. |
| DOM-P2R-04 (High) | Fixed | Every reliance re-reads the external approval's evidence link: only an ACTIVE link verified by a second person counts — gate approval and gate blockers, change-request / baseline approval, perimeter-version approval, prerequisite satisfaction. Rejected / superseded / conflicting decision evidence flags the approved gates that relied on it (`reassessment.decisionEvidence`, escalation, notifications, `gate.blocked`, downstream flags, recompute) — the recorded decision and cycle are never modified. |
| DOM-P2R-05 (High, P3) | Fixed | One decision backs one record of each kind: decision-use registry (`decision_use`, unique per decision and kind; `SELECT … FOR UPDATE` on the decision; 422 `perimeter.version.decision_already_used`, 409 on a lost race); a partial unique index on `perimeter_version.decision_id` is a second backstop. |
| DOM-P2R-01 (Medium) | Fixed — rule PROPOSED, pending the governance owner (Q-40) | The outcome is recorded only when every present, eligible, non-recused voting member voted (circulation: every appointed eligible member, or the deadline passed), or the chair closed voting with an audited reason (`POST …/close-voting`, chair of the committee only; later votes 422 `governance.vote.voting_closed`). Non-voters are listed in the tally snapshot and not counted (abstention rule unchanged). In a meeting a missing quorum is reported first. Web: voting-state panel, chair command, outcome disabled while votes are outstanding. `authority-matrix.md` §3, `decision-workflow.md` §2. |
| F-01 / REQ-GOV-015 | Fixed — PROPOSED (A-50) | A member votes only after their OWN declaration for the item ("no conflict" with the vote or at the meeting; a conflict → recusal); on-behalf "no conflict" does not count (422 `governance.vote.declaration_required`). Web: conflict step in the vote dialog. |
| DOM-P2-14 (Low) | Fixed | Submission needs ≥ 1 active evidence link on the paper (attachments are documents linked as evidence) or `evidenceNoneReason`. Web: paper field + evidence count. |
| DOM-P2R-02 (Low) | Fixed — conservative option, pending Q-43 | A requester-stated cost impact may refuse an approval but decides it only once an assessor other than the requester recorded or confirmed it (`costImpactRecordedBy`; 422 `change_control.amount_unconfirmed`). Web: confirmation shown on the change request. |
| DOM-P2R-07 (Low) | Fixed — PROPOSED (A-53) | Removing a prerequisite needs a reason; while it still blocks, not by the person accountable for the task / milestone (403 `planning.prerequisite.removal_by_blocked_party`); audited with the reason. Web: reason field + rule. |
| DOM-P2R-06, DOM-P2R-08 (Low) | Not addressed | Governance-owner decisions (gate ownership override; on-behalf recusal ruling); outside this assignment. |

Status of the requirements this review lowered or questioned (`docs/requirements/status-evidence.yaml`): REQ-GOV-022,
REQ-PLN-013, REQ-LCY-015 and REQ-DAT-014 keep **Tested** with the new evidence; REQ-GOV-013, -014 and -015 move to
**Tested**; REQ-GOV-016, REQ-LCY-010, REQ-PLN-006 and REQ-SET-012 gain evidence.

Verification: see the branch's final report (commands and results are recorded in the "Fix status" section of
`P2-qa-review.md`, which covers the same runs).
