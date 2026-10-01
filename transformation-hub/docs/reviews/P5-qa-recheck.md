# P5 (Proactive AI PM) — independent QA RE-CHECK of the P5 QA fixes

| Item | Value |
|---|---|
| Reviewer | `qa-test-engineer`, independent re-check in its own context (REVIEW mode). The reviewer wrote none of the code under review and changed no implementation file, existing test, migration or seed. |
| Revision reviewed | **`598f25a`** (head of `origin/claude/mobily-transformation-hub`; `git fetch` + `git merge` → "Already up to date"), frozen for the whole re-check. Every result below is at `598f25a` plus this re-check's files. |
| Reviewed against | `docs/reviews/P5-qa-review.md` (FAIL at `79d1f71`) and its "Fix status" section (fix commits `c3c7e59`, `7172f91`, `917f912`, `050fef7`, `d63f171`). |
| Files added | `apps/api/test/reviews/p5-qar-roles.spec.ts`, `p5-qar-access.spec.ts`, `p5-qar-dedupe.spec.ts`, `p5-qar-arabic.spec.ts`, `p5-qar-assertions.spec.ts`; `e2e/tests/qa-p5r-ai-center.spec.ts`; this report. Screenshots were written to the scratchpad (`QA_P5R_SHOTS`), not committed. |
| Databases | Own: `hub_test_p5qar` (API runs), `hub_test_p5qar_boot`, `hub_test_p5qar_e2e` (e2e stack), created with `HUB_DATABASES="hub_test_p5qar hub_test_p5qar_boot hub_test_p5qar_e2e" bash scripts/dev/pg-init-roles.sh`. No other database was touched. |
| E2E stack | As the CI e2e job, own ports: schema dropped, `node deploy/docker/api-entrypoint.cjs migrate` + `node apps/api/dist/cli/seed-demo.js` on `hub_test_p5qar_e2e`; API `dist/main.js` on **:4490** (`HUB_RATE_LIMIT_PUBLIC_PER_MINUTE=1000`), worker `dist/worker.js`, production web build (`HUB_API_URL=http://127.0.0.1:4490`) served by `next start -p 3490`. Started and stopped by PID by this re-check only. |
| Provider | Only the Simulated mock provider exists here (`openai_compatible` / `anthropic` **Not configured**, never contacted). |
| **Verdict P5 (QA)** | **PASS WITH CONDITIONS** at `598f25a` — see §12. QA-P5-03 (the High) is fixed and holds through 21 API routes, the worker paths and the UI in both languages; QA-P5-01, -02, -04, -05, -06 (TSA part), -08, -09, -10 are confirmed fixed. No Critical or High is open. New: one Medium (QA-P5R-03, Arabic question routing parity), two Lows (QA-P5R-01 raw entity type in the Arabic conflict note; QA-P5R-02 the new deduplication refusal is shown in English on Arabic runs) and four Infos. QA-P5-07 is unchanged (carried to P6). |

Severity scale (as in the P2–P5 QA reviews): **High** = a mandatory rule, an acceptance criterion or an exit criterion can be
bypassed through the API; **Medium** = a mandatory requirement missing or partly met; **Low** = precision, documentation or
hardening gap; **Info** = observation.

---

## 1. Commands run and real results

All commands ran in `transformation-hub/` of the review worktree. Every vitest run used
`TEST_DATABASE_URL=postgres://hub_app:…@127.0.0.1:5432/hub_test_p5qar` and
`TEST_DATABASE_MIGRATION_URL=postgres://hub_owner:…@127.0.0.1:5432/hub_test_p5qar`.

### 1.1 Environment
```
$ git fetch origin claude/mobily-transformation-hub && git merge origin/claude/mobily-transformation-hub → Already up to date.
$ git rev-parse HEAD                                    → 598f25a735c078cb8814c4122ffed1ee4735010f
$ pg_isready -h 127.0.0.1 -p 5432                      → accepting connections
$ HUB_DATABASES="hub_test_p5qar hub_test_p5qar_boot hub_test_p5qar_e2e" bash scripts/dev/pg-init-roles.sh → databases ready
$ pnpm install --frozen-lockfile --prefer-offline        → Done in 3.3s;  pnpm build:packages → exit 0
$ (apps/api) npx tsc -p tsconfig.build.json              → exit 0
$ (e2e) npx tsc --noEmit                                  → exit 0 (with this re-check's spec)
$ free -g before each full run → 11–13 GB available; one other agent's full API suite was running at the time of the
  full API run (never more than two full suites at once); the full Playwright run was started after the full API run ended.
```

### 1.2 Baseline (delivered AI specs + the P5 review probes, before any new probe)
```
$ (apps/api) npx vitest run test/ai test/reviews/p5-qa-ai.spec.ts test/reviews/p5-sec-ai.spec.ts test/reviews/p5-sec-egress.spec.ts
  Test Files  14 passed (14)
       Tests  150 passed (150)        Duration 136.83s        EXIT 0
```

### 1.3 Light checks
```
$ (apps/api) npx tsc -p tsconfig.json --noEmit (src + tests incl. this re-check's probes) → exit 0;
  node scripts/check-module-boundaries.mjs → passed (the api "lint" script);  (e2e) npx tsc --noEmit → exit 0 (the e2e "lint")
$ (packages/domain) npx vitest run                 → Test Files 24 passed (24); Tests 479 passed (479)
$ node apps/web/scripts/check-i18n.mjs              → i18n check passed: 19 namespaces, 7049 keys per language, 615 enum values
                                                      translated in en and ar, 260 server message codes (… AI detections), 29 AI
                                                      refusal codes, …
$ python3 scripts/requirements/apply_status.py --check → status-evidence.yaml OK (308 entries)
$ (register) P5 requirements: 45 → Tested 31, Implemented 11, Planned 3   (as the fix states)
$ git diff --stat 79d1f71 598f25a -- packages/db/seed/templates/dc-carveout.v1.json …/finance/kpis/[kpiId]/page.tsx
  packages/db/src/schema/finance.ts                 → no change (QA-P5-07 sources untouched)
```

