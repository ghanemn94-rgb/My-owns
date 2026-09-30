# P2 QA gate review — Governance & Delivery (with re-verification of the P1 gate conditions)

| Item | Value |
|---|---|
| Reviewer | qa-test-engineer (independent; separate context; did not author the code under review) |
| Revision tested | **`1b30f48`** (`1b30f4886bb413c009745d55cb2f7c2881537b03`), head of `claude/mobily-transformation-hub` at the start of this review, frozen for every run below |
| Review branch | `worktree-agent-a6960822b49af9154` (adds only this report, one API probe spec, three e2e specs, one shared e2e helper and their screenshots; no implementation code changed) |
| Date | 2026-09-30 |
| Scope (Part A) | Master prompt §19 P2 row: committees, meetings, decisions, votes, actions, authority matrix; planning (WBS, tasks, milestones, deliverables, dependencies/CPM, baselines, change requests, RAID, status updates, RAG); business gates G0–G7 with evidence, reviewers, waivers, approvals (incl. DOM-P2-16); documents / evidence / source register; My Work; the P2 screens and the P2 web follow-ups |
| Scope (Part B) | Conditions of `docs/phases/P1-gate-report.json` assigned to QA: QA-P1R-02 (REQ-SRC-002, REQ-ARC-011), QA-P1R-03 (disposition vs register), the CI run 32 claim |
| **Verdict** | **FAIL** — 1 open **High** (QA-P2-01: one committee decision can back two change-request approvals when they run at the same time; the P2 exit criterion "block decisions outside authority" is bypassed through the API). Everything else in the required verification ran and passed; see §10 for the short list that turns this into PASS WITH CONDITIONS. |

---

## 1. Environment

- Reviewer worktree on `1b30f48`; `git status` clean before the review (only the files listed in §12 were added).
- Node 22.22.2, pnpm 10.33.0, PostgreSQL 16.13 (local cluster on :5432, already running; not restarted), Playwright 1.56.1 with Chromium from `/opt/pw-browsers`, 4 CPUs shared with other agents (load average 8–12 during the runs).
- Own databases only: `hub_test_p2qa` (API suite), `hub_test_p2qa_boot` (its throwaway boot database), `hub_test_p2qa_e2e` (e2e stack), `hub_test_p2qa_probe` (the adversarial probe spec, so it never reset the database of a running suite). Created with
  `HUB_DATABASES="hub_test_p2qa hub_test_p2qa_boot hub_test_p2qa_e2e" bash scripts/dev/pg-init-roles.sh` and `HUB_DATABASES=hub_test_p2qa_probe …`.
- E2E stack configured like the CI e2e job (`.github/workflows/transformation-hub-ci.yml`, job `e2e`): migrate with the container
  entrypoint, demo seed, API `dist/main.js` on **:4871** with `HUB_RATE_LIMIT_PUBLIC_PER_MINUTE=1000`, worker `dist/worker.js`, production
  web build with `HUB_API_URL` fixed at build time, `next start -p 3871`. Ports 3530/4530 belonged to another agent and were not touched.
- No Docker was started. Nothing started by others was stopped.

## 2. Commands and real results

### 2.1 Build, unit, integration, lint (all at `1b30f48`)

```
$ pnpm install --frozen-lockfile                      → Done in 4.4s
$ pnpm build:packages                                 → exit 0

$ pnpm --filter @hub/domain test
 Test Files  17 passed (17)
      Tests  357 passed (357)
$ pnpm --filter @hub/contracts test
 Test Files  2 passed (2)
      Tests  100 passed (100)

$ TEST_DATABASE_URL=postgres://hub_app:…@127.0.0.1:5432/hub_test_p2qa \
  TEST_DATABASE_MIGRATION_URL=postgres://hub_owner:…@127.0.0.1:5432/hub_test_p2qa pnpm --filter @hub/api test
 Test Files  80 passed (80)
      Tests  709 passed (709)
   Duration  978.56s
   (includes apps/api/test/reviews/p2-domain.spec.ts: all 12 DOM-P2 defect probes now pass without weakening,
    and apps/api/test/gates/dom-p2-16-gate-roles.spec.ts 11/11; confirms the "API 709/709" claim of the 1b30f48 commit)

$ pnpm lint                                           → exit 0 (run at the start, and again after this review's files were added: exit 0)
  apps/api:  module boundary check passed: 32 cross-module imports, 14 module edges, acyclic, only published surfaces
  apps/web:  i18n check passed: 18 namespaces, 5772 keys per language, 611 enum values translated in en and ar, 78 server message codes
             Hard-coded UI string check passed (self-test: 6 fixture violations detected)

$ python3 scripts/requirements/apply_status.py --check      → status-evidence.yaml OK (263 entries)
$ pnpm --filter @hub/db run validate:templates
  source map dc-carveout.v1: 7 reference headings → 9 workstreams, 25 WBS activities
  checks executed: 23824
  PASS — all checks passed
```

### 2.2 Adversarial probe spec (this review; §7)

```
$ (cd apps/api && TEST_DATABASE_URL=…/hub_test_p2qa_probe TEST_DATABASE_MIGRATION_URL=…/hub_test_p2qa_probe \
   npx vitest run test/reviews/p2-qa-adversarial.spec.ts --reporter=verbose --silent=false)
QA-P2-03 probe: late evidence 201; review state before decide stale; decide 201 approved; snapshot review basis == reviewed basis: true; …
QA-P2-01 probe: requests waiting before release 2
QA-P2-01 probe: approve statuses [201,201] codes ["approved","approved"]; change requests approved on the decision: 2
F-03 probe: agenda numbers [1,2,2]            (final run of the committed file: [1,1,1]; same 9 passed | 3 expected fail)
 Test Files  1 passed (1)
      Tests  9 passed | 3 expected fail (12)
```

The three `it.fails` probes (QA-P2-01, QA-P2-03, F-03) were first run as plain `it` and failed **only** at their defect assertion
(`expected 2 to be less than or equal to 1`, `expected false to be true`, `expected 2 to be 3`); they were then marked `it.fails` with the
finding id so the suite stays green while the defect is open and turns red once it is fixed.

### 2.3 End-to-end (Playwright)

Stack as in §1 (API :4871 with `HUB_RATE_LIMIT_PUBLIC_PER_MINUTE=1000` + worker; `env -u NODE_ENV HUB_API_URL=http://127.0.0.1:4871 pnpm --filter @hub/web run build`
→ exit 0; `next start -p 3871`; database `hub_test_p2qa_e2e` migrated with `node deploy/docker/api-entrypoint.cjs migrate` and seeded with
`node apps/api/dist/cli/seed-demo.js`; `/readyz` → `{"status":"ready"}`).

```
$ HUB_WEB_URL=http://127.0.0.1:3871 PLAYWRIGHT_BROWSERS_PATH=/opt/pw-browsers pnpm --filter @hub/e2e exec playwright test
Running 261 tests using 1 worker
  … p2-documents (a)–(d) ✓ · p2-gates (a)–(e) ✓ · p2-governance ✓ · p2-planning (a)–(c) ✓ · p2-web-followups (a)–(d) ✓ ·
    p3-carveout (a) AT-07 ✓ (F-13 fixed), (b)–(d) ✓ · p3-readiness ✓ · p4-finance ✓ · p4-jv ✓ · qa-p1-review ✓ · qa-p1r-arabic-rtl ✓
  261 passed (25.6m)
  a11y (regenerated docs/test-evidence/a11y-report.md, then restored): Scans 208 (104 screen states × 2 locales) —
  Gating result (serious/critical WCAG violations): PASS — 0

$ … playwright test tests/qa-p2-exit-journey.spec.ts tests/qa-p2-gate-review-journey.spec.ts      (this review)
  ✓ qa-p2-exit-journey …  owned, dated action; the owner reports done with evidence; the secretariat verifies closure;
    the sponsor verifies implementation (23.8s)
  ✓ qa-p2-gate-review-journey …  G0 of a fresh project: start → return → submit refused → endorse → reviewer cannot submit →
    owner submits → approver rejects with a reason (25.9s)
    [gate start dialog]    axe: 0 WCAG violation(s) (0 serious/critical), 14 rules passed
    [gate review dialog]   axe: 0 WCAG violation(s) (0 serious/critical), 15 rules passed
    [gate decision dialog] axe: 0 WCAG violation(s) (0 serious/critical), 15 rules passed
    markReady refused; translated explanation shown: false        (×2 — QA-P2-04)
    approve without a decision refused: The request breaks a business rule No approved governance decision is linked to gate G0 …

$ … playwright test tests/qa-p2-arabic-rtl.spec.ts                                                 (this review)
  ✘ 1 PM (known English remainders, QA-P2-04) …   [expected failure, test.fail — reached its final assertion on 6 screens]
  ✓ 2 PM: cockpit, Committee Hub, gates, gate review dialog, plan (WBS, cross-project + dialog), prerequisites panel + dialog,
      RAID changes, change request, documents
  ✓ 3 secretary: a recommended decision and its external-approval dialog (verified-evidence picker) in Arabic
  ✓ 4 sponsor: change-request approval above the limit is refused with a translated explanation and a decision picker;
      matrix approval dialog in Arabic
  ✓ 5 ids of another project: … restricted state and nothing of the gate (Arabic)
  ✓ 6 detector self-check: on the gate screen in English the detector reports English UI messages
  6 passed (1.2m)
    dialogs scanned with axe (0 serious/critical each): gate review, cross-project dependency, prerequisite, external approval,
    change-request approval, matrix approval
```

