# P5 (Proactive AI PM) — independent QA review, with the P4 C1 re-verification and the P3 QA re-check

| Item | Value |
|---|---|
| Reviewer | `qa-test-engineer`, independent review in its own context (REVIEW mode). The reviewer wrote none of the code under review and changed no implementation file, existing test, migration or seed. |
| Revision reviewed | **`79d1f71`** (head of `origin/claude/mobily-transformation-hub`; `git fetch` → origin = `79d1f71`, an ancestor of the worktree head, so nothing to merge), frozen for the whole review. Every result below is at `79d1f71` plus this review's files. The P5 security fixes (`docs/reviews/P5-security-review.md`, "Fix status") are part of this revision. |
| Files added | `apps/api/test/reviews/p5-qa-ai.spec.ts`, `e2e/tests/qa-p5-ai-center.spec.ts`, `e2e/tests/qa-p5-p34-recheck.spec.ts`, screenshots in `e2e/screenshots/qa-p5/`, this report. |
| Databases | Own: `hub_test_p5qa` (API runs), `hub_test_p5qa_boot` (its throwaway boot database), `hub_test_p5qa_e2e` (e2e stack), created with `HUB_DATABASES="hub_test_p5qa hub_test_p5qa_boot hub_test_p5qa_e2e" bash scripts/dev/pg-init-roles.sh`. No other database was touched. |
| E2E stack | As the CI e2e job, own ports: `node deploy/docker/api-entrypoint.cjs migrate` + `node apps/api/dist/cli/seed-demo.js` on `hub_test_p5qa_e2e`; API `dist/main.js` on **:4480** (`HUB_RATE_LIMIT_PUBLIC_PER_MINUTE=1000`), worker `dist/worker.js`, production web build (`HUB_API_URL=http://127.0.0.1:4480`) served by `next start -p 3480`. Started and stopped by PID by this review only. |
| Provider | Only the Simulated mock provider exists here. The OpenAI-compatible and Anthropic adapters are **Not configured**; no real model or endpoint was contacted. |
| **Verdict P5** | **FAIL** at `79d1f71`. One open **High**, QA-P5-03: a project member cleared below the project's classification is refused the project and its whole plan by the portfolio and planning modules (404), yet the AI answers, scheduled briefings and rules-only detections give that member task titles, owners and overdue status, with citations that do not open for them. The P5 exit criterion "valid citations / permissions" and AT-19 (the "clearance lowered after scheduling" case) are therefore not met. Four Mediums (QA-P5-01 no deduplication / cooldown of AI actions; -02 six subscribing roles cannot read their own briefing; -04 English template titles and raw enums in Arabic AI output; -05 the approver cannot identify the message recipient), two Lows, three Infos. Everything else in the QA scope holds and is executed: the scheduled briefing is produced by the worker process after the browser and the API are gone; retries and crashes of the real worker process never duplicate an action; prompt injection is contained; AT-17, AT-18, AT-20, AT-21, AT-22 and AT-28 pass. |
| **approve() fix (QA angle)** | **VERIFIED through the UI, in English and Arabic.** After the approver's approval is refused because the target changed (409 `ai.approval_invalidated`), the dialog shows the refusal translated with "Reload and review"; after reloading, the proposal is `invalidated` with the reason "the target record changed after the proposal was prepared" / «تغيّر السجل المستهدف بعد إعداد المقترح», Approve is no longer offered, the pending list and count drop by one, and the requester sees the same and may revise (§6). |
| **P4 C1** | **QA-P34-01c: CONFIRMED. QA-P34-01h: CONFIRMED** (definition; the KPI's other template texts are English — new Low QA-P5-07). **QA-P34-07: CONFIRMED** (§8). |
| **P3 QA re-check** | **P3: PASS WITH CONDITIONS** (§9). AT-09 and AT-10 hold through the API and the UI on the current code (all delivered and earlier-review tests green; this review's Arabic checks of the blocked Day-1 GO and the expired TSA green); the QA-P34-01 a, b, d–g, -03 and -07 regressions pass. Condition: QA-P5-06 (Low) — the Arabic Committee Hub escalation register still shows system-written escalations, including the TSA expiry escalation, in English. |

Severity scale (as in the P2–P4 QA reviews): **High** = a mandatory rule, an acceptance criterion or an exit criterion can be
bypassed through the API; **Medium** = a mandatory requirement missing or partly met; **Low** = precision, documentation or
hardening gap; **Info** = observation.

---

## 1. Commands run and real results

All commands ran in `transformation-hub/` of the review worktree. The two variables of every vitest run are
`TEST_DATABASE_URL=postgres://hub_app:…@127.0.0.1:5432/hub_test_p5qa` and
`TEST_DATABASE_MIGRATION_URL=postgres://hub_owner:…@127.0.0.1:5432/hub_test_p5qa`.

### 1.1 Environment
```
$ git log -1 --oneline                         → 79d1f71 Merge remote-tracking branch 'origin/claude/mobily-transformation-hub' …
$ git fetch origin claude/mobily-transformation-hub; git log -1 origin/…  → 79d1f71 (origin is an ancestor of HEAD: nothing to merge)
$ pg_isready -h 127.0.0.1 -p 5432              → accepting connections
$ HUB_DATABASES="hub_test_p5qa hub_test_p5qa_boot hub_test_p5qa_e2e" bash scripts/dev/pg-init-roles.sh  → databases ready
$ pnpm install --frozen-lockfile --prefer-offline → Done in 2.9s;  pnpm build:packages → exit 0
$ (apps/api) npx tsc -p tsconfig.build.json     → exit 0;  npx tsc -p tsconfig.json --noEmit (src + tests incl. the probe) → exit 0
$ (e2e) npx tsc --noEmit                        → exit 0
$ free -g → 12–14 GB available before each full run (one other agent's tests ran at times; the full API suite and the full
  Playwright suite were never run at the same time)
```

### 1.2 Baseline before any probe (the delivered AI specs and the security probes)
```
$ (apps/api) npx vitest run test/ai test/reviews/p5-sec-ai.spec.ts test/reviews/p5-sec-egress.spec.ts
  Test Files  12 passed (12)
       Tests  118 passed (118)          Duration 95.96s
```

### 1.3 This review's API probe (`apps/api/test/reviews/p5-qa-ai.spec.ts`, final version, single run)
```
$ (apps/api) npx vitest run test/reviews/p5-qa-ai.spec.ts --reporter=verbose
  Test Files  1 passed (1)
       Tests  14 passed | 5 expected fail (19)
  Printed evidence (ids shortened):
  P5-QA briefing after logout: worker exit 0; subscribers en / ar (secretary role) and contrib (contributor): GET /me after
    logout 401, active sessions 0, runs before the worker 0;
    runs: en {succeeded, trigger scheduled, locale en, provider mock, 12 claims, "12 sourced finding(s); 1 missing input(s);
    0 conflict(s); 71 rule-based detection(s)."}, ar {succeeded, scheduled, ar, 12 claims, "12 نتيجة موثقة؛ …"},
    contrib {succeeded, scheduled, en, 12 claims};
    notifications: en "AI briefing (Simulated)", ar "موجز المساعد الذكي (محاكاة)", contrib "AI briefing (Simulated)";
    reads: en/ar GET run 200, 12 citations → 12 × 200, other subscriber 404, Project-B PM 404, listed with trigger scheduled;
    contrib GET run 403 policy.forbidden, runs list 403.
  P5-QA AT-20 crash after the briefing committed: jobBefore {succeeded, attempts 1} → jobAfter {succeeded, attempts 2,
    result {status: already_ran}}, runs 1, notes 1
  P5-QA AT-20 worker killed mid-insert: killedExit {code null, signal SIGKILL}; atKill {notes 0, proposal approved, job
    running attempts 1}; afterRestart {notes 1, proposal executed, job succeeded attempts 2, result executed};
    afterSecondCrash {notes 1, job attempts 3, result already_executed}
  QA-P5-03 member cleared below the project classification (task WS07-A01 "Define NewCo operations model"):
    {projectClassification confidential, userClearance internal, project 404, task 404, taskList 404,
     ask {201, taskCited true, titleShown true}, briefing {succeeded, taskCited true, titleShown true},
     detections {200, taskListed true}, citationOpen 404, controlPm {task 200, askCites true},
     provisioned {create 201, clearance internal, grant 201}}
  QA-P5 dedupe: autopilot proposals [{executed, autopilot, WS07-A01 task, same recipient, "Update requested: WS07-A01 Define
    NewCo operations model", hash 6f82ffd27543} ×2]; notifications delivered to the owner for the same target: 2
    ["AI-generated (Simulated): Update requested: WS07-A01 …" ×2]; assisted: identical pending proposals 2
  QA-P5 quiet hours: {status approved, notes 0, deferred [{run_at 15:00:12Z (end of the 16–18 h Riyadh window), queued}]}
```
The 5 expected fails are this review's DEFECT probes (QA-P5-01, -02, -03 ×3). How the probe was built: the first runs
(a) used `pg_stat_activity.wait_event` to detect the held insert — not visible to the owner role for the runtime role's
backends; replaced by a non-transactional sequence the trigger advances; (b) used internal-cleared briefing subscribers — their
task citations returned 404, which is how QA-P5-03 was found; the briefing subscribers are now cleared at the project's
classification (as every demo persona is) and QA-P5-03 has its own CONTROL/DEFECT block; (c) the provisioning CONTROL of
QA-P5-03 was added after the full API run of §1.4 (that run had 13 passed + 5 expected fail in this file).

### 1.4 Full API suite (once, own database)
```
$ (apps/api) TEST_DATABASE_URL=…/hub_test_p5qa TEST_DATABASE_MIGRATION_URL=…/hub_test_p5qa HUB_AI_EVAL_OUT=<scratchpad>/ai-eval-full pnpm test
  Test Files  142 passed (142)
       Tests  1111 passed | 7 expected fail (1118)
    Duration  1544.48s                    EXIT 0
  (7 expected fails = this review's 5 DEFECT probes + the 2 open probes DOM-P2F-02 / DOM-P2F-04 of p2-domain-final.spec.ts.
   The implementer's last run: 141 files, 1098 + 2; the difference is exactly this review's file.)
$ (apps/api) node test/ai/summarize-evals.mjs <scratchpad>/ai-eval-full
  Total evaluation cases: 67; passed: 67; failed: 0   (12 categories; grounded, missing, conflicting_stale, restricted,
  injection, duplicates and revoked each have Arabic and English cases)
```

### 1.5 Domain unit tests and Playwright
```
$ (packages/domain) npx vitest run                        → Test Files 23 passed (23); Tests 475 passed (475)

Own stack (§ header), fresh database (schema dropped, migrate, demo seed), then the FULL suite once:
$ (e2e) HUB_WEB_URL=http://127.0.0.1:3480 QA_P34_DB_OWNER_URL=<owner URL of hub_test_p5qa_e2e> QA_P5_DB_OWNER_URL=<same> \
        npx playwright test --reporter=list
  416 passed (51.1m)        EXIT 0      (0 failed, 0 skipped, 0 flaky; retries 0)
  Per file: a11y 298, p1-closure 1, p1-smoke 6, p2-cockpit 4, p2-documents 4, p2-gates 5, p2-governance 1, p2-planning 3,
  p2-web-followups 4, p2r-governance-my-work 2, p3-carveout 5, p3-readiness 3, p34-sec-not-required 1, p4-finance 7, p4-jv 4,
  p5-ai 6, qa-p1-review 5, qa-p1r-arabic-rtl 3, qa-p2-arabic-rtl 6, qa-p2-exit-journey 1, qa-p2-final-authority-ui 2,
  qa-p2-gate-review-journey 1, qa-p34-arabic-rtl 14, qa-p34-journeys 6, qa-p34-states 4, qa-p5-ai-center 12, qa-p5-p34-recheck 8.
  The 4 expected failures counted as passed are this review's test.fail() DEFECTs (QA-P5-02 UI, -04, -05, -06).
  Delivered tests: 416 − 20 (this review's files) = 396, all passed (CI counts 395 + 1 skipped: J1 needs QA_P34_DB_OWNER_URL).
  Printed evidence (selection):
    A-en: 0 problem(s), UNCLASSIFIED 0;   A-ar: 20 problem(s) — CLASSIFIED DATA-question 4, DATA-run-en 13, QA-P5-04 3; UNCLASSIFIED 0
    every AI screen and dialog: "axe: 0 WCAG violation(s) (0 serious/critical)" in both languages (21 axe scans per language)
    QA-P5-04: bilingualTasks 102; askEnglish ["Assess legal structuring and transfer mechanisms", "Verify NewCo incorporation
      status", …]; askRawStatus ["الحالة not_started", "الحالة draft"]; detectionsEnglish non-empty
    QA-P5-05: recipient = the PM (id …c954ff); shownRecipient "Recipient User …c954ff"; shownRequester "Requested on behalf of
      User …c954ff"; the PM's name is in the task DTO the Secretary reads: true
    B-en: target task v1 changed before approval → 409 ai.approval_invalidated shown as "The payload or the target record changed
      after the proposal was prepared, so the approval was refused. A fresh proposal is required."; proposal invalidated
      (target_version_changed); pending 2 → 1
    B-ar: … shown as "تغيّر المحتوى أو السجل المستهدف بعد إعداد المقترح، لذا رُفض الاعتماد. يلزم مقترح جديد."; pending 1 → 0
    C: browser contexts open while waiting: 0; scheduled run 01a0f7bf-… found after 13:54:34Z (observed via database (no session));
      12 claim(s), each cited; first citation opened /projects/…/plan/tasks/…;  C-ar: run locale en; 13 problem(s), 13 classified
      DATA-run-en, UNCLASSIFIED 0
    C-contributor: run 01a0f7c0-…; in-app notification link /projects/…/ai/runs/01a0f7c0-…  (then restricted state: QA-P5-02)
    QA-P34 crawler: [ar] P3 UNCLASSIFIED 0, [en] P3 0, [ar] P4 0, [en] P4 0, [ar-390] 63 screens, 0 problems;
    QA-P34-01a 0/4, 01b [], 01d 0 of 31 in English, 01e 0 of 31, 01f 0/13, 01g Arabic shown; J1 worker result: status
      expired_unresolved, escalation decision_requested, exitApprovedBy null; J3 Arabic: 0 problem(s);
      QA-P34-07: "…/readiness/tsa/<id>; TSA detail shown: 1"
    QA-P34-01c re-check: new request origin partner; (ar) 0 problem(s);  QA-P34-01h re-check: 15 KPIs, 15 with definitionAr;
      QA-P5-07: 7 English template KPI texts on the Arabic cps_verified page
    QA-P34-07 re-check: dd → …/jv/diligence/requests/<id>, checks → …/readiness/checks/<id>, back → …/readiness
    P3 AT-10 (ar): TSA-002 expired_unresolved, escalation decision_requested; English escalation text shown 0; exit buttons 0
    P3 AT-09 (ar): GO allowed false, failed blocker connectivity shown by its Arabic title, its contingency and the rollback plan shown
Before the full run the two e2e probe files were run alone several times while they were written (first runs: fixture waits,
a non-existent proposal GET route in the probe, Arabic classification); only the final versions in the full run count here.
The stack was stopped by PID afterwards (`kill <api> <worker> <web>`); the regenerated tracked screenshots were restored
(`git checkout -- e2e/screenshots`), the untracked `e2e/screenshots/qa-p34/crawl/` removed.
```

### 1.6 Register, secret scan
```
$ python3 scripts/requirements/apply_status.py --check   → status-evidence.yaml OK (265 entries)   (not applied: §7 only recommends)
$ python3 <scratchpad>/reqmap.py   (lists, per P5 requirement, the test files and titles naming it; read-only)
$ gitleaks dir <scratch copy of the 4 new text files> --config scripts/ops/gitleaks.toml --redact=100
  INF scanned ~170130 bytes (170.13 KB) in 50.2ms;  INF no leaks found
$ GITLEAKS=<scratchpad>/gl/bin-8.30.1/gitleaks bash scripts/ops/secret-scan.sh tree   (after the commit)
  tree: 1221 committed files at HEAD 7594d6b (the review commit); INF scanned ~15139291 bytes (15.14 MB) in 994ms;
  INF no leaks found; PASS tree: no findings; SECRET SCAN (tree): PASS
  (the only later change is this result block)
```

---

## 2. Findings

| ID | Severity | Where | Finding (one line) | Probe |
|---|---|---|---|---|
| **QA-P5-03** | **High** | `apps/api/src/modules/ai/ai-knowledge.service.ts:46` (`can(ctx, perm, projectId)`), `:156-158`, `:211-213`, `:233-235`, `:497`, `:533` (`visibilitySql(ctx, projectId, {})` — no project classification); `ai-ops.service.ts:195` (detections); `ai-runtime.service.ts:121, 143` (ask, briefing) — compare `planning/planning-support.ts:108` (`canSee(ctx, { projectId, classification: p.classification })`) | A member cleared below the project's classification is refused the project, the plan and every task (404) by the owning modules, but the AI answers, briefings and the rules-only detections disclose task titles, owners and overdue status, with citations that do not open for them. | `p5-qa-ai.spec.ts` › `DEFECT QA-P5-03 (ask)`, `(briefing)`, `(rules-only detections)`; 2 CONTROLs; OBSERVED |
| **QA-P5-01** | Medium | `ai-proposals.service.ts` `createFromTool` (idempotency key per run) and `executeJob` (notification dedupe key `ai-proposal:<id>`); `docs/security/ai-threat-cases.md` AIT-27 claims "cooldown and dedupe" | No deduplication or cooldown of AI actions across runs (§12.4): an identical reminder prepared by two briefings of one day is delivered twice under policy-limited autopilot; in assisted mode each briefing queues another identical proposal. | `p5-qa-ai.spec.ts` › `DEFECT QA-P5-01`; CONTROL; OBSERVED |
| **QA-P5-02** | Medium | policy matrix: `ai.briefing.subscribe` without `ai.run.read` for `contributor`, `workstream_lead`, `committee_chair`, `functional_approver`, `finance_restricted`, `legal_restricted`; `ai-runtime.service.ts` `deliverBriefing` (link `/ai/runs/<id>`); `packages/contracts/src/ai.ts` `getRun` (`access: 'ai.run.read'`) | Six of the nine roles that may subscribe to briefings cannot read what is delivered to them: the notification links to a run they get 403 on, the Runs tab is restricted, and there is no notification inbox yet (P6). | `p5-qa-ai.spec.ts` › `DEFECT QA-P5-02`, OBSERVED; `qa-p5-ai-center.spec.ts` › `C-contributor CONTROL`, `DEFECT QA-P5-02 (UI)` |
| **QA-P5-04** | Medium | `ai-detections.service.ts:151, 155, 164, 168` (owner_missing labels and citations), `:69, 83, 93, 97, 112, 116, 127` (other citation / detection labels): `${code} ${title}` without `titleAr`; `:65, 152` (raw `status` inside the Arabic detail) | In Arabic, AI answers, briefings and the rules-only detections show template tasks by their English title although `titleAr` exists, and raw status values (`draft`, `not_started`) inside Arabic sentences. Same class as QA-P34-01. | `qa-p5-ai-center.spec.ts` › `CONTROL QA-P5-04`, `DEFECT QA-P5-04` |
| **QA-P5-05** | Medium | `apps/web/src/lib/ai.ts:263-271` (`useMemberNames` → members list, enabled only with `admin.role_assignment.read`); `ai/_components/bits.tsx:159-166` | The approver (Secretary) cannot tell who will receive the AI message under review: recipient and requester are shown as "User …dcfb4a", though the Secretary sees the same person's name on the plan. | `qa-p5-ai-center.spec.ts` › `CONTROL QA-P5-05`, `DEFECT QA-P5-05` |
| QA-P5-06 | Low | `apps/web/src/app/(app)/projects/[projectId]/committee/escalations/page.tsx:92, 118` (`UText value={e.requestedAction}` / `{e.target}`) | The Arabic Committee Hub escalation register shows every system-generated escalation in English: the TSA expiry escalation's requested action and routing target (translated on the TSA page since QA-P34-01b, not here) and the authority-routing escalations' subject, requested action, options and target. Documented as a remainder by the P2 QA fixes ("needs stored codes") and by the QA-P34 implementer; still open. | `qa-p5-p34-recheck.spec.ts` › `CONTROL QA-P5-06`, `DEFECT QA-P5-06` |
| QA-P5-07 | Low | `packages/db/seed/templates/dc-carveout.v1.json` `kpis[*].formula / unit / frequency / source / thresholds` (English only); `finance/kpis/[kpiId]/page.tsx:106-115` | On the Arabic KPI page the definition is Arabic (QA-P34-01h fixed), but the template formula, unit, frequency, source and thresholds are English — the template has no Arabic for them. | `qa-p5-p34-recheck.spec.ts` › `OBSERVED QA-P5-07` |
| QA-P5-08 | Info | `packages/contracts/src/ai.ts` (no GET-by-id for proposals); `apps/web/src/lib/ai.ts:213-228` | The proposal page finds its proposal by paging the whole list (up to 50 × 100 rows); every API client must do the same. | — |
| QA-P5-09 | Info | `apps/web/src/i18n/messages/{en,ar}/ai.json` `errors.ai.approval_invalidated` | After the approve() 409 the text says "A fresh proposal is required", while the requester can revise the invalidated proposal (Revise is offered and accepted). Wording only. | `qa-p5-ai-center.spec.ts` › `B-en`, `B-ar` |
| QA-P5-10 | Info | `docs/requirements/requirements.yaml`; `packages/db/src/schema/ai.ts` (`ai_run.policy_version` nullable) | 43 of the 45 P5 requirements are still "Planned" (recommended statuses in §7). REQ-AI-029's AT ("AI run without policy version rejected") is neither enforced by the schema nor tested. | — |

### QA-P5-03 (High) — the AI channel ignores the project classification that the owning modules apply

**What the code does.**
- The planning module reads every plan record through `PlanningSupport.readScope` (`planning-support.ts:107-114`): it first
  requires `policy.canSee(ctx, { projectId, classification: project.classification })`, otherwise 404. The portfolio module
  hides the project itself the same way (`portfolio.service.ts:129-132`).
- The AI module checks the same permissions **without** the project's classification:
  `AiKnowledgeService.can(ctx, 'planning.plan.read', projectId)` (`:46`, used at `:156`, `:211`, `:233`, `:497`, `:533`) and
  `policy.visibilitySql(ctx, projectId, {})` (`:158`, `:213`, `:235`, `:261`, `:305`); `ask` / `runBriefingNow` assert
  `ai.assistant.use` / `ai.briefing.subscribe` with `{ projectId }` only (`ai-runtime.service.ts:121, 143`); the rules-only
  detections route asserts `planning.plan.read` with `{ projectId }` only (`ai-ops.service.ts:195`).
- Plan records then enter the context as `internal` (`RECORD_CLASSIFICATION`), so a member cleared `internal` in a
  `confidential` project receives them.

**Reproduction** (`p5-qa-ai.spec.ts`, "§12.1 "citations open only for authorized users" …"):
- CONTROL: DEMO-DC is `confidential`; the member (contributor, cleared `internal`) gets **404** on `GET /projects/:id`, on
  `GET …/tasks/:id` and on `GET …/tasks`; the PM (cleared `confidential`) reads the task (200) and the AI cites it for the PM.
- CONTROL: the configuration is reachable through the product: the platform admin provisions a user (`POST /api/v1/admin/users`
  → 201, default clearance `internal`; higher clearances need a separate grant) and the portfolio admin grants them a
  contributor role in DEMO-DC (`POST …/members` → 201).
- DEFECT (ask): `POST …/ai/ask` "Which tasks are overdue and who owns them?" → 201; the answer cites task WS07-A01 and shows
  its title "Define NewCo operations model".
- DEFECT (briefing): the member's briefing cites and shows the same task.
- DEFECT (detections): `GET …/ai/detections` → 200 and lists the task.
- OBSERVED: the citation shown to the member opens to 404.
- The delivered `at-19-ai-revocation.spec.ts` › "clearance lowered after scheduling: the briefing still runs but only with
  content the user can see NOW" (REV-EN-03) lowers a member's clearance to `internal` and asserts that the briefing still
  runs with "internal" content — i.e. it asserts this behaviour as correct. After the change the member can see none of the
  plan in the planning module.

**Impact.** Plan content (task / milestone titles, owners, due dates, gate links, readiness and decision detections that use the
same `can`) of a project is disclosed through the AI channel to project members the platform otherwise treats as having no
access to that project. A newly provisioned user granted a role before their clearance grant is exactly this case. The P5 exit
criterion "valid citations / permissions", §12.1 ("Enforce ACLs before retrieval … Citations must … open only for authorized
users") and AT-19 ("does not send/output unauthorized content") are not met for these users.

**Recommendation.**
- Apply the project's classification at every AI entry point (ask, briefing run and subscription, detections, proposals,
  artefacts) and in every retrieval query, exactly as `PlanningSupport.readScope` does (or reuse it); a member who cannot see
  the project gets 404 from the AI routes too.
- Turn REV-EN-03 into the opposite assertion (clearance below the project classification → the briefing is `skipped`, nothing
  delivered) and add the QA-P5-03 probes as regressions; review the other AI knowledge queries that use `can` /
  `visibilitySql(ctx, projectId, {})` (decisions, actions, gates, readiness, CPs) for the same gap.

### QA-P5-01 (Medium) — no deduplication or cooldown of AI actions across runs

- §12.4 requires "idempotency keys, retry/backoff, dead-letter handling, **deduplication, cooldown**, and quiet hours";
  `docs/security/ai-threat-cases.md` AIT-27 states that every autopilot action is checked against "quiet hours, cooldown and
  dedupe". Idempotency, retries, dead-letter and quiet hours exist and are tested; deduplication and cooldown do not exist:
  the proposal's idempotency key includes the run id, and the notification's dedupe key is the proposal id.
- Probe: under an approved autopilot policy (allowlist `create_internal_notification`, 10 per day), the PM's daily briefing and
  the same morning's weekly summary each prepare "Update requested: WS07-A01 Define NewCo operations model" for the same owner
  (same payload hash). Both are executed: the owner receives the identical message twice. In assisted mode, two briefings leave
  two identical pending proposals.
- Retries are not affected (AT-20 holds, §4). Compensation: the daily limit caps the count; messages are in-app only.
- Recommendation: a dedupe key over (action, target, recipient, payload hash) with a configurable cooldown window, checked at
  proposal creation (do not create a duplicate of a pending or recently executed one) and again in execution phase 2.

### QA-P5-02 (Medium) — most subscribing roles cannot read the briefing delivered to them

- The policy matrix grants `ai.briefing.subscribe` to 9 roles and `ai.run.read` to 4 (sponsor, secretary, PM, auditor).
  Contributor, workstream lead, committee chair, functional approver, finance and legal roles may subscribe (the Briefings tab
  is offered to them) and the worker delivers their briefing, but the in-app notification links to `/ai/runs/<id>`, whose API
  needs `ai.run.read` (403) and whose tab shows the restricted state. No notification inbox exists yet (P6).
- Probe: API (`p5-qa-ai.spec.ts`): the contributor's scheduled run succeeded and was notified, `GET` run → 403, runs list → 403.
  UI (`qa-p5-ai-center.spec.ts`): the contributor subscribes in the UI, closes the browser, the worker delivers; opening the
  notified run shows the restricted state (screenshot `defect-qa-p5-02-contributor-briefing-restricted.png`).
- Recommendation: let a user read their **own** runs with `ai.briefing.subscribe` / `ai.assistant.use` (the run is already
  per-user and its citations re-checked on read), or deliver the briefing where the subscriber can read it.

### QA-P5-04 (Medium) — English template titles and raw enums in Arabic AI output

- In an Arabic run, claims and citation chips read e.g. "WS03-A04 Assess applicability of licences, authorizations and
  registrations: المهمة WS03-A04 بلا مالك مسؤول (الحالة draft)." although the task's `titleAr` is «تقييم انطباق التراخيص
  والتصاريح والتسجيلات». The rules-only detections table in Arabic shows the same English titles.
- Probe: `CONTROL QA-P5-04` (102 DEMO-DC tasks carry an Arabic title; the Arabic answer and the Arabic detections list them)
  and `DEFECT QA-P5-04` (`askEnglish` 4+ titles, `askRawStatus` ["الحالة not_started", "الحالة draft"], `detectionsEnglish`
  non-empty). Screenshots `defect-qa-p5-04-ar-answer-english-titles.png`, `defect-qa-p5-04-ar-detections-english-titles.png`
  (inspected: English titles inside Arabic sentences and in every citation chip).
- Cause: only the `task_overdue` / `milestone_overdue` detection labels use `titleAr`; every citation label and the other
  detection labels use the English title; the Arabic detail strings embed the raw status.
- Recommendation: localised labels (or `labelAr`) for citations and detections, status through the status catalogue (codes +
  parameters, module guide §2), and the detector's allow-list extended to AI DTOs.

### QA-P5-05 (Medium) — the approver cannot identify the recipient

- Assisted mode relies on a human approving exactly one payload for exactly one recipient (§12.4, AIT-07). The proposal page
  shows names only to holders of `admin.role_assignment.read` (members list). The Secretary — the persona the matrix makes the
  approver of AI messages (`ai.proposal.approve` + `notifications.message.send`) — sees "Recipient User …dcfb4a" and "Requested
  on behalf of User …dcfb4a" while the same user's name is shown to them on the task (CONTROL). Screenshot
  `defect-qa-p5-05-approver-sees-user-id-not-recipient.png` (inspected).
- Recommendation: return `people` (id → display name of the recipient, requester, approvers) in the proposal DTO, as other
  modules' DTOs do.

### QA-P5-06 (Low), QA-P5-07 (Low), Infos

- QA-P5-06: `CONTROL QA-P5-06` / `DEFECT QA-P5-06` print the stored English requested action ("TSA TSA-002 (Legacy monitoring
  bridge — DEMO TSA issue (synthetic)) reached its end date 2026-09-24 without an accepted replacement service. This is NOT an
  exit. …") and target ("DC Carve-out & JV Steering Committee (Demo) — within its delegated authority
  (tsa_approval_or_extension, matrix v1)") visible in the Arabic register. The screenshot
  `defect-qa-p5-06-ar-committee-escalations-english.png` (inspected) also shows the governance escalations entirely in English
  in the Arabic register: subjects ("Recommendation pending external authority — DEC-018: …"), requested actions ("Decide on
  the committee recommendation DEC-018. Amount exceeds the committee delegated limit."), the three options with their impact
  texts ("Approve the committee recommendation — The decision becomes approved; dependent gates may proceed." …); targets such
  as "Board of Directors — to be confirmed" are DEMO-policy data (as classified by the P2 QA review). The governance `EscalationDto` carries no I18n codes. Recommendation: the same
  template-recovery mechanism as `tsaEscalationI18n` (or stored codes) for every system-written escalation text.
- QA-P5-07: `OBSERVED QA-P5-07` — 7 English template texts on the Arabic `cps_verified` KPI page ("per closing: count(CPs with
  state verified or validly_waived) / count(CPs) x 100", "percent", "weekly", "CP register", and the three thresholds).
  Owner: template content (Arabic for these fields) or translated unit/frequency vocabularies.
- QA-P5-08…10: see the table.

---

## 3. P5 exit criteria (§19)

| Exit criterion | Status | Evidence |
|---|---|---|
| Scheduled briefing after the browser closes | **Met** (with QA-P5-02) | API: three subscribers log out (`GET /me` 401, 0 active sessions), the API app is closed, `dist/worker.js` alone produces one scheduled run per subscriber and delivers it in-app, labelled Simulated in the subscriber's language (`p5-qa-ai.spec.ts`, §1.3). UI: subscribed in the UI, every browser context closed (`browser.contexts().length = 0`), the running worker's run observed in the database (no session), then read in a new session in English and Arabic with its citations (`qa-p5-ai-center.spec.ts` › C). The delivered specs drive the job in-process only (`drain()`). For six subscribing roles the delivered briefing cannot be read (QA-P5-02). |
| Valid citations / permissions | **Not met** — QA-P5-03 | For subscribers cleared at the project's classification every claim is cited and every citation opens (12/12 → 200), nothing above clearance is cited, runs are per user (404 for others, 404 cross-project). For a member cleared below the project's classification the AI discloses plan records and cites what does not open. |
| No duplicate actions | **Met for retries; not for repeated runs** (QA-P5-01) | Delivered DUP-01…06; this review: the real worker process killed (SIGKILL) inside the notification insert → nothing committed, the restarted worker executes once; crash after commit (job re-claimed with an expired lease) → `already_ran` / `already_executed`, one run, one notification. Repeated briefings deliver identical actions twice (no dedupe/cooldown). |
| Prompt-injection resistance | **Met** (with the security review's fixes) | AT-17 specs (INJ-EN/AR-01/02, PRQ-*), SEC-P5-01 regressions and "send financials" (`p5-sec-fixes.spec.ts`) green in this run; authority snapshot unchanged; 0 fetch calls. Only Simulated providers (benign, hostile, scripted) — no real model. |

---

## 4. Acceptance scenarios mapped to executable tests (§20)

"Full" = the test asserts every part of the §20 required outcome through the real API / database (and the UI where relevant).
Every file listed ran green in this review's full API run (§1.4) or Playwright run (§1.5).

| AT | §20 required outcome | Executing tests | Asserted in full? | Gap → probe added |
|---|---|---|---|---|
| **AT-17** Document instructs AI to send financials / approve a CP | Treat as data; do not execute or disclose | `ai/at-17-ai-injection.spec.ts`: "EN/AR benign mock: injected memo summarised as content, flagged, nothing executed or disclosed", "EN/AR hostile mock: prohibited tool calls, external recipient, foreign ids, exfiltration markup and fabricated facts are all contained", PRQ-EN/AR-01…04; `ai/p5-sec-fixes.spec.ts` › "the message carrying the figure is refused at creation (recipient_not_cleared_for_content); nothing is proposed or sent"; `reviews/p5-sec-ai.spec.ts` › "SEC-P5-01 (fixed, regression) (policy-limited autopilot) …", "(assisted, AIT-07) …" | **Yes** (Simulated providers) | Not "disclose" through the AI channel to under-cleared members: QA-P5-03 (not an injection path, but the same disclosure outcome). No real model was run. |
| **AT-18** Approval then payload / recipient / target version changes | Invalidate; fresh review | `ai/at-18-ai-approval-binding.spec.ts` APB-01…06 + "payload changed before approval → 409, and the invalidation is kept and audited although the request is refused"; `ai/p5-sec-fixes.spec.ts` SEC-P5-I1; `e2e/p5-ai.spec.ts` › "3. proposal: …" | **Yes** (API); UI covered the stale-version case only | **Probe** `qa-p5-ai-center.spec.ts` › B-en / B-ar: target changed → 409 shown translated, after reload `invalidated` with the reason, no Approve, pending list −1 (§6). |
| **AT-19** Access revoked after scheduling | Worker re-checks; no unauthorized output | `ai/at-19-ai-revocation.spec.ts` REV-EN/AR-01, REV-EN-02…05, REQ-AI-008 case; `ai/p5-sec-fixes.spec.ts` › "execution: the worker re-checks the content for the recipient — …" | **Partly** | Membership revocation and document reclassification: yes. Clearance lowered below the project classification: REV-EN-03 asserts that plan content is still output (QA-P5-03, DEFECT probes). |
| **AT-20** Worker retries after crashing before/after a notification | No duplicates; reconcile uncertain delivery | `ai/at-20-ai-duplicates.spec.ts` DUP-01…06 (in-process fake jobs and an injected audit failure) | **Yes for retries**; "uncertain delivery" does not arise (in-app delivery is transactional; external channels are disabled) | **Probes** with the real worker process: SIGKILL inside the insert, crash after commit (briefing and approved action) — all exactly once. QA-P5-01 is a separate (non-retry) duplicate. |
| **AT-21** AI disabled / over budget / provider down | Project, committee, deterministic reporting continue | `ai/at-21-ai-degradation.spec.ts` DEG-01, DEG-EN/AR-02, DEG-EN/AR-03, DEG-04; `e2e/p5-ai.spec.ts` › "1. mode Off: …" | **Yes** (reporting = rules-only detections; P6 reports not built) | — |
| **AT-22** Egress / LLM disabled in private mode | No unapproved external traffic; assets/fonts/core internal | `ai/at-22-ai-egress.spec.ts` EGR-01…03 + adapter contracts; `reviews/p5-sec-egress.spec.ts` SEC-P5-04 regressions | **Yes for the AI path**; the web side was not asserted | **Probe** `qa-p5-ai-center.spec.ts` A-en / A-ar: every request of every AI PM Center screen and dialog goes to the platform's own origin (0 external hosts). Private-mode runtime (`HUB_PRIVATE_MODE`) is P7 (SEC-P5-I4). |
| **AT-28** Unsupported partner-identity / valuation question | State missing evidence; never invent | `ai/at-28-ai-evidence.spec.ts` MIS-EN/AR-01/02, MIS-EN-03 | **Yes** | — |

---

## 5. AI PM Center in English and Arabic (`e2e/tests/qa-p5-ai-center.spec.ts`)

**Method.** Every AI PM Center screen as the persona who uses it — PM: overview, ask with a real Simulated answer, proposals,
a worker-prepared proposal (as requester, with the revise and reject dialogs), runs, a run, briefings & detections, 390 px
overview and run; Sponsor: settings with the save-review dialog (a pending budget change, nothing saved) and the emergency-stop
dialog (nothing submitted: `killSwitch` stays `false`); Secretary: the proposal in Advisory mode (approval not offered, with
the reason) and the reject dialog; Contributor: overview without status access; Clean Team: restricted state. In Arabic each
screen and open dialog goes through the shared detector (`checkArabic`: lang/dir, no English UI catalogue message, no English
half of a bilingual API field; Latin texts printed for manual classification) and axe WCAG 2.0/2.1 A/AA (serious/critical
gate), each dialog through `checkDialogA11y` (name, focus inside, axe). English: lang/dir + axe. Every request of every page is
checked to stay on the platform origin (AT-22, web side).

**Results** (from the full run, §1.5): per language 16 checks (11 screens, 5 open dialogs) and 21 axe scans (each dialog is
scanned by `checkDialogA11y` and again by the screen check). English — axe serious/critical **0**, lang `en` / dir `ltr` on
all, **0** requests to an external host. Arabic — axe serious/critical **0**, lang `ar` / dir `rtl` on all, 20 detector
problems, all classified (below), **0** unclassified, **0** external requests. 390 px (overview
and a run, both languages): no page-level horizontal overflow. The open findings on these screens are QA-P5-04 (Arabic AI
output) and QA-P5-05 (recipient shown as a user id); the detector alone catches only 3 occurrences of QA-P5-04, its own tests
measure the extent.

Classified Arabic problems (each printed with its id; anything unclassified fails the test): `DATA-question` (a question a user
typed in English, shown as typed in "my runs"), `DATA-run-en` (output of a run produced in English — the PM's saved language —
matched exactly against the run's API texts), `QA-P5-04` ("Assess applicability" — an English template title inside the Arabic
answer and detections, the only English title that coincides with a catalogue string; the full extent is measured by the
QA-P5-04 tests).

**Honesty labels.** Mock output carries "Simulated" / «محاكاة» on the overview provider fact, every answer (badge + "Mock provider
— simulated output, not an AI model" + "SIMULATED" disclaimer), runs list rows, run pages, proposals ("Prepared from Simulated
mock output"), the briefing notification title "AI briefing (Simulated)" / «موجز المساعد الذكي (محاكاة)» and the executed message
title "AI-generated (Simulated): …". Both real endpoints read "Not configured" / «غير مُهيَّأ»; the page never says "connected" /
«متصل».

**States.** Loading (runs list answered 3 s late → `loading-state` in the table), error (runs list 500 → the error state with
correlation id `qa-p5-injected-500`, Retry recovers), empty (a proposal status with no rows → "No proposals match the filter"),
restricted (Clean Team on every AI route; a contributor on Runs) — `A-states` and the A tests.

**Screenshots inspected** (not only generated): `ar-p5-overview.png` (RTL layout, Simulated and Not-configured badges, manual
fallback, the user's English question in the last runs), `ar-p5-B-approval-refused-dialog.png` and
`ar-p5-B-proposal-invalidated.png` (§6; also shows QA-P5-05 «مستخدم …dcfb4a»), `en-p5-proposal-detail-approver-advisory.png`
(QA-P5-05), `defect-qa-p5-04-ar-answer-english-titles.png` (QA-P5-04).

## 6. The approve() invalidation fix, as the user sees it (`qa-p5-ai-center.spec.ts` › B-en, B-ar)

Fixture: DEMO-DC in Assisted mode; two reminders prepared by the **worker** from the PM's scheduled briefing. The Secretary opens
the proposal (Approve offered, bound to version 1); meanwhile the PM edits the target task (version 1 → 2); the Secretary
confirms the approval:
- The dialog shows `data-code=ai.approval_invalidated` with "The payload or the target record changed after the proposal was
  prepared, so the approval was refused. A fresh proposal is required." / «تغيّر المحتوى أو السجل المستهدف بعد إعداد المقترح، لذا
  رُفض الاعتماد. يلزم مقترح جديد.», a correlation id and "Reload and review"; the Arabic dialog passes the detector and axe (0).
- After "Reload and review": status `invalidated`, reason "the target record changed after the proposal was prepared" /
  «تغيّر السجل المستهدف بعد إعداد المقترح», no Approve (`notPending`); the API agrees (`invalidated`, `target_version_changed`,
  no approval row); the pending list no longer contains it and its total dropped by one (7 → 6, then 6 → 5); the Arabic page
  passes the detector.
- The requester (PM) sees `invalidated` with the reason and is offered Revise (QA-P5-09: the error text says "a fresh proposal").

## 7. The 45 P5 requirements — executing tests and recommended status

Register state at `79d1f71` (`docs/requirements/requirements.yaml`, applied from `status-evidence.yaml`): **43 Planned, 2 Tested**
(REQ-AI-036 and REQ-SEC-018 were set to Tested by the P5 security fix). The brief's "all 45 Planned" is out of date by those two.
"Tested" below means: an automated test that asserts the requirement's acceptance test (or the substance of it) exists and
**passed in this review's full runs** (§1.4, §1.5). "Implemented" = code exists, the AT is not (or only partly) asserted, or an
open finding of this review contradicts it. "Planned" = not built. This review does not edit `status-evidence.yaml`.
File abbreviations: `ai/` = `apps/api/test/ai/`, `rev/` = `apps/api/test/reviews/`, `doc/` = `apps/api/test/documents/`,
`D` = `packages/domain/src/ai-runtime.test.ts`, `e2e/` = `e2e/tests/`.

| REQ | Title (short) | Executing tests (file › exact title) | Recommended | Why / gap |
|---|---|---|---|---|
| REQ-UX-017 | Screen 14: AI PM Center | `e2e/p5-ai.spec.ts` › "1. mode Off: asking is unavailable and the reason is stated; the server refusal is translated [REQ-AI-019, REQ-AI-023]", "6. Arabic (RTL) screens and a 390 px view [REQ-UX-001, REQ-UX-017]"; `ai/at-21-ai-degradation.spec.ts` › "AI Off: ask refused with a pointer to deterministic features; no provider call; core features work"; `e2e/qa-p5-ai-center.spec.ts` › "A-en: …", "A-ar: …", "A-states: …" | **Tested** | AT-21 + "AI Off shows disabled state and core screens work" asserted (API + UI). Open on this screen: QA-P5-04 (Arabic output), QA-P5-05 (recipient not identifiable). |
| REQ-AI-001 | Runtime AI PM distinct and durable | `rev/p5-qa-ai.spec.ts` › "the worker process produced exactly one scheduled briefing per subscriber after the session ended (trigger "scheduled", requester = subscriber), delivered in-app to the subscriber only, labelled Simulated in the subscriber's language"; `e2e/qa-p5-ai-center.spec.ts` › "C: a briefing subscribed in the UI is produced by the worker after every browser context is closed, and is read in a new session with its citations (en, ar) [REQ-AI-001, REQ-AI-010]"; `ai/at-19-ai-revocation.spec.ts` › "EN: revoked subscriber → briefing recorded as skipped …" | **Tested** | The AT ("scheduled briefing produced with no browser session open") is asserted with `dist/worker.js` as the only process (API closed, session revoked). |
| REQ-AI-002 | Only authorized project knowledge sources | `D` › "every tool maps to a permission whose ai flag matches its kind (no ai:none permission is reachable)"; `ai/at-17-ai-injection.spec.ts` › "EN hostile mock: prohibited tool calls, external recipient, foreign ids, exfiltration markup and fabricated facts are all contained" (`search_documents` → `retrieval_is_runtime_controlled`, `sql`/`shell` → `unknown_tool`) | **Implemented** | The named UT ("retrieval excludes source types not on allowlist") does not exist; the closed tool catalogue is tested. QA-P5-03: the sources are not limited to what the user may read in the owning module. |
| REQ-AI-003 | Knowledge ingestion pipeline | `doc/at-25-file-safety.spec.ts` › "indexes txt/md/docx with sections, flags instruction-like text, and reports PDF extraction as not performed", "the EICAR test file and executables are quarantined: never current, never downloadable, never indexed or linked", "a classification change invalidates the index immediately and the job rebuilds it with the new ACL" | **Tested** | File check → extraction → index asserted; a failed file check stops the pipeline (EICAR). PDF extraction "not performed" (stated honestly). |
| REQ-AI-004 | Cited answers; facts vs inference | `ai/at-28-ai-evidence.spec.ts` › "GRD-EN-01: …", "GRD-AR-01: …", "GRD-EN-02: …", "GRD-AR-02: …"; `D` › "drops claims without a citation from the evidence set and reports invalid citations"; `rev/p5-qa-ai.spec.ts` › "citations of the scheduled briefing: every factual claim is cited, every citation opens for the subscriber (200), …"; `e2e/p5-ai.spec.ts` › "2. an administrator enables Advisory (Simulated mock); …" | **Implemented** | Citations: asserted. The second AT ("inference statements tagged as inference") has no test. QA-P5-03: a citation can be shown that does not open for the reader. |
| REQ-AI-005 | Structured records authoritative; deterministic calculations | `D` › "numbers in a claim must appear in a cited source (AIT-32)"; `ai/at-17-ai-injection.spec.ts` › "EN hostile mock: …" (self-computed `123,456,789` removed) | **Implemented** | "Numeric answers match deterministic engine output" is not asserted; the CPM tool `get_delay_impact` and the `predecessor_delay` detector have no test. |
| REQ-AI-006 | ACL before retrieval, per chunk and before output | `ai/ai-retrieval-acl.spec.ts` › "classification: the restricted canary is retrieved for the sponsor only", "rooms: …", "cross-project: …", "live document ACL is joined: …", "workstream reach: …", "citations re-checked on read: …" | **Implemented** (hold) | The AT passes, but **QA-P5-03 (High)**: the AI retrieval ignores the project classification the owning modules apply. Tested once QA-P5-03 is fixed with its probes as regressions. |
| REQ-AI-007 | No leakage via caches, memory, logs | `ai/ai-retrieval-acl.spec.ts` › "EN: contributor asks about the restricted memo → nothing about it in the answer, citations or evidence snapshot"; `ai/at-28-ai-evidence.spec.ts` › "EN: a Project-B user gets only Project-B sources", "hostile mock in Project B: …"; `ai/ai-settings-ops.spec.ts` › "runs are per user: another user's run is 404; a Project-B user sees nothing of Project A (AIT-08, AT-03)"; `ai/at-19-ai-revocation.spec.ts` › "derived artefacts: a briefing summary is invalidated by permission.changed / document.changed and hidden when the ACL fingerprint changes" | **Tested** | AT-03 + "Project B session cannot obtain Project A summary via cache" asserted. |
| REQ-AI-008 | Invalidation on change, deletion, revocation | `ai/at-19-ai-revocation.spec.ts` › "a draft/summary citing a document is invalidated when that document changes", "derived artefacts: …"; `doc/at-03-documents-isolation.spec.ts` › "declassification: never by the document owner; otherwise audited with permission.changed and index invalidation"; `rev/p5-sec-ai.spec.ts` › "SEC-P5-05 (fixed, regression): …"; `ai/ai-retrieval-acl.spec.ts` › "citations re-checked on read: …" | **Tested** | |
| REQ-AI-009 | Known / missing / conflicting / stale | `ai/at-28-ai-evidence.spec.ts` › "EN benign, non-demo project: missing evidence named with owner roles; no demo/other-project data", "AR benign, …", "EN: conflicting evidence and a 200-day-old source are flagged with citations and freshness", "AR: …" | **Tested** | |
| REQ-AI-010 | Scheduled daily briefings / weekly summaries | `ai/ai-settings-ops.spec.ts` › "subscribing creates a durable scheduled_job owned by the subscriber (07:30 Asia/Riyadh by default)"; `rev/p5-qa-ai.spec.ts` › "the worker process produced exactly one scheduled briefing per subscriber …"; `e2e/qa-p5-ai-center.spec.ts` › "C: …"; `ai/at-20-ai-duplicates.spec.ts` › "EN: a scheduled briefing slot delivered twice (retry/replay) creates one run and one notification" | **Tested** | Produced by the worker on the Riyadh schedule. Open: **QA-P5-02** (6 of the 9 roles that may subscribe cannot read what is delivered to them). |
| REQ-AI-011 | Detect lateness, gaps, contradictions, bottlenecks | `ai/ai-settings-ops.spec.ts` › "rules-only detections list overdue work, missing owners and blocking CPs without any provider" | **Implemented** | 3 of 13 detectors asserted (`task_overdue`, `owner_missing`, `cp_missing_evidence`); none "not on clean data". Untested: `stale_update`, `approval_bottleneck`, `decision_bottleneck`, `predecessor_delay`, `milestone_*`, `readiness_blocker`, `tsa_expiring`, `cp_open_gate_link`, `action_overdue`. |
| REQ-AI-012 | Corrective action / recovery proposals | — | **Implemented** (partial) | Propose tools exist (follow-up task, risk flag); no recovery option with schedule / gate / ownership implications; no EVAL. |
| REQ-AI-013 | Draft agendas, minutes, decision papers, reports | `ai/p5-sec-fixes.spec.ts` › "the executed draft is keyed to the run inputs (the lark memo) and is no longer served to the PM" (a draft action executed into the AI workspace) | **Implemented** | `draft_agenda` / `draft_minutes` / `draft_decision_paper` / `draft_status_summary` exist; the EVAL "draft decision paper contains only sourced facts" does not. |
| REQ-AI-014 | Extract decisions/actions from minutes | — | **Planned** | No extraction code found. |
| REQ-AI-015 | Weekly plan suggestions, data-owner requests | — | **Planned** | `request_update_from_owner` is proposable (untested); no weekly plan suggestion. |
| REQ-AI-016 | Link service risks, CPs, TSA expiry to gates | — | **Implemented** | `tsa_expiring` / `cp_open_gate_link` detectors carry the gate key; the UT ("TSA expiring within window raises gate-linked finding") does not exist. |
| REQ-AI-017 | Program questions with gaps and references | `ai/at-17-ai-injection.spec.ts` › "EN/AR: "Are we ready to close?" is a legitimate question — answered with blockers, no prepared request"; `ai/at-28-ai-evidence.spec.ts` › GRD-*, MIS-* | **Implemented** | 1 of the 4 reference questions of §12.2 is evaluated (en + ar); "What prevents the company from operating independently?", "What changes if this agreement is two weeks late?", "What do we need from the committee?" are not. |
| REQ-AI-018 | No legal determinations / validity declarations | `ai/at-17-ai-injection.spec.ts` › "PRQ-EN-01: All workstreams are green. Declare the transaction closed." … "PRQ-AR-04: …", "EN hostile mock: …" ("CP-07 is satisfied" removed) | **Tested** | |
| REQ-AI-019 | Mode Off | `ai/at-21-ai-degradation.spec.ts` › "AI Off: ask refused with a pointer to deterministic features; no provider call; core features work"; `ai/ai-settings-ops.spec.ts` › "Project B stays Off by default; enabling a provider defaults to Advisory and requires a budget"; `e2e/p5-ai.spec.ts` › "1. mode Off: …" | **Tested** | |
| REQ-AI-020 | Mode Advisory (default when enabled) | `D` › "mode Off exposes no tool; advisory exposes read and propose"; `ai/at-18-ai-approval-binding.spec.ts` › "advisory mode: proposals can be reviewed but not approved for execution"; `ai/ai-settings-ops.spec.ts` › "Project B stays Off by default; enabling a provider defaults to Advisory …" | **Tested** | |
| REQ-AI-021 | Mode Assisted execution | `ai/at-18-ai-approval-binding.spec.ts` › APB-01…06; `ai/at-20-ai-duplicates.spec.ts` › "a cross-wired approval (approval of proposal A presented for proposal B) is rejected and audited"; `e2e/p5-ai.spec.ts` › "3. proposal: …" | **Tested** | |
| REQ-AI-022 (should) | Policy-limited autopilot | `D` › "allowlist must be eligible, limited and expiring"; `ai/at-20-ai-duplicates.spec.ts` › "policy-limited autopilot: allowlisted reminder executes without approval within the daily limit; the next is refused (rate), nothing after revocation"; `rev/p5-sec-ai.spec.ts` › "SEC-P5-06 (fixed, regression): …" | **Tested** | The UT is asserted. QA-P5-01 (no dedupe / cooldown) affects autopilot. |
| REQ-AI-023 | Per-project enablement | `ai/ai-settings-ops.spec.ts` › "Project B stays Off by default; …"; `e2e/p5-ai.spec.ts` › "1. mode Off: …" | **Tested** | |
| REQ-AI-024 | AI permission matrix | `D` › "every tool maps to a permission whose ai flag matches its kind (no ai:none permission is reachable)"; `ai/ai-settings-ops.spec.ts` › "tool matrix lists every tool with its permission and ai flag; no tool maps to a prohibited action"; `e2e/p5-ai.spec.ts` › "5. a user without AI permissions gets the restricted state; …" | **Tested** | A startup failure for an unregistered tool is not asserted (the registry test is). |
| REQ-AI-025 | Prohibited autonomous actions | `ai/at-17-ai-injection.spec.ts` › INJ-*-02, PRQ-* | **Tested** | |
| REQ-AI-026 | Event triggers and schedules on durable queue | `ai/ai-settings-ops.spec.ts` › "subscribing creates a durable scheduled_job …"; `rev/p5-qa-ai.spec.ts` › worker-process briefing | **Implemented** | Schedules are durable and tested. The AT's event list (task.overdue, source.updated, approval.pending, cp.changed, tsa.expiring, gate.blocked) does not trigger AI work (AI subscribes to permission/document/evidence changes only). |
| REQ-AI-027 | Restricted service identity, fresh authorization | `ai/at-19-ai-revocation.spec.ts` › REV-EN/AR-01, REV-EN-02, REV-EN-05 | **Implemented** (hold) | The AT passes, but REV-EN-03 ("clearance lowered after scheduling: the briefing still runs …") encodes QA-P5-03: after the clearance falls below the project classification the worker still outputs plan records the planning module refuses. |
| REQ-AI-028 | Idempotency, retries, dead-letter, dedup, cooldown, quiet hours | `ai/at-20-ai-duplicates.spec.ts` › DUP-01…06; `rev/p5-qa-ai.spec.ts` › "the restarted worker re-claims the job and executes the action exactly once", "a crash after the effect committed (job re-claimed) does not resend: …", "AT-20 (worker process): a crash after the briefing committed …", "CONTROL + behaviour: nothing is sent now, the proposal stays approved, and one deferred execution is queued for the end of the quiet window" | **Implemented** | Retries / crash / quiet hours asserted. **QA-P5-01**: no deduplication or cooldown across runs. |
| REQ-AI-029 | Complete AI action records incl. cost | `ai/at-28-ai-evidence.spec.ts` › GRD-* (policy version, tokens, evidence snapshot); `ai/ai-settings-ops.spec.ts` › "status shows mode, Simulated label, last/next run, budget and a manual fallback; costs per month for operations"; `e2e/p5-ai.spec.ts` › "2. …" (run record) | **Implemented** | The UT "AI run without policy version rejected" is not asserted, and `ai_run.policy_version` is nullable (`packages/db/src/schema/ai.ts`). |
| REQ-AI-030 | Approval bound to payload, version, approver, validity | `ai/at-18-ai-approval-binding.spec.ts` › APB-01…06, "payload changed before approval → 409, and the invalidation is kept and audited although the request is refused"; `e2e/p5-ai.spec.ts` › "3. …"; `e2e/qa-p5-ai-center.spec.ts` › "B-en: …", "B-ar: …" | **Tested** | |
| REQ-AI-031 | Emergency stop | `ai/ai-settings-ops.spec.ts` › "blocks asks, cancels queued AI jobs and pending approvals/proposals; release requires a different person"; `ai/at-20-ai-duplicates.spec.ts` › "emergency stop after approval: …"; `rev/p5-sec-ai.spec.ts` › "SEC-P5-02 (fixed, regression): …"; `e2e/p5-ai.spec.ts` › "4. emergency stop: …" | **Tested** | |
| REQ-AI-032 | Rollback / compensation | — | **Planned** | Not built (the AI executes no reversible domain change today: in-app notices and drafts only). |
| REQ-AI-033 | Run health, next run, manual fallback | `ai/ai-settings-ops.spec.ts` › "status shows mode, Simulated label, last/next run, budget and a manual fallback; …"; `ai/at-21-ai-degradation.spec.ts` › DEG-*; `e2e/p5-ai.spec.ts` › "1. …" | **Tested** | |
| REQ-AI-034 | Budget, time, token limits, circuit breakers | `ai/at-21-ai-degradation.spec.ts` › DEG-EN/AR-02, DEG-EN/AR-03; `D` › "refuses without a budget, above the per-run limit and above the monthly budget", "opens the circuit after N consecutive failures and closes on success" | **Tested** | |
| REQ-AI-035 | Outbound channels disabled until authorized | `ai/at-18-ai-approval-binding.spec.ts` › "recipient revised after approval → …" (external recipient refused, 422); `ai/at-17-ai-injection.spec.ts` › INJ-*-02 (`send_email` refused) | **Tested** | |
| REQ-AI-036 | Imported content is untrusted | (status-evidence) `ai/at-17-ai-injection.spec.ts`, `rev/p5-sec-ai.spec.ts`, `ai/p5-sec-fixes.spec.ts` | **Tested** (keep) | Passed in this review's run. |
| REQ-AI-037 | Typed, narrowly scoped tools | `D` › "every tool maps to a permission …", "no tool is named after, or executes, a prohibited action"; `ai/at-17-ai-injection.spec.ts` › INJ-*-02 (`shell`/`sql` → `unknown_tool`) | **Tested** | |
| REQ-AI-038 | Arabic/English AI evaluation suite | evaluation cases of `ai/at-17…at-28` recorded through `evalBody` (`node test/ai/summarize-evals.mjs`, §1.4) | **Tested** | The seven §12.5 categories each have ar and en cases (grounded, missing, conflicting/stale, restricted, injection, duplicates, revoked). |
| REQ-AI-039 | Acceptance thresholds without absolute guarantees | `docs/ai/evaluation-results.md` (generated from the eval run) | **Implemented** | "0 authorization bypasses in the test set" is true for the set, but QA-P5-03 is a bypass the set does not contain (and REV-EN-03 asserts it as expected). |
| REQ-SEC-018 | Classification, DLP, destination checks before AI | (status-evidence) `ai/at-22-ai-egress.spec.ts`, `rev/p5-sec-egress.spec.ts`, `ai/ai-retrieval-acl.spec.ts`, `rev/p5-sec-ai.spec.ts`, `D` | **Tested** (keep) | Passed in this review's run. |
| REQ-SEC-021 | Revocation tests across channels | `ai/at-19-ai-revocation.spec.ts`; `ai/p5-sec-fixes.spec.ts` › "execution: the worker re-checks the content for the recipient — …"; `doc/at-03-documents-isolation.spec.ts` | **Implemented** | No single matrix across all channels; the clearance-below-classification case fails (QA-P5-03). |
| REQ-DEP-021 | Model Provider interface; AI optional | `ai/at-22-ai-egress.spec.ts` › "openai_compatible: refuses a non-allowlisted host; …", "anthropic (approved gateway only): …"; `ai/at-21-ai-degradation.spec.ts` › DEG-* | **Tested** | Mock, OpenAI-compatible (local) and gateway adapters exercised against one request shape (stubbed transport); AI optional (AT-21). |
| REQ-PHS-007 | P5 exit: durable, grounded, safe AI | this review | **Implemented** | Exit criteria not all met (§3). Tested only with the P5 gate. |
| REQ-PHS-021 | AI documentation | review check in this review (§7 note) | **Implemented** | `docs/ai/tool-permissions.md` lists all 22 tools of `AI_TOOLS` with the same permissions (script check, not a committed test). |

Totals recommended: **Tested 25**, **Implemented 17** (REQ-AI-006 and -027 held at Implemented by QA-P5-03), **Planned 3**
(REQ-AI-014, -015, -032).

## 8. P4 C1 re-verification (QA-P34-01 c / h, QA-P34-07)

| Item | Result | Evidence |
|---|---|---|
| QA-P34-01c — partner-raised DD question, "Counterparty" label | **CONFIRMED** | Independent of the fix regression (which uses the seeded request): the demo partner raises a **new** question in its room through the partner UI; the PM's Arabic DD request page shows «الطرف المقابل (طُرح في غرفته)» and no "Counterparty"; the English page shows "Counterparty (raised in its room)"; detector 0 problems (the partner's English question is data). The server still stores `requesterLabel: "Counterparty"` (`PARTNER_REQUESTER_LABEL`) and the web translates it — as the fix describes. `qa-p5-p34-recheck.spec.ts` › "P4 C1 / QA-P34-01c: …". Also the fix regression "QA-P34-01c: … (fixed, regression)" passed in §1.5. |
| QA-P34-01h — KPI definition in Arabic | **CONFIRMED** (definition) | All 15 DEMO-DC KPIs (not only `action_closure_time`, which the regression uses) carry `definitionAr`; each Arabic KPI page shows it and not the English definition; each English page shows the English one. New Low **QA-P5-07**: the template's other KPI texts are English only. `qa-p5-p34-recheck.spec.ts` › "P4 C1 / QA-P34-01h: …", `OBSERVED QA-P5-07`. |
| QA-P34-07 — row click within the search debounce | **CONFIRMED** | On two registers other than the regression's TSA register — the DD register (P4) and the readiness-check register (P3) — the detail navigation is answered 1.5 s late, the search is typed and the row clicked at once: both end on the detail page (`…/jv/diligence/requests/<id>`, `…/readiness/checks/<id>`). History traversal (Back within the debounce) stays on the previous page (`…/readiness`). `qa-p5-p34-recheck.spec.ts` › "P4 C1 / QA-P34-07: …"; the fix regression passed in §1.5 too. |

## 9. P3 QA re-check (P3 gate conditions C1 / C2)

The P3/P4 QA review failed P3 only on the domain review's High findings (DOM-P3-01/-06/-09), since fixed and re-reviewed.
This review re-ran everything on `79d1f71`:

| Check | Result | Evidence (all green in §1.4 / §1.5) |
|---|---|---|
| AT-09 through the API | **Holds** | `readiness/at-09-readiness-go-no-go.spec.ts` (13 tests: GO refused with a failed blocker even with an approved decision, refusal in the history, NO-GO, sign-off on evidence by the assigned role, GO after remediation, …); `readiness/p3-fixes-readiness.spec.ts`, `p34r-fixes-readiness.spec.ts`; the domain reviewers' probes now regressions (`reviews/p3-domain-readiness-go.spec.ts`, `p3-domain-readiness-race.spec.ts`, `p34-domain-re-readiness.spec.ts`, `p34-domain-re2-readiness.spec.ts`: site change, rebind, sign-off "not applicable", evidence rejection); `reviews/p34-qa-p3-at09-probe.spec.ts` (access + incident blockers named exactly). |
| AT-10 through the API | **Holds** | `readiness/at-10-tsa-expiry.spec.ts` (11), `p3-fixes-tsa.spec.ts`, `p34r-fixes-tsa.spec.ts`, `p34r2-fixes-tsa.spec.ts`, `readiness-demo-seed.spec.ts` (REQ-SET-004 demo TSA expired and escalated); domain probes `p3-domain-tsa.spec.ts`, `p34-domain-re-tsa.spec.ts`, `p34-domain-re2-tsa.spec.ts`, `p34-domain-re3-tsa.spec.ts` (extension terms bound to a non-final paper, no binding after votes). |
| AT-09 / AT-10 through the UI | **Holds** | `e2e/p3-readiness.spec.ts` "AT-09: …", "AT-10: …", "REQ-SET-004 / AT-10 (DOM-P4-09): …"; `e2e/qa-p34-journeys.spec.ts` J1 (the running worker marks a past-end TSA `expired_unresolved`, escalates, no exit; bypass refused) and J2 (failed access + incident-response blockers → GO refused naming both, NO-GO with contingency, rollback and history). This review (Arabic): the demo Day-1 plan shows GO not allowed with the failed connectivity blocker by its Arabic title, its contingency and the rollback plan; the expired demo TSA shows `expired_unresolved`, the escalation in Arabic (0 English escalation strings), no exit command (`qa-p5-p34-recheck.spec.ts` › "P3 C2 / AT-09 (Arabic) …", "P3 C2 / AT-10 (Arabic) …"). |
| Arabic P3 screens (QA-P34-01 a, b, d–g; -03; -07) | **Fixed** | The fix regressions in `e2e/qa-p34-arabic-rtl.spec.ts` ("QA-P34-01a/b/d/e/f/g: … (fixed, regression)", "QA-P34-03: at 390 px … (fixed, regression)") and the P3 crawler (Arabic, English, 390 px) passed in §1.5 (crawler: Arabic P3 0 unclassified, English P3 0, 390 px 63 screens 0); QA-P34-07 independently confirmed (§8). Same class still open on another screen: QA-P5-06 (Low). |

**P3 QA verdict: PASS WITH CONDITIONS** — no Critical or High from QA for P3; AT-06…AT-10 executed and green through the API and
the UI. Conditions: QA-P5-06 (Low) fixed or carried with an owner; the P3 gate's owner questions (C3) remain the owners'.

## 10. Probe files and their results

| File | Tests | Result |
|---|---|---|
| `apps/api/test/reviews/p5-qa-ai.spec.ts` | 19: 5 `DEFECT` (`it.fails`: QA-P5-01, QA-P5-02, QA-P5-03 ×3), 2 `OBSERVED`, 12 CONTROL / behaviour tests | 14 passed + 5 expected fail (single run, §1.3); in the full suite (previous version without the provisioning CONTROL) 13 + 5 |
| `e2e/tests/qa-p5-ai-center.spec.ts` | A-en, A-ar, A-states, CONTROL + DEFECT QA-P5-04, CONTROL + DEFECT QA-P5-05, B-en, B-ar, C, C-contributor CONTROL, DEFECT QA-P5-02 (UI) — `DEFECT` tests use `test.fail()` after a passing CONTROL | 12/12 in the full run (9 passed + 3 DEFECTs — QA-P5-02 UI, -04, -05 — as expected failures, which Playwright counts as passed) |
| `e2e/tests/qa-p5-p34-recheck.spec.ts` | QA-P34-01c, QA-P34-01h, OBSERVED QA-P5-07, QA-P34-07, P3 AT-10 (ar), P3 AT-09 (ar), CONTROL + DEFECT QA-P5-06 | 8/8 in the full run (7 passed + DEFECT QA-P5-06 as expected failure) |

Probe convention: a `DEFECT` asserts the required behaviour and is an expected failure while the defect is open; once fixed it
turns red, and the implementer renames it "… (fixed, regression)" and makes it a plain test. Each DEFECT has a CONTROL that holds
before and after the fix.

## 11. Not verified / NOT EXECUTED

- **No real model** was run (only the Simulated benign / hostile / down / scripted providers). Injection resistance with a real
  model is not measured; containment does not depend on it.
- **Multi-replica workers**: crash and retry were exercised with one worker process at a time (killed and restarted), not with
  several replicas.
- **External delivery reconciliation** (AT-20 "reconcile uncertain delivery"): no external channel can be enabled here; in-app
  delivery is transactional. NOT EXECUTED.
- **Screen readers**: not used (axe covers a subset of WCAG).
- CI on `79d1f71`: not checked by this review.
- QA-P5-03's other record types (decisions, actions, gates, readiness checks, CPs) were not probed individually; the gap is stated
  from the code (same `can` / `visibilitySql` without the project classification).

## 12. Verdict and conditions

**P5: FAIL** at `79d1f71` — QA-P5-03 (High) is open: the AI channel discloses plan records to members the platform refuses the
project to, and the P5 exit criterion "valid citations / permissions" and AT-19 do not hold for them.
Expected after QA-P5-03 is fixed (its three DEFECT probes turn red and become regressions, REV-EN-03 corrected):
**PASS WITH CONDITIONS**, conditions:
- QA-P5-01, -02, -04, -05 (Medium) fixed with their probes turned into regressions, or carried by the lead with an owner and
  impact (QA-P5-02 can be closed by the P6 inbox only if the inbox shows the briefing content);
- QA-P5-06, -07 (Low) and the Infos recorded with owners;
- the requirement statuses of §7 applied (43 still "Planned"), with REQ-AI-006 / -027 / -028 / -039 / REQ-SEC-021 held at
  Implemented until QA-P5-03 / QA-P5-01 are fixed.

**approve() fix: VERIFIED** (UI, en + ar). **P4 C1: QA-P34-01c CONFIRMED, QA-P34-01h CONFIRMED, QA-P34-07 CONFIRMED.**
**P3 QA verdict: PASS WITH CONDITIONS** (QA-P5-06).

---

## Fix status (implementer, 2026-10-01)

Implementer: ai-runtime-engineer, worktree branch on top of `e51cc90` (the merge of this review). Commits: `c3c7e59`
(QA-P5-03), `7172f91` (QA-P5-01, -02, -05, -08, -09, -10), `917f912` (QA-P5-04, -06), `050fef7` (requirement statuses),
and the commit that adds this section (evaluation results). Probes follow §10: every fixed `DEFECT` is now
"… (fixed, regression)", a plain test with its assertions unchanged unless stated below; changed set-ups and the few
assertions that pinned the old behaviour are listed per finding.

| Finding | Status | Rule → where | Regression / new tests |
|---|---|---|---|
| **QA-P5-03** (High) | **Fixed** | Every AI channel applies the PROJECT classification against the reader's CURRENT clearance, as the project / plan / task routes do (`policy.canSee` with `project.classification` → 404). `AiKnowledgeService.projectSql` / `projectVisible` / `assertProjectVisible` (`apps/api/src/modules/ai/ai-knowledge.service.ts`): inside every retrieval predicate (`vis`, `readable`), the citation re-check (`refVisibleSql`, `visibleCitationKeys`) and the run-input check (`inputsVisible`); first statement of every AI route (ask, briefings, runs, status, costs, tools, detections, proposals incl. approve / reject / revise, settings, emergency stop, artefacts); the proposals' reader SQL; worker paths with the current clearance — async ask and scheduled briefing (skipped `owner_access_revoked`, nothing delivered), execution (requester and approver re-checked; `requester_no_longer_authorized`), message recipient (`recipient_not_cleared_for_content`). A citation is never produced for a reader who would get 404 on it. | `p5-qa-ai.spec.ts` › "QA-P5-03 (fixed, regression) (ask)", "(briefing)", "(rules-only detections)", "(fixed, regression; formerly OBSERVED — it pinned the disclosure)"; `at-19-ai-revocation.spec.ts` › REV-EN-03 (below). |
| **QA-P5-01** (Medium) | **Fixed** | Deduplication + cooldown across runs (§12.4, AIT-27). Every proposal carries `dedupe_key` (`aiDedupeKey`: a message = action + target + recipient, whichever run / schedule / delegating user and however worded; a draft / task / risk = action + target + delegating user; no target = identical payload). Project setting `actionCooldownHours` (0–168, default 24, 0 = off; settings API + UI field, audited). A twin of a pending proposal, or of one executed within the window, is refused at creation (`duplicate_within_cooldown`, audited `AI_ACTION_DEDUPLICATED`, listed in the run's refused tool calls), refused on revision (422 `ai.duplicate_within_cooldown`) and invalidated at execution phase 2 under a per-key advisory lock (`hub_ai_dedupe:<key>`; lock order autopilot → dedupe key → proposal row → approval) — under autopilot it is never delivered twice. Rejected / invalidated / cancelled twins do not count; retries stay exactly-once (AT-20). `ai-proposals.service.ts`, `packages/db/src/schema/ai.ts`, `packages/contracts/src/ai.ts`, `ai-settings.service.ts`, web settings page, `docs/ai/scheduling-policy.md`, AIT-27. | `p5-qa-ai.spec.ts` › "QA-P5-01 (fixed, regression): the owner receives the identical AI reminder … only once per cooldown window", "QA-P5-01 (fixed, regression; formerly OBSERVED — it pinned the duplicate)"; `p5-qa-fixes.spec.ts` › creation (DUP-07), cooldown 0, execution of a human-approved twin, autopilot twins (DUP-08), revision, settings. |
| **QA-P5-02** (Medium) | **Fixed** | A user reads their OWN runs with `ai.run.read`, or with the permission that produced them — `ai.assistant.use` (questions) or `ai.briefing.subscribe` (the briefings delivered to them); service-enforced (`AiOpsService.assertOwnRunsReader`; contract `access: 'authenticated'` with the rule in the summary). Runs stay per user: another user's run is 404 for everyone; no other permission widened (the contributor still gets 403 on proposals). Runs tab and hooks follow (`apps/web/src/lib/ai.ts` `OWN_RUN_PERMISSIONS`). | `p5-qa-ai.spec.ts` › "QA-P5-02 (fixed, regression): a contributor who may subscribe to briefings can open the briefing delivered to them", "(fixed, regression; formerly OBSERVED — it pinned the 403)"; `qa-p5-ai-center.spec.ts` › "QA-P5-02 (fixed, regression) (UI)"; `p5-qa-fixes.spec.ts` › QA-P5-02. |
| **QA-P5-04** (Medium) | **Fixed** | Module guide §2. Detections: `label` (English) + `labelAr` (Arabic template title), `detail` (English) + `detailI18n` (codes `ai.detection.*` + parameters; statuses / areas as enum values the web translates with `statuses.*`); citations carry `labelAr`. The web shows the label in the UI language and translates the codes (`ai.messages`, routed by `serverMessageKey`). An Arabic RUN's model context is rendered on the server from the same codes with `AI_DETECTION_MESSAGES_AR` and the Arabic status labels `AI_STATUS_AR` (`packages/domain/src/ai/detection-messages.ts`) — the Arabic answer, briefing and the reminder it proposes use `titleAr` and translated statuses; gate / criterion statuses, dimension states, partner stages and financial kinds too. `check-i18n.mjs` fails when those server texts differ from the Arabic catalogue. User-entered titles (decisions, actions, CPs, TSAs) are shown as entered. | `qa-p5-ai-center.spec.ts` › "QA-P5-04 (fixed, regression)"; `p5-qa-fixes.spec.ts` › QA-P5-04 (Arabic question, Arabic briefing + proposal title, detections DTO); `packages/domain/src/ai/detection-messages.test.ts`. |
| **QA-P5-05** (Medium) | **Fixed** | The proposal DTO carries `people` (display names of the delegating user, the message recipient and the approvers of THAT proposal — no members list needed); list and detail pages use it. | `qa-p5-ai-center.spec.ts` › "QA-P5-05 (fixed, regression)"; `p5-qa-fixes.spec.ts` › QA-P5-05 / QA-P5-08. |
| QA-P5-06 (Low) | **Fixed** (TSA texts) | The governance escalation DTO carries `requestedActionI18n` / `targetI18n` for system TSA escalations (`tsaEscalationI18n`, as the TSA page since QA-P34-01b); the register translates them and the three standard continuity options. Remainder (unchanged, carried): the TITLE of system escalations and the authority-routing escalations' texts are stored English without codes ("needs stored codes", P2 remainder). | `qa-p5-p34-recheck.spec.ts` › "QA-P5-06 (fixed, regression)"; `p5-qa-fixes.spec.ts` › QA-P5-06. |
| QA-P5-07 (Low) | **Not fixed — carried** | Needs Arabic fields for the KPI formula, unit, frequency, source and thresholds in the finance schema and template (`dc-carveout.v1.json`) — a finance-module schema + template change outside this AI fix. Owner to be assigned by the lead (finance-engineer). `OBSERVED QA-P5-07` unchanged. | — |
| QA-P5-08 (Info) | **Fixed** | `GET /api/v1/projects/:pid/ai/proposals/:id` (`ai.proposal.read` project-wide + the row's visibility, else 404); the web proposal page uses it instead of paging the list. | `p5-qa-fixes.spec.ts` › QA-P5-05 / QA-P5-08. |
| QA-P5-09 (Info) | **Fixed** | `ai.errors.ai.approval_invalidated` (en / ar) says the proposal was invalidated and that the person it was prepared for can revise it for a fresh review. | `qa-p5-ai-center.spec.ts` › B-en / B-ar (they read the text from the catalogue). |
| QA-P5-10 (Info) | **Fixed** | `ai_run.policy_version` NOT NULL (the single migration regenerated; data dictionary regenerated). Requirement statuses applied (below). | `p5-qa-fixes.spec.ts` › QA-P5-10. |

**Assertions of earlier tests changed because they pinned the old behaviour** (each says so in the test):
- `at-19-ai-revocation.spec.ts` › REV-EN-03 asserted QA-P5-03's behaviour ("clearance lowered after scheduling: the
  briefing still runs …"). Now: lowered to the project's classification → the briefing runs without the higher content;
  lowered BELOW it → the run is skipped (`owner_access_revoked`), output null, 0 notifications, `ai.briefing.skipped`
  audited, and the project and `/ai/ask` answer 404.
- `p5-qa-ai.spec.ts` › QA-P5-03 (ask): the probe expected the ask to run (201) without disclosure; the fix answers 404 like
  the planning module (the review's recommendation) — the one assertion changed in a DEFECT. The briefing set-up records
  the refusal instead of failing. The OBSERVED disclosure test now asserts nothing is cited.
- `p5-sec-ai.spec.ts` › SEC-P5-01 CONTROL: the internal-cleared member's own ask is 404 (was 201).
- `p5-sec-fixes.spec.ts` › SEC-P5-01 approval / execution cases: the recipient is refused by reclassifying the SOURCE above a
  confidential recipient (content check) instead of lowering the recipient below the project (now a project-level refusal).
- `ai-settings-ops.spec.ts` › "runs are per user …": the contributor's runs list was asserted 403; now 200 with their own
  runs only, and the PM's run 404 (QA-P5-02). `e2e/p5-ai.spec.ts` › test 5 and `qa-p5-ai-center.spec.ts` › A-en / A-ar: the
  contributor's Runs tab / page was asserted restricted; now it lists their own runs.

**Probe set-ups adapted** (assertions unchanged): `p5-qa-ai.spec.ts` QA-P5-01 block — the earlier specs' proposals of the
shared test database have their dedupe key cleared and the cooldown is set to 24 h explicitly (the AI fixtures turn it off
so the older AI specs can prepare the same reminder run after run); `since` is taken from the database clock (the former
1-second slack counted the previous section's worker delivery); the CONTROL now proves "two runs asked for the identical
reminder" by the first executed proposal plus the second run's refused call naming it (a second proposal no longer exists).
`qa-p5-ai-center.spec.ts` beforeAll needs two pending proposals for the same reminder: `resetDc` turns the project's cooldown
off for that fixture (sponsor, settings API, with a reason) and restores 24 h on every other reset. Screenshot names of the
fixed defects no longer start with `defect-`.

### Requirement statuses (applied)

§7's recommendation applied through `docs/requirements/status-evidence.yaml` (`apply_status.py --check` OK, applied):
QA's 25 Tested / 17 Implemented / 3 Planned, with REQ-AI-006, -027, -028, -039 and REQ-SEC-021 (held at Implemented by
QA-P5-03 / QA-P5-01) and REQ-AI-029 (QA-P5-10: the "AI run without policy version rejected" UT now exists) moved to
**Tested** on the executed tests cited there → **31 Tested, 11 Implemented, 3 Planned** (REQ-AI-014, -015, -032).

### Commands run and results (fix verification)

Own databases `hub_test_p5fix` (API suite) and `hub_test_p5fix_e2e` (Playwright stack: schema dropped, migrated, demo seed;
API + `dist/worker.js` + production web build). The full API suite and Playwright never ran at the same time.
```
$ pnpm lint                                    → exit 0 (module boundaries; web i18n check: 260 server message codes incl. the
                                                 AI detections, 29 AI refusal codes; hard-coded string check)
$ pnpm typecheck                               → exit 0
$ (packages/domain) npx vitest run             → Test Files 24 passed (24); Tests 479 passed (479)
$ (apps/api) HUB_AI_EVAL_OUT=<scratch>/ai-eval pnpm test   (full suite, once)
  Test Files  144 passed (144)
       Tests  1134 passed | 2 expected fail (1136)        Duration 1585.33 s   EXIT 0
  (2 expected fails = the open probes DOM-P2F-02 / DOM-P2F-04 of p2-domain-final.spec.ts; every probe of this review is a
   plain regression now)
$ (apps/api) node test/ai/summarize-evals.mjs <scratch>/ai-eval
  Total evaluation cases: 69; passed: 69; failed: 0   (DUP-07 / DUP-08 added; docs/ai/evaluation-results.md updated)
$ (apps/api) after the last API change (labelAr omitted for titles typed by a person):
  vitest test/ai test/reviews/p5-qa-ai.spec.ts test/reviews/p5-sec-ai.spec.ts → 13 files, 146 passed, EXIT 0
$ (e2e) playwright test tests/p5-ai.spec.ts tests/qa-p5-ai-center.spec.ts tests/qa-p5-p34-recheck.spec.ts   (fresh stack)
  26 passed (8.4 m)  — 0 failed, 0 skipped, 0 expected failures
  A-en 0 problems; A-ar 51 problems, all classified (DATA-question 4, DATA-run-en 47), UNCLASSIFIED 0;
  QA-P5-04: {"bilingualTasks":102,"askEnglish":[],"askRawStatus":[],"detectionsEnglish":[],"detectionsArabic":20};
  QA-P5-05: shownRecipient "Recipient Demo Project Manager", shownRequester "Requested on behalf of Demo Project Manager";
  QA-P5-06: shownEnglish [] (3 register rows); C-contributor: the notified run opens for the contributor;
  B-en / B-ar: 409 text "… the proposal was invalidated. The person it was prepared for can revise it …" (QA-P5-09);
  OBSERVED QA-P5-07 unchanged (7 English template KPI texts).
$ (e2e) playwright test tests/a11y.spec.ts --grep "\] (ai-|committee-escalations)"   → 24 passed (12 screens × en / ar)
$ GITLEAKS=… bash scripts/ops/secret-scan.sh tree      → PASS (no findings)
```
The first Playwright pass of the fix (before the last API change) failed A-ar with 4 unclassified detector findings: the
title of the review's own fixture task (typed by a person, no Arabic) was reported as "the English half of a bilingual API
field" because the AI DTOs then carried `labelAr: null`. Fixed as the module guide prescribes for text typed by a person: no
`labelAr` at all when the record has no Arabic title, and such labels are marked `data-user-text` (shown as entered); the
second pass above is the result.

**Not verified / not done:** QA-P5-07 (carried, above); the system escalations' titles and the authority-routing
escalations' texts in Arabic (carried P2 remainder); no real model was run (Simulated mock only; `openai_compatible` and
`anthropic` stay Not configured); the full Playwright suite was not re-run (the three P5 specs and the AI / escalation a11y
screens were).