### 1.4 This re-check's API probes (final versions, single-file runs; ids shortened)
```
$ (apps/api) npx vitest run test/reviews/p5-qar-roles.spec.ts --reporter=verbose
  Tests 6 passed (6)
  P5-QAR roles: worker exit 0; 6 subscribers (contributor en, workstream lead+contributor ar, committee chair en, functional
    approver ar, finance en, legal ar) → subscribe 201 each; one scheduled run each {succeeded, scheduled, locale en/ar}; one
    in-app notification each linking /projects/…/ai/runs/<run>; GET run 200, listed in "my runs", other subscriber's run 404;
    12 claims and 12 task citations each, every citation GET …/tasks/:id → 200; Arabic runs: English template titles [],
    raw enum values []; workstream-ONLY lead: subscribe 403 policy.forbidden, /me lists ai.briefing.subscribe, runs list 200
$ (apps/api) npx vitest run test/reviews/p5-qar-access.spec.ts --reporter=verbose
  Tests 12 passed (12)
  P5-QAR route matrix: projectStatus {low 404, ctl 200}; killSwitchAfterLow false;
    low (sponsor+auditor+PM roles, clearance internal): all 21 AI routes → 404 (incl. GET runs/:own, created while cleared);
    ctl (same roles, confidential): settings 200, PUT settings 200, autopilot approve 409 / revoke 409, killswitch activate 201,
    release 403 (not_self), ask 422 (stop active), runs 200, runs/:own 200, status / costs / detections / tools 200, proposals
    200, proposals/:id 200, approve 409, reject 409, revise 403, briefings 200 / POST 201, artifacts 200 → no 404
  P5-QAR worker paths: async ask {queued → skipped requester_access_revoked, output null}; requester below the project
    {invalidated requester_no_longer_authorized, 0 notifications}; approver below the project {invalidated
    approver_no_longer_authorized, 0}; recipient below the project {invalidated recipient_not_cleared_for_content, 0, 0 to the
    recipient}; deactivated user (admin API 201) {async ask skipped requester_access_revoked, briefing skipped
    owner_access_revoked, no output, 0 notifications, session 401}
  P5-QAR citations: PM and functional approver, 8 questions × en/ar: every citation of every answer opens for the asker
    (bad = 0 everywhere; types task, gate_definition, closing_condition, readiness_check, document); restricted memo never shown
  P5-QAR proposal by id: run inputs [restricted, confidential, internal]; PM by id 404, not listed; secretary 200; sponsor 200;
    other project's path 404; malformed id 400
$ (apps/api) npx vitest run test/reviews/p5-qar-dedupe.spec.ts --reporter=verbose
  Tests 10 passed (10)
$ (apps/api) npx vitest run test/reviews/p5-qar-arabic.spec.ts --reporter=verbose
  Tests 4 passed | 3 expected fail (7)
  P5-QAR Arabic routing parity: {"enGates":7,"arGates":0,"enConditions":4,"arConditions":0,"arGateSingular":7}
  refused (Arabic briefing 2): "duplicate_within_cooldown: the same action for the same target and recipient is already
    awaiting review or execution (proposal 01a0f86b-…)"
  conflicts (Arabic): "الدليل من «AI-EVAL cooling capacity assessment 2026 (synthetic)» مسجّل كمتعارض بالنسبة إلى task؛ …"
$ (apps/api) npx vitest run test/reviews/p5-qar-assertions.spec.ts test/reviews/p5-qar-access.spec.ts
  Tests 14 passed (14)   (the access file was re-run here before the deactivation case was added)
  REV-EN-03 (a) measurement: contributor briefing items {"task/internal":21,"milestone/internal":11,"workstream/internal":8};
    sponsor briefing items identical (no item above internal)
  SEC-P5-01 isolation: no-content message → internal-cleared member refused "recipient_not_cleared_for_content …";
    confidential member → created
```
Earlier iterations of these files (not counted): the citation check first looked gates up in `GET …/gates?pageSize=100`
(400 — the gates list takes no paging) and was corrected to `GET …/gates/:id`; the Arabic raw-enum scan first counted record
codes such as `backup_recovery-restore_verified` (identifiers, not statuses) and was narrowed to stand-alone values.

### 1.5 Full API suite (once, own database)
```
$ (apps/api) TEST_DATABASE_URL=…/hub_test_p5qar TEST_DATABASE_MIGRATION_URL=…/hub_test_p5qar HUB_AI_EVAL_OUT=<scratch>/ai-eval-full pnpm test
  START 2026-10-01T17:19:47Z
  Test Files  1 failed | 148 passed (149)
       Tests  1 failed | 1168 passed | 5 expected fail (1174)
    Duration  1768.53s                                   EXIT 1      END 2026-10-01T17:49:46Z
  ❯ test/reviews/p5-qar-dedupe.spec.ts (10 tests | 1 failed)
      × every change is audited with before / after; the default is 24 h (schema and an untouched project)
  P5-QAR cooldown setting: {…, "genDefault":{"status":200,"value":0}, "column":{"column_default":"24","is_nullable":"NO"}}
$ (apps/api) node test/ai/summarize-evals.mjs <scratch>/ai-eval-full → Total evaluation cases: 69; passed: 69; failed: 0
```
- **The one failure is this re-check's own probe, not the product.** Its "untouched project" was Project B, but
  `at-28-ai-evidence.spec.ts` (which runs earlier in the full suite) resets Project B's AI settings row through the test
  fixture `setAi`, whose default turns deduplication off (`action_cooldown_hours: 0`, documented in `ai-fixtures.ts`). In the
  single-file run Project B was untouched and the assertion passed. The probe now reads a project whose settings row was never
  written (version 1). Re-run in the order that failed:
  ```
  $ (apps/api) npx vitest run test/ai/at-28-ai-evidence.spec.ts test/reviews/p5-qar-dedupe.spec.ts
    Test Files  2 passed (2)        Tests  24 passed (24)        EXIT 0
  ```
- **Expected fails (5)** = the two open probes DOM-P2F-02 / DOM-P2F-04 of `p2-domain-final.spec.ts` + this re-check's three
  `DEFECT QA-P5R-01/-02/-03` probes. Every earlier P5 probe (security and QA) ran as a plain regression and passed.