The full-suite run rewrote tracked screenshots and `docs/test-evidence/a11y-report.md`; they were restored with `git checkout`
(no tracked file changed by this review). Earlier runs of this review's own specs failed and were corrected as follows:
(1) the detector's `networkidle` wait never settled on My Work, which polls — it is now bounded to 10 s; (2) the gate-review journey
asserted a *translated* refusal for `gates.*` codes, which does not exist — it now asserts the refusal the user actually sees (the
server's reason in the dialog's alert) plus the unchanged state through the API, and the missing translation is part of QA-P2-04;
(3) screens that show English in Arabic were moved from the strict test into a `test.fail` test linked to QA-P2-04, so the strict
test covers the clean screens and the defect stays recorded. No assertion about product behaviour was weakened.

## 3. P2 exit criteria (§19 P2 row)

| Criterion | Evidence (executed here) | Result |
|---|---|---|
| Committee / meetings / decisions / actions | API `governance/*` (7 files) green in the 709; e2e `p2-governance`, `p2-web-followups` (a)(b) | Met |
| WBS / RAID / change / baselines / gates | API `planning/*`, `gates/*` green; e2e `p2-planning`, `p2-gates` (a)–(e), `p2-web-followups` (c)(d) | Met |
| Initial dashboard | Cockpit renders dimension cards and the delay-impact tile; the **top decisions / blockers** and **committee asks** tiles are still `NotImplementedYet` labelled **P2** (`apps/web/src/app/(app)/projects/[projectId]/page.tsx:196-197`; F-05, REQ-UX-005 Implemented) | **Partly met** (QA-P2-02) |
| Decision request → authorized approval → action → closure evidence (REQ-PHS-004) | API `governance/decision-lifecycle.spec.ts` steps 1–11 (green); UI up to "Approved / Implementation pending" in `p2-governance.spec.ts`; **the rest of the journey in the UI** by this review's `qa-p2-exit-journey.spec.ts` (action with owner and due date → owner reports done with evidence → secretariat verifies closure → sponsor verifies implementation → Implemented — verified; then the decision and actions checked in Arabic) — passed (23.8s), strict Arabic check of the decision and actions pages passed | **Met** (API and UI) |
| Block decisions outside authority | AT-04 specs (governance + gates), `p2-governance-authority` (DOM-P2-03, -12), `p2-gate-authority-reassessment` (DOM-P2-01) and the DOM-P2 probes are green: sequential attempts are refused and audited. **Bypass under concurrency: QA-P2-01** — two change requests above the delegated limit approved at the same time on one committee decision (reproduced 3/3 deterministically; without any lock, in 2 of 4 runs of 4 simultaneous requests) | **Not met** (QA-P2-01, High) |
| Domain plus QA review | Domain review `docs/reviews/P2-domain-review.md` verdict **FAIL** at `4f05318`; its fixes are recorded by the implementers (fix-status sections) and its 12 probes pass here, but **no independent domain re-review** has been recorded. This QA review: FAIL (QA-P2-01) | **Not met yet** (condition C2) |

## 4. Acceptance tests mapped to P2

Mapping: every `AT-xx` in the `acceptance_tests` of the 85 `phase: P2` requirements (`docs/requirements/requirements.yaml`), plus AT-01
(requested; P2 screen REQ-UX-016). "Green" = passed in the runs of §2 at `1b30f48`.

| AT | P2 requirements | Executed tests (API unless marked e2e; number of tests) | Result at `1b30f48` |
|---|---|---|---|
| AT-01 historical statuses | (UX-016 screen; SRC-003/004 are P1) | `documents/at-01-historical-claims` (6), `documents/at-01-claim-verification` (6, incl. DOM-P2-04), D `documents.test.ts`; e2e `p2-documents` (c) | **Pass** |
| AT-03 isolation | ENT-010, ENT-013, UX-016, UX-021 | `documents/at-03-documents-isolation` (12), `planning/cross-project-and-prerequisites` (10), gates "Project isolation" (`gate-evaluation-rules`); this review's probes #6–#10; e2e `p2-documents` (b), `p2-web-followups` (c), `qa-p2-arabic-rtl` (foreign gate ids) | **Pass** (ENT-010 variance O-2) |
| AT-04 decision outside delegation | GOV-010, GOV-022, GOV-023, UX-007, PHS-004, SET-013 | `governance/at-04-decision-outside-delegation` (6), `gates/at-04-gate-blocked-by-recommendation` (6), `governance/p2-governance-authority` (18; DOM-P2-03, -12), `gates/p2-gate-authority-reassessment` (9; DOM-P2-01), `reviews/p2-domain` DOM-P2-01a/b, -03a/b; e2e `p2-web-followups` (a) (recommendation → external approval only on evidence verified by a second person → change above the limit refused, then approved on that decision, all in the UI), `p2-gates` (d) | **Pass sequentially; fails under concurrency (QA-P2-01)** |
| AT-05 quorum, recusal, self-approval | GOV-015, GOV-016, GOV-022, SEC-004, SEC-005, PHS-004 | `governance/at-05-quorum-recusal-self-approval` (9), `p2-governance-authority` (DOM-P2-02, -06, -13, -20), `reviews/p2-domain` DOM-P2-02/-06; probes #4, #11; e2e `p2-governance` (recused vote refused in the UI), `p2-web-followups` (a) (recusal after a vote refused, translated) | **Pass** (declarations not required before voting: F-01 / GOV-015 Implemented) |
| AT-06 (UX-005 side) | UX-005 | `gates/at-06-status-dimensions` (6), `carveout/at-06-incorporation-separate`; e2e cockpit dimension cards (`p1-smoke`, `a11y`), `p3-carveout` (b) | **Pass** for the dimensions; the cockpit's P2 tiles are placeholders (QA-P2-02) |
| AT-07 (P2 side: change control) | PLN-013, UX-015 | `carveout/at-07-perimeter-change-control` (9), `planning/at-16` "re-baselining … previous baseline is preserved"; e2e `p3-carveout` (a) AT-07 (F-13 fixed), `p2-web-followups` (a) (`costImpact`) | **Pass** |
| AT-12 (gate side) | LCY-011, PLN-018 | `gates/at-12-gate-side` (2), `gate-evaluation-rules`, `planning/measurement` (8) | **Pass** (CP side is P4) |
| AT-13 non-waivable / unauthorized waiver | LCY-012, LCY-013 | `gates/at-13-non-waivable` (9), `readiness/readiness-waiver-n02`; e2e `p2-gates` (c) | **Pass** |
| AT-14 conflicting / defective evidence | DAT-014, LCY-015 | `gates/at-14-reassessment` (4), `gates/p2-gate-authority-reassessment` (DOM-P2-05), `documents/at-14-conflicting-evidence` (7), `documents/at-01-claim-verification` (AT-14 part, DOM-P2-19), `reviews/p2-domain` DOM-P2-05 | **Pass** |
| AT-15 predecessor delay | PLN-008, PLN-009, PLN-023, PLN-024, UX-008 | `planning/at-15-delay-impact` (7), `planning/schedule-rules`, D `schedule.test.ts` | **Pass** (PLN-023 AI-schema part re-phased to P5; UX-008 Gantt critical path not asserted in e2e) |
| AT-16 concurrent baseline / approval changes | PLN-004, PLN-013 | `planning/at-16-baseline-concurrency` (5), `governance-integrity` (stale command 409); probes #1 (gate review 409), #4; e2e `p2-planning` (a) (stale version → 409 "reload and review" in the UI) | **Pass for conflicts on one record; cross-record decision re-use race QA-P2-01** |
| AT-19 access revoked after scheduling | PLT-008 | — (REQ-PLT-008 Deferred to P6, DOM-P2-11) | **Not in P2** (Deferred, recorded) |
| AT-25 malicious / oversized upload | SEC-013 | `documents/at-25-file-safety` (11), D `documents.test.ts` | **Pass** (enterprise scanner Not configured) |
| AT-27 legal hold | DAT-010 | `documents/at-27-legal-hold` (7), `p1/projects-templates-audit` | **Pass** |
| AT-30 (governance part) | GOV-018, UX-018 | `governance/decision-lifecycle` (11); e2e `p2-planning` (b) (approval found in My Work); this review's e2e `qa-p2-exit-journey` (action → verified closure → implementation verified, UI) | **Pass** (governance part; AT-30 as a whole is P8) |

