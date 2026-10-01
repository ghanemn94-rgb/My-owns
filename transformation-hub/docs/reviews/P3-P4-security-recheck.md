# P3 / P4 security re-check (focused): the SEC-P34 fixes, the new rules and routes, the P4 exit criteria

| Item | Value |
|---|---|
| Reviewer | `security-privacy-reviewer`, independent re-check in its own context (REVIEW mode). The reviewer implemented none of the fixes. It added two probe specs (`apps/api/test/reviews/p34-sec-re-registers.spec.ts`, `apps/api/test/reviews/p34-sec-re-jv-ai.spec.ts`) and this document; no implementation file, migration, seed or existing test was changed. |
| Revision re-checked | **`4fde3ec96e2e102e6c90c61802095f4b9cea9346`** (`4fde3ec`, as assigned), reached by `git fetch` + fast-forward to `983c1d5` (head of `claude/mobily-transformation-hub`), whose only difference from `4fde3ec` is one line of `docs/WORK_LOG.md` (`git diff --stat 4fde3ec 983c1d5` → 1 file changed). The application code, tests, migrations and seeds of both revisions are identical. Frozen for the whole re-check. |
| Scope | Every SEC-P34 finding of `docs/reviews/P3-P4-security-review.md` against its fix (its "Fix status" sections §8 and §9); the new record-visibility rules (SEC-P34-12); the AI knowledge sources in every AI channel (SEC-P34-02 / -03); the evidence-linker "self" rule on every verification (SEC-P34-01, DOM-P3-10), including linkers who later lost access; the new routes (readiness rebind, transfer not-applicable, checklist "not required" request / decide) and, since the domain re-review fixes (`docs/reviews/P3-P4-domain-rereview.md` §8), the cutover plan site command, the TSA extension terms bound per decision and the service identity `svc-carveout`; the P4 exit criteria from the security angle. |
| Databases | Own databases on the shared cluster `127.0.0.1:5432`: `hub_test_p34sre` (full API suite) and `hub_test_p34sreprobe` (single-spec runs), created with `HUB_DATABASES="hub_test_p34sre hub_test_p34sre_boot hub_test_p34sreprobe hub_test_p34sreprobe_boot" bash scripts/dev/pg-init-roles.sh`. No other database was touched. PostgreSQL was already running. |
| Processes | Only `pnpm` / `tsc` / `vitest` / `psql` (read-only queries on the own databases) of this worktree. No server, no Docker, no external host. A first full-suite run was started before the probes were final and stopped by the reviewer by PID after 42 s (not counted); the full suite was then run once at the end (§1.5). |
| **Verdict P3** | **PASS WITH CONDITIONS** — every Medium / Low P3 SEC-P34 finding is FIXED (Info -11 documented, -16 partly addressed); no Critical / High. New Medium SEC-P34R-07 (evidence supersede / flag-conflict bypass the target's command rules; a contributor without any transfer permission un-verifies a verified transfer through the new `svc-carveout` reaction) to be fixed before the P3 gate; Lows SEC-P34R-01, -02, -03 tracked. |
| **Verdict P4** | **PASS WITH CONDITIONS** — every Medium / Low P4 SEC-P34 finding is FIXED (Info -14, -15, -18 stay with their owners); no Critical / High. New Medium SEC-P34R-05: the AI **proposals list** shows proposals about records — and model-drafted content carrying approved figures — to readers refused them, so the exit criterion "financial data only with the finance-domain clearance and reach" holds in AI retrieval, answers, detections and the citation re-check (executed) but **not in the AI proposals list** until SEC-P34R-05 is fixed (the gate report must say so). SEC-P34R-07 (P4 part: the requester's paper evidence) to be fixed too; Lows SEC-P34R-02, -03, -04 tracked. Partner isolation and "an NDA alone is not sufficient" hold (§4). |

Severity scale (as in the P1–P4 reviews): **Critical** isolation/security bypass; **High** a control the gate relies on does not work
or is unverified; **Medium** a control is materially weaker than documented, with compensation elsewhere; **Low** limited exposure or
defence-in-depth gap; **Info** observation / documentation.

---

## Re-check of the fixes

### 1. Commands run and real results

All commands ran in `transformation-hub/` of the review worktree (`/home/user/My-owns/.claude/worktrees/agent-acd29603109961c96`).

#### 1.1 Environment
```
$ git fetch origin claude/mobily-transformation-hub; git merge --ff-only FETCH_HEAD
  → Fast-forward to 983c1d5 (WORK_LOG.md only; code = 4fde3ec)
$ pg_isready -h 127.0.0.1 -p 5432                     → accepting connections
$ pnpm install --frozen-lockfile --prefer-offline      → Done in 3.3s
$ pnpm build:packages                                  → domain / contracts / db built
$ HUB_DATABASES="hub_test_p34sre hub_test_p34sre_boot hub_test_p34sreprobe hub_test_p34sreprobe_boot" bash scripts/dev/pg-init-roles.sh
  → roles hub_owner/hub_app and databases ready: hub_test_p34sre hub_test_p34sre_boot hub_test_p34sreprobe hub_test_p34sreprobe_boot
```

#### 1.2 Unit tests and static checks
```
$ (packages/domain)    npx vitest run   → Test Files 22 passed (22)  Tests 459 passed (459)   (incl. the policy drift test against
                                           docs/security/access-matrix.md — the SEC-P34-05 matrix change)
$ (packages/contracts) npx vitest run   → Test Files 3 passed (3)    Tests 105 passed (105)
$ (apps/api) npx tsc -p tsconfig.json --noEmit → exit 0 (includes test/**, with both new probe specs)
$ psql …/hub_test_p34sreprobe (owner, read-only):
  tsa_extension_terms: relrowsecurity t; policy hub_project_isolation (project_id = ANY (app_full_project_ids()));
  composite FKs (project_id, decision_id) → decision, (project_id, tsa_service_id) → tsa_service; unique (decision_id)
  transfer_record: relrowsecurity t; policy hub_project_isolation (full members)
```

#### 1.3 Existing probe and regression specs (own database `hub_test_p34sreprobe`, single-file runs, at `4fde3ec`)
```
$ (apps/api) npx tsc -p tsconfig.build.json && TEST_DATABASE_URL=…/hub_test_p34sreprobe TEST_DATABASE_MIGRATION_URL=…/hub_test_p34sreprobe \
    npx vitest run test/reviews/p34-sec-registers.spec.ts test/reviews/p34-sec-jv.spec.ts test/reviews/p34-sec-fixes.spec.ts
  Test Files  3 passed (3)    Tests  44 passed (44)
  (every original DEFECT probe of the P3/P4 security review is now a plain "(fixed, regression)" test and passes with its
   assertion unchanged — checked against the review-commit versions of both files: only the `it.fails` → `it` flip and the
   rename, plus the OBSERVED SEC-P34-10 test updated with the fix, as the probe convention requires)
$ … npx vitest run test/reviews/p34-domain-re-readiness.spec.ts test/reviews/p34-domain-re-tsa.spec.ts \
    test/reviews/p34-domain-re-perimeter.spec.ts test/reviews/p34-domain-re-dimension.spec.ts \
    test/readiness/p34r-fixes-readiness.spec.ts test/readiness/p34r-fixes-tsa.spec.ts test/carveout/p34r-fixes-carveout.spec.ts
  Test Files  7 passed (7)    Tests  26 passed (26)
```

#### 1.4 New probe specs (own database `hub_test_p34sreprobe`, final versions, one combined run; record ids shortened)
```
$ (apps/api) TEST_DATABASE_URL=…/hub_test_p34sreprobe TEST_DATABASE_MIGRATION_URL=…/hub_test_p34sreprobe \
    npx vitest run test/reviews/p34-sec-re-registers.spec.ts test/reviews/p34-sec-re-jv-ai.spec.ts --reporter=verbose
SEC-P34R-01 observed: workstream-only reader — legal_entity events 1 ["newco.legal_entity.update"]; category-review events 1
  ["carveout.perimeter.category_review"]
SEC-P34R-02 observed (rebind): unreadable existing check → 403 policy.forbidden; unknown id → 404 not_found
SEC-P34R-02 observed (plan site): unreadable existing plan → 403 policy.forbidden; unknown id → 404 not_found
SEC-P34R-02 observed (decide): unreadable existing item → 403 policy.forbidden; unknown id → 404 not_found
SEC-P34R-03 observed: CP verify by the uploader of its only evidence document → 201 {"id":"01a0f5c8-…","status":"verified","version":3}
SEC-P34R-04 observed: My Work of the linking secretary → [["action_closure_verification","P34SRE-ACT-CANARY circulate the pack (synthetic)"]]
SEC-P34R-05 observed: secretary's proposal list → total 1; proposal about the CP: [{"targetType":"closing_condition",
  "title":"Update requested: P34SRE-CP-PROPOSAL-CANARY anti-trust clearance"}]
SEC-P34R-05 observed (finance): PM's proposal list contains the strictly confidential figure: true; proposal
  [["draft_decision_paper","P34SRE-SC-FIGURE-CANARY budget paper draft"]]
SEC-P34R-07 observed (transfer): contributor supersede → 201 {"id":"01a0f5c8-…","status":"superseded","version":2}; item after the
  worker {"transfer_status":"in_progress","economic_transfer_status":"in_progress"}; system entries
  [{"aspect":"legal","command":"reject_evidence","recorded_by":null},{"aspect":"economic","command":"reject_evidence","recorded_by":null}]
SEC-P34R-07 observed (paper): finance supersedes the PM's paper evidence → 201 {"id":"01a0f5c8-…","status":"superseded","version":2};
  link status superseded
SEC-P34R-06 observed: confirm by a second person who cannot open the item or its event → 201 {"id":"01a0f5c8-…","status":"not_required","version":2}
 Test Files  2 passed (2)
      Tests  15 passed | 9 expected fail (24)
```
"expected fail" = `it.fails`: the test asserts the **required** behaviour and currently fails on exactly that assertion (the
`observed` line printed just before each DEFECT assertion shows the actual response — every DEFECT probe prints it, so none of them
passes by failing earlier). Setup runs in `beforeAll` hooks with their own assertions. While the probes were written, the
SEC-P34R-07 (transfer) probe was once run as a plain `it` (temporary local change, reverted) to confirm the failing assertion:
`AssertionError: expected 201 to be 403`.

#### 1.5 Full API suite (once, at the end, own database `hub_test_p34sre`)
```
$ free -g → 6 GB free at start (another agent's Playwright run active)
$ (apps/api) TEST_DATABASE_URL=postgres://hub_app:…@127.0.0.1:5432/hub_test_p34sre \
    TEST_DATABASE_MIGRATION_URL=postgres://hub_owner:…@127.0.0.1:5432/hub_test_p34sre pnpm test
 Test Files  131 passed (131)
      Tests  1022 passed | 11 expected fail (1033)
   Duration  1365.38s
exit=0
```
131 files = the 129 committed `apps/api/test/**/*.spec.ts` at `4fde3ec` (`ls-files … | wc -l` → 129) + the two new probe specs.
The 11 expected fails are the 9 `DEFECT` probes of this re-check and the 2 open P2 probes DOM-P2F-02 / DOM-P2F-04
(`p2-domain-final.spec.ts`, `defect` alias). Every other spec passes, including those cited below: `jv/at-03-partner-room-isolation`,
`jv/at-11-partner-parallel`, `jv/at-12-closing-blocked-cp`, `jv/at-13-cp-non-waivable`, `jv/p4-domain-fixes`,
`documents/clean-team-room`, `ai/ai-retrieval-acl`, `finance/finance-isolation`, `reviews/p1-sec-finance-visibility`,
`carveout/p3-fixes-newco`, `carveout/p3-fixes-carveout`, `reviews/p3-domain-readiness-go`, `reviews/p34-sec-*` and
`reviews/p34-domain-re-*`.

---

### 2. Status of every SEC-P34 finding

| Finding (sev.) | Status | Evidence of the re-check |
|---|---|---|
| **SEC-P34-01** (Medium) — verifications accepted the evidence linker | **FIXED** (residuals: Low SEC-P34R-03, Low SEC-P34R-04, Info in §5) | Every verification of access-matrix §5.1 now adds the linkers of the record's current evidence as `not_self` subjects (read for the rule, whatever the caller may see): readiness sign-off `checks.service.ts:524-527, 540` (active + conflicting links, `readiness.support.ts:119-124`); CP verify `jv/transactions.service.ts:995-998` and `jv.ts:525-530`; closing deliverable acceptance `transactions.service.ts:609-612`; post-close obligation `postclose.service.ts:150-157`; incorporation verify `newco/legal-entities.service.ts:285-290`; regulatory outcome / conditions satisfied `regulatory.service.ts:276, 288`; transfer verify `carveout/transfers.service.ts:290-293`; benefit verify `finance/benefits.service.ts:276-278`; governance action closure `governance/actions.service.ts:192-198`. Executed: the original DEFECT probes (readiness, CP) pass as regression tests (§1.3); the implementer's tests for obligation / deliverable / benefit / action / incorporation / transfer pass in the full run (§1.5); new CONTROL "a linker who later LOST ACCESS to the evidence (room grant revoked; the link is no longer shown to them) is still self for the CP verification (403 `jv.cp.self_verification`, CP unchanged); an independent verifier verifies" — passes. The linker query runs under RLS, but `evidence_link` (a room-bearing table) shows every project row to full members, and every verifier is a full member — so a lost room grant never hides a linker. |
| **SEC-P34-02** (Medium) — AI detections listed TSAs above clearance / outside reach | **FIXED** in retrieval, detections, briefings, `/ai/ask`, citation re-check (new Medium SEC-P34R-05 in the **proposals** channel) | `tsaExpiring` and the `tsa_service` / `readiness_check` citation re-check use `RecordVisibility` (classification + readiness reach) — `ai-knowledge.service.ts:355-375, 592-599`; every channel (detections `ai-detections.service.ts:287`, tools `ai-tools.service.ts`, scheduled briefings and queued asks re-entered as the delegating user `ai-runtime.service.ts:152-234`, stored runs re-checked on read `ai-ops.service.ts:58-71`, artefacts `ai-artifacts.service.ts:43-56`) goes through these methods. Executed: original probe passes (§1.3); `p34-sec-fixes` "TSA detections: the readiness reach applies" passes. The AI proposals list does not use them — SEC-P34R-05. |
| **SEC-P34-03** (Medium) — AI answered with figures outside the finance reach | **FIXED** in retrieval, answers and the citation re-check (proposals channel: SEC-P34R-05) | `approvedFinancials` and the `financial_snapshot` / `financial_model_version` re-check use `RecordVisibility` with the finance domain (finance-domain clearance via `domainCtx`, project roles only) and the reach of `finance.record.read` — `ai-knowledge.service.ts:425-471, 612-620`, `record-visibility.ts:93-100, 210-216`. Executed: original probe passes; new CONTROL "Finance retrieves a strictly confidential approved figure; the PM (project-wide `finance.record.read`, clearance confidential) is refused it in the finance module (404), in AI retrieval, in the citation re-check and in `/ai/ask`" — passes. |
| **SEC-P34-04** (Medium) — counterparty used the internal DD route | **FIXED** | `diligence.service.ts:216-224`: room-only principals 404, a project-wide `jv.dd_request.create` required, real author recorded. Original probe passes; the invariant test (only `jv.createDdRequest` is an internal route whose permission `external_partner_limited` holds) passes. |
| **SEC-P34-05** (Medium) — regulatory determinations by a non-legal approver | **FIXED** | `newco.regulatory.verify` → `legal_restricted` only (policy matrix; access-matrix JSON; drift test green, §1.2). The verification routes (`assess-applicability`, `record-outcome`, `conditions-satisfied`) all carry that permission (`packages/contracts/src/newco.ts:221-224`); the PATCH body carries no applicability / status. Original probe passes. |
| SEC-P34-06 (Low) — TSA charge by RBAC alone | **FIXED** | `tsa.service.ts:162-168, 246-259`: finance-domain clearance + reach over the TSA's workstream. Original probe passes; new CONTROL: the WS1 lead (finance read on WS1) still sees the charge of a WS1 TSA (no over-hiding), cannot read a WS2 TSA, and the TSA list carries no charge — passes. |
| **SEC-P34-07** (Medium) — restricted consents inside perimeter items | **FIXED** | `perimeter.service.ts:220-223, 278-279, 1036-1053`: shown consents filtered in SQL by classification and only for a project-wide `carveout.register.read`; the Day-1 rule still counts every consent (status only); transferability / interim-arrangement responses carry statuses only. Original probe passes; new CONTROL: the workstream-only lead reads its WS1 item and the Day-1 positions without the consent; the PM sees it — passes. |
| SEC-P34-08 (Low) — TSA relabel above clearance | **FIXED** | `tsa.service.ts:354-357` (403 `readiness.classification_above_clearance`). Original probe passes. The other P3 PATCH paths already refused it (`carveout.support.ts:76-80` used at `agreements.service.ts:218, 421`, `perimeter.service.ts:692`; `newco/regulatory.service.ts:195`). |
| SEC-P34-09 (Low) — DD findings list vs detail | **FIXED** | `diligence.service.ts:140-155` (+ findings list): `grantSql('jv.dd_request.read', …, { room })` in list and total. Original probe and the implementer's request-list test pass. Room counters (`rooms.service.ts:138-147`) are shown only to callers who may open the room with a covering grant — consistent. |
| SEC-P34-10 (Low) — "not required" by one person | **FIXED** (new Low SEC-P34R-02 on the new route; Info SEC-P34R-06) | Request bound to the item version (`transactions.service.ts:623-647`), decided by a second human holding `jv.cp.verify`, never the requester (`:654-682`); stale request 422; refusals audited (new CONTROL, §3). |
| SEC-P34-11 (Info) | **DOCUMENTED** | access-matrix §2.4 "`own_workstream` and create commands"; AMQ-10 (§12). |
| SEC-P34-12 (Low) — prerequisites showed agreements to workstream-only readers | **FIXED** for decision / agreement / consent / regulatory requirement (residual Low SEC-P34R-01 for other project-level registers) | `record-visibility.ts:92, 102, 104, 113` (`ws: <read>, wsCol: null`). It did **not** hide the records from the people who should see them: new CONTROLs — PM and Legal still see the agreement and the decision as prerequisites; PM, Legal and the auditor (reach not applied to audit readers, `portfolio.service.ts:631-637`) see the agreement, consent, regulatory requirement and decision events in the activity feed with `total` = rows shown; Legal reads and links evidence on the agreement and the consent (201). The workstream-only lead gets none of them (labels hidden, activity total 0, evidence of the agreement / consent 404 with the same code as an unknown id) — all pass. Legal / Finance roles can only be project-scoped (`policy-matrix.json` `scopeTypes`), so they always hold the project-wide read. |
| SEC-P34-13 (Low) — another member added evidence to the requester's draft paper | **FIXED as reported** (residual: Medium SEC-P34R-07 — the same member **supersedes** that evidence) | `evidence.service.ts:111-125` refuses `link` to anyone but the requester while the paper is draft / submitted. Original probe passes. `supersede` / `flag-conflict` of the paper's links do not apply this rule (SEC-P34R-07, executed). |
| SEC-P34-14, -15, -18 (Info) | **OPEN (recorded, not changed)** | Owner decisions; unchanged code (`jv.support.ts:84-88`; `record-visibility.ts:110` `partner_room`; `deals.service.ts`). |
| SEC-P34-16 (Info) | **PARTLY ADDRESSED** (new instances: Info SEC-P34R-08) | AI pending approval requests now filtered by their subject's rule (`ai-knowledge.service.ts:268-281`). The new commands add codes / ids of records outside the caller's scope to error details (SEC-P34R-08). |
| SEC-P34-17 (Info) | **FIXED** | One allowlist per `svc-jv` job (`jv.jobs.ts`), each refused the other scan — implementer test passes (§1.3). |

### 3. New rules, new routes and the new service identity

| Item | Authorization | 404 vs 403 | Denied attempts audited | Result |
|---|---|---|---|---|
| `POST …/readiness-checks/:checkId/rebind` (`readiness.check.manage` + `W`) | Route permission (`HubGuard`), then `assertManage` with the check's workstream and owners (`checks.service.ts:383-386`); reason required; readiness lock; history entries and audit. | **Existence oracle**: `loadInProject` then the manage check — a WS1 lead gets **403** for a WS2 check it cannot read (GET 404) and 404 for an unknown id (SEC-P34R-02, executed). | Yes — CONTROL: contributor without `own_workstream` → 403 + `audit_event` `readiness.rebindCheck` / `denied`. | Sound except SEC-P34R-02 |
| `POST …/cutover-plans/:planId/site` (`readiness.cutover.manage` + `W`) | `cutover.service.ts:345-348`; reason; only before the go/no-go; refused while a FAILED gating check would stop gating the plan; PATCH no longer carries `siteId` (400). | Same oracle (SEC-P34R-02, executed). The refusal lists ids / codes of every leaving failed check, whatever their workstream (Info SEC-P34R-08). | Yes — CONTROL: Project-B PM → 404 + audit row (`project_id` null, attempted project and plan id in `after`, SEC-P1R-06). | Sound except SEC-P34R-02 |
| `POST …/perimeter-items/:itemId/transfer-not-applicable` (`carveout.transfer.verify`) | `transfers.service.ts:263-282`: `loadReadable` first, `not_self` vs owner and creator (fails closed), before baseline only, one aspect. | Correct: CONTROL — WS1 approver on a WS2 item 404 with the same code as an unknown id; contributor 403 (route); Project B 404; item unchanged. | Yes (ProblemFilter, `errors.ts:124-138`). | Sound |
| `POST …/checklist-items/:itemId/not-required` and `…/not-required/decide` | Request: `jv.closing_checklist.manage`, human, row lock, one pending request bound to the item version. Decide: `jv.cp.verify`, human, role → state → not the requester (`transactions.service.ts:623-682`). | Oracle for a workstream-scoped functional approver (holds `jv.cp.verify` through a workstream role, no `jv.deal.read`): existing item 403, unknown 404 (SEC-P34R-02, executed; same pattern in the older `loadItem` / `loadCp` commands). The project-wide approver confirms an item it cannot open (Info SEC-P34R-06). | Yes — CONTROL: PM (route 403) and Legal as requester (service 403 `jv.checklist_item.not_required_self`) both audited `denied`. | Sound except SEC-P34R-02 |
| TSA `request-extension` / `record-extension` (terms bound per decision, `tsa_extension_terms`) | `readiness.tsa.manage` + `W` + classification (`tsa.service.ts:534-537, 587-589`); the linked decision must be readable (`readiness.support.ts:247-251`, else 404); decision row `FOR SHARE`, terms row `FOR UPDATE`; RLS and composite FKs on the new table (§1.2). | Same `loadInProject` → manage-check pattern (static; not probed separately). `tsa.extension.decision_other_tsa` returns `boundTsaServiceId` (Info SEC-P34R-08). | Yes (filter). | Sound |
| `svc-carveout` (`carveout.transfer_evidence_changed`, allowlist `carveout.register.read` + `carveout.transfer.manage`) | `carveout.jobs.ts`; re-reads the item and its evidence counts in the job's project (never trusts the payload beyond the target id), acts only on `transferred_verified` aspects without valid evidence, writes a system `reject_evidence` entry (`recorded_by` null) — never reports, verifies or classifies (`transfers.service.ts:166-209`). A null recorder cannot become a verifier's "requester": `verify` needs a new human `report_transferred` (`workflows.ts:272-281`). | n/a | Audited (`carveout.transfer.evidence_invalidated`). | Sound — but any reader holding `documents.evidence.link` can trigger it by superseding transfer evidence it may not link (SEC-P34R-07, executed). |

### 4. P4 exit criteria (security angle)

| Exit criterion | Re-check | Result |
|---|---|---|
| **Partner isolation** | No fix touched the room / grant / external projection paths except SEC-P34-04 (internal DD route closed to counterparties) and SEC-P34-09 (DD lists apply the grant coverage); AI document retrieval now also applies the documents list's grant coverage (`ai-knowledge.service.ts:97-100`). `jv/at-03-partner-room-isolation`, `jv/at-11-partner-parallel`, `documents/clean-team-room`, `ai/ai-retrieval-acl` and the SEC-P34-04 / -09 regression tests in the full run (§1.5). | **Met** |
| **An NDA alone is not sufficient for access** | `at-03…` "partner with an executed NDA but no grant cannot list room documents" / "a grant is refused while the partner is only at NDA" in the full run; `recordNda` unchanged. | **Met** |
| **Financial data only with the finance-domain clearance and reach** (finance module, TSA charge, AI) | Finance module unchanged and covered (`finance/finance-isolation`, `reviews/p1-sec-finance-visibility` in the full run); TSA charge FIXED (SEC-P34-06); AI retrieval, `/ai/ask`, detections and the citation re-check FIXED (SEC-P34-03 + new CONTROL with a strictly confidential figure). **AI proposals list: not met** — a decision-paper draft that Finance's AI run writes from the figure is listed to the PM, who is refused the figure (SEC-P34R-05, executed with the runtime's own model-tool-call path). | **Met except the AI proposals list** (condition: SEC-P34R-05) |
| Missing CP blocks closing (context) | `jv/at-12-closing-blocked-cp`, `at-13-cp-non-waivable`, `p4-domain-fixes` (DOM-P34R-08: CPs created blocking unless Legal decides) in the full run. Checklist "not required" is now two-person (SEC-P34-10). | **Met** |

### 5. New findings

| ID | Severity | Phase | Where | Finding | Reproduction | Recommendation |
|---|---|---|---|---|---|---|
| **SEC-P34R-07** | **Medium** | P3 (+P2 gates, P4 paper) | `documents/evidence.service.ts:325-351` (`flagConflict`, `supersede`: only `documents.evidence.link` and a readable target) vs `:213-218` (`link`: `EVIDENCE_TARGET_PERMISSION` + `assertTargetCommand`); reactions `carveout.jobs.ts` (`svc-carveout`), `readiness.jobs.ts`, `newco.jobs.ts`, `gates.jobs.ts` | **Supersede / flag-conflict of evidence skip the target's command rules that linking applies** (target manage permission, gate-criterion owner rule SEC-P2-05, paper requester rule SEC-P34-13). Any reader who holds `documents.evidence.link` can deactivate the evidence a verification relies on, and the evidence reactions then undo the verification: a contributor with no transfer permission returns a verified transfer to `in_progress` (DOM-P34R-06 reaction); by the same code, an incorporation verification (DOM-P3-08), a TSA replacement acceptance and gate-criterion assessments can be reopened by people who could not have linked that evidence; a voting member removes the requester's supporting evidence from the draft paper. Compensation: audited; the effect only withdraws (never grants) a verification. | DEFECT SEC-P34R-07 (transfer): contributor `POST /evidence/:linkId/supersede` on the transfer evidence → **201**; after the worker both aspects `in_progress` with two system `reject_evidence` entries (required 403, transfer unchanged). DEFECT SEC-P34R-07 (paper): finance supersedes the PM's evidence on the PM's draft paper → **201**, link `superseded` (required 403 `governance.decision.not_requester`). CONTROL: `link` is refused to both (403 `evidence.target_permission` / `governance.decision.not_requester`). | Apply the `link` authorization to `supersede` and `flagConflict` (target command permission via `EVIDENCE_TARGET_PERMISSION`, `assertTargetCommand`), or restrict them to the link's author / the target's managers / `documents.evidence.verify` holders; add a test per reaction. |
| **SEC-P34R-05** | **Medium** | P5 module, affects P3 / P4 records and the P4 finance exit criterion | `ai/ai-proposals.service.ts:377-408` (`list`, `targetVisibleSql`: decision → classification only; task → reach; every other target type and proposals **without a target** visible to every `ai.proposal.read` holder); `:120-145` (no derived classification stored, access-matrix §2.6) | **The AI proposals list shows proposals about records the reader may not read, and model-drafted content above the reader's clearance.** The SEC-P34-02 / -03 alignment covers `AiKnowledgeService`, not this list. A proposal targeting a CP is listed (with the CP title in its payload) to the secretary, who holds no `jv.deal.read`; the same predicate lets TSA, readiness-check, action, gate and closing-condition targets through without classification or reach. A draft without a target that Finance's run writes from a strictly confidential approved figure is listed to the PM, whom the finance module refuses the figure. Compensation: needs a provider that drafts such proposals (the Simulated mock only proposes task reminders); readers are internal project-wide members holding `ai.proposal.read`. | DEFECT SEC-P34R-05: PM's run → `createFromTool(propose_internal_notification, target closing_condition)` → secretary `GET /ai/proposals` → total 1, title "Update requested: P34SRE-CP-PROPOSAL-CANARY …" (secretary GET CP 403/404 — CONTROL). DEFECT SEC-P34R-05 (finance): Finance's run → `createFromTool(propose_decision_paper_draft, content with 5555.0000 SAR)` → PM's list contains the figure: **true** (PM GET figure 404 — CONTROL). | Filter the list in SQL with the target's `RecordVisibility` rule (as `visibleCitationKeys` does) and store a derived classification / finance flag per proposal (max of the run's cited inputs, §2.6) applied with the reader's (finance-domain) clearance; show proposals without a target only to their requester and to approvers whose ACL covers the run's inputs. |
| SEC-P34R-01 | Low | P3 (+P2 known deviation) | `platform/record-visibility.ts:134-141, 262` (no rule — or no reach — for `legal_entity`, `perimeter_version`, `perimeter_category_review`, `action_item`, `escalation`, committee children); `portfolio.service.ts:647-652` (type filter RBAC-only) | SEC-P34-12 residual: the activity feed still lists events (action, entity id, actor, time — not the reason) of other project-level registers to a workstream-only reader whom the owning module refuses (NewCo `assertProjectRead`, carve-out `assertProjectWide`, governance `grantSql(…, {})`). The governance part is the documented open deviation of access-matrix §2.2. | DEFECT SEC-P34R-01: WS1 lead — `GET /legal-entities/:id` 404, `GET /perimeter/reconciliation` 404 (CONTROL) — activity `legal_entity` → 1 event `newco.legal_entity.update`, `perimeter_category_review` → 1 event (required 0). | Give those types `ws: <read>, wsCol: null` rules (and inherit the decision's reach for action items / escalations), like SEC-P34-12. |
| SEC-P34R-02 | Low | P3 / P4 | `readiness/checks.service.ts:383-386`, `cutover.service.ts:345-348`, `jv/transactions.service.ts:577-583, 654-656` (same pattern in the older readiness / cutover / TSA commands and `loadCp`) | **403 vs 404 existence oracle on the new commands**: the record is loaded, then the manage / verify grant is checked, so a project member holding the route permission only for another workstream (or without the module's read) gets 403 for an existing record it cannot read and 404 for an unknown id. Same project only; UUIDv7 ids. | DEFECT SEC-P34R-02 ×3: rebind → 403 `policy.forbidden` vs 404; plan site → 403 vs 404; decide (workstream-scoped approver) → 403 vs 404 (item unchanged). | Check the module's read rule first (`loadReadable` → 404), then the command permission — as `transfer-not-applicable` already does. |
| SEC-P34R-03 | Low | P3 / P4 | `jv/transactions.service.ts:995-998` and the other §5.1 verifications (linkers only) vs `documents/evidence.service.ts:292-296` (linker **and** version uploader are self) | The person who **uploaded** the only evidence document is not "self" for the CP verification (nor, by the same code, for the other §5.1 verifications); the documents module treats the uploader as self for the same link. Matches the documented definition (access-matrix §5.1 note: linkers), hence OBSERVED. | OBSERVED SEC-P34R-03: Legal uploads, the PM links and submits; Legal's `documents.evidence.verify` on that link → 403; Legal's CP verify → **201 `verified`**. | Decide (Legal / governance owner) and, if confirmed, add the uploaders of the linked document versions to the self subjects, as `documents.evidence.verify` does. |
| SEC-P34R-04 | Low | P2 / P4 (SEC-P34-01 governance part) | `planning/my-work.service.ts:267-277` | My Work offers the action-closure verification to the secretary who linked the action's evidence; the command refuses them (403 `governance.action.linker_verification`) — the SEC-P2-03 rule "offered only when the command would accept the caller". | DEFECT SEC-P34R-04: linking secretary's `/me/work` → `action_closure_verification` for that action (required: not offered). CONTROL: verify-closure 403; the second secretary is offered it. | Apply the linker set in the My Work query (one `evidence_link` sub-select). |
| SEC-P34R-06 | Info | P4 | policy matrix (`functional_approver`: `jv.cp.verify` without `jv.deal.read`); `transactions.service.ts:654-682` | The "second person" of a "not required" request (and of CP verification / deliverable acceptance) can be a functional approver who cannot open the item, its event or the CP register; it decides on the request payload only. | OBSERVED SEC-P34R-06: approver `GET /signings/:id` 403/404; confirm → **201 `not_required`**. | Domain / Legal owner: require a project-wide `jv.deal.read` for the JV verification commands, or document why the approver decides blind. |
| SEC-P34R-08 | Info | P3 | `packages/domain/src/readiness.ts:299-305` (`site_change_failed_check`: ids / codes of every leaving failed check), `:471-473` (`decision_other_tsa`: `boundTsaServiceId`); `errors.ts:76-84` (details are returned) | SEC-P34-16 class in the new commands: error details and the plan history (`site_changed` codes) name records outside the caller's readiness reach / clearance. | Static (not probed). | Filter the listed ids / codes with the caller's readiness reach, or return counts. |
| SEC-P34R-09 | Info | P3 / P4 | `jv.support.ts:135-140`, `finance.support.ts:294-299` (linkers = `active` links) vs `readiness.support.ts:119-124`, `carveout.support.ts:142-151`, `newco.support.ts:122-131` (`active` or `conflicting`); `packages/domain/src/jv.ts:525-530` | The linker set differs between modules; CP verification does not refuse while contested evidence exists (readiness and NewCo do). No bypass found (a verification needs active evidence, and all active linkers are excluded). | Static. | Use one definition (active or conflicting) and let CP verification refuse unresolved conflicts, as the other verifications do. |

### 6. Not verified / NOT EXECUTED

- Playwright / e2e: not run (not requested; no web change is in scope of the security re-check).
- SEC-P34R-07: the incorporation, TSA replacement-acceptance and gate-criterion variants are stated from the code (same `supersede`
  path and the subscribed reactions); only the transfer and paper variants were executed. `flag-conflict` was not executed (same
  authorization as `supersede`, `evidence.service.ts:325-330`).
- SEC-P34R-05: with the Simulated mock provider (the only provider in this environment) the proposals were created through the
  runtime's own path for a model tool call (`AiProposalsService.createFromTool`, as the delegating user, in that user's
  transaction); no real provider was used. The TSA / readiness-check target variants are stated from `targetVisibleSql`.
- SEC-P34R-02 for the TSA extension routes and the older readiness / cutover / TSA / JV commands: static (same pattern).
- SEC-P34R-08: static.

### 7. Verdicts

| Phase | Verdict |
|---|---|
| **P3** | **PASS WITH CONDITIONS** — SEC-P34-01 (P3 part), -02, -05, -06, -07, -08, -12 FIXED with regression tests; no Critical / High. Condition: fix **SEC-P34R-07** (Medium) before the P3 gate, with its DEFECT probes turning red; track Low SEC-P34R-01, -02, -03 and Info -08, -09. |
| **P4** | **PASS WITH CONDITIONS** — SEC-P34-01 (P4 part), -03, -04, -09, -10, -13 (as reported), -17 FIXED with regression tests; no Critical / High. Partner isolation and "an NDA alone is not sufficient" met. Conditions: fix **SEC-P34R-05** (Medium) — until then the gate report states that the finance exit criterion is **not met for the AI proposals list** (it is met in the finance module, the TSA charge and AI retrieval / answers / detections / citations); fix **SEC-P34R-07** (paper part); track Low SEC-P34R-02, -03, -04 and Info -06, -09; SEC-P34-14, -15, -18 stay with their owners. |

### 8. Files added by this re-check

- `docs/reviews/P3-P4-security-recheck.md` (this document).
- `apps/api/test/reviews/p34-sec-re-registers.spec.ts` — 12 tests: 4 `DEFECT` expected fails (SEC-P34R-01, SEC-P34R-02 ×3), 8 `CONTROL`.
- `apps/api/test/reviews/p34-sec-re-jv-ai.spec.ts` — 12 tests: 5 `DEFECT` expected fails (SEC-P34R-04, SEC-P34R-05 ×2, SEC-P34R-07 ×2), 2 `OBSERVED` (SEC-P34R-03, -06), 5 `CONTROL`.

The `DEFECT` tests must not be weakened; they turn red when the finding is fixed (then rename "(fixed, regression)" and make them
plain tests). Review commit and secret scan: §9.

### 9. Review commit
Review commit `42a26c0` (this document and the two probe specs, parent `983c1d5`). Before committing, the three new files were
scanned with the repository's configuration (copies under the session scratchpad):
```
$ gitleaks dir <copy> --config scripts/ops/gitleaks.toml --redact=100   (gitleaks 8.30.1)
  INF scanned ~80549 bytes (80.55 KB) … INF no leaks found
```
After the commit, with the repository's script:
```
$ GITLEAKS=…/gitleaks-8.30.1 bash scripts/ops/secret-scan.sh tree
  tree: 1153 committed files at HEAD 42a26c0 … INF no leaks found  PASS  tree: no findings  SECRET SCAN (tree): PASS
$ GITLEAKS=… bash scripts/ops/secret-scan.sh history
  history: 329 commits reachable from HEAD 42a26c0 (whole repository) … INF 237 commits scanned. … INF no leaks found
  PASS  history: no findings  SECRET SCAN (history): PASS
```
This section was filled in by a follow-up documentation commit. Nothing was pushed; every process started by the reviewer has
ended (the first, early full-suite run was stopped by PID; the final run exited 0).
