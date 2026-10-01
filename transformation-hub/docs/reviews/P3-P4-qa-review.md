# P3 (Carve-out & NewCo) and P4 (JV & Finance) — independent QA review

| Item | Value |
|---|---|
| Reviewer | qa-test-engineer (independent; separate context; wrote none of the code under review) |
| Revision reviewed | **`5bf274b`** (`5bf274b917493f0c02e5de032c8f64f7b6cafc57`), head of `origin/claude/mobily-transformation-hub` when the review started (`git merge` → "Already up to date"), frozen for the whole review. Every result below is at `5bf274b` plus this review's test files. |
| Review branch | `worktree-agent-a2ab585bb54d3b43b` — adds this report, API probe specs `apps/api/test/reviews/p34-qa-*.spec.ts` (3), e2e probe specs `e2e/tests/qa-p34-*.spec.ts` (3) and a curated set of screenshots under `e2e/screenshots/qa-p34/`; no application code, existing test, migration or seed changed |
| Dates | 2026-09-30 – 2026-10-01 (two container restarts killed the first runs; every count below comes from a run that completed) |
| Brief | full API and Playwright suites; AT-06..AT-10 (P3) and AT-03, AT-11, AT-12, AT-13, AT-29 (P4) mapped to executable tests; critical UI journeys; Arabic RTL / English LTR / 390 px on every P3/P4 screen and dialog; loading / empty / error / restricted states, Demo badge, Simulated labels; requirement-status sampling |
| **Verdict P3** | **FAIL** at `5bf274b`. The P3 exit criterion "blockers prevent go-live" and AT-09 / AT-10 do not hold on the server: the P3 domain review's High findings DOM-P3-01, DOM-P3-09 (AT-09) and DOM-P3-06 (AT-10) were **re-run and reproduced by this review** at `5bf274b` (§2.4) — cross-referenced, not duplicated. This review adds QA-P34-01 (Medium: English on Arabic P3 screens where Arabic exists or should exist — readiness registers, cutover plan, perimeter item, reconciliation, TSA escalation) and Lows QA-P34-02, -03, -04, -07. Every P3 AT is otherwise executed and green (§3), including the journeys added here (J1, J2, J5). |
| **Verdict P4** | **PASS WITH CONDITIONS** at `5bf274b` — no Critical or High from this review; AT-03, AT-11, AT-12, AT-13 and AT-29 are executed and green through the API and the UI (incl. the probes added here: AT-13 logging, AT-29 summaries and units in the UI, the DD Q&A journey J3). Conditions: QA-P34-01 c and h (English on Arabic P4 screens) fixed; QA-P34-04 evidence refreshed; the P4 domain re-review (pending) and the P3/P4 security review's P4 conditions (SEC-P34-01, -03, -04 — cross-referenced, not re-verified) closed. |

Severity scale (as in the P2 QA reviews): **High** = a mandatory rule, an acceptance criterion or an exit criterion can be bypassed
through the API; **Medium** = a mandatory requirement missing or partly met; **Low** = precision, documentation or hardening gap;
**Info** = observation.

---

## 1. Environment

- Review worktree on `5bf274b`, clean before the review. Node 22.22.2, pnpm 10.33.0, PostgreSQL 16.13 (shared local cluster
  `127.0.0.1:5432`; not started or restarted by this review), Playwright 1.56.1 + @axe-core/playwright 4.13.0, Chromium from
  `/opt/pw-browsers`. 4 CPUs and 15 GB shared with other agents.
- Own databases only: `HUB_DATABASES="hub_test_p34qa hub_test_p34qa_boot hub_test_p34qa_probe hub_test_p34qa_e2e" bash scripts/dev/pg-init-roles.sh`
  → `roles hub_owner/hub_app and databases ready: …`. `hub_test_p34qa` = full API suite, `hub_test_p34qa_probe` = probe runs,
  `hub_test_p34qa_e2e` = e2e stack.
- E2E stack as in the CI e2e job: schema dropped, `node deploy/docker/api-entrypoint.cjs migrate` → "migrations applied … post-migrate
  SQL applied", `node apps/api/dist/cli/seed-demo.js` → "demo seed complete"; API `dist/main.js` on **:4450** with
  `HUB_RATE_LIMIT_PUBLIC_PER_MINUTE=1000 HUB_MODE=demo NODE_ENV=development`, worker `dist/worker.js`; production web build
  `env -u NODE_ENV HUB_API_URL=http://127.0.0.1:4450 pnpm --filter @hub/web run build` (EXIT 0) and `next start -p 3450`. The
  database was reset and freshly seeded before the full Playwright run B. Only processes started by this review were stopped,
  by PID. No Docker.
- **Interruptions.** The container was restarted twice while several agents ran suites; the API runs 1 and 2 and Playwright
  run A were killed before their summary. Their partial results are reported as partial (§2.1, §2.3) and not counted.

## 2. Commands and real results

### 2.1 API integration suite (full)

```
$ pnpm install --frozen-lockfile && pnpm build:packages            → Done; exit 0
$ (apps/api) TEST_DATABASE_URL=postgres://hub_app:…@127.0.0.1:5432/hub_test_p34qa \
    TEST_DATABASE_MIGRATION_URL=postgres://hub_owner:…@127.0.0.1:5432/hub_test_p34qa pnpm test        (run 3, completed)
 ❯ test/reviews/p2-qa-final-race.spec.ts (8 tests | 1 failed) 26287ms
     × both kinds of use are accepted on one G1 decision (documented rule: one record of EACH kind); registered once each; …
 Test Files  1 failed | 103 passed (104)
      Tests  1 failed | 858 passed | 2 expected fail (861)
   Duration  981.08s
EXIT 1
```

104 files = the 101 committed spec files of `5bf274b` + this review's 3 probe files (4 tests, all passing). For the frozen tree
alone: **101 files, 1 failed, 854 passed, 2 expected fail** (the open `DEFECT` probes DOM-P2F-02/04 of `p2-domain-final.spec.ts`).

**The single failure is a known pre-existing failure of `5bf274b`, not a P3/P4 finding:** the P2 QA probe
`p2-qa-final-race.spec.ts` raises its G1 paper for no record, which the later DOM-P2F-08 fix refuses
(`422 perimeter.version.decision_no_subject`; printed: `perimeter 422:perimeter.version.decision_no_subject gate
["422:gate_assessment.invalid_transition","201:approved"]`). It failed identically in all three runs here (runs 1 and 2 were
killed later by the container restarts). The lead confirmed it and fixed the fixture on the branch at `3735be4` (not the review
revision). The security and P3 domain reviews report the same at `5bf274b`.

### 2.2 This review's API probes (single runs, `hub_test_p34qa_probe`)