## 5. Spot-check of P2 requirements marked Tested (20)

For each: the cited test exists (`apply_status.py --check` OK, and opened here), it passed in §2, and I read what it asserts against the
requirement's statement / AT.

| Requirement | Cited test(s) opened | Passed here | Checks what the requirement says? |
|---|---|---|---|
| REQ-GOV-010 no approval authority before delegation approved | `governance-integrity` "the Demo matrix can be drafted but not approved (422, audited)…"; `p2-governance-authority` "baseline approval is refused while no approved matrix exists"; "a non-demo matrix needs its approval document…" | yes | Yes — 422 + audit row + version stays draft + no active matrix; baseline refused without an approved, verified matrix |
| REQ-GOV-016 voting, attendance, recusal records | `decision-lifecycle` step 5 (duplicate vote refused), tie test in `p2-governance-authority`, circulation in `governance-integrity`, vote immutability in `at-05` | yes | Yes. This review adds: a concurrent double vote by one member gives one row and a 4xx, never 500 (unique `vote_uq`) |
| REQ-GOV-018 actions and verified closure | `decision-lifecycle` step 7 | yes | Yes — only the owner reports, evidence required (422), self-verification 403 + audit; UI journey added by this review |
| REQ-GOV-020 approval ≠ execution | `decision-lifecycle` steps 6, 8; D `governance.test.ts` | yes | Yes — verify-implementation before tracking 422; tracking needs an owned, dated action (422 `no_actions`); verifier ≠ starter (403) |
| REQ-GOV-021 frozen meeting packs | `decision-lifecycle` step 10 | yes | Yes — the pack keeps "under_review" after the decision became implemented_verified; DB rejects edits; re-freeze links a new version |
| REQ-GOV-022 approvals enforce delegated authority | `at-04-decision-outside-delegation`, `p2-governance-authority` DOM-P2-03, `p2-gate-authority-reassessment` DOM-P2-01 | yes | Yes for sequential requests. **Not under concurrency** — QA-P2-01 |
| REQ-GOV-023 out-of-mandate → recommendation | `at-04-*` (both), `p2-governance-authority` DOM-P2-12 | yes | Yes. Evidence text is stale ("the external-approval dialog … fails with 422 until the P2 web follow-up merges"); the dialog works — `p2-web-followups` (a) (QA-P2-06) |
| REQ-GOV-024 historical votes immutable | `governance-integrity` "ending a seat keeps the seat, its votes and the recorded tally…"; `at-05` vote immutability | yes | Yes — votes and tally snapshot equal before/after; retroactive end refused (422) |
| REQ-LCY-010 complete gate structure | `dom-p2-16-gate-roles` (11), D `gates.test.ts`, e2e `p2-gates` (d) | yes | Yes — roles incomplete → 422; owner / reviewer / approver separation (403s audited). Gap after submission: QA-P2-03 (Low) |
| REQ-LCY-013 waiver authority and record | `at-13-non-waivable` | yes | Yes — wrong authority 403, self-approval refused, basis + impact, criterion waived only by the authority role |
| REQ-LCY-015 controlled reassessment | `at-14-reassessment`, `p2-gate-authority-reassessment` DOM-P2-05 | yes | Yes — approved cycle never modified, flagged, cycle 2 created, cycle 1 preserved; fresh gate review needed |
| REQ-PLN-004 baseline versions vs forecast | `at-16-baseline-concurrency`, `arch-rereview-hardening`, `at-15-delay-impact` | yes | Yes — snapshot + hash frozen (DB), forecast kept apart, one of two concurrent approvals 409 |
| REQ-PLN-006 prerequisites (decisions, gates, agreements, approvals, evidence) | `cross-project-and-prerequisites` DOM-P2-18 (3) | yes | Yes — pending agreement blocks start (422, audited); evidence counts only when verified by another person. Evidence text stale ("prerequisites screen is in progress") — QA-P2-06 |
| REQ-PLN-013 change requests and re-baseline | `at-16`, `p2-governance-authority`, e2e `p2-planning` (b) | yes | Yes (API and UI). Evidence text stale ("costImpact … in progress") — QA-P2-06 |
| REQ-PLN-018 green average never hides red | `measurement` "an open blocker makes the workstream red and the project red…"; D rules | yes | Yes — project aggregate red, red-critical lists the workstream |
| REQ-PLN-020 unknown / stale never green | `measurement` "an update older than the freshness window is Data stale — never green" | yes | Yes — calculated `stale`, effective not green, reported vs calculated side by side |
| REQ-PLN-021 manual RAG override | `measurement` (expiry validation; requester cannot approve own override) + D rules (expiry reverts) | yes | Yes |
| REQ-SEC-004 no self-approval | `at-05`, `at-16`, `measurement` (second role) | yes | Yes — including a second role (the submitter granted `secretary_cpmo` still 403, audited). This review adds: the requester of a recommendation cannot record its external approval (403) |
| REQ-SEC-005 protected quorum | `at-05` "a client cannot supply its own quorum…", `p2-governance-authority` DOM-P2-06/-20 | yes | Yes — client quorum fields ignored (server says no quorum, 422); attendance frozen while voting |
| REQ-DAT-014 reassessment on change | `p2-gate-authority-reassessment` DOM-P2-05, `at-03-documents-isolation`, `at-06-status-dimensions` | yes | Yes — superseding relied-upon evidence flags the approved gate through the worker job |

Result: 20/20 cited tests exist and pass, and 20/20 check their requirement; two carry a caveat that is a finding of this review
(GOV-022 → QA-P2-01, LCY-010 → QA-P2-03), and four have stale evidence text (QA-P2-06).

## 6. P2 UI journeys, English and Arabic (RTL)

All UI evidence below comes from the Playwright runs of §2.3 against the production build. "Inspected" = I opened the PNG and read it.

### 6.1 P2 journeys (English)

| Journey | Test | Result |
|---|---|---|
| Committee Hub: paper → agenda → meeting → attendance/quorum → votes → server outcome; recused vote refused | `p2-governance` | Pass |
| External approval on verified evidence (verifier cannot record); change above the limit refused (text-only cost, then outside authority) and approved on the final decision via the **decision picker**; `costImpact` recorded as money | `p2-web-followups` (a) | Pass |
| Matrix approval needs an approval document, stays "awaiting verification", drafter cannot verify, Legal verifies → in force | `p2-web-followups` (b) | Pass |
| Cross-project dependency: both ends to readers of both projects, nothing to the sponsor (one project), closed with a reason | `p2-web-followups` (c) | Pass |
| Prerequisite blocks starting a task; refusal translated in English and Arabic; removed | `p2-web-followups` (d) | Pass |
| Gates list / criterion met only with evidence by another reviewer / non-waivable refused / non-final decision refused, PM endorses in the UI | `p2-gates` (a)–(d) | Pass |
| **DOM-P2-16 in the UI** — owner (secretary) starts G0; reviewer (PM) **returns** with a note; owner's submit refused ("returned for rework"); PM **endorses**; the PM's own submit refused ("the gate reviewer who endorsed the assessment cannot also submit it"); owner submits; neither owner nor reviewer is offered the decision; the approver (sponsor) cannot approve without a final governance decision; the approver **rejects** with a reason | `qa-p2-gate-review-journey` (this review) | Pass. A UI approval on a final decision is covered by the API (`dom-p2-16-gate-roles`); the UI rejection path is used here to avoid building a non-demo governance fixture |
| P2 exit journey after approval: action, tracking, report done with evidence, verification by the secretariat, implementation verified by the sponsor | `qa-p2-exit-journey` (this review) | Pass |
| Plan: task confirmed, stale version → 409 "reload and review"; change request and re-baseline; cockpit tile / workspace / timeline | `p2-planning` (a)–(c) | Pass |
| Documents: upload → version → evidence → verification by another person; project B sees nothing; AT-01 claims | `p2-documents` (a)–(c) | Pass |

### 6.2 Arabic (RTL)