- The delivered suite alone: 1174 − 38 (this re-check's five files) = 1136 = the implementer's count (1134 + 2), all green.

### 1.6 E2E: this re-check's spec alone, then the full Playwright suite once
Stack (header) on a fresh `hub_test_p5qar_e2e`; `PLAYWRIGHT_BROWSERS_PATH=/opt/pw-browsers`, `HUB_WEB_URL=http://127.0.0.1:3490`,
`QA_P5R_DB_OWNER_URL` / `QA_P5_DB_OWNER_URL` / `QA_P34_DB_OWNER_URL` = owner URL of `hub_test_p5qar_e2e`.

Single-file runs of `e2e/tests/qa-p5r-ai-center.spec.ts` while it was written (each line is a real run):
```
run 1 (all 12): R1 ✓ (1.9m), R2 ✓ (27.6s), R3 CONTROL ✘ — the conflict fixture of the API specs does not exist in the e2e
       seed (no conflict note) → the spec now creates conflicting evidence through the documents API; rest not run (serial)
run 2 (R3–R8): R3 CONTROL ✓ (50.1s), R3 QA-P5-04 ✓, DEFECT QA-P5R-01 / -02 / -03 (UI) = expected failures, R4 ✘ — the probe
       counted the page's own route prefetch (`…/ai/proposals?_rsc=…`) as a list request → narrowed to /api/v1 requests
run 3 (R4–R8): R4 ✓ (16.4s); R5 ✘ (timeout) — the probe clicked "Review" with 169 in the field; the button is disabled for an
       out-of-range value (the value is not in the change set) → the probe now asserts the disabled button and the 0–168 hint
run 4 (R5–R8): 4 passed (36.7s)  EXIT 0
  R1: 6 roles × {claims 12, citations opened 3}; R1 problems (0)
  R3: {"englishTitles":[],"conflict":"تعارضات الدليل من «QA P5R … survey A (synthetic)» مسجّل كمتعارض بالنسبة إلى task؛ …",
       "refused":"propose_internal_notification duplicate_within_cooldown: the same action for the same target and recipient is
       already awaiting review or execution (proposal 01a0f878-…)","gatesPlural":0,"gatesSingular":7,"askProblems":[]}
  R4: en {recipient "Recipient Demo Project Manager", requests ["/api/v1/projects/…/ai/proposals/01a0f878-…"]},
      ar {recipient "المستلم Demo Project Manager", requester "بالنيابة عن Demo Project Manager", same single request}
  R5: saved {"en":12,"ar":6}; problems []   (reset to 24 afterwards)
  R6: TSA action «بلغت اتفاقية الخدمات الانتقالية TSA-002 … وهذا ليس خروجاً. …», target «DC Carve-out & JV Steering Committee
      (Demo) — ضمن صلاحياتها المفوَّضة …»; detector problems 9, all in ESC-001 / ESC-002 (authority routing, carried remainder)
  R7: contributor runs page: own run listed true; PM run listed false
  R8: tabs [Overview, Ask, Proposals, Runs, Briefings & detections]; requests [GET briefings 403, POST briefings 403, POST ask 403]
  axe: 0 serious/critical on every screen and dialog checked (R1 ×6, R4 ×2, R5 ×4, R6)
```

**Full Playwright suite, once** (stack restarted on a freshly dropped / migrated / seeded `hub_test_p5qar_e2e`, started after the
full API run had ended):
```
$ (e2e) npx playwright test --reporter=list          START 2026-10-01T17:50:41Z   END 2026-10-01T19:03:25Z
  1 failed
    [chromium] › tests/qa-p5r-ai-center.spec.ts:443:7 › … › R4 QA-P5-08 / QA-P5-05 (UI) …
  4 did not run
  443 passed (1.2h)                                   EXIT 1
  Per file: a11y 308, p1-closure 1, p1-smoke 6, p2-cockpit 4, p2-documents 4, p2-gates 5, p2-governance 1, p2-planning 3,
  p2-residuals 10, p2-web-followups 4, p2r-governance-my-work 2, p3-carveout 5, p3-readiness 3, p34-sec-not-required 1,
  p4-finance 7, p4-jv 4, p5-ai 6, qa-p1-review 5, qa-p1r-arabic-rtl 3, qa-p2-arabic-rtl 6, qa-p2-exit-journey 1,
  qa-p2-final-authority-ui 2, qa-p2-gate-review-journey 1, qa-p34-arabic-rtl 14, qa-p34-journeys 6, qa-p34-states 4,
  qa-p5-ai-center 12, qa-p5-p34-recheck 8 — all passed; qa-p5r-ai-center: R1, R2, R3, R3 QA-P5-04 passed, the three DEFECT
  (UI) tests failed as expected (counted as passed), R4 failed, R5–R8 did not run (serial file).
  Printed evidence (selection): A-en 0 problems; A-ar 51 problems, all classified (DATA-question 4, DATA-run-en 47),
  UNCLASSIFIED 0; QA-P5-04 {"bilingualTasks":104,"askEnglish":[],"askRawStatus":[],"detectionsEnglish":[],"detectionsArabic":20};
  QA-P5-05 shownRecipient "Recipient Demo Project Manager"; B-en / B-ar: the new 409 text (QA-P5-09) shown, proposal invalidated,
  pending 2 → 1; C: browser contexts 0, 12 cited claims, first citation opened; C-ar 47 problems, all DATA-run-en; QA-P5-07: 7
  English template KPI texts (unchanged); R1: 6 roles, problems 0; R2: 16 screens restricted, no title leaked; R3: conflict
  "… بالنسبة إلى task …", refused "propose_internal_notification duplicate_within_cooldown: …", gatesPlural 0, gatesSingular 7.
```
- **Delivered tests: 448 − 12 (this re-check's file) = 436, all passed** — 0 failed, 0 skipped, 0 flaky, retries 0; every former
  `test.fail()` DEFECT of the P5 QA review now runs as a plain regression and passed.
- **The one failure is this re-check's own probe.** R4 picked the first message proposal the Secretary can read; after the
  earlier QA specs that is a proposal the Secretary requested herself, and the page correctly names her "You" ("Requested on
  behalf of You") instead of her display name. The probe now picks a proposal prepared for someone else. Re-run of R4–R8 on the
  same database state, right after the full run:
  ```
  $ (e2e) npx playwright test tests/qa-p5r-ai-center.spec.ts --grep "R4|R5|R6|R7|R8"
    5 passed (49.3s)        EXIT 0
    R4: en {recipient "Recipient Demo Project Manager", requester "Requested on behalf of Demo Project Manager", one request
        /api/v1/projects/…/ai/proposals/01a0f8d0-…}; ar {«المستلم Demo Project Manager», «بالنيابة عن Demo Project Manager»};
        problems []
    R5: saved {"en":12,"ar":6}; problems []      R7: own run listed true, PM run listed false
    R6: every system TSA escalation text Arabic (TSA-002, TSA-003, TSA-004 by then); detector 20 problems, all in
        authority-routing escalations (0 mention a TSA) — the carried remainder
    R8: requests [GET briefings 403, POST briefings 403, POST ask 403]
  ```
- The stack was stopped by PID afterwards (`kill <api> <worker> <web>`; ports 4490 / 3490 free). The tracked screenshots the
  earlier specs regenerate were restored (`git checkout -- e2e/screenshots`) and the untracked ones they wrote removed
  (`git clean -fd -- e2e/screenshots`); this re-check's own screenshots stayed in the scratchpad.

### 1.7 Secret scan
```
$ gitleaks dir <scratch copy of the 7 new files> --config scripts/ops/gitleaks.toml --redact=100   (before the commit)
  INF scanned ~163613 bytes (163.61 KB) in 41ms;  INF no leaks found
$ GITLEAKS=<scratchpad>/gl/bin-8.30.1/gitleaks bash scripts/ops/secret-scan.sh tree   (after the commit)
  tree: 1283 committed files at HEAD 9a64bf1 (the re-check commit); INF scanned ~15709831 bytes (15.71 MB) in 947ms;
  INF no leaks found; PASS tree: no findings; SECRET SCAN (tree): PASS
  (the only later change is this result block, folded into the same commit)
```

---

## 2. Re-verification of the fixed findings

| Finding | Re-check result | Evidence (this re-check) |
|---|---|---|
| **QA-P5-03** (High) | **FIXED — CONFIRMED** (API, worker, UI, en + ar) | A member holding sponsor + auditor + PM roles but cleared `internal` in the `confidential` DEMO-DC gets **404 from all 21 AI routes** (the project route: 404), including their OWN earlier run; the same roles cleared `confidential` get no 404 (CONTROL). The emergency-stop request of the under-cleared member changed nothing. Worker paths re-check the CURRENT clearance: queued question skipped, approved proposal invalidated when the requester / approver / recipient falls below the project, nothing sent. UI: every AI PM Center screen (8 routes × en/ar) shows the restricted state and no task title (R2). No dangling citation: 32 answers (PM and functional approver, en + ar) and 6 delivered briefings — every citation opens for its reader. |
| **QA-P5-01** (Medium) | **FIXED — CONFIRMED** | Beyond the implementer's tests: the same reminder prepared for a DIFFERENT delegating user and worded differently is refused while the first awaits review; a different recipient is not a twin (CONTROL); window boundary 23 h 50 min → refused, 24 h 10 min → prepared; **two simultaneous creations → exactly one created**; **two worker claims executing approved twins at the same time → one message, the other invalidated `duplicate_within_cooldown`**; settings field: −1 / 1.5 / "12" / 169 → 400, 0 / 168 / 24 → 200, PM → 403, audited before / after, default 24 (schema and an untouched project). UI (R5): the field shows 24, 169 cannot be submitted (Review disabled; the hint states 0–168), a change goes through the review dialog and is saved (en + ar, detector + axe). Remainders recorded as Info QA-P5R-05 (key per action; untargeted messages dedupe on the identical payload only; 0 disables twin detection too — all documented). New Low QA-P5R-02 (the refusal text). |
| **QA-P5-02** (Medium) | **FIXED — CONFIRMED** for all six roles | API with the real worker process (`dist/worker.js`, sessions logged out, API app closed): contributor, workstream lead (as the demo leads: WS07 lead + contributor), committee chair, functional approver, finance, legal — each opens the delivered run (200), finds it in "my runs", cannot open another subscriber's run (404), and every citation opens. UI (R1): the six demo personas subscribe in the UI, every browser context is closed, the running worker delivers, each opens the run from "Runs" with 12 cited claims and three citations opened; the three Arabic runs pass the detector (0 problems) and axe (0 serious/critical). A lead holding ONLY a workstream-scoped grant cannot subscribe at all (Info QA-P5R-04). |
| **QA-P5-04** (Medium) | **FIXED — CONFIRMED** for titles and statuses; two remainders found | No English template title and no raw status value in the headline, claims, missing information, warnings or prepared requests of 9 Arabic questions + 2 Arabic briefings (API), nor in the six roles' briefings; template citations carry `labelAr`; the Arabic reminder is titled «طلب تحديث: …»; UI: the Arabic answer shows no English template title, detector 0 problems. Remainders: the Arabic conflict note embeds the raw entity type (QA-P5R-01) and the deduplication refusal is English (QA-P5R-02). Pre-existing, found on the same screens: the Arabic question routing (QA-P5R-03). |
| **QA-P5-05** (Medium) | **FIXED — CONFIRMED** (en + ar) | The Secretary (no members-list permission) opens the proposal and sees "Recipient Demo Project Manager" / «المستلم Demo Project Manager» and "Requested on behalf of …" / «بالنيابة عن …»; the API `people` carries exactly the people of that proposal (implementer test) — R4. |
| QA-P5-06 (Low) | **FIXED (TSA part) — CONFIRMED**; remainder carried as stated | Arabic register (R6): the system TSA escalation's requested action and target are Arabic (`escalation-action` / `escalation-target`), the English TSA sentence ("reached its end date … This is NOT an exit") is gone; axe 0. The remaining English texts (system-escalation titles, authority-routing escalations) are the carried P2 remainder the Fix status names. |
| QA-P5-07 (Low) | **UNCHANGED — open, carried to P6** | Template, schema and KPI page untouched since `79d1f71` (`git diff --stat` empty); `OBSERVED QA-P5-07` still passes in the full Playwright run (7 English template texts). |
| QA-P5-08 (Info) | **FIXED — CONFIRMED** | `GET …/ai/proposals/:id` applies the list's visibility: a proposal drafted from a RESTRICTED input is 404 for the PM (and absent from the PM's list), 200 for the secretary and the sponsor; another project's path 404; malformed id 400. UI: the proposal page issues one GET by id and no list request (en + ar); an unknown id shows the restricted state (R4). |
| QA-P5-09 (Info) | **FIXED — CONFIRMED** | Catalogue en: "… the approval was refused and the proposal was invalidated. The person it was prepared for can revise it; the revised version needs a fresh review."; ar: «… رُفض الاعتماد وأُبطل المقترح. يمكن للشخص الذي أُعدّ نيابةً عنه تعديله، …». The B-en / B-ar tests of `qa-p5-ai-center.spec.ts` render it from the catalogue in the full Playwright run. |
| QA-P5-10 (Info) | **FIXED — CONFIRMED** | `ai_run.policy_version` NOT NULL; the implementer's insert-without-policy-version test passes (its error must name `policy_version`, so it discriminates). |

---

## 3. Earlier assertions changed by the fix — do they still test their criterion?

| Changed assertion | Judgement | Why (measured) |
|---|---|---|
| `at-19-ai-revocation.spec.ts` › **REV-EN-03** rewrite (a: lowered to the project's classification → runs without higher content; b: lowered below it → skipped, nothing delivered, 404) | **Sound for the criterion (AT-19) through part (b); part (a) does not discriminate** | (b) would fail if the worker did not re-check: run `skipped owner_access_revoked`, output null, 0 notifications, audit, 404 on the project and on `/ai/ask`. (a) cannot fail with this data: measured, a strictly_confidential contributor's briefing — and even the sponsor's — contains only `internal` items (21 tasks, 11 milestones, 8 workstreams), so "no item above confidential" holds whatever clearance the worker applies (`p5-qar-assertions.spec.ts`, OBSERVED). The pre-fix version had the same weakness. Recommendation (Info QA-P5R-06): give the briefing a record above `confidential` within the subscriber's reach (e.g. a restricted decision awaiting action for a secretary-role subscriber) so (a) can fail. |
| `p5-qa-ai.spec.ts` › QA-P5-03 (ask) **201 → 404** | **Sound** | 404 is the behaviour the review recommended (the planning / portfolio rule); the assertions "task not cited" and "title not shown" are kept. Independently: all 21 AI routes answer 404 to such a member and the same roles cleared at the project's classification get no 404, so the 404 is the classification rule, not a broken route. |
| `p5-qa-ai.spec.ts` › QA-P5-03 OBSERVED → "nothing of the plan is cited …"; briefing set-up records the refusal | **Sound** | The former OBSERVED pinned the disclosure; it now asserts the absence, and the citation route stays 404 for the member. |
| `ai-settings-ops.spec.ts` › contributor's runs list **403 → 200** | **Sound** | The test's criterion is "runs are per user": it now asserts the PM's run is absent from the contributor's list and 404 by id — a list leaking other users' runs would fail it. My probes confirm with six roles (other subscriber's run 404). |
| `e2e/p5-ai.spec.ts` › test 5 and `qa-p5-ai-center.spec.ts` › A-en / A-ar: contributor's **Runs page restricted → runs table** | **Sound but weaker** | The restricted-state checks for `/proposals` and `/settings` remain; the Runs page assertion only checks that a table renders, not what it lists. Measured (R7): the contributor's Runs page lists their own question and none of the PM's runs; the PM's run URL shows no run detail. The API spec carries the per-user rule. |
| `p5-sec-ai.spec.ts` › SEC-P5-01 CONTROL: internal member's own ask **201 → 404** | **Sound as a CONTROL; the two SEC-P5-01 regressions of that file no longer isolate the content check** | Measured: a message with NO content at all to the internal-cleared member is refused `recipient_not_cleared_for_content` (project-level rule), so those regressions now pass whatever the content check does. The content check itself stays covered by `p5-sec-fixes.spec.ts` (re-addressed: sources reclassified above a confidential recipient, with a 404 CONTROL on the source) — that rewrite is sound. Recorded as Info QA-P5R-06 for the security re-check. |
| `p5-sec-fixes.spec.ts` › SEC-P5-01 approval / execution / revision cases re-addressed | **Sound** | The recipient stays at the project's classification and the SOURCE moves above them (CONTROL: the source is 404 for the recipient); refusal codes unchanged. |
| `p5-qa-ai.spec.ts` › QA-P5-01 CONTROL (two executed → first executed + second run's refusal naming it) and the dedupe-key / `since` set-ups | **Sound** | The second run's refused call naming the first proposal proves both runs asked for the identical reminder, which is what the CONTROL must show; `since` from the database clock removes a real race. |

---

## 4. New findings

| ID | Severity | Where | Finding (one line) | Probe |
|---|---|---|---|---|
| **QA-P5R-03** | Medium | `apps/api/src/modules/ai/ai-tools.service.ts:53-65` (`ROUTES`: substring regexes for singular Arabic forms only — `بوابة/البوابة`, `شرط/الشروط`, `إغلاق`) | An Arabic question in the product's own Arabic vocabulary is not routed to the gate / closing-condition tools: «ما عوائق البوابات؟» (gates, plural, as the Arabic UI says) → 0 claims, while "What are the gate blockers?" → 7 cited gates and the singular «ما عوائق البوابة؟» → 7; «ما شروط الإتمام المفتوحة؟» → 0 vs 4 in English. The Arabic user is told "no sufficient evidence". Pre-existing (not introduced by the fixes). | `p5-qar-arabic.spec.ts` › `DEFECT QA-P5R-03` + CONTROL; e2e `DEFECT QA-P5R-03 (UI)` (screenshot `ar-r3-gates-plural.png` inspected) |
| QA-P5R-01 | Low | `apps/api/src/modules/ai/ai-runtime.service.ts:530` (Arabic `L(…)` embeds `${c.targetType}`) | The Arabic conflict note shows the raw entity type: «الدليل من «…» مسجّل كمتعارض بالنسبة إلى task؛ يلزم إعادة التقييم…». QA-P5-04 class (raw value in an Arabic sentence). | `p5-qar-arabic.spec.ts` › `DEFECT QA-P5R-01`; e2e `DEFECT QA-P5R-01 (UI)` (screenshot `ar-r3-conflict.png` inspected) |
| QA-P5R-02 | Low | `apps/api/src/modules/ai/ai-proposals.service.ts:186` (English refusal sentence) → `ai/_components/answer.tsx:127-134` (`UText value={r.reason}`) | Introduced with the QA-P5-01 fix and routine: an Arabic subscriber's second briefing within the cooldown (or any while the reminder awaits review) shows under «الضمانات المطبقة» the English sentence "duplicate_within_cooldown: the same action for the same target and recipient is already awaiting review or execution (proposal …)". Earlier refusal reasons were English too but arose only on hostile / misconfigured paths. | `p5-qar-arabic.spec.ts` › `DEFECT QA-P5R-02`; e2e `DEFECT QA-P5R-02 (UI)` (screenshot `ar-r3-briefing-dedupe-refusal.png` inspected) |
| QA-P5R-04 | Info | `ai-settings.service.ts` `subscribeBriefing` / `ai-runtime.service.ts` `ask` (`policy.assert(…, { projectId })`) vs `apps/web/src/lib/ai.ts` `AI_TABS` (effective permissions incl. workstream grants) | A lead holding ONLY the workstream-scoped grant is offered the Briefings tab, its form and the Ask tab, but the API refuses (403) — consistent with the strict §2.2 rule already documented for proposals (OBS-P5-01), not documented for briefings / questions. The demo leads also hold a project-level contributor role and are unaffected. Owner decision: document, or hide the forms. | `p5-qar-roles.spec.ts` › OBSERVED; e2e `R8 OBSERVED` |
| QA-P5R-05 | Info | `ai-proposals.service.ts` `aiDedupeKey`, `duplicateOf` | Deduplication is per action (an `owner update request` and a `notification` for the same target and recipient are two messages); a message without a target dedupes only on the identical payload; cooldown 0 also turns off the "twin awaiting review" check. All three are documented in the code / settings hint. | `p5-qar-dedupe.spec.ts` › two OBSERVED; implementer's "cooldown 0" test |
| QA-P5R-06 | Info | `at-19-ai-revocation.spec.ts` REV-EN-03 (a); `p5-sec-ai.spec.ts` SEC-P5-01 | Test strength: REV-EN-03 (a) cannot fail with the current data (no briefing item above internal); the p5-sec-ai SEC-P5-01 regressions now pass on the project-level rule (the content check is covered by p5-sec-fixes). See §3. | `p5-qar-assertions.spec.ts` (two OBSERVED + CONTROL) |
| QA-P5R-07 | Info | `ai-settings.service.ts` `activateKillSwitch` (`assertProjectVisible` first); `ai-tools.service.ts` `get_status_dimensions` (`portfolio.dashboard.read`) vs `GET …/status-dimensions` (`portfolio.project.read`) | (a) Since QA-P5-03, a holder of `ai.killswitch.activate` cleared below a project's classification cannot press that project's emergency stop (404) — the stop reveals nothing; a portfolio administrator provisioned at the matrix default (`internal`) is in this position for every confidential project (the demo one is cleared confidential). Owner decision whether the stop should be exempt. (b) The PM can open the status dimensions page, but the AI says «المعلومات الخاصة بـ «get_status_dimensions» غير متاحة…» (also a raw tool name in an Arabic sentence). Safe direction; consistency only. | route matrix (`killswitch/activate` 404, emergency stop unchanged); screenshots `ar-r3-*.png` |

### QA-P5R-03 (Medium) — Arabic questions in the UI's own vocabulary miss gates and closing conditions

- **What happens.** Retrieval is runtime-controlled: `toolsForQuestion` picks tools by regex. The Arabic alternatives match
  `بوابة` / `البوابة` / `عائق` / `يمنع` and `شرط` / `الشروط` / `إغلاق` / `الإغلاق` as substrings. The Arabic UI itself says
  «البوابات» (gates; e.g. «جميع البوابات», «البوابات من G0 إلى G7») and the status catalogue «شروط الإتمام»; «البوابات» contains
  neither `بوابة` nor `البوابة`, «عوائق» is not `عائق`, «شروط» is not `شرط`, and «الإتمام» (the UI's word for closing) is absent.
- **Reproduction** (`p5-qar-arabic.spec.ts`, same Arabic PM, same data): gate-definition citations — "What are the gate
  blockers?" 7, «ما عوائق البوابة؟» 7, «ما عوائق البوابات؟» **0**; closing-condition citations — "Which closing conditions are
  open?" 4, «ما شروط الإتمام المفتوحة؟» **0**. In the access probe the Arabic PM / approver received 0 claims for the gates and
  closing-conditions questions where the English ones had 7 and 8, and «هل نحن جاهزون للإتمام؟» cited readiness checks only
  where "Are we ready to close?" cited closing conditions and gates. UI: the Arabic answer reads «لا توجد
  أدلة كافية في المصادر المصرح لك بالاطلاع عليها. 0 نتيجة موثقة» (screenshot inspected).
- **Impact.** Arabic users get materially less from the AI PM than English users for core questions (what blocks the gate, which
  conditions are open) and are told evidence is missing. Not a disclosure; a bilingual parity gap (REQ-AI-017, REQ-AI-038 —
  the evaluation suite asserts specific Arabic phrasings only).
- **Recommendation.** Match Arabic stems / plural forms (`بواب`, `عوائق|عائق`, `شروط|شرط`, `إتمام|الإتمام`), or route on the
  Arabic UI catalogue's own terms; add Arabic evaluation cases phrased with the UI vocabulary (and the remaining §12.2 reference
  questions) in both languages.

### QA-P5R-01 / QA-P5R-02 (Low) — two English remainders on Arabic runs

- QA-P5R-01: render the record type through the catalogue (`ai.citationTypes.*` exists in the web) or as a code + parameter.
- QA-P5R-02: return refusals as codes + parameters (`ai.refusal.duplicate_within_cooldown` with the proposal id), translated by
  the web like the 29 AI refusal codes the i18n check already knows; keep the English sentence for audit.

---

## 5. P5 exit criteria (MASTER_PROMPT §19) — re-check

| Exit criterion | Status at `598f25a` | Evidence |
|---|---|---|
| Scheduled briefing after the browser closes | **Met** (now for every subscribing role) | API: six roles subscribed, logged out, API app closed; `dist/worker.js` alone produced and delivered one run each, which each subscriber opened (QA-P5-02 closed). UI (R1): subscriptions made in the UI, `browser.contexts().length = 0` while the running worker produced them, read in new sessions (en + ar). The earlier review's worker-process probe (`p5-qa-ai.spec.ts`) and C test ran green in the full runs. |
| Valid citations / permissions | **Met** (was Not met) | QA-P5-03 closed through 21 routes, the worker paths and the UI; 0 dangling citations over 32 answers and 6 briefings; GET proposal by id applies the run-input visibility; user deactivation through the admin API stops the worker for that user. |
| No duplicate actions (retries and across runs) | **Met** (was met for retries only) | Retries / crashes: AT-20 specs and the earlier worker-process kill probes (full run). Across runs: implementer's DUP-07 / DUP-08 plus this re-check's concurrency probes — simultaneous creation → 1 proposal; simultaneous execution of approved twins → 1 message. |
| Prompt-injection resistance | **Met** (Simulated providers only) | AT-17 specs, the SEC-P5-01 regressions and "send financials" green in the full API run; no real model was run. |

---

## 6. Acceptance scenarios (update of §4 of the QA review)

Rows that changed are marked **(changed)**; the others are confirmed unchanged and their files ran green in the full runs.

| AT | Executing tests | Asserted in full? |
|---|---|---|
| AT-17 | as in the review §4 | **Yes** (Simulated providers). **(changed)** The QA-P5-03 disclosure gap noted in this row is closed (route matrix, worker paths). |
| AT-18 | as in the review §4, plus `p5-qa-fixes.spec.ts` QA-P5-05/-08 and this re-check's R4 | **Yes** (API + UI) |
| **AT-19 (changed)** | `at-19-ai-revocation.spec.ts` (REV-EN/AR-01, REV-EN-02…05 incl. the rewritten REV-EN-03), `p5-qa-ai.spec.ts` QA-P5-03 regressions, `p5-qar-access.spec.ts` (route matrix; async ask, requester, approver, recipient below the project; user deactivated), `p5-qar-roles.spec.ts` | **Yes** — membership revocation, document reclassification, clearance below the project, user deactivation. Weakness: REV-EN-03 (a) does not discriminate (QA-P5R-06). |
| **AT-20 (changed)** | `at-20-ai-duplicates.spec.ts` DUP-01…06, `p5-qa-fixes.spec.ts` DUP-07/-08, `p5-qa-ai.spec.ts` worker-process probes and QA-P5-01 regressions, `p5-qar-dedupe.spec.ts` (concurrent creation and execution) | **Yes** for retries, crashes and repeated runs. "Reconcile uncertain delivery" still does not arise (in-app delivery is transactional; external channels disabled) — NOT EXECUTED. |
| AT-21 | as in the review §4 | **Yes** |
| AT-22 | as in the review §4 (web side: the review's A-en / A-ar request-host check ran in the full run) | **Yes for the AI path and the web origin**; private-mode runtime is P7 |
| AT-28 | as in the review §4 | **Yes** |

---

## 7. Requirement statuses applied by the fix

Register: 45 P5 requirements → **31 Tested / 11 Implemented / 3 Planned** (counted from `requirements.yaml`). For the six moved
to Tested by the fix, every cited test title exists (checked by grep and by `apply_status.py --check`) and its file ran green in
this re-check's full API run (§1.5):

| REQ | AT (register) | Cited tests execute the AT? | Re-check |
|---|---|---|---|
| REQ-AI-006 | AT-03; IT "restricted chunk never appears in retrieval candidates for unauthorized user" | Yes — `ai-retrieval-acl.spec.ts` (restricted canary sponsor-only, rooms, cross-project, live ACL, citations re-checked on read) + the QA-P5-03 regressions | **Confirm Tested** (independently: route matrix, 0 dangling citations) |
| REQ-AI-027 | AT-19; IT "job for user revoked after enqueue produces no output" | Yes — at-19 REV-*, "queued (async) ask … → skipped, no output", REV-EN-03 (b) | **Confirm Tested** (independently: async ask and execution re-checks, deactivated user) |
| REQ-AI-028 | AT-20; IT crash before/after send; UT quiet hours | Yes — at-20 DUP-*, worker-process crash probes, `ai-runtime.test.ts` "quiet hours wrap midnight", dedupe / cooldown tests; dead-letter via `architecture-hardening.spec.ts` "poison jobs are dead-lettered" | **Confirm Tested** — "reconcile-pending state" for uncertain external delivery cannot arise yet (stated) |
| REQ-AI-029 | UT "AI run without policy version rejected" | Yes — `p5-qa-fixes.spec.ts` QA-P5-10 (DB-level refusal naming `policy_version`) | **Confirm Tested** for the AT; the statement's "rationale" field is not asserted anywhere (minor) |
| REQ-AI-039 | EVAL "acceptance report shows 0 bypasses, 0 unauthorized actions, 100 % valid citations with caveat text" | Yes — `docs/ai/evaluation-results.md` (69/69, caveat present); this re-check's full run recorded 69 cases, 69 pass, 0 fail (`summarize-evals.mjs`), the same as the document | **Confirm Tested** — note the set's Arabic phrasings do not cover QA-P5R-03 (quality, not a bypass) |
| REQ-SEC-021 | AT-19; IT "revocation matrix test across all channels" | Partly — AT-19 yes; the IT does not exist as a matrix: the evidence is spread over files, user deactivation on the AI / worker channel was not tested by the project (only by this re-check's probe), and the reports channel is P6 | **Hold back at Implemented** until a revocation-matrix test exists (user / document / permission × API, search, AI, worker; reports when P6 lands). The original review held it for this reason as well as QA-P5-03; only the second reason was removed. |

No other P5 status is disputed by this re-check. Recommended register after this re-check: **30 Tested / 12 Implemented /
3 Planned** (REQ-SEC-021 back to Implemented).

---

## 8. QA-P5-07 — unchanged

Confirmed unchanged and open: no change since `79d1f71` to `dc-carveout.v1.json`, the finance schema or the KPI page; `OBSERVED
QA-P5-07` passed in the full Playwright run (7 English template KPI texts on the Arabic `cps_verified` page). Owner: the P6
configuration package, as the Fix status assigns.

---

## 9. AI PM Center in English and Arabic (this re-check's e2e, `qa-p5r-ai-center.spec.ts`)

**Method.** The demo personas in the roles under test; every Arabic screen through the shared detector (`checkArabic`: lang /
dir, no English UI catalogue message, no English half of a bilingual API field; Latin texts printed for manual classification)
and axe WCAG 2.0/2.1 A/AA (serious / critical gate); dialogs through `checkDialogA11y`. Screenshots were rendered and the ones
named below were opened and inspected.

| Test | Result (single-file runs, §1.6) | What was inspected |
|---|---|---|
| R1 QA-P5-02, six roles | 6 subscriptions made in the UI, 0 browser contexts while the running worker produced the runs, 6 runs opened from "Runs": 12 cited claims each, 3 citations opened each (no restricted / error state); Arabic runs: detector 0 problems; axe 0 serious/critical on all six | `ar-r1-workstream-briefing-run.png` (Operations Lead): RTL, «تشغيل: موجز يومي», Simulated badge, claims and citation chips with Arabic template titles and «الحالة مسودة»; the "missing inputs" list names tools by their raw ids («list_closing_conditions», «get_status_dimensions» — Info QA-P5R-07 b) |
| R2 QA-P5-03 | 8 AI routes × en/ar: restricted state on every one, no overdue task title on any page; the web issues no AI request (the project layout is refused first — the API 404s are shown by the route matrix); CONTROL: the PM sees the detections | `en-` / `ar-r2-under-cleared-ai.png`: the restricted state only |
| R3 QA-P5-04 | Arabic answer: English template titles [] , detector 0 problems; CONTROL recorded the conflict note, a deduplicated Arabic briefing and the gate questions; DEFECT QA-P5R-01 / -02 / -03 (UI) = 3 expected failures | `ar-r3-conflict.png` («… مسجّل كمتعارض بالنسبة إلى task؛ …», twice); `ar-r3-briefing-dedupe-refusal.png` (under «الضمانات المطبقة»: `propose_internal_notification` and the English "duplicate_within_cooldown: the same action …" sentence); `ar-r3-gates-plural.png` («لا توجد أدلة كافية … 0 نتيجة موثقة») vs `ar-r3-gates-singular.png` (7 cited gates) |
| R4 QA-P5-08 / -05 | One API request `GET …/ai/proposals/<id>` and no list request (en + ar); "Recipient Demo Project Manager" / «المستلم Demo Project Manager», «بالنيابة عن …»; unknown id → restricted state; Arabic detector 0; axe 0 | `ar-r4-proposal-by-id.png` |
| R5 QA-P5-01 settings | The field shows 24; 169 cannot be submitted (Review disabled; the hint states 0–168; field errors appear only after a submit attempt — the same pattern as the other numeric fields); 12 (en) and 6 (ar) go through the review dialog (change line names the field) and are saved (API 12 / 6), then reset to 24; dialog a11y + axe 0; Arabic page and dialog detector 0 | `ar-r5-settings-review-dialog.png`: «حفظ إعدادات الذكاء الاصطناعي», change line «فترة تهدئة إجراءات الذكاء الاصطناعي (بالساعات): 24 ← 6», bound to the settings version |
| R6 QA-P5-06 | The TSA escalation's requested action and target are Arabic; axe 0; detector: 9 problems, all in the two authority-routing escalations (subject, requested action, target — the carried P2 remainder) | `ar-r6-committee-escalations.png`: ESC-003 (TSA) action, options and target Arabic, its subject still English (system-escalation title, carried); ESC-001 / ESC-002 fully English (carried) |
| R7 runs page | The contributor's Runs page lists their own question and not the PM's run; the PM's run URL shows no run detail | — |
| R8 OBSERVED | Workstream-only lead: tabs Overview, Ask, Proposals, Runs, Briefings & detections; `GET briefings 403`, `POST briefings 403`, `POST ask 403` (errors shown) | `en-r8-*.png` |

---

## 10. Probe files and their results

| File | Tests | Result |
|---|---|---|
| `apps/api/test/reviews/p5-qar-roles.spec.ts` | 6: CONTROL, worker-process delivery, QA-P5-02 for six roles, no dangling citation, Arabic output, OBSERVED (workstream-only lead) | 6 passed (single run); full run: passed (§1.5) |
| `apps/api/test/reviews/p5-qar-access.spec.ts` | 12: route matrix (2 CONTROL + 1), worker paths (5 incl. user deactivation), citations (CONTROL + 1), proposal by id (CONTROL + 1) | 12 passed; full run: passed |
| `apps/api/test/reviews/p5-qar-dedupe.spec.ts` | 10: dedupe key and window (3 + CONTROL + 2 OBSERVED), concurrency (2), settings (3) | 10 passed (single run); full run: 9 + 1 failed — the probe's own fixture assumption (§1.5), corrected and re-run after `at-28`: 10 passed |
| `apps/api/test/reviews/p5-qar-arabic.spec.ts` | 7: CONTROL, QA-P5-04, Arabic reminder title, `DEFECT QA-P5R-01`, `DEFECT QA-P5R-02`, `DEFECT QA-P5R-03` (`it.fails`), CONTROL (QA-P5R-03) | 4 passed + 3 expected fail; full run: the same |
| `apps/api/test/reviews/p5-qar-assertions.spec.ts` | 3: OBSERVED (REV-EN-03 (a)), CONTROL + OBSERVED (SEC-P5-01 isolation) | 3 passed; full run: passed |
| `e2e/tests/qa-p5r-ai-center.spec.ts` | 12: R1–R8, R3 QA-P5-04, `DEFECT QA-P5R-01/-02/-03 (UI)` (`test.fail()`) | all green over the single-file runs (§1.6); full run: 7 passed (incl. 3 expected failures), R4 failed on the probe's own proposal choice, R5–R8 not run (serial) — corrected and re-run after the full run: R4–R8 5 passed |

Probe convention: a `DEFECT` asserts the required behaviour and is an expected failure while the defect is open; once fixed it
turns red and the implementer renames it "… (fixed, regression)" and makes it a plain test. Each DEFECT has a CONTROL that holds
before and after the fix. `OBSERVED` tests pin current behaviour that is not (yet) a defect.

---

## 11. Not verified / NOT EXECUTED

- **No real model** (Simulated benign / hostile / down / scripted only). The Arabic routing gap QA-P5R-03 is in the runtime's
  deterministic routing and does not depend on the model.
- **Multi-replica workers**: the concurrency probes used two claims in one process (two `runJobs(1)` at once) and two
  simultaneous transactions; several worker processes at once were not run.
- **External delivery reconciliation** (AT-20, REQ-AI-028 "reconcile uncertain delivery"): no external channel can be enabled —
  NOT EXECUTED.
- **Screen readers**: not used (axe covers a subset of WCAG).
- **CI** on `598f25a`: not checked by this re-check.
- The security reviewer's re-check of the same fixes was not read (separate context).

---

## 12. Verdict and conditions

**P5 (QA): PASS WITH CONDITIONS** at `598f25a`.

- The High finding QA-P5-03 is fixed and confirmed independently: all 21 AI routes, the worker paths (questions, briefings,
  executions — requester, approver, recipient), user deactivation and every AI PM Center screen in both languages refuse a
  member cleared below the project's classification; no dangling citation was found for readers who see the project.
- QA-P5-01, -02, -04, -05, -06 (TSA part), -08, -09, -10 are confirmed fixed; QA-P5-07 is unchanged and carried (P6).
- The four P5 exit criteria are met with the Simulated providers (§5); AT-17 … AT-22 and AT-28 are executed and green (§6).
- No Critical or High is open from this re-check.

Conditions (before or at the P5 gate):
1. **QA-P5R-03 (Medium)** — Arabic question routing parity: fixed with Arabic evaluation cases phrased in the UI's own
   vocabulary, or carried by the lead with an owner (ai-runtime-engineer) and the stated impact.
2. **QA-P5R-01, QA-P5R-02 (Low)** — fixed (codes + parameters) or recorded with an owner; QA-P5R-02 is new with the QA-P5-01 fix
   and appears on every Arabic subscriber's repeated briefing.
3. **REQ-SEC-021** back to Implemented until a revocation-matrix test exists (§7) → register 30 Tested / 12 Implemented / 3 Planned.
4. QA-P5-07 and the QA-P5-06 remainder stay carried with owners (P6 configuration; stored escalation codes); Infos QA-P5R-04 …
   -07 recorded with owners (QA-P5R-04 and -07 a are owner decisions; QA-P5R-06 is test strength — REV-EN-03 (a) fixture, and
   for the security re-check the SEC-P5-01 probe of `p5-sec-ai.spec.ts`).

Probe convention for the implementer: the three `DEFECT QA-P5R-0x` API probes and their three UI counterparts turn red when
fixed; rename them "… (fixed, regression)" and make them plain tests.