```
$ (apps/api) TEST_DATABASE_URL=…/hub_test_p34qa_probe TEST_DATABASE_MIGRATION_URL=…/hub_test_p34qa_probe npx vitest run \
    test/reviews/p34-qa-p3-at07-probe.spec.ts test/reviews/p34-qa-p3-at09-probe.spec.ts test/reviews/p34-qa-p4-probes.spec.ts
 Test Files  3 passed (3)
      Tests  4 passed (4)
```

All four are `CONTROL` tests (the rule holds); they also passed inside the full run 3. Printed evidence (`--reporter=verbose
--silent=false` re-run, `Test Files 3 passed (3) · Tests 4 passed (4)`):

```
QA-P34 AT-07: applied item inApprovedBaseline=false, history=[1,2,3]
QA-P34 AT-07: re-baseline v2 approval → 201 approved                      (then v1 superseded, its snapshot scope unchanged)
QA-P34 AT-09: GO with failed access + incident blockers and a failed optional check → 422 readiness.go_blocked; blockers
  [["RC-001 — QA34 physical access tested (synthetic)","failed",true],["RC-002 — QA34 incident response tested (synthetic)","failed",true]]
QA-P34 AT-13: legal (no jv.cp.waive) → 403 policy.forbidden; sponsor (not the determined authority) → 403 policy.forbidden
  (each audited: action jv.approveConditionWaiver, outcome denied, attempted waiver id; waiver stays requested, CP open)
QA-P34 AT-29 summary groups: [["SAR",1,2,"1500.0000"],["SAR",1000,1,"2.0000"],["USD",1,2,"140.0000"]]
QA-P34 AT-29 separation-cost groups: [["one_off_separation","SAR",1,"1000.0000"],["one_off_separation","SAR",1000,"2.0000"],
  ["one_off_separation","USD",1,"100.0000"],["tsa_charge","SAR",1,"500.0000"],["tsa_charge","USD",1,"40.0000"]]
```

### 2.3 Playwright