Checked by `qa-p2-arabic-rtl.spec.ts` and the Arabic steps of the two journey specs: `<html lang="ar" dir="rtl">`, the untranslated-text
detector of `qa-rtl-detector.ts` (English UI catalogue messages and English halves of bilingual API fields; the self-check proves it
reports English on an English screen), and for dialogs: accessible name, focus inside, **Escape closes**, axe on the open dialog.

- **Clean (strict assertions pass):** cockpit, Committee Hub, gates list, G0 detail with the gate-review panel and **Review assessment**
  dialog, WBS, cross-project tab and its dialog, prerequisites panel and dialog, RAID change requests, change-request detail and the
  approve dialog (refusal `change_control.outside_delegated_authority` explained in Arabic, decision picker shown), NewCo board with the
  **matrix approval** dialog, the recommended-decision callout and the **external-approval** dialog, the decided G0 of the gate-review
  journey, the implemented decision and its actions (exit journey), and the foreign-id pages (restricted state; nothing of the gate, no
  "DEMO-DC" text for a Project B user).
- **English remainders (QA-P2-04; recorded with `test.fail`):** task detail (description, output, acceptance criteria, dependency titles,
  effort text and raw enum keys `approved_document` / `assumed`), plan Health (workstream names in the data-quality list and red-critical
  card, RAG explanations, data-quality issues, "Schedule incomplete …"), plan Timeline (schedule assumptions), My Work (template task
  titles, the gate name "Mandate & Governance"), decision detail (authority reason), decisions list (English demo-seed titles — data, the
  QA-P1R-05 remainder). Gate refusals (DOM-P2-16 codes) show only the server's English detail.