**Run A** (frozen tree only, before this review's e2e specs existed; killed by the first container restart): **275 passed, 0 failed**
when it stopped, after `p3-carveout.spec.ts (c)` — i.e. all of `a11y.spec.ts` (both locales, incl. the JV / finance screens), P1, P2
and `p3-carveout (a)–(c)` passed at `5bf274b`. Not counted as a full run.

**Run B** (frozen tree + this review's three e2e specs, database freshly reset and seeded):

```
$ (transformation-hub) QA_P34_DB_OWNER_URL=postgres://hub_owner:…@127.0.0.1:5432/hub_test_p34qa_e2e HUB_WEB_URL=http://127.0.0.1:3450 \
    PLAYWRIGHT_BROWSERS_PATH=/opt/pw-browsers pnpm --filter @hub/e2e exec playwright test --reporter=list
  ✘  279 … p3-readiness.spec.ts:407 › REQ-SET-004 / AT-10 (DOM-P4-09): the demo TSA issue … is shown expired and escalated
        Error: expect(locator).toHaveAttribute(expected) failed — Locator: getByTestId('tsa-detail') … element(s) not found
  ✘  … qa-p34-journeys.spec.ts:138 › J1 (AT-10) … (same step: getByTestId('tsa-detail') not found after the row click)
  2 failed
  335 passed (41.7m)
```

337 tests = **314 delivered** (`a11y.spec.ts` 244 + 70 others) + **23 of this review** (crawler 5 + `DEFECT` 9, journeys 5, states 4).
Delivered tree: **313 passed, 1 failed**; this review's specs: 22 passed (the 9 `DEFECT` tests as expected failures), 1 failed.

**Both failures have one cause, established by a probe (QA-P34-07), and both pass when re-run:**

```
$ … playwright test tests/p3-readiness.spec.ts:407 tests/qa-p34-journeys.spec.ts:138 --reporter=list
  ✓  1 … p3-readiness.spec.ts:407:7 › REQ-SET-004 / AT-10 (DOM-P4-09) … (2.8s)
  ✓  2 … qa-p34-journeys.spec.ts:138:7 › J1 (AT-10) …
  2 passed (15.7s)
```

Both tests type into the TSA register's search and click a row that is already visible before the filter applies. The search
reaches the URL through a 300 ms debounced `router.replace` (`components/SearchInput.tsx:14,33`, `useUrlState`); when the
navigation to the detail takes longer than the debounce (as under load), that `replace` cancels it and the page stays on the
filtered register (both failure screenshots show exactly that, with the TSA already `Expired — unresolved`). `OBSERVED QA-P34-07`
reproduces it deterministically: with the detail navigation delayed 1.5 s, a click without a pending search reaches the detail
(control), a click right after typing ends on `/readiness/tsa?q=Legacy+monitoring+bridge` with no detail. J1 now waits for the
filter to land before clicking (re-run green); the delivered `p3-readiness` test keeps the race (QA-P34-07).

Every other delivered spec passed in run B, including `a11y.spec.ts` (244, both locales), `p3-carveout` (4), `p3-readiness` AT-09
and AT-10, `p4-finance` (7), `p4-jv` (4: AT-11, AT-12, AT-13, AT-03) and the P1/P2/P5/QA specs.

**This review's e2e specs, single runs before run B** (same stack): journeys `qa-p34-journeys.spec.ts` J1, J2, J5 passed on the
first run; J3 and J4 failed on two harness errors of this review (a person picker that turns into a chip; a focus check placed
after a refused run — see QA-P34-06), corrected, then passed. `qa-p34-states.spec.ts` 4/4 passed (one route-handler harness error
corrected first). `qa-p34-arabic-rtl.spec.ts`: English passes clean; Arabic and 390 px fail on the defects reported in §5 (now
classified, see §5.3); the 9 `DEFECT` tests reproduce (`9 passed (57.0s)` as expected failures).

### 2.4 Cross-check of the P3 domain review's High findings at `5bf274b`

The P3 domain review (`docs/reviews/P3-domain-review.md`, merged on the branch after `5bf274b`) reports four High findings. Its
probe files were copied **temporarily** into this worktree (not committed, deleted after the run) and run in plain mode at
`5bf274b` on this review's probe database:

```
$ P3D_PROBE_PLAIN=1 TEST_DATABASE_URL=…/hub_test_p34qa_probe … npx vitest run test/reviews/xtmp-p3-domain-readiness-go.spec.ts \
    test/reviews/xtmp-p3-domain-tsa.spec.ts -t "DOM-P3-01|DOM-P3-09|DOM-P3-06"
 × DEFECT DOM-P3-01 … AssertionError: PATCH 200 …; check now {"status":"failed","cutover_plan_id":"01a0f4c4-fbb9-…"};
     GO 201 {"status":"approved_go","goNoGo":"go","version":6}
 × DEFECT DOM-P3-09 … check after rejection: status passed, evidence {"active":0,"conflicting":0}; GO 201 {"status":"approved_go",…}
 × DEFECT DOM-P3-06 … request 1 (X=2027-01-19) 201; request 2 (Y=2036-09-28) 201 …; record 201 {"status":"extended",…};
     TSA extended end 2036-09-28
 Tests  3 failed | 6 skipped (9)
```

All three reproduce: a GO is recorded with a failed blocker moved to another plan (DOM-P3-01) or a blocker whose only evidence
was rejected (DOM-P3-09), and an extension is recorded to a date the decision never approved (DOM-P3-06). They defeat AT-09
("block go-live according to the blocker") and AT-10 ("extension options await approval") through the API. The other P3 domain
findings and the P3/P4 security findings (`docs/reviews/P3-P4-security-review.md`, no High) were **not re-verified** here.

### 2.5 Register, lint, typecheck, secret scan

```
$ python3 scripts/requirements/apply_status.py --check          → status-evidence.yaml OK (263 entries)
$ python3 scripts/requirements/apply_status.py                   → applied 263 status updates; rendered 394 requirements; AT coverage 30/30
  git status docs/requirements/ → no change (register in sync)
$ pnpm --filter @hub/e2e typecheck                               → tsc --noEmit, exit 0 (with the three e2e probe specs)
$ GITLEAKS=…/gitleaks bash scripts/ops/secret-scan.sh tree       → after each commit: "PASS  tree: no findings" / "SECRET SCAN (tree): PASS"
```

```
$ (apps/api) npx tsc -p tsconfig.json --noEmit                   → exit 0 (includes test/**, with the three API probe specs)
```
The root `pnpm lint` was not run: this review adds test files only (API probes type-checked above, e2e probes by the e2e
`tsc --noEmit`); the web i18n / hard-coded-string checks and the module-boundary check do not read them.

## 3. Acceptance scenarios mapped to executable tests (§20)

"Full" = the test asserts every part of the §20 required outcome through the real API / database (and the UI where the
scenario is a user journey). Counts are `it(` / `test(` blocks in the file. All listed files ran green in the full API suite
(§2.1) or Playwright run B (§2.3) unless marked.

### 3.1 P3

| AT | §20 required outcome | Executing tests | Asserted in full? | What was missing → probe added |
|---|---|---|---|---|
| **AT-06** Incorporation confirmed while assets/contracts/operations pending | Keep states separate; do not mark the whole carve-out complete | `carveout/at-06-incorporation-separate.spec.ts` (7): evidence needed, recorder ≠ verifier, Legal verifies → `incorporated_verified` while `perimeter_transfer` = not started and operations pending, `carveOutComplete=false`, perimeter item untouched, history kept; legal verified + economic in progress stays in progress (D-05). `gates/at-06-status-dimensions.spec.ts` (6): four dimensions, versioned + audited, worker path (`perimeter.changed` → recompute), TSAs/enduring arrangements in the explanation, 403/404. e2e `p3-carveout.spec.ts (b)` (UI: record ≠ verify, dimensions and "carve-out complete = false" unchanged, transfers unchanged). Domain `rules.test.ts`, `newco.test.ts` | **Yes** | The API spec's perimeter holds only a site; contracts pending are covered by the gates spec (rows written with the owner pool). The REQ-LCY-007 AT names the cockpit: the UI proof is on the NewCo screen (the cockpit shows the dimensions in `p2-cockpit (a)`, not this state). No probe needed. |
| **AT-07** Site/shared asset added after baseline approval | Change request + financial/TSA/readiness/transaction impact, **preserving the previous version** | `carveout/at-07-perimeter-change-control.spec.ts` (9): held pending, CR `submitted`, `rebaseline:true`, impacts for scope/financial/tsa/readiness/transaction/time/cost (readiness names the check at the site, financial "Assessment pending — specialist"), 8-area impact assessment, baseline unchanged, requester cannot approve, apply after approval, rejection closes without change, 409 on stale version, workstream-lead path. `carveout/setup-wizard.spec.ts` (4). e2e `p3-carveout.spec.ts (a)` (UI journey end to end). Domain `perimeter.test.ts` | **Partly**: "previous version preserved" is asserted only **before** the CR is decided | **Probe** `p34-qa-p3-at07-probe.spec.ts` (CONTROL): after approval + apply, baseline v1 is still current with its frozen scope; after the re-baseline v1 is `superseded` with its snapshot unchanged and v2 carries the new item — **passes**. **Probe** J5 (`qa-p34-journeys.spec.ts`): the item added through the UI appears in the reconciliation tab (REQ-UX-010's AT had no test). |
| **AT-08** Customer contract cannot transfer on Day 1 | Required consent/interim arrangement, service/billing/SLA accountability, remediation plan | `carveout/at-08-day1-contract-position.spec.ts` (8): specialist-only transferability (403 + audit), Day-1 position lists what is missing, consent workflow with evidence, legal transfer refused while consent outstanding, accountable owners must be members, complete interim position = OK, verifyTransfer needs evidence + another person, append-only transfer history. Domain `perimeter.test.ts` | **Yes (API)** | UI: the Day-1 tab is only screenshotted by `p3-carveout (d)`; no e2e asserts its content. Covered for rendering/RTL/axe by the crawler (`qa-p34-arabic-rtl.spec.ts`, screens `perimeter-day1`, `perimeter-item` on the demo contract). |
| **AT-09** Connectivity/access/incident-response test fails | Block go-live according to the blocker; show contingency runbook and decision history | `readiness/at-09-readiness-go-no-go.spec.ts` (13): §7.4 prerequisites, append-only test runs, only the go/no-go authority decides, GO refused with an approved decision while a blocker failed, refusal in the history and audited, NO-GO + return to planning, sign-off by the assigned role on evidence, GO after remediation, execution recorded never performed, acceptance by the accountable owner, final decision of the right type, 14-area template. e2e `p3-readiness.spec.ts` AT-09 (UI). Domain `readiness.test.ts`; `readiness-demo-seed.spec.ts` (blocked demo GO) | **Yes** for the paths tested (connectivity) — **but bypassable**: DOM-P3-01 (a PATCH re-binds the failed blocker) and DOM-P3-09 (sign-off evidence rejected, check stays passed) let a GO through; reproduced in §2.4 | Only the **connectivity** test fails in every spec. **Probe** `p34-qa-p3-at09-probe.spec.ts` (CONTROL): failed physical-access and incident-response blockers + a failed optional check → GO refused naming exactly the two blockers — **passes**. **Probe** J2 (UI): the same through the UI, NO-GO, the plan's contingency runbook + rollback and the history. |
| **AT-10** TSA expires before replacement acceptance | Escalate without declaring exit; extension/continuity options await approval | `readiness/at-10-tsa-expiry.spec.ts` (11): approval needs §7.3 essentials + a FINAL decision, dates locked, illegal transitions, the expiry job (per-project schedule, service identity, injected Clock) warns once and then marks `expired_unresolved` + one system escalation routed per the matrix ("NOT an exit"), dimension blocked, no exit without accepted replacement evidence, extension only on a FINAL decision (never automatic, not reusable), replacement failure escalates, independent exit approval bound to the request. `readiness/p2f-decision-reliance.spec.ts` (5), `readiness-demo-seed.spec.ts`. e2e `p3-readiness.spec.ts` AT-10 + REQ-SET-004 | **Yes (API)** for the paths tested — **but bypassable**: DOM-P3-06 (an approved extension decision records any later end date) defeats "extension options await approval"; reproduced in §2.4 | The e2e AT-10 test never runs the **worker**: its TSA ended 5 days ago but stays `active`. **Probe** J1 (UI + real worker): the running worker's daily scan (made due now on this review's database) marks a past-end TSA `expired_unresolved` and escalates; the UI offers no exit; the bypass is refused. |

### 3.2 P4

| AT | §20 required outcome | Executing tests | Asserted in full? | What was missing → probe added |
|---|---|---|---|---|
| **AT-03** Project B user requests Project A records/files/search/AI/reports | Deny without leaking titles, snippets or confidential counts, incl. worker/cache paths | `jv/at-03-partner-room-isolation.spec.ts` (12): partner B vs partner A rooms (404, never 403, counts exclude), Project-B user 404 on every JV route, external accounts refused on registers/documents/search/AI, RLS in a room-only DB context, NDA alone grants nothing (REQ-JV-005), revoke/lock stop downloads with history retained, clean-team rooms. `finance/finance-isolation.spec.ts` (10), `readiness/readiness-isolation.spec.ts` (7), `carveout/carveout-isolation.spec.ts` (4): Project-B 404 on every route, foreign ids refused, RLS, clearance and workstream reach in SQL. `documents/at-03-documents-isolation.spec.ts`, P1 `isolation-and-auth.spec.ts`. e2e `p4-jv.spec.ts` AT-03 | **Yes** for P3/P4 records, rooms, search and AI | Worker/cache paths of P3/P4: the gates recompute runs with an allow-listed service principal; no P3/P4 job notifies anyone (the notifications module is still a shell — nothing to leak); reports are P6. **Probe** `qa-p34-states.spec.ts` (restricted): Project-B user and foreign ids in the UI. |
| **AT-11** Partner preparation during separation | Permit authorized parallel work; separate signing/closing and their dependencies | `jv/at-11-partner-parallel.spec.ts` (6): G5 independent of G3/G4, DD schedulable before G3 unless a dependency is configured, each step keeps its authorization, skipped stages refused (audited), checklist items belong to one event, two closings with independent CP sets, signing completion never closes, signing only after G5. `gates/gate-evaluation-rules.spec.ts`. e2e `p4-jv.spec.ts` AT-11. Domain `jv.test.ts` | **Yes** | — |
| **AT-12** All workstreams green, a mandatory CP lacks evidence | Block closing; AI cannot bypass the condition or create a waiver | `jv/at-12-closing-blocked-cp.spec.ts` (5): tasks all done → closing stays open, `mark_ready` refused, verifyCP without evidence refused (logged), confirmation re-evaluates the CP set inside its transaction (evidence withdrawn → refused, logged), late blocking CP blocks, only the authority confirms; a service principal with the permissions allow-listed gets `jv.human_only` / `gates.human_only`. `jv/p4-decision-reliance.spec.ts` (8), `gates/at-12-gate-side.spec.ts` (2). e2e `p4-jv.spec.ts` AT-12 | **Mostly** | "All workstreams green" is simulated by setting every task `done` with the owner pool; workstream RAG is not asserted green. The AI part is tested at the service-principal level (the AI proposal pipeline is P5). No probe (P5 scope). |
| **AT-13** Non-waivable condition or unauthorized waiver request | Reject/**log**; the condition remains unmet | `jv/at-13-cp-non-waivable.spec.ts` (5), `gates/at-13-non-waivable.spec.ts` (9). e2e `p4-jv.spec.ts` AT-13 | **Partly**: the log is asserted for the non-waivable **request** only; the two unauthorized **approvals** are checked for status only | **Probe** `p34-qa-p4-probes.spec.ts` (CONTROL): both unauthorized approvals are 403 **and** audited `denied` with the waiver id; the waiver stays `requested`, the CP `open`, the closing blocked — **passes**. |
| **AT-29** Different currencies/units combined | Prevent invalid aggregation; show conversion basis/source where used | `finance/at-29-currency-unit-aggregation.spec.ts` (12): SAR+USD refused (audited), explicit basis shown with source and date, basis without source/date refused, units vs thousands refused unless normalization is explicit (disclosed), baseline+actual never added, filtered aggregate, commitments/approved budget in another unit refused, EV/equity and unit/currency confusion reported in model comparisons. e2e `p4-finance.spec.ts` AT-29 (currency, en + ar). Domain `money`/`finance` tests | **Yes (API)** | UI covers only the currency case. **Probe** J4 (UI, en + ar): units vs thousands refused with the reason, explicit normalization discloses its basis. **Probe** `p34-qa-p4-probes.spec.ts` (CONTROL): the Finance summary and the separation-cost view keep SAR units / SAR thousands / USD (and TSA charges) in separate groups — **passes**. |

## 4. Critical user journeys through the UI

| Journey (brief) | Delivered e2e | This review | Result |
|---|---|---|---|
| P3: perimeter change after baseline → change request and impact | `p3-carveout (a)` (EN): held pending, CR, impact entries, assessor, sponsor approval, applied | **J5**: an item added through the UI appears in the reconciliation tab with `pending_disposition`, `pending_without_resolution`, `change_request_pending`; item count 5 → 6 (REQ-UX-010's AT had no test) | Passed (single run and run B) |
| P3: Day-1 blocker → NO-GO with contingency runbook and decision history | `p3-readiness` AT-09 (connectivity) | **J2**: failed physical-access + incident-response tests recorded in the UI; the sponsor's GO refused naming both (`go_blocked` entry lists both); NO-GO with rationale; the plan's contingency runbook, rollback and each check's contingency shown; Arabic plan page passes the detector; go/no-go dialog axe 0 | Passed |
| P3: TSA expiring without replacement → escalation, no exit | `p3-readiness` AT-10 (its TSA is past its end date but stays `active`: the worker never runs), REQ-SET-004 demo record | **J1**: a TSA ended 3 days ago is approved and activated; the DEMO-DC expiry schedule is made due on this review's database; the **running worker** sets `expired_unresolved` and raises the escalation (`decision_requested`, routed "within its delegated authority (tsa_approval_or_extension, matrix v1)"); the UI shows "Reaching the end date is not an exit", offers no exit request or approval; the bypass is refused (`request-exit-approval 422 tsa.exit_not_evidenced; approve-exit 422 tsa.exit.not_requested`); Arabic page passes the detector except QA-P34-01b (asserted separately) | Passed in the single run; in run B failed at the row click (QA-P34-07 race), passed on re-run and after the harness fix |
| P4: DD question → answer in a partner room | `p4-jv` AT-11 raises a PM question only; the seeded answer is shown in AT-03 | **J3**: the partner asks in its room (UI) → PM assigns (owner PM, reviewer Legal), drafts and submits (UI; review/release not offered to the drafter) → Legal approves for release → the partner still sees "No released answer yet" → the sponsor releases → the answer appears in the partner's room; Arabic room and request pages checked (one finding: QA-P34-01c); assign and release dialogs axe 0 | Passed |
| P4: closing blocked by an unmet CP | `p4-jv` AT-12 (EN + AR + 390): blocked message names the CP, confirmation refused inside the transaction | — (covered) | Passed (run B) |
| P4: currency / unit aggregation refused with the reason | `p4-finance` AT-29 (currency, EN + AR) | **J4**: SAR units + SAR thousands → `422 money.mixed_unit_scale`, the dialog shows "Total refused: different units … (units / thousands)" and no total; explicit normalization → 3000.0000 SAR with the disclosed basis "Units units, thousands were normalized to units at your explicit request."; Arabic dialog passes the detector and axe | Passed |

## 5. Arabic (RTL) / English (LTR) / 390 px on every P3 and P4 screen and dialog

### 5.1 Method (`e2e/tests/qa-p34-arabic-rtl.spec.ts`)

Every P3 screen (25: the 8 perimeter tabs, perimeter item as PM and as Legal, agreement, NewCo entities / requirements / entity
(PM, Legal) / requirement, readiness overview / checks / check / cutover / plan (PM, sponsor) / TSA register / TSA / waivers) and
every P4 screen (38: finance summary, figures, figure, budget, budget line, reconciliations, reconciliation, models, model,
version, benefits, benefit, KPI; JV overview, partners, partner, proposals, scenarios, scenario, negotiation, rooms, room index /
disclosures / grants / history, diligence, findings, DD request, finding, closing, CP register, closing, signing, CP (Legal, PM),
funds flow, obligations; partner access and the partner's room) of the demo sandbox — figure and reconciliation details on a
fresh non-demo project because the sandbox has none. On each screen every command / create button is clicked, the dialog is
checked and closed with Escape (nothing submitted): in run B **P3 48 dialogs, P4 51 dialogs** (the set of offered commands depends on the records' state; 50 / 49 in the single run). Arabic: `checkArabic` (lang/dir, no English
UI message, no English half of a bilingual API field) + axe WCAG 2.0/2.1 A/AA serious/critical on the screen and on each open
dialog (`checkDialogA11y`: accessible name, focus inside, axe); English: lang/dir + the same axe scans; 390 px (Arabic): page-level
horizontal overflow. The Latin-letter texts of each screen are printed and were classified manually.

### 5.2 Results

| Pass | Screens / dialogs | axe serious/critical | Detector / overflow |
|---|---|---|---|
| English (LTR), P3 | 25 / 48 | **0** | lang `en`, dir `ltr` on all; 0 problems |
| English (LTR), P4 | 38 / 51 | **0** | lang `en`, dir `ltr` on all; 0 problems |
| Arabic (RTL), P3 | 25 / 48 | **0** | 108 problems, all classified: QA-P34-01a 1, 01d/01e 72, 01f 18, 01g 1; data 16 (demo-seed text 10, test-created checks 5, source label 1); **0 unclassified** |
| Arabic (RTL), P4 | 38 / 51 | **0** | 11 problems, all classified: QA-P34-01h 1; data 10 (demo-seed text 8, "TBD" 2); 0 unclassified (01c appears when the first DD request listed is partner-raised: single run, J3 and its own `DEFECT` test) |
| 390 px Arabic, P3+P4 | 63 | — | 2: perimeter item page (PM, Legal) 433 px wider than the viewport → QA-P34-03; 0 unclassified |

The P3 screens are **not in `a11y.spec.ts`** (QA-P34-02); this crawler is their only axe scan: 0 serious/critical in both
languages. Problems classified as **data** after checking the API: demo-seed texts ("DEMO — TSA charge: …", "DEMO — Board
resolutions …", "DEMO — counterparty access after Materials access."), benefit baseline / target value "TBD" (honesty-rule
placeholder stored as data), the agreement type "TSA" (stored as the source label, REQ-AGR-002), the demo plan's service-impact
text "Assessment pending — specialist (DEMO)", and readiness checks created by tests (no Arabic source).

Screenshots inspected (not only generated): `p3/perimeter-reconciliation-ar.png` as regenerated by the delivered `p3-carveout (d)`
in run A at `5bf274b` (English "Details" column — QA-P34-01a; the tracked copy was restored, the committed evidence is
`qa-p34/defect-qa-p34-01a-ar-reconciliation-findings.png`), `qa-p34/defect-qa-p34-01b-ar-tsa-escalation.png` (the Arabic
escalation panel shows the requested action and the routing target in English; its three options are Arabic — QA-P34-01b), `qa-p34/crawl-ar-readiness-checks.png` (every template check title in English, the area labels
under them Arabic — QA-P34-01d), `qa-p34/crawl-ar-390-perimeter-item.png` (page 823 px wide at 390 px; the consents table pushes
it — QA-P34-03).

Committed screenshots (`e2e/screenshots/qa-p34/`, 38 files): the journey, state and `DEFECT` shots and 16 crawler screens
(`crawl-*.png`); the crawler writes all ~390 screens to `qa-p34/crawl/` on each run (not committed).

### 5.3 Regression net

The crawler keeps failing on any **unclassified** problem; the classified ones (each with its own `DEFECT` test or verified as
data) are printed with their id. Run B result: §2.3.

## 6. States, Demo badge, Simulated labels (`e2e/tests/qa-p34-states.spec.ts`, 4/4 passed)

- **Restricted (404 → restricted):** a Project-B user opening 13 DEMO-DC P3/P4 URLs (perimeter, item, NewCo, entity, readiness,
  TSA, plan, finance, budget line, JV, partner, closing, room) sees the neutral restricted state and none of `DEMO-DC`, `PI-001`,
  `Demo NewCo`, `TSA-002`, `Legacy monitoring bridge`, `CO-001`, `Day-1 go-live`, `DEMO-PA`, `Partner Alpha`, `CLO-001`, `BL-001`;
  DEMO-DC record ids under another project's URL (TSA, item, closing) show the restricted state too.
- **Error:** a 503 problem on the perimeter-item, TSA, partner and budget-line lists shows "service unavailable" with the
  correlation id; Retry recovers the table (4/4). **Loading:** the same lists delayed 3 s show the loading state first (4/4).
- **Empty:** a fresh DC project shows the empty state of the TSA register, partners, closings, approvals register and budget.
- **Demo badge:** present in the header of 8 DEMO-DC P3/P4 detail pages (item, entity, TSA, plan, partner, closing, room, budget
  line); absent on a record of the non-demo project.
- **Simulated:** P3/P4 have no integration or mock surface — `grep -ciE "connected|simulated|integration"` over the en catalogues
  `carveout, newco, readiness, finance, jv` → 0 each, and no "Connected" in the P3/P4 screens; nothing to label.

## 7. Requirement statuses — P3/P4 requirements marked Tested (sample of 24)

`python3 scripts/requirements/apply_status.py --check` → `status-evidence.yaml OK (263 entries)`; `apply_status.py` (apply +
render) → `applied 263 status updates; rendered 394 requirements; AT coverage 30/30` and **no diff** in `docs/requirements/`
(the register matches the overlay). The check only proves that cited files and quoted titles exist; the sample below reads
each cited test and states whether it asserts the requirement's acceptance test.

P3/P4 musts: 76 (P3 37, P4 39) — 72 Tested, 4 Implemented (REQ-RDY-006, REQ-UX-010, REQ-PHS-005, REQ-PHS-006).

| Requirement | Register AT | Cited test read | Asserts the AT? |
|---|---|---|---|
| REQ-LCY-006 | AT-06; UT confirming incorporation leaves the other dimensions unchanged | gates `at-06-status-dimensions` "recompute keeps incorporation verified…"; carveout `at-06` "Legal verifies…" | Yes |
| REQ-LCY-007 | AT-06; **E2E: cockpit** shows Incorporated alongside Transfer In progress | carveout `at-06`; e2e `p3-carveout (b)` | API yes; the E2E proof is on the **NewCo screen**, not the cockpit; evidence text stale ("the full run skipped it after (a) failed" — (a) passes at `5bf274b`) → QA-P34-04 |
| REQ-LCY-014 | UT independence lists TSAs / enduring arrangements | gates `at-06` "TSAs and approved enduring arrangements…"; readiness `at-10` dimension blocked | Yes |
| REQ-PER-003 | UT reconciliation flags categories with zero assessed items | carveout `carveout-rules` "reconciliation flags unassessed categories…" (`guarantee` unassessed → reviewed) | Yes |
| REQ-PER-005 | AT-07; IT post-baseline addition creates CR and preserves prior version | carveout `at-07` (CR, baseline unchanged before the decision) | Yes for the CR; "preserves prior version" only before the decision — completed by probe `p34-qa-p3-at07-probe` (passes) |
| REQ-PER-006 | UT reconciliation lists item with no transfer record | D `perimeter.test`; carveout `at-08` (findings incl. `no_transfer_plan`) | Yes |
| REQ-AGR-003 | UT agreement without legal reviewer cannot advance to Signing | carveout `carveout-rules` "stage is a command…" (`agreement.legal_reviewer_required`, `agreement.executed_copy_required`) | Yes |
| REQ-AGR-008 | AT-08; IT consent pending requires interim arrangement and owners **before G3** | carveout `at-08` (3 tests) | Yes for the Day-1 position; "before G3" is not automated — recorded honestly in the evidence (G3-C02 reviewed by its reviewer) |
| REQ-TSA-003 | AT-10; IT past end date → Expired-unresolved with escalation | readiness `at-10` "AT-10 / REQ-TSA-003…" (injected Clock, idempotent) | Yes (worker path in the UI: probe J1) |
| REQ-TSA-005 | AT-10; UT Extended without approved decision rejected | readiness `at-10` "REQ-TSA-005…"; `p2f-decision-reliance` | Yes |
| REQ-RDY-002 | UT DC checklist covers all listed domains | readiness `at-09` "REQ-RDY-002…" (14 areas, 31 checks, idempotent) | Yes |
| REQ-RDY-004 | AT-09; IT go rejected while a mandatory blocker failed | readiness `at-09`; e2e `p3-readiness` AT-09 | Yes (connectivity only; access/incident: probe `p34-qa-p3-at09-probe` + J2) |
| REQ-FIN-002 | UT TSA charge counted once across TSA and cost views | finance `finance-registers` "UT: TSA charge counted once…" (409, DB unique index, view not doubled) | Yes |
| REQ-FIN-004 | UT unreconciled intercompany difference flagged | finance `finance-figures` "UT: unreconciled intercompany difference flagged" | Yes |
| REQ-FIN-006 | UT approved value field empty until approval recorded | finance `finance-registers` "UT: approved value field empty…" (+ recommended decision refused) | Yes |
| REQ-JV-005 | IT NDA without grant cannot list room documents | jv `at-03` "IT: partner with an executed NDA…"; "a grant is refused while the partner is only at NDA…" | Yes |
| REQ-JV-010 | UT release without approval rejected | jv `jv-diligence` "UT: release without approval is rejected (and logged)…" | Yes (UI journey: probe J3) |
| REQ-JV-015 | UT funds flow record-only; no payment endpoint | jv `jv-closing-rules` "UT: funds flow is record-only…" (route scan, DB check) | Yes |
| REQ-JV-016 | UT overdue obligation escalates | jv `jv-closing-rules` "UT: overdue obligation escalates…" (schedule, injected Clock, idempotent) | Yes |
| REQ-JV-018 | AT-12, AT-13; IT confirm with one unverified blocking CP rejected and logged | jv `at-12` "IT: confirm with one unverified blocking CP…"; `at-13`; reviews `p4-domain-jv` regressions | Yes |
| REQ-DAT-004 | AT-29; SAR+USD without basis rejected; with basis shows source | finance `at-29` (3 cited tests) | Yes |
| REQ-SET-012 | **E2E**: wizard perimeter approval creates baseline perimeter version | carveout `setup-wizard` (API) | **No E2E** — the evidence itself says "no Playwright test drives the wizard step"; status Tested with its only AT unmet → QA-P34-04 |
| REQ-UX-011 / -012 | E2E record incorporation with evidence / failed blocker shown and go blocked | e2e `p3-carveout (b)(c)`, `p3-readiness` AT-09/AT-10 | Yes — evidence cites runs at `124f3d8`; re-run green at `5bf274b` (§2.3) |
| REQ-UX-013 / -014 | E2E restricted state / closing blocked shows unmet CPs | e2e `p4-finance`, `p4-jv` | Yes — evidence cites "261/261 at ef8ea27"; re-run at `5bf274b` (§2.3) |

Stale or inconsistent evidence (QA-P34-04): REQ-UX-010 (Implemented) still records `p3-carveout (a)` as FAILED at `124f3d8`
(F-13) — it passes at `5bf274b`; its remaining AT gap ("add perimeter item and see reconciliation update") is now exercised by
probe J5. REQ-PHS-005 says "P3 screens not yet in the axe scan list" — still true in `a11y.spec.ts`; this review's crawler
scans them (§5). REQ-LCY-007 and REQ-SET-012 as above.

## 8. Findings

| ID | Severity | Phase | Summary | Probe |
|---|---|---|---|---|
| DOM-P3-01, DOM-P3-09, DOM-P3-06 (P3 domain review) | **High** | P3 | GO accepted with a failed / unevidenced blocker; extension recorded to an unapproved date — AT-09 / AT-10 do not hold on the server | reproduced here (§2.4); not duplicated |
| QA-P34-01 | **Medium** | P3 (a, b, d, e, f, g), P4 (c, h) | English on Arabic screens where Arabic exists or should exist | `DEFECT QA-P34-01a … 01h` |
| QA-P34-02 | Low | P3 | The P3 screens (perimeter, NewCo, Day-1 & TSA) are in no axe regression scan | — (crawler scans them: 0) |
| QA-P34-03 | Low | P3 | At 390 px the perimeter item page is 823 px wide | `DEFECT QA-P34-03` |
| QA-P34-04 | Low | P3/P4 | Stale or inconsistent requirement evidence | — |
| QA-P34-05 | Info | P3/P4 | Coverage notes: the delivered AT-10 e2e never runs the worker; AT-12 "all workstreams green" is simulated; the AT-08 Day-1 tab content is asserted at API level only | J1 |
| QA-P34-06 | Info | P4 | Focus falls to `<body>` after Run in the aggregate dialog (the button is disabled while busy) | printed in J4 |
| QA-P34-07 | Low | P3/P4 (shared) | A row link clicked within the 300 ms search debounce is undone by the debounced `router.replace` when the navigation is slow — cause of both run-B failures (delivered `p3-readiness` test and J1) | `OBSERVED QA-P34-07` |

### QA-P34-01 — Medium — English on Arabic P3/P4 screens where Arabic exists or should exist

- **Requirement:** REQ-UX-001, REQ-UX-002 (and the module guide §2 "Bilingual server strings": server-computed explanations carry
  `<field>I18n` codes; template texts carry `<field>Ar`); screens REQ-UX-010, -012, -013, -014. Same class as QA-P2-04 (Medium).
- **Where / what** (each asserted by a `DEFECT` test in `e2e/tests/qa-p34-arabic-rtl.spec.ts`; printed evidence from the run):
  - **a** Perimeter reconciliation, "Details" column — `components/carveout/panels.tsx:65` renders `f.message` (`ReconciliationDto`
    findings have no `messageI18n`): `QA-P34-01a: … (4/4): ["Disposition (included/excluded/shared) not decided","No transfer
    mechanism and/or planned effective date","Pending item without owner, resolution path and target resolution gate
    (G1-C03)","A scope change awaits change-request decision"]`.
  - **b** TSA escalation — `readiness/tsa.service.ts:419, 613–616, 659` compose `requestedAction` and `target` in English; the page
    renders them raw: "TSA TSA-002 (…) reached its end date 2026-09-24 without an accepted replacement service. This is NOT an exit. …"
    and "DC Carve-out & JV Steering Committee (Demo) — within its delegated authority (tsa_approval_or_extension, matrix v1)".
  - **c** (P4) DD request of a partner-raised question — `jv/diligence.service.ts:405` stores `requesterLabel: 'Counterparty'`;
    shown as is (`QA-P34-01c: requesterLabel … "Counterparty"`).
  - **d** Readiness-check register — the list DTO returns `titleAr` (e.g. "اعتماد خطة التعافي من الكوارث") but the page shows the
    English title: `QA-P34-01d: template checks with an Arabic title: 31; shown in English on the Arabic register: 23; shown in
    Arabic: 0` (screenshot inspected).
  - **e** Cutover plan — the plan DTO's `checks[]` has no `titleAr`: `plan check fields: ["id","code","area","title",…]
    (titleAr present: false)`; `template check titles shown in English on the Arabic plan: 20 of 31`.
  - **f** Perimeter item — impact-assessment `summary` and history `reason` are English server sentences (no I18n):
    `(13/13): ["The change adds PI-003 (included); the carve-out financial statements / reporting perimeter must be reassessed —
    Assessment pending — specialist (Finance).", "Valuation assumptions may change — …", …]`, history "Created — held Pending under
    change control", "Change request CR-004 raised (requested: included)", "Applied: CR-004", "Transferability: consent_required".
  - **g** TSA page — workstream "Operations, Continuity & TSA" shown although `nameAr` = "العمليات واستمرارية الأعمال والخدمات الانتقالية".
  - **h** (P4) KPI page — `KpiDto` has no `definitionAr` although `packages/db/seed/templates/dc-carveout.v1.json` has
    `definition.ar` for `action_closure_time`; the Arabic page shows the English definition.
- **Not caught by the delivered tests:** `p3-carveout (d)` and `p3-readiness` take Arabic screenshots but assert only `dir` and a
  label; the shared detector cannot see a, b, c, f (no `Ar` / `I18n` sibling in the DTO).
- **Recommendation:** codes + parameters (`<field>I18n`) for reconciliation findings, impact summaries, history reasons and TSA
  escalation texts (and a code for the partner requester); return and use `titleAr` / `nameAr` / `definitionAr` where the template
  has them; extend `check-i18n.mjs` or the detector's allow-list so these DTO fields are covered.

### QA-P34-02 — Low — P3 screens are not in the axe regression scan

`e2e/tests/a11y.spec.ts` lists the JV and finance screens (both locales) but no perimeter, NewCo or Day-1 & TSA screen
(`grep "/perimeter\|/newco\|/readiness" a11y.spec.ts` → only `project-dimension`); REQ-PHS-005's evidence says so too. This
review's crawler found 0 serious/critical violations on all of them in both languages (§5.2), so no violation is open — the gap
is that a regression would go unnoticed. Recommendation: add the P3 screens (and a P3 dialog) to `SCREENS`.

### QA-P34-03 — Low — The perimeter item page overflows at 390 px

`DEFECT QA-P34-03` prints `overflow 433px; widest element {"tag":"section","testid":"","width":807}` (Arabic); the full-page
screenshot is 823 px wide (consents table of the item). REQ-UX-010 (390 px rendering). Recommendation: wrap the table in the
shared scroll region like the other registers.

### QA-P34-04 — Low — Stale or inconsistent requirement evidence

REQ-UX-010 (Implemented) still records `p3-carveout (a)` as FAILED at `124f3d8` (F-13) — it passes at `5bf274b`; REQ-LCY-007's E2E
evidence is the NewCo screen (the AT names the cockpit) and says "the full run skipped it after (a) failed"; REQ-SET-012 is Tested
while its only AT is an E2E that "no Playwright test drives"; REQ-PHS-005 "P3 screens not yet in the axe scan list" (still true,
QA-P34-02). Recommendation: refresh the evidence; set REQ-SET-012 to Implemented or record the AT variance as accepted by its
owner; cite J5 for REQ-UX-010's open AT.

### QA-P34-05 — Info — Coverage notes

The delivered AT-10 e2e creates a TSA past its end date that stays `active` (the worker never runs) — J1 now drives the worker
path through the UI. AT-12's "all workstreams green" is simulated by setting every task `done` with the owner pool (no workstream
RAG asserted). The AT-08 Day-1 positions tab is screenshotted only (API spec asserts the content).

### QA-P34-06 — Info — Focus leaves the aggregate dialog after Run

J4 prints `focus after the refused run (ar): BODY; refusal in aria-live: 1`: the Run button is disabled while the request runs, so
focus falls back to `<body>` (the refusal itself is announced through `aria-live`). Keyboard users must re-enter the dialog.

### QA-P34-07 — Low — A click within the search debounce is undone by the debounced URL update

- **Where:** `apps/web/src/components/SearchInput.tsx:14,33` (300 ms debounce) + the shared `useUrlState` filter hook
  (`router.replace(pathname?…)`), used by the P3/P4 registers.
- **Reproduction:** `OBSERVED QA-P34-07` in `e2e/tests/qa-p34-journeys.spec.ts`: detail navigation delayed 1.5 s; control without
  a pending search → "TSA detail shown"; after typing and clicking at once → `…/readiness/tsa?q=Legacy+monitoring+bridge; TSA detail
  shown: 0`. In run B the delivered `p3-readiness.spec.ts:407` (REQ-SET-004 / AT-10) and J1 failed at that step and passed on re-run.
- **Impact:** a user who clicks a row while the search is pending can be sent back to the list; the delivered e2e test is
  timing-dependent under load (it can fail CI spuriously).
- **Recommendation:** drop the pending `replace` once a navigation starts (or apply it only while the pathname is unchanged); in
  `p3-readiness.spec.ts` wait for the filter (URL `q`, one row) before clicking, as J1 now does.

## 9. Probe files and their results

| File | Tests | Result |
|---|---|---|
| `apps/api/test/reviews/p34-qa-p3-at07-probe.spec.ts` | `CONTROL` AT-07 previous version preserved after approval, apply and re-baseline | passed (run 3 + single runs) |
| `apps/api/test/reviews/p34-qa-p3-at09-probe.spec.ts` | `CONTROL` AT-09 failed access + incident blockers named exactly, failed optional check not | passed |
| `apps/api/test/reviews/p34-qa-p4-probes.spec.ts` | `CONTROL` AT-13 unauthorized approvals 403 **and** audited `denied`; `CONTROL` AT-29 summary / separation-cost groups per currency and unit | passed (2) |
| `e2e/tests/qa-p34-journeys.spec.ts` | J1–J5; `OBSERVED QA-P34-07` (added after run B) | run B: J2–J5 passed, J1 failed on the QA-P34-07 race → re-run passed; after the harness fix J1 and QA-P34-07 passed (`2 passed`) |
| `e2e/tests/qa-p34-states.spec.ts` | restricted, error + loading, empty, Demo badge | 4/4 passed (run B and single runs) |
| `e2e/tests/qa-p34-arabic-rtl.spec.ts` | 5 crawler passes + `DEFECT QA-P34-01a…01h`, `DEFECT QA-P34-03` (`test.fail()`) | run B: 14/14 (crawler 0 unclassified problems; the 9 `DEFECT` tests reproduce = expected failures) |

## 10. Verdict

**P3 — FAIL at `5bf274b`.**

- The P3 exit criterion "blockers prevent go-live" and the acceptance criteria of AT-09 and AT-10 do **not** hold on the server:
  the P3 domain review's High findings DOM-P3-01, DOM-P3-09 and DOM-P3-06 reproduce at this revision (§2.4). No PASS is possible
  with them open; they are the domain review's findings and are not duplicated here.
- Everything else that P3 asks of QA holds: AT-06, AT-07, AT-08, AT-09 and AT-10 are executed by API and UI tests that pass at
  `5bf274b` (§3); this review's probes (AT-07 previous version after re-baseline, AT-09 access + incident blockers, J1 worker
  expiry, J2 NO-GO, J5 reconciliation) pass; English screens and dialogs have 0 serious/critical axe violations; restricted,
  error, loading and empty states and the Demo badge work (§6).
- This review's P3 findings: **QA-P34-01 (Medium)** — the Arabic Day-1 & TSA Center and perimeter screens show English where
  Arabic exists or should exist (template check titles on the register and the plan, reconciliation details, impact
  assessments and history, TSA escalation, workstream name); Lows QA-P34-02 (no axe regression scan of P3 screens), QA-P34-03
  (390 px overflow of the perimeter item), QA-P34-04 (stale evidence), QA-P34-07 (search debounce race; cause of the only
  delivered-test failure in run B).
- To pass: DOM-P3-01/-06/-09 fixed with their probes turned into regressions; QA-P34-01 a, b, d, e, f, g fixed (the `DEFECT`
  tests turn red → rename "(fixed, regression)"); QA-P34-02/-03/-04/-07 fixed or carried with owners; a green full Playwright run
  on the gate revision.

**P4 — PASS WITH CONDITIONS at `5bf274b`.**

- No Critical or High from this review. AT-03, AT-11, AT-12, AT-13 and AT-29 are executed through the API and the UI and pass;
  the probes added here pass: unauthorized CP waiver approvals are refused **and** logged (AT-13), Finance summary and
  separation-cost views never add different currencies or units (AT-29), units vs thousands refused with the reason in the UI
  in English and Arabic (J4), the DD question → review → release → answer-in-the-room journey through the UI (J3). The P4 screens
  have 0 serious/critical axe violations in both languages (and are in `a11y.spec.ts`).
- Conditions: QA-P34-01 c and h fixed (requester "Counterparty" literal; KPI definition without its template Arabic);
  QA-P34-04 evidence refreshed; QA-P34-06 considered; the pending P4 domain re-review and the P3/P4 security review's P4
  conditions (SEC-P34-01, -03, -04) closed — cross-referenced, not re-verified here.

Known pre-existing failure of `5bf274b` (not a P3/P4 finding): `p2-qa-final-race.spec.ts` "both kinds of use are accepted on one
G1 decision …" (`422 perimeter.version.decision_no_subject`), lead-confirmed, fixed on the branch at `3735be4`.

## 11. NOT EXECUTED / not verified

- CI on `5bf274b`: not checked by this review (the lead reports CI run 48 at `5bf274b`: only the known API failure, Playwright passed).
- The P3 domain findings other than DOM-P3-01/-06/-09 and every P3/P4 security finding: cross-referenced, not re-verified.
- Screen-reader / manual assistive-technology testing: not performed (axe covers a subset of WCAG).
- Arabic screens of P3/P4 records created by other e2e specs were not individually inspected beyond the crawler's classification.