- **Inspected PNGs** (`e2e/screenshots/qa-p2/`): `ar-p2-gate-review-dialog` (title, list, outcome select, note and buttons in Arabic,
  RTL alignment correct); `ar-p2-cr-approve-refused-dialog` (Arabic headline and explanation; the server detail is labelled and LTR;
  "Delegating authority — to be confirmed" is English DEMO-policy data); `ar-p2-external-approval-dialog` (Arabic; "Board of Directors
  — to be confirmed" is DEMO-policy data); `ar-p2-my-work` (Arabic chrome, English task titles and "Mandate & Governance");
  `ar-p2-gate-review-journey-rejected` (Arabic throughout except user-entered notes and persona names); `ar-p2-plan-health` and
  `ar-p2-task-detail` (English as listed above). In `ar-p2-plan-health` the data-quality column looks cut at the left edge: measured with
  a scratch script, the table sits in a labelled, keyboard-focusable scroll region (`role="group"`, `tabindex="0"`; scrollWidth 1005 >
  clientWidth 966 in Arabic, 1094 > 966 in English), so the column is reachable by scrolling — no finding. The task detail's dependency
  column is narrow (titles wrap word by word) — cosmetic, no finding.
- No console errors or page errors in any of these runs (`watchConsole`).

### 6.3 Broken states and restricted access

- A gate id of another project under a project URL, and a DEMO-DC gate for a Project B user: restricted state, no gate data, no project
  name (Arabic) — `qa-p2-arabic-rtl` test 5.
- 409 on a stale version in the UI: `p2-planning` (a), `p1-smoke` (e). Server refusals are shown in the dialog with a correlation id and
  the command is not applied (checked through the API after each refusal in the journey specs).

## 7. Adversarial tests (API; `apps/api/test/reviews/p2-qa-adversarial.spec.ts`)

Every probe goes through the real HTTP API of the Nest app and a real PostgreSQL database (own project `QA-P2-ADV` created through the
portfolio API; DEMO matrix in force). The Demo Project Manager is a member of both `QA-P2-ADV` and `DEMO-DC`, so each cross-project id
below is visible to the caller in its own project — a 404 proves the id is bound to the project in the path, not a lack of access.

| # | Area | Probe | Result |
|---|---|---|---|
| 1 | Concurrency / 409 | Two designated G0 reviewers (PM, and the chair who also holds `project_manager`) endorse the same cycle version at the same time | Pass — `[201, 409]`, one `gates.assessment.review_endorse` audit row, the stored reviewer is the winner; the pre-review version then gets 409 on review and on mark-ready |
| 2 | Stale endorsement | After the endorsement, Legal verifies the evidence of G0-C01 | Pass — review state `stale`; mark-ready 422 `gates.assessment.review_stale` |
| 3 | Stale endorsement after submission | After mark-ready, a contributor links new evidence to G0-C02; the sponsor decides | **Defect QA-P2-03** — evidence 201, review state `stale`, decide **201 approved**; the decision snapshot keeps the old review basis and relies on the unreviewed link |
| 4 | Concurrency (votes) | The chair double-submits the same vote at the same time | Pass — one vote row; the duplicate is refused with 409/422 (never 500) |
| 5 | Re-used decision under concurrency | Two change requests of 1,200,000 SAR (each above the DEMO limit of 1,000,000, each covered by the decision) approved on **one** externally approved 1,500,000 SAR decision at the same time | **Defect QA-P2-01** — both 201 `approved`; both audit rows `planning.change_request.approve` carry `authority.basis = governance_decision` and the same `decisionId` |
| 6 | Cross-gate / cross-project ids | A G1 criterion under G0's URL; a DEMO-DC criterion under this gate; evidence on a DEMO-DC criterion | Pass — 404, 404, 404 |
| 7 | Cross-project ids (prerequisites) | Successor task of DEMO-DC; decision of DEMO-DC; evidence link of DEMO-DC | Pass — 404 ×3, no `record_dependency` row |
| 8 | Cross-project ids (dependency) | Cross-project dependency whose **local** item is a DEMO-DC task | Pass — refused, no row |
| 9 | Cross-project ids (governance) | Agenda request for a DEMO-DC decision; external approval citing a DEMO-DC evidence link | Pass — 404, 404; decision stays `recommended` |
| 10 | Cross-project ids (matrix) | Non-demo matrix approval citing a DEMO-DC document | Pass — refused; version stays `draft`, `approved_by` null |
| 11 | Separation of duties | The secretary who drafted a recommendation tries to record its external approval | Pass — 403, decision unchanged; the chair then records it (201) |
| 12 | Concurrency (agenda numbers) | Three agenda requests accepted onto one meeting at the same time | **Defect F-03 (still open)** — numbers `[1, 2, 2]`; `[1, 1, 1]` in another run |

Separation-of-duties cases already covered by the existing suite and re-run green here (not duplicated): requester vote / outcome / review
(`at-05`), baseline proposer (`at-16`), change-request requester (`p2-governance-authority`), waiver requester (`at-13`), evidence verifier
cannot record the external decision, matrix drafter / approver cannot verify, gate starter cannot review, endorsing reviewer cannot submit
or decide, submitter cannot decide (`dom-p2-16-gate-roles`), action owner cannot verify closure (`decision-lifecycle`).

## 8. Findings

| ID | Severity | Summary | Status |
|---|---|---|---|
| QA-P2-01 | **High** | One committee decision backs two change-request approvals under concurrency (authority bypass) | Open — blocks the gate |
| QA-P2-02 | Medium | 23 P2 musts committed to "close before the P2 gate" still open, incl. the cockpit's P2 tiles | Open — gate condition |
| QA-P2-04 | Medium | P2 screens show English in Arabic where Arabic exists or should exist (REQ-UX-001) | Open — gate condition |
| QA-P2-03 | Low | Gate endorsement not re-checked after submission | Open |
| F-03 | Low | Agenda numbers duplicate under concurrent screening (reconfirmed) | Open |
| QA-P2-05 | Low | Evasions of the SRC-002 validator and the ARC-011 boundary checker | Open |
| QA-P2-06 | Low | Stale evidence and status documents after the P2 web follow-ups | Open |
| QA-P2-07 | Info | CI run on the reviewed revision cancelled | Open |

Severity scale: the one used by the P2 domain review — **High** = a mandatory rule named in the spec or a P2 exit criterion can be
bypassed through the API, or the implementation contradicts the platform's governance rule; **Medium** = a mandatory requirement is
missing or partly enforced; **Low** = precision, documentation or hardening gap.

### QA-P2-01 — High — One committee decision backs two change-request approvals when they run at the same time

- **Requirement / rule:** P2 exit criterion "block decisions outside authority"; REQ-GOV-022, REQ-PLN-013, AT-04, AT-16;
  `docs/governance/decision-workflow.md` invariant A and the DOM-P2-03 fix ("the decision must … back one approval only",
  `change_control.decision_already_used`).
- **Where:** `apps/api/src/modules/planning/change-control.service.ts` `evaluateAuthority` (lines ~745–763): the "already used" test is a
  `SELECT … limit 1` on other approved change requests with the same `decision_id`, inside a READ COMMITTED transaction, with no lock on
  the decision row and no unique constraint (`packages/db/src/schema/planning.ts`: `change_request.decision_id` has only the
  project FK). `crCommand` locks only the change request being approved, so approvals of **different** change requests do not serialize.
- **Reproduction (executed, `p2-qa-adversarial.spec.ts` "two change requests above the delegated limit approved at the same time on ONE
  final decision"):** a 1,500,000 SAR `change_request_budget` decision is recommended by the committee and externally approved on
  verified evidence; two change requests of 1,200,000 SAR each (each above the DEMO limit of 1,000,000 and each covered by the
  decision) are under review; the sponsor approves both with `decisionId` = that decision. A test-only owner transaction holds a
  table lock on `outbox_event` (the last write of an approval) until both requests wait, so the interleaving is deterministic:
  `approve statuses [201,201] … change requests approved on the decision: 2` — 3 runs out of 3. Without any lock, four simultaneous
  approvals gave two approvals (`[201,201,422,422]`, `[422,201,422,201]`) in 2 of 4 runs. Both audit rows read
  `planning.change_request.approve | success | … | governance_decision | <same decisionId> | 1200000.0000`.
- **Impact:** 2,400,000 SAR of change is approved on an authorization for 1,500,000 SAR; the second approval is outside the
  sponsor's delegated authority and is backed by an already-used decision. The audit trail shows it afterwards, but the rule is
  not enforced. Needs two approvals submitted within the same short window (two approvers, two browser tabs, or a script).
  Baselines are not affected in practice (only one proposed baseline can exist: `baseline_one_proposed_uq`); gate approvals are bound
  by gate key and prior cycles of the same gate.
- **Recommendation:** lock the decision row (`SELECT … FOR UPDATE` on `decision` in `evaluateAuthority`) before the "already used"
  query, and add partial unique indexes as a backstop — `change_request (decision_id) WHERE status IN ('approved','implemented')` and
  `baseline_version (decision_id) WHERE status IN ('approved','superseded')` (migration is lead-owned) — mapping a unique violation
  to `409` / `change_control.decision_already_used`, never 500. Then drop `.fails` from the probe (it asserts `approved ≤ 1` and no 5xx).

### QA-P2-02 — Medium — 23 P2 musts committed to "close before the P2 gate" are still open, including the P2 dashboard tiles

- **Where:** `docs/phases/P2-P4-requirement-disposition.md` §3 (P2) versus the register at `1b30f48` (compared
  row by row with a scratch script; not committed): 15 rows "Close before P2 gate" (GOV-002, GOV-013, GOV-014, GOV-015, GOV-019, GOV-027,
  PLN-002, UX-005, UX-006, UX-008, UX-009, UX-015, UX-023, UX-024, DAT-013) and 8 conditional ones (SET-013, SET-014, GOV-008,
  GOV-009, GOV-012, WS-003, UX-018, UX-022 — "close before the gate or re-phase / accept") are all still `Implemented`. Only REQ-LCY-010
  moved (to Tested, DOM-P2-16). Register P2: 56 Tested / 27 Implemented / 2 Deferred.
- **Notable:** the P2 required output "initial dashboard" still renders the **top decisions / blockers** and **committee asks** tiles as
  `NotImplementedYet` labelled **P2** (`apps/web/src/app/(app)/projects/[projectId]/page.tsx:196-197`; F-05, also QA-P1R observation
  O-1); REQ-GOV-015 (conflict declarations not required before voting, F-01, Medium) and REQ-GOV-014 (DOM-P2-14) are open behaviour
  gaps, not only missing tests.
- **Recommendation:** before the gate report, close each item or re-phase it explicitly (target phase, owner, reason) as done for P1
  (QA-P1R-02 precedent). The cockpit tiles and GOV-015 should be decided by the lead, not left as test debt.

### QA-P2-03 — Low — The gate endorsement is checked at submission only; the approver can decide on evidence nobody reviewed

- **Where:** `gates.service.ts` `decide` checks roles, separation of duties and the re-evaluated criteria, but not
  `gateReviewState(…) === 'endorsed'`; the documents module (`evidence.service.ts` `link` / `verify`) does not look at the gate cycle
  state, so evidence of a criterion can be added, verified or superseded while the cycle is `ready_for_decision`.
- **Reproduction (executed, probe #3):** G0 endorsed by the PM and submitted by the secretary; a contributor then links new evidence
  to G0-C02 (201); the gate shows review state `stale`; the sponsor decides with a final decision → **201 approved**. The decision
  snapshot's `review.basis` is the old one, and G0-C02's `activeEvidenceLinkIds` include the unreviewed link.
- **Mitigation already in place:** criterion statuses are frozen in `ready_for_decision` (422 `gates.assessment.not_editable`); a
  rejected or conflicting link turns the criterion unmet / conflicting and blocks the decision; the snapshot records what was relied on.
- **Recommendation:** in `decide`, refuse (422 `gates.assessment.review_stale`) when the current basis differs from the recorded one,
  or refuse evidence changes on criteria of a submitted cycle until it is sent back to assessment. Then drop `.fails` from probe #3.

### F-03 (disposition finding, reconfirmed) — Low — Agenda numbers are not unique under concurrent screening

- Reproduced (probe #12): three agenda requests accepted onto one meeting at the same time get numbers `[1, 2, 2]`, and `[1, 1, 1]` in another run
  (`meetings.service.ts` `screenAgendaRequest`: `max(number) + 1`, no lock, no unique index). REQ-GOV-013 remains Implemented.

### QA-P2-04 — Medium — P2 screens show English in the Arabic UI where Arabic exists or should exist (REQ-UX-001)

Found by `qa-p2-arabic-rtl.spec.ts` (known-remainders test, recorded with `test.fail`) and by inspecting the PNGs (§6.2):

| Screen (P2) | English shown in Arabic | Cause |
|---|---|---|
| Task detail (Integrated Plan) | description, output, acceptance criteria, effort text; raw enum keys `approved_document` (evidence type), `assumed` (duration basis) | the template has Arabic for these fields; the task DTO carries only `titleAr` |
| Task / milestone dependencies panel | predecessor / successor titles | `NodeDependencies` shows `predecessorTitle` / `successorTitle`; no Arabic in the dependency DTO |
| Plan Health | workstream names in the red-critical card and data-quality list (Arabic names exist), RAG explanations, data-quality issues, "Schedule incomplete …" | planning contracts define no `…Ar` / `…I18n` for `label`, `explanation`, `reason`, `issue` |
| Plan Timeline | schedule assumptions | `assumptions: string[]` |
| My Work (screen 15) | template task titles, gate names ("Mandate & Governance") | `MyWorkItemDto` has no Arabic title |
| Decision detail | authority reason ("Decision type … is reserved for …") | server rule text rendered `lang="en"` by design |
| Gate dialogs (DOM-P2-16) | refusal detail of every `gates.*` code | no `gates.*` entry in `apps/web/src/lib/refusals.ts` (governance, change-control and prerequisite refusals do have one) |

The English texts are marked `lang="en" dir="ltr"`, so screen readers switch language and nothing is misrepresented. But REQ-UX-001
("all visible strings") and the CLAUDE.md convention (template-seeded names carry `<field>Ar`; server explanations carry `<field>I18n`)
are not met on these P2 screens, and only part of this is in the P6 remainder of QA-P1R-05 (refusal detail text, audit codes, demo
seed text). Demo-seed decision titles and DEMO-policy body names ("Board of Directors — to be confirmed") are data and are not counted.
**Recommendation:** return `titleAr` / `descriptionAr` / `acceptanceCriteriaAr` / `outputAr` for template-seeded tasks, dependency
titles and My Work items; add `…I18n` codes to planning health / schedule explanations; add the `gates.*` refusal codes to
`lib/refusals.ts`; translate the evidence-type and duration-basis enums on the task page. Or record each category as a REQ-UX-001
remainder with an owner and phase in the gate report.

### QA-P2-05 — Low — REQ-SRC-002 / REQ-ARC-011 checks: three evasions (Part B detail in §9)

- `validate-templates.mjs`: a duplicate `claimId` in the source map is silently shadowed (`new Map(...)` keeps the last entry), so an
  invalid first entry (unknown workstream `WS99`, foreign activity `WS12-A06`) passes. Fix: reject duplicate claim ids.
- `check-module-boundaries.mjs`: not detected — `import(\`../gates/x\`)` (template literal), a re-export laundered through
  `src/platform/` (platform files are not scanned; none imports a module today), and non-`.ts` files in a module. Fix: scan
  `src/**` (platform included, modules as targets), accept template literals, or use the TypeScript AST.

### QA-P2-06 — Low — Status documents and requirement evidence are stale after the P2 web follow-ups merged

- `docs/requirements/status-evidence.yaml` still says the web follow-ups are "in progress" or "fail with 422" for REQ-GOV-023, REQ-UX-007
  ("known regression … returns 422"), REQ-UX-008, REQ-UX-015, REQ-PLN-006, REQ-PLN-013 and REQ-ENT-010; the follow-ups merged in
  `65b53e9` and `p2-web-followups.spec.ts` (a)–(d) pass here. REQ-UX-007's own AT ("E2E: decision lifecycle executed from Committee Hub")
  and AT-04 in the UI may now be met and should be re-evaluated.
- `docs/DELIVERY_STATUS.md` is "last updated at `d508929`": 348 domain / 691 API tests (actual 357 / 709), the external-approval 422
  regression, cross-project screens "In progress", CI "green run still to be confirmed" (run 32 is green). `docs/WORK_LOG.md` checkpoint
  is `2ac548b` and lists F-13 and the 422 regression as known failures. Same pattern as QA-P1-11.

### QA-P2-07 — Info — No green CI run on the reviewed revision

- GitHub Actions run **33** (id 36722632030) on `1b30f48` is `completed / cancelled`: 7 jobs succeeded (unit + template validator,
  OpenAPI, web build + egress scan, restore drill, Helm/kubeconform, licence, SBOM, audit) and 7 were cancelled (static/lint, API
  integration, images, Compose, Playwright, secret scan). The local runs in §2 stand in for them; the P2 gate report should cite a green
  CI run on its gate revision.

### Observations (no severity)

- **O-1 Decision re-use after a rejected cycle.** `gates.service.ts` `decide` excludes rejected cycles from `priorDecisionIds`
  (`a.status !== 'rejected'`), so a final decision linked to a rejected cycle can back the approval of the reopened cycle; the domain
  message says "a reopened gate needs a fresh decision". **Executed** with a temporary probe (run on `hub_test_p2qa_probe`, then deleted,
  not committed): G0 cycle 1 with an approved G0 decision linked → the sponsor rejects it → the chair reopens (201) → cycle 2 is started,
  reviewed and submitted → the sponsor approves cycle 2 citing the **same** decision → `201 approved`. The governance owner should
  confirm whether a rejected cycle "uses" its decision; if not intended, include rejected cycles in the re-use check.
- **O-2 REQ-ENT-010 variance (F-08).** A reader of one end sees nothing rather than a redacted remote item. It fails safe; I accept it
  as a P2 variance with the requirement staying Implemented (owner ux-frontend-engineer / backend-data-engineer), not as Tested.
- **O-3 Independent domain re-review.** The P2 domain review (FAIL, 5 High) has fix-status sections written by the implementers, and its
  12 probes pass here, but no independent re-review is recorded. The exit criterion "domain plus QA review" needs it.

## 9. Part B — P1 gate conditions

The P1 gate (`docs/phases/P1-gate-report.json`, PASS WITH CONDITIONS at `65b53e9`) carries "independent re-verification of the closures
the lead made after the reviews" to the P2 gate reviews. The QA part is QA-P1R-02, QA-P1R-03 and the CI claim. (SEC-P1S-01/-02/-03/-04/-07
belong to the security reviewer; my module-boundary probes below incidentally confirm the SEC-P1S-07 fix: double-quoted specifiers and
`require()` are now detected.) All probes ran on **scratch copies** in the scratchpad; no tracked file was changed.

### 9.1 QA-P1R-02 — REQ-SRC-002 (source map check) — **CONFIRMED, with one Low hardening gap (QA-P2-05)**

`packages/db/scripts/validate-templates.mjs` block "REQ-SRC-002" reads the 7 `Heading:` claims of `docs/source-register.md`
(CLM-002..CLM-008) and `packages/db/seed/source-maps/dc-carveout.v1.json` (status `proposed`). It is run by the CI unit job
(`pnpm --filter @hub/db run validate:templates`, workflow line 79). On the tree: `7 reference headings → 9 workstreams, 25 WBS activities … PASS`.

Negative probes (each on a fresh copy of templates, source map, validator and register):

| Mutation | Validator |
|---|---|
| unchanged copy (control) | exit 0, PASS |
| CLM-006 removed from the map | exit 1 — `reference heading CLM-006 is not mapped to the template` |
| CLM-002 mapped to no workstream | exit 1 — `no workstream` (+ its activities reported as outside the mapped workstreams) |
| CLM-004 lists WS12-A06 (activity of another workstream) | exit 1 — `WS12-A06 belongs to WS12, not a mapped workstream` |
| CLM-003 maps to unknown workstream WS99 | exit 1 — `unknown workstream WS99` |
| CLM-003 maps to unknown activity WS02-A99 | exit 1 — `unknown WBS activity WS02-A99` |
| map adds CLM-001 (not a heading claim) | exit 1 — `CLM-001 is not a reference heading claim of the source register` |
| map status set to `confirmed` | exit 1 — `a mapping stays proposed` |
| register gains an 8th heading claim | exit 1 — `expected 7 … found 8` + `CLM-099 is not mapped` |
| register heading row reworded (`heading:`) | exit 1 — `expected 7 … found 6` |
| duplicate CLM-002 entry (invalid) appended after the valid one | exit 1 — `no workstream`, `WS12-A06 belongs to WS12` |
| duplicate CLM-002 entry (invalid) placed **before** the valid one | **exit 0, PASS** — the Map keeps the last entry; the invalid one is never checked (QA-P2-05) |

The requirement's AT ("every reference heading claim links to at least one template workstream") is met; the register evidence
("negative probe (a heading removed, an activity of another workstream) fails the validator") is accurate.

### 9.2 QA-P1R-02 — REQ-ARC-011 (module boundaries) — **CONFIRMED, with Low hardening gaps (QA-P2-05)**

`apps/api/scripts/check-module-boundaries.mjs` runs in `pnpm --filter @hub/api lint` (CI static job, `pnpm lint`). On the tree:
`32 cross-module imports, 14 module edges, acyclic, only published surfaces` (the register cites 30 / 13 at `2ac548b`; the difference is
later merged code, still passing). Probes on a copy of `src/` + the script:

| Probe (added to `modules/planning/probe.ts` unless stated) | Checker |
|---|---|
| unchanged copy (control) | exit 0 |
| `import { x } from '../gates/gates.evaluation'` | exit 1 — internal to module 'gates' |
| same with double quotes | exit 1 |
| `import type { X } from …` | exit 1 |
| `export * from '../gates/gates.evaluation'` | exit 1 |
| `require('../gates/gates.evaluation')` | exit 1 |
| `import('../gates/gates.evaluation')` | exit 1 |
| multi-line import with `from` on the next line | exit 1 |
| `from '../gates'` (module index) | exit 1 |
| cycle through published surfaces (gates → planning.module, planning → gates.module) | exit 1 — `module cycle: planning → gates → planning` |
| ``import(`../gates/gates.evaluation`)`` (template literal) | **exit 0** |
| `platform/probe-relay.ts` re-exports `../modules/gates/gates.evaluation`; planning imports `../../platform/probe-relay` | **exit 0** |
| `modules/planning/probe.js` with `require('../gates/gates.evaluation')` | **exit 0** |

The AT (a rule forbids cross-module internal imports) is met for ordinary code; the three evasions need deliberate intent. The
variance "dependency-free checker instead of dependency-cruiser" is acceptable.

### 9.3 QA-P1R-03 — disposition update vs register — **CONFIRMED**

`docs/phases/P1-must-disposition.md` "Update at the P1 gate" states 82 P1 musts = Tested 58 · Implemented 22 · Deferred 2 · Planned 0 and
lists the 24 non-Tested musts. Computed from the register with `git show <rev>:…/requirements.yaml` (scratch script):

```
== 2ac548b: P1 musts 82 {'Implemented': 22, 'Tested': 58, 'Deferred': 2}
   non-Tested in register: 24 · listed in the update: 24 · in register, not in update: [] · in update, not in register: []
   REQ-SRC-002: Tested · REQ-ARC-011: Tested
== 65b53e9: (identical)
== 1b30f48: (identical)
```

Each ID has the status the update gives it (22 Implemented, 2 Deferred). The P1 gate report's counts (82 / 58 / 22 / 2) match. The
older summary (33 / 47) and table below the update are kept "as history" under a banner that the register wins; that is acceptable,
though a regenerated table (the QA-P1R-03 recommendation) would remove the ambiguity.

### 9.4 CI run 32 at `65b53e9` — **CONFIRMED**

There is no `gh` CLI here. I queried the public GitHub REST API read-only through the configured proxy (no credentials):

```
GET https://api.github.com/repos/ghanemn94-rgb/My-owns/actions/runs/36719104841            → 200
  run_number 32, head_sha 65b53e99154df0d8c8a5719478efe5ee01b2d594, event push, status completed, conclusion success,
  created 2026-09-30T13:05:02Z, updated 13:23:13Z, run_attempt 1
GET …/actions/runs/36719104841/jobs                                                         → total_count 14, all "success":
  Install/build/typecheck/lint · Domain/contract unit tests + template validator · API integration tests (PostgreSQL 16) ·
  Web build + private-mode egress check (AT-22) · Container images + SBOM + vulnerability report · OpenAPI generation ·
  Licence policy · pnpm audit · Source SBOM · Helm/kubeconform/compose/shellcheck · Backup/restore drill (AT-23) ·
  Docker Compose dev/eval stack · Playwright smoke (demo stack) · Secret scan (gitleaks — history + tree, web bundle, CI test reports)
```

The claim in `P1-gate-report.json` ("run 32 (id 36719104841) … conclusion success — every job green") is accurate. Job logs were not
downloaded. The run on this review's revision (run 33, `1b30f48`) was cancelled — QA-P2-07.

## 10. Verdict

**FAIL at `1b30f48`.**

- One open **High**: QA-P2-01 (decision re-use race in change-request approvals — the P2 exit criterion "block decisions outside
  authority" can be bypassed through the API). Under the gate rule (§19 step 6; CLAUDE.md "No PASS with open Critical/High findings")
  this alone prevents PASS or PASS WITH CONDITIONS.
- Everything else required by the task was executed and is green (API 709/709, domain 357, contracts 100, lint, `apply_status --check`, template validator, full Playwright 261/261 with 208 axe scans at 0 serious/critical, this review's probes and 3 e2e specs). The P2 behaviours reviewed by the domain review are
  fixed as far as its probes and the ATs show; DOM-P2-16 works in the API and the UI; the P2 web follow-ups work in English and Arabic.

**What turns this into PASS WITH CONDITIONS (for the lead):**

1. **Fix QA-P2-01** (lock the decision row in `evaluateAuthority`; partial unique indexes as a backstop; 409 on conflict) and drop
   `.fails` from its probe; re-run `apps/api/test/reviews/p2-qa-adversarial.spec.ts` and the planning / governance suites. A QA
   re-check of that probe is enough; a full re-review is not needed.
2. **Conditions to carry into the P2 gate report:**
   - C1 — close or formally re-phase (phase, owner, reason) the 23 "close before P2 gate" musts (QA-P2-02); decide on the cockpit's
     P2 tiles (F-05) and on GOV-015 (conflict declarations before voting, F-01).
   - C2 — an independent domain re-review of the DOM-P2 fixes (O-3), and the P2 security review.
   - C3 — a green CI run on the gate revision (QA-P2-07).
   - C4 — refresh `status-evidence.yaml` (7 stale P2 entries), `DELIVERY_STATUS.md` and `WORK_LOG.md` (QA-P2-06).
   - C5 — QA-P2-04 (Arabic on the P2 screens): fix, or record each category as a REQ-UX-001 remainder with owner and phase.
   - Low items with owners: QA-P2-03 (gates), F-03 (governance; migration by the lead), QA-P2-05 (validator and boundary checker
     hardening); observation O-1 to the governance owner.

**Part B (P1 gate conditions assigned to QA): all CONFIRMED** — REQ-SRC-002 and REQ-ARC-011 closures (with the Low hardening items of
QA-P2-05), the P1-must disposition update matches the register at `2ac548b`, `65b53e9` and `1b30f48`, and CI run 32 on `65b53e9` is
green in all 14 jobs.

## 11. NOT EXECUTED

- **CI on `1b30f48`**: not triggerable from here (no push to the integration branch by the reviewer; run 33 was cancelled). CI job logs
  were not downloaded.
- **Docker / Compose / Helm / image builds**: no Docker daemon; not started (as instructed).
- **Independent P2 domain re-review and P2 security review**: other reviewers' scope (O-3).
- **Manual screen-reader, zoom and high-contrast checks**: not done; accessibility evidence is axe (the suite's `a11y.spec.ts` and
  the dialog scans of §6) plus the dialog behaviour checks (accessible name, focus, Escape).
- **Full API suite including this review's new spec file**: the full suite (709) ran before `p2-qa-adversarial.spec.ts` was added;
  that file was run on its own (§2.2). `pnpm lint` (which typechecks the API tests and the e2e package) was re-run after all files were
  added: exit 0.

## 12. Files written by this review and cleanup

- This report: `docs/reviews/P2-qa-review.md`.
- API probe spec: `apps/api/test/reviews/p2-qa-adversarial.spec.ts` (12 tests: 9 pass, 3 `it.fails` linked to QA-P2-01, QA-P2-03, F-03).
- E2E: `e2e/tests/qa-p2-exit-journey.spec.ts` (P2 exit journey in the UI), `e2e/tests/qa-p2-gate-review-journey.spec.ts` (DOM-P2-16
  step in the UI), `e2e/tests/qa-p2-arabic-rtl.spec.ts` (Arabic/RTL screens and dialogs, foreign ids, known remainders as `test.fail`,
  detector self-check), `e2e/tests/qa-rtl-detector.ts` (shared untranslated-text detector and dialog checks incl. axe on the open dialog).
- Screenshots: `e2e/screenshots/qa-p2/*.png` (the Arabic screens and dialogs listed in §6 and the English journey end state).
- Not committed (scratchpad): the SRC-002 / ARC-011 probe scripts, the P1-must and P2-disposition comparison scripts, the Health-table
  measurement script, the temporary O-1 probe, run logs.
- Cleanup: the API (PID 27083), worker (27103) and web server (27193) started for this review were stopped by PID after
  checking their command lines (their shell wrappers exited); ports 4871 / 3871 are free. Tracked screenshots and
  `docs/test-evidence/a11y-report.md` rewritten by the full e2e run were restored with `git checkout`. The temporary O-1 probe file was
  deleted. The review databases (`hub_test_p2qa`, `hub_test_p2qa_boot`, `hub_test_p2qa_e2e`, `hub_test_p2qa_probe`) are left in place
  (test data only).

---

## Fix status (implementation, 2026-09-30) — QA-P2-01, QA-P2-03, O-1, F-03 (and the P2 domain re-review findings)

Appended by the implementing `backend-data-engineer` (not the reviewer); the text above is unchanged. Branch
`worktree-agent-a667570d205e1a5d2`, with `claude/mobily-transformation-hub` merged up to `1c6b375` (P4 domain review, P2
security review, cockpit). The same branch fixes the P2 domain re-review findings (`P2-domain-rereview.md`, "Fix status").
The three `.fails` probes of this review (QA-P2-01, QA-P2-03, F-03) were turned into plain tests and pass. One setup line of
the QA-P2-03 probe changed after the security-review merge: the late evidence is linked by the kit's authorized linker
(`evidenceAdderFor`, SEC-P2-05 lets only the criterion's owner role or a project manager link criterion evidence — the
contributor now gets 403, which is not the refusal the probe looks for); its assertion is unchanged.

| Finding | Status | What changed |
|---|---|---|
| QA-P2-01 (High) | Fixed | Generic decision-use registry: every approval that relies on a decision locks the decision row (`SELECT … FOR UPDATE`), re-reads it with its registered uses and refuses a decision already used for another record of the same kind (422 `change_control.decision_already_used` / `perimeter.version.decision_already_used` / `gates.decide.decision_reused`); the use is written in the same transaction (`decision_use`, unique per decision and kind). Backstops: the registry's unique index and partial unique indexes `change_request_decision_uq`, `baseline_version_decision_uq`, `perimeter_version_decision_uq`; a violation is 409 `…decision_already_used`, never 500. Documented for other modules in `docs/architecture/module-guide.md` ("Relying on a governance decision"). |
| QA-P2-03 (Low) | Fixed | `decide` re-checks the gate reviewer's endorsement against the CURRENT criterion basis: an approval on a basis the reviewer did not endorse is 422 `gates.assessment.review_stale` (the owner sends the gate back for a fresh review); rejections are unaffected. |
| O-1 (observation) | Fixed — PROPOSED, pending the governance owner | A decision linked to ANY earlier cycle of the gate — approved or rejected — cannot back a later cycle (`gates.decide.decision_reused`); the rejected cycle's reliance is recorded in the registry (`gate_cycle`). `business-gates.md` rule 12, `assumptions-and-open-questions.md` A-52. |
| F-03 (Low) | Fixed | Screening locks the meeting row before `max(number) + 1`; partial unique index `agenda_item_number_uq` (meeting, number of accepted items). REQ-GOV-013 → Tested. |

Verification on this branch (own databases `hub_test_p2r`, `hub_test_p2r_boot`, `hub_test_p2r_e2e`; own stack on ports
4217 / 3217):

```
$ pnpm build:packages                                        # OK
$ (cd packages/domain && npx vitest run)                     → Test Files 18 passed (18), Tests 386 passed (386)
$ (cd packages/contracts && npx vitest run)                  → Test Files 2 passed (2), Tests 100 passed (100)
$ TEST_DATABASE_URL=…/hub_test_p2r TEST_DATABASE_MIGRATION_URL=…/hub_test_p2r pnpm --filter @hub/api test
  before the 1c6b375 merge:  Test Files 87 passed (87), Tests 763 passed (763)
  after the merge (run 3):   Test Files 1 failed | 89 passed (90), Tests 1 failed | 780 passed | 8 expected fail (789)
                             → the failure was the QA-P2-03 probe's setup (security-review merge, see above); after the
                               setup fix: vitest run test/reviews/p2-qa-adversarial.spec.ts → Tests 12 passed (12)
                             (the 8 expected failures are the open P4 domain-review probes, `it.fails`)
  final commit f552cf5 (run 4): Test Files 90 passed (90), Tests 781 passed | 8 expected fail (789), 798.6 s
                             (incl. p1-closure-empty-db on hub_test_p2r_boot)
$ pnpm lint                                                  # exit 0 (packages, api tsc + module boundaries, web tsc + i18n
                                                             #  + hard-coded strings, e2e tsc)
$ full Playwright suite (API + worker + production web build as in CI: HUB_RATE_LIMIT_PUBLIC_PER_MINUTE=1000,
  env -u NODE_ENV HUB_API_URL=http://127.0.0.1:4217 pnpm --filter @hub/web run build; next start -p 3217;
  HUB_WEB_URL=http://127.0.0.1:3217 npx playwright test)      → 311 passed (24.5m)
  (includes the known-remainder `test.fail` of qa-p2-arabic-rtl, QA-P2-04, failing as expected)
$ python3 scripts/requirements/apply_status.py --check       → status-evidence.yaml OK (263 entries); applied
```
The API, worker and web server started for the e2e run were stopped by PID after checking their command lines. The
tracked screenshots rewritten by the run were restored with `git checkout`; `docs/test-evidence/a11y-report.md` was
regenerated by this full run (240 scans, 0 serious/critical) and kept.

---

## Fix status (implementation, 2026-09-30) — QA-P2-04

Appended by the implementing `ux-frontend-engineer` (not the reviewer); the text above is unchanged. Branch
`worktree-agent-a68ed0047dffd3de9`, from `claude/mobily-transformation-hub` at `f8fdf01`. The known-remainders test of
`qa-p2-arabic-rtl.spec.ts` is no longer `test.fail`: it is a strict test and passes. The detector (`qa-rtl-detector.ts`) is
unchanged.

| Screen | English before | Fix |
|---|---|---|
| Task detail | description, output, acceptance criteria, effort, raw `approved_document` / `assumed`, dependency titles | `task.description_ar`, `output_ar`, `acceptance_criteria_ar` (stored at project creation from the template, like `title_ar`; the single migration regenerated: 3 columns). `TaskDto` adds `descriptionAr`, `outputAr`, `acceptanceCriteriaAr` and `effortI18n` (codes for the template's "Assumed: N person-days" / "TBD"; null for text a planner typed). Changing the English text without its Arabic clears the Arabic, so a stale translation is never shown. Evidence types and duration bases are translated on the page; the dependency panel uses `predecessorTitleAr` / `successorTitleAr`. |
| Plan Health | workstream names, RAG explanations, data-quality issues, "Schedule incomplete …", exclusion reasons | Domain `PLANNING_MESSAGES_EN` (`plan.*`): `calculateRag`, `aggregateRag`, `effectiveRag`, `capOverrideAtOpenBlockers`, `weightedProgress` return `explanationI18n` / `reasonI18n`, and the English sentence is rendered from the same messages. `ProgressDto` adds `explanationI18n`, `reasonI18n`, `issueI18n`, `dataQualityI18n` and `labelAr` (workstream code + Arabic name; the project code for project-level issues). The schedule gap example names the activity by its WBS code. |
| Plan Timeline / What-if | schedule assumptions | `ScheduleDto` / `DelayImpactDto` add `assumptionsI18n` (one message per assumption; working days shown as weekday names). |
| My Work | template task titles, gate names, server-composed titles | `MyWorkItemDto.titleAr` for tasks, deliverables, milestones, gates and gate criteria (absent for free text typed by a user); `titleI18n` for status-update review, RAG-override review and baseline approval. |
| Decision detail | authority reason | Domain `AUTHORITY_MESSAGES_EN` (`authority.*`); `checkAuthority` returns `reasonI18n`, stored with the outcome's tally snapshot; `DecisionDetailDto.authorityReasonI18n` (only when the snapshot recorded the same reason). The decision type is named as the matrix names it. |
| Gate dialogs | refusal detail of `gates.*` codes | Every refusal code raised in `apps/api/src/modules/gates` and `packages/domain/src/gates.ts` (50 codes; 404 codes excluded) has an en + ar explanation in `apps/web/src/lib/refusals.ts`; `check-i18n.mjs` now fails when one is missing. |
| Decisions list / detail | demo-seed decision titles | Decision titles are free text typed by the requester in the decision paper: marked `data-user-text` (as on the cockpit). |

The web routes `plan.*` codes to `planning.messages` and `authority.*` codes to `governance.messages` (`serverMessageKey`
in `lib/i18n-data.ts`). `check-i18n.mjs` registers both catalogues and checks the prefixes. The English UI wording of the
authority reasons differs from the server's sentence. With identical wording, the detector matched the server's English
refusal detail in the change-request approval dialog: that labelled technical-record line was shown before this change too.

Remaining English on these screens (not changed, with reasons): free text typed by users or the demo seed (decision
papers, change-request and action titles, committee and meeting names, override reasons, document titles); DEMO-policy
data (escalation bodies such as "Board of Directors — to be confirmed"); template values with no Arabic in the template
(`proposedOwnerFunction` such as "CPMO", RACI function labels); the server's English refusal detail shown under the
translated explanation (QA-P1R-05 remainder); escalation records whose title / requested action the outcome command
composes in English (Committee escalations page; needs stored codes); persona names, record codes and the time-zone id.

Verification on this branch (own databases `hub_test_qa24`, `hub_test_qa24_boot`, `hub_e2e_qa24`; own stack on ports
4124 / 3124, set up like the CI e2e job):

```
$ pnpm test:unit                  → domain: Test Files 19 passed (19), Tests 393 passed (393)
                                    contracts: Test Files 2 passed (2), Tests 100 passed (100)
$ TEST_DATABASE_URL=…/hub_test_qa24 TEST_DATABASE_MIGRATION_URL=…/hub_test_qa24 pnpm --filter @hub/api test
                                  → Test Files 91 passed (91), Tests 788 passed | 8 expected fail (796), 962.8 s
                                    (the 8 expected failures are the open P4 domain-review probes, `it.fails`;
                                     new: test/planning/qa-p2-04-bilingual.spec.ts, 7 tests)
$ pnpm lint                       → exit 0 (i18n check: 145 server message codes incl. planning + governance,
                                    50 gate refusal codes; hard-coded string check passed)
$ HUB_RATE_LIMIT_PUBLIC_PER_MINUTE=1000 node apps/api/dist/main.js (PORT=4124) + node apps/api/dist/worker.js;
  env -u NODE_ENV HUB_API_URL=http://127.0.0.1:4124 pnpm --filter @hub/web run build; next start -p 3124
$ HUB_WEB_URL=http://127.0.0.1:3124 npx playwright test qa-p1r-arabic-rtl p2-planning p2-gates p2-governance
  p2-cockpit a11y                 → 260 passed (18.7m)  (3 + 3 + 5 + 1 + 4 + 244)
$ HUB_WEB_URL=… npx playwright test qa-p2-arabic-rtl p2-web-followups qa-p2-gate-review-journey
  qa-p2-exit-journey p3-readiness → 14 passed (3.0m)  (6 + 4 + 1 + 1 + 2), on the final web build;
                                    the gate journey now logs "translated explanation shown: true" for both refusals
```
Before the final build, only the Arabic wording of the effort estimate changed. The 260-test run used the build before
that change. The full Playwright suite was not run. The data dictionary and ERD were not regenerated: regenerating them
also picks up earlier, unregenerated schema changes (for example `decision_use`), which is left to integration. The API,
worker and web server were stopped by PID after checking their command lines; the tracked screenshots and
`docs/test-evidence` rewritten by the runs were restored with `git checkout`.
