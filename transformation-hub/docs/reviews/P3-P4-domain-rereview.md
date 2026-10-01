# P3 / P4 focused domain re-review (carve-out & NewCo; JV & finance)

| Item | Value |
|---|---|
| Reviewer | carveout-domain-analyst (REVIEW mode, separate context). The reviewer did not write the fixes under review, nor the original P3 / P4 domain reviews. |
| Revision reviewed | `9a93951` on `claude/mobily-transformation-hub`. `git fetch origin claude/mobily-transformation-hub` → `origin` head `9a93951` = the worktree head (nothing to merge). The worktree was frozen on it. |
| Review branch | `worktree-agent-aed7e64c83e78ff84`. The review adds only this report and four probe files: `apps/api/test/reviews/p34-domain-re-readiness.spec.ts`, `p34-domain-re-dimension.spec.ts`, `p34-domain-re-tsa.spec.ts`, `p34-domain-re-perimeter.spec.ts`. No application code, existing test, seed, template, migration or governance document was changed. |
| Date | 2026-10-01 |
| Scope | (1) every finding of `docs/reviews/P3-domain-review.md` (DOM-P3-01 … -17, I1, I2) and `docs/reviews/P4-domain-review.md` (DOM-P4-01 … -17) against its fix, its regression tests and the original probes; (2) the P3 exit criteria of master prompt §19 and the P4 exit criteria from the domain angle; (3) new behaviour introduced by the fixes (readiness re-binding command, transfer "not applicable" determination, extension terms binding, dimension vocabulary, TSA lifecycle changes, two-person "not required" on closing checklists) and the owner questions recorded in `docs/assumptions-and-open-questions.md` (Q-P3-*, AMQ-10). |
| **Verdict P3** | **FAIL** — 2 High (DOM-P34R-01, DOM-P34R-04) and 4 Medium (DOM-P34R-02, -03, -05, -06) open. The fixes close every path the P3 domain review reproduced (all 18 original probes pass as plain tests, assertions unchanged), but two of the fixed rules have an equivalent path around them: a FAILED site blocker leaves the GO evaluation through a descriptive PATCH of the **plan's** site (same effect as DOM-P3-01), and the extension terms bound to a decision are released by re-linking the request through a second decision (same effect as DOM-P3-06). Exit criterion "blockers prevent go-live" is **not met**. |
| **Verdict P4** | **PASS WITH CONDITIONS** — every DOM-P4 High and Medium finding is fixed and verified (the 8 original probes and their 8 setup steps pass; each refusal carries the intended code, and DOM-P4-05 discloses the pinned, reviewed evidence version). Open: Low DOM-P34R-07 (documentation), DOM-P34R-08, DOM-P34R-09, the documented open Lows DOM-P4-13 / -14 (funds-flow part) / -15, and Info DOM-P34R-I1, all for the P4 gate report with owners. P4 exit criteria "missing CP blocks closing" and "financial reconciliation" are **met** from the domain angle. |

This review makes no legal, tax, zakat, accounting or regulatory determination. Where a recommendation depends on a governance or
specialist choice it says so ("owner to confirm").

---

## 1. Commands and real results

All commands ran from `transformation-hub/` in the review worktree at `9a93951`. Only this review's databases were used:
`hub_test_p34dre` (full suite), `hub_test_p34dre_boot` (empty-database test), `hub_test_p34dre_probe` (probe and subset runs).
Docker was not started; no e2e stack was started; no process or database of another agent was touched. Logs are in the reviewer's
scratch directory.

### 1.1 Set-up

```
$ git fetch origin claude/mobily-transformation-hub          → FETCH_HEAD 9a93951 (= HEAD; nothing to merge)
$ git log -1 --oneline                                        → 9a93951 WORK_LOG: P3/P4 QA review merged (…)
$ pg_isready -h 127.0.0.1 -p 5432                             → accepting connections
$ HUB_DATABASES="hub_test_p34dre hub_test_p34dre_boot hub_test_p34dre_probe" bash scripts/dev/pg-init-roles.sh
roles hub_owner/hub_app and databases ready: hub_test_p34dre hub_test_p34dre_boot hub_test_p34dre_probe
$ pnpm install --frozen-lockfile --offline                    → exit 0
$ pnpm build:packages                                         → exit 0
$ (apps/api) npx tsc -p tsconfig.build.json                   → exit 0
```

### 1.2 Unit tests and lint

```
$ (packages/domain) npx vitest run        Test Files 22 passed (22)   Tests 453 passed (453)
$ (packages/contracts) npx vitest run     Test Files 3 passed (3)     Tests 105 passed (105)
$ (apps/api) pnpm run lint                # tsc --noEmit (incl. this review's probe files) + module boundaries
module boundary check passed: 43 cross-module imports, 19 module edges, acyclic, only published surfaces      (exit 0)
```

### 1.3 The original probes

P3 domain probes in plain mode (`P3D_PROBE_PLAIN=1` — the `defect` alias is still in each file, so any probe still declared
`defect` would run plain; all fixed probes are now plain `it`):

```
$ P3D_PROBE_PLAIN=1 TEST_DATABASE_URL=…/hub_test_p34dre_probe TEST_DATABASE_MIGRATION_URL=…/hub_test_p34dre_probe \
  npx vitest run test/reviews/p3-domain-{dimensions,perimeter,tsa,readiness-go,readiness-race}.spec.ts --reporter=verbose
 ✓ CONTROL: GO is refused while a failed blocker is bound to the plan (server re-evaluation, AT-09)
 ✓ DOM-P3-01 … (fixed, regression)      ✓ DOM-P3-02 … (fixed, regression)     ✓ DOM-P3-04 … (fixed, regression)
 ✓ DOM-P3-09 … (fixed, regression)      ✓ DOM-P3-10 … (fixed, regression)     ✓ CONTROL: one included item … not_started
 ✓ DOM-P3-05a … (fixed, regression)     ✓ DOM-P3-05b … (fixed, regression)    ✓ DOM-P3-10b … (fixed, regression)
 ✓ DOM-P3-08 … (fixed, regression)      ✓ DOM-P3-06 … (fixed, regression)
 ✓ DOM-P3-13 (fixed — conservative option, governance owner to confirm) …     ✓ DOM-P3-07 (fixed) …
 ✓ CONTROL: before G4, an expired-unresolved TSA blocks the operational-readiness dimension (D-15)
 ✓ DOM-P3-11 … (fixed, regression)      ✓ DOM-P3-12 (fixed) …                 ✓ DOM-P3-03 (concurrency) … (fixed, regression)
 Test Files  5 passed (5)
      Tests  18 passed (18)
```

P4 domain probes as they are (the implementers removed the `probe` alias; every probe is a plain `it`):

```
$ TEST_DATABASE_URL=…/hub_test_p34dre_probe … npx vitest run test/reviews/p4-domain-jv.spec.ts test/reviews/p4-domain-finance.spec.ts --reporter=verbose
 ✓ setup DOM-P4-01 …  ✓ DOM-P4-01 … (fixed, regression)   ✓ setup DOM-P4-02 …  ✓ DOM-P4-02 … (fixed, regression)
 ✓ setup DOM-P4-03 …  ✓ DOM-P4-03 … (fixed, regression)   ✓ setup DOM-P4-04 …  ✓ DOM-P4-04 … (fixed, regression)
 ✓ setup DOM-P4-05 …  ✓ DOM-P4-05 … (fixed, regression)   ✓ setup DOM-P4-08 …  ✓ DOM-P4-08 … (fixed, regression)
 ✓ setup DOM-P4-06 …  ✓ DOM-P4-06 … (fixed, regression)   ✓ setup DOM-P4-07 …  ✓ DOM-P4-07 … (fixed, regression)
 Test Files  2 passed (2)
      Tests  16 passed (16)
```

The P4 probes assert outcomes (e.g. "closing #2 not confirmed"); to make sure each passes for the intended reason and not because
of an unrelated refusal, the rejected / denied audit rows of that run were read:

```
$ psql …/hub_test_p34dre_probe -Atc "select p.code, a.action, a.outcome, left(a.reason,170) from audit_event a join project p … where a.outcome <> 'success' order by a.seq"
DRP4-JV |jv.requestEventConfirmation   |rejected|jv.closing.decision_already_used: Decision DEC-004 already backs another closing; …        (DOM-P4-01)
DRP4-JV |jv.requestEventConfirmation   |rejected|jv.signing.g5_not_passed: A signing can be recorded only after gate G5 … (G5 is reopened) (DOM-P4-02)
DRP4-JV |jv.determineConditionWaivability|denied |policy.forbidden: Missing permission jv.cp.set_waivability                          (DOM-P4-03)
DRP4-JV |jv.updateCondition            |rejected|jv.cp.validity_locked: The validity date of a verified condition is what its verification relied on … (DOM-P4-04)
DRP4-JV |jv.requestEventConfirmation   |rejected|jv.closing.decision_evidence_invalid: The evidence of the external approval of decision DEC-006 is now rejected … (DOM-P4-08)
DRP4-FIN|finance.approveModelValues    |rejected|finance.model.decision_already_used: Decision DEC-001 already backs another financial model version …  (DOM-P4-06)
DRP4-FIN|finance.recordBudgetApproval  |rejected|finance.budget.decision_already_used: Decision DEC-002 already backs another budget line …          (DOM-P4-07)
$ … where p.code='DRP4-JV' and action like '%dd%' …                                                                           (DOM-P4-05)
jv.dd_answer.submit|success||{"releaseStatus": "in_review", "evidenceVersionIds": ["01a0f522-78df-…"]}
jv.dd_answer.release|success|Release (probe)|{"disclosures": 1, "releaseStatus": "released", …}      → the pinned (reviewed) version is disclosed
```

### 1.4 Weakening check (`git diff` of each probe file from the review commit to `9a93951`)

| Probe file | Implementer edits | Result |
|---|---|---|
| `p3-domain-readiness-go.spec.ts`, `-readiness-race.spec.ts`, `-perimeter.spec.ts` | `git diff c00748c 9a93951`: `defect(…)` → `it(…)`, title suffix "(fixed, regression)", a comment and `void defect;`. No assertion, setup or fixture line changed. | **Not weakened.** |
| `p3-domain-tsa.spec.ts` | DOM-P3-06: rename only. OBSERVED DOM-P3-13 / DOM-P3-07 (they pinned the reported behaviour) now assert the implemented rule: 422 `tsa.extension.decision_other_tsa` and no use registered for B; 422 `tsa.extension.end_date_past`, TSA stays `expired_unresolved` with its old end date. Setup unchanged. | **Not weakened** — observations became stricter assertions of the fix (convention of the common rules). |
| `p3-domain-dimensions.spec.ts` | DOM-P3-11 rename only. OBSERVED DOM-P3-12 now asserts "no undocumented state" and that `day1_go_approved`, `operating_with_transitional_services`, `transitional_services_exited`, `perimeter_approved` are produced (three inputs added for the new GO / perimeter-approval fields of `DimensionInput`); "every check passed, no GO" is now `readiness_in_progress`. | **Not weakened.** Note: it exercises the pure rule only — whether the GO reaches the rule is DOM-P34R-03. |
| `p4-domain-jv.spec.ts` | `git diff 4efdb3e 9a93951`: `probe(…)` → `it(…)`, renames. Fixture: the first signing now passes G5 through the real gate API (`passG5`) and uses the decision that approved it (needed since DOM-P4-02); the DOM-P4-02 setup reopens G5 (chair, controlled reopen) so that its precondition "G5 not passed" holds and is still asserted. Assertions unchanged. | **Not weakened** — the refusal is `jv.signing.g5_not_passed` (audit above), i.e. the probe still tests the G5 dependency. |
| `p4-domain-finance.spec.ts` | Renames; `probe` alias removed. Assertions unchanged. | **Not weakened.** |

### 1.5 This review's probes

Four files, one DC project each (`P34R-GO`, `P34R-DIM`, `P34R-TSA`, `P34R-PER`). `DEFECT …` asserts the REQUIRED behaviour with
`it.fails` (green while open, red once fixed); `P34DRE_PROBE_PLAIN=1` runs them plain. Every DEFECT probe failed **at its final
assertion**; every setup step and CONTROL before it passed through the real API:

```
$ P34DRE_PROBE_PLAIN=1 TEST_DATABASE_URL=…/hub_test_p34dre_probe … npx vitest run test/reviews/p34-domain-re-*.spec.ts --reporter=verbose
DOM-P34R-01  plan PATCH siteId A→B 200; check RC-002 status failed; GO 201 {"status":"approved_go","goNoGo":"go"};
             decision history ["rehearsal","submitted","go"]: expected 201 not to be 201
DOM-P34R-02  N/A sign-off 201 {"status":"not_applicable"}; check now not_applicable; GO 201 {"status":"approved_go","goNoGo":"go"}:
             expected 201 not to be 201          (CONTROL inside: the same specialist's determination → 422 readiness.determination.release_not_allowed)
DOM-P34R-03a plan approved_go; stored dimension {"state":"readiness_in_progress","explanation":"All mandatory readiness checks passed.
             0 of 1 transition plan(s) with an approved Day-1 GO."}: expected 'readiness_in_progress' to be 'day1_go_approved'
             (CONTROL next: explicit recompute → day1_go_approved)
DOM-P34R-03b plan planning; stored dimension {"state":"day1_go_approved","explanation":"All mandatory readiness checks passed. Day-1 GO
             approved for every transition plan (1)."}: expected 'day1_go_approved' not to be 'day1_go_approved'
DOM-P34R-04  X=2027-01-19 Y=2036-09-28; request on D2 201; back to D1 201; record 201 {"status":"extended"}; TSA extended end 2036-09-28;
             uses of D1 [{"use_kind":"tsa_extension",…}]: expected '2036-09-28' not to be '2036-09-28'
             (CONTROL before: re-requesting Y directly on D1 → 422 tsa.extension.terms_bound)
DOM-P34R-05  classify 201 {"disposition":"included","applied":true,"changeRequest":null}; item included {"legal":"not_applicable",
             "economic":"not_applicable","combined":"not_applicable"}; transfer records [legal mark_not_applicable "Retained …",
             economic mark_not_applicable "Retained …"]: expected true to be false
DOM-P34R-06  item transfer {"legal":"transferred_verified","economic":"transferred_verified",…}, evidence {"transfer":{"active":0,
             "conflicting":0}}; dimension {"state":"transferred_verified","explanation":"All in-scope items transferred with verified
             evidence."}: expected 'transferred_verified' not to be 'transferred_verified'
 Test Files  4 failed (4)
      Tests  7 failed | 6 passed (13)              # 7 DEFECT probes fail as intended; 4 CONTROL + 1 OBSERVED + 1 CONTROL pass
```

One probe-authoring correction while iterating (setup only, no assertion changed): the first version of the dimension probe
showed the stale explanation ("0 of 1 transition plan(s) with an approved Day-1 GO" after the GO) but its state assertion could
not discriminate, because the DC template instantiates **28 project-level Day-1 checks** at project creation and the dimension
counts them all ("1 of 29 mandatory/blocking checks cleared"). The probe now sets those 28 unrelated checks `not_applicable`
through the owner pool in `beforeAll` (documented in the file); the behaviour under test (GO, its withdrawal) runs through the
real API.

Default mode, together with the P3 / P4 acceptance and fix specs (§2):

```
$ TEST_DATABASE_URL=…/hub_test_p34dre_probe … npx vitest run <24 files listed in §2> --reporter=verbose
 Test Files  24 passed (24)
      Tests  156 passed | 7 expected fail (163)          # the 7 expected fails are this review's DEFECT probes
   Duration  169.86s
```

### 1.6 Full API suite at `9a93951` with this review's probes

Run once, at the end, with at least 6 GB free (`free -g`: 11 GB free at the start; no other vitest process running):

```
$ (apps/api) TEST_DATABASE_URL=postgres://hub_app:…@127.0.0.1:5432/hub_test_p34dre \
  TEST_DATABASE_MIGRATION_URL=postgres://hub_owner:…@127.0.0.1:5432/hub_test_p34dre pnpm test --reporter=verbose
 Test Files  124 passed (124)
      Tests  984 passed | 9 expected fail (993)
   Duration  1207.01s
exit 0
```

The 9 expected failures are this review's 7 DEFECT probes (DOM-P34R-01, -02, -03a, -03b, -04, -05, -06) and the two open P2 Lows
DOM-P2F-02 / DOM-P2F-04 (`p2-domain-final.spec.ts`). The test that failed at `5bf274b` (DOM-P3-I1,
`p2-qa-final-race.spec.ts` "both kinds of use are accepted …") passes. `p1/p1-closure-empty-db.spec.ts` ran on
`hub_test_p34dre_boot` and passed. Cited from this run: `readiness/readiness-demo-seed` "REQ-SET-004 / AT-10 (DOM-P4-09): a
synthetic TSA past its end date without an accepted replacement is expired_unresolved and escalated; nothing is extended";
`finance/finance-figures` "UT: unreconciled intercompany difference flagged", "reconciling needs an explained difference and a
reviewer other than the preparer".

---

## 2. Exit criteria (real runs)

Per-file results of the subset run of §1.5 (all passed): `carveout/at-06-incorporation-separate` 7, `gates/at-06-status-dimensions` 6,
`carveout/at-07-perimeter-change-control` 9, `carveout/at-08-day1-contract-position` 8, `readiness/at-09-readiness-go-no-go` 13,
`readiness/at-10-tsa-expiry` 11, `readiness/p3-fixes-readiness` 6, `readiness/p3-fixes-tsa` 9, `carveout/p3-fixes-carveout` 8,
`carveout/p3-fixes-newco` 2, `gates/p3-dimension-lock` 1, `jv/at-12-closing-blocked-cp` 5, `jv/at-13-cp-non-waivable` 5,
`gates/at-12-gate-side` 2, `jv/p4-domain-fixes` 14, `jv/p4-decision-reliance` 8, `finance/p4-domain-fixes-finance` 2,
`finance/p4-decision-reliance-finance` 7, `finance/finance-registers` 15, `finance/at-29-currency-unit-aggregation` 12, and this
review's four files (13, of which 7 expected fail).

### 2.1 P3 (master prompt §19 P3 row; §20 AT-06 to AT-10)

| Criterion | Result | Evidence |
|---|---|---|
| Incorporation recorded while transfer / operations remain incomplete; states kept separate; the carve-out never shown complete (AT-06) | **Met** (core), with Medium residuals on the accuracy of two dimensions | `at-06-incorporation-separate` 7/7 and `gates/at-06-status-dimensions` 6/6 (incorporation `incorporated_verified` while the perimeter is `not_started` / `transfer_in_progress`, `carveOutComplete: false`); `isCarveOutComplete` needs `incorporated_verified` + `transferred_verified` + `transitional_services_exited` (`packages/domain/src/carveout.ts:275-282`); DOM-P3-05a, -08, -11, -12 regressions pass. Residuals: the operational dimension does not move on a GO and keeps "Day-1 GO approved for every transition plan" after the GO is withdrawn (DOM-P34R-03); the perimeter keeps "All in-scope items transferred with verified evidence" after the only transfer evidence is rejected (DOM-P34R-06) — which, with G4 approved and incorporation verified, would let `carveOutComplete` rest on rejected evidence (not executed end to end: reaching an approved G4 through the API was not attempted). |
| Blockers prevent go-live (AT-09) | **Not met** | The five paths of the P3 review are closed: DOM-P3-01, -02, -03, -04, -09 regressions pass (plain mode, §1.3); `at-09-readiness-go-no-go` 13/13; `p3-fixes-readiness` 6/6. Two paths remain: a FAILED site blocker leaves the GO evaluation when the PM edits the **plan's** site, and the GO is accepted (DOM-P34R-01, High); one specialist determines a FAILED non-waivable blocker "not applicable" and the GO is accepted (DOM-P34R-02, Medium). |
| Perimeter-change impact: change request with financial / TSA / readiness / transaction impact, previous version preserved (AT-07) | **Met** | `at-07-perimeter-change-control` 9/9; DOM-P3-05b regression (after baseline, "not applicable" raises a change request — `p3-fixes-carveout` "after baseline: the transfer manager raises a CHANGE REQUEST …"). Specialist effects are marked "Assessment pending — specialist" (unchanged since the P3 review). Note DOM-P34R-05 (before baseline only). |
| AT-08 customer contract that cannot transfer on Day 1 | **Met** | `at-08-day1-contract-position` 8/8 (DOM-P3-I2 unchanged, Info). |
| AT-10 TSA past its end date escalates, never counts as exit; extension options await an approved decision | **Not met** for "extension awaits the approved decision" | Expiry / escalation / exit: `at-10-tsa-expiry` 11/11, DOM-P3-07 / -11 regressions. Extension: the direct re-request is refused (`tsa.extension.terms_bound`, CONTROL of DOM-P34R-04), but re-linking through a second decision records the TSA as extended by D1 to a date D1 never approved (DOM-P34R-04, High). |

### 2.2 P4 from the domain angle (master prompt §19 P4 row)

| Criterion | Result | Evidence |
|---|---|---|
| Missing CP blocks closing (AT-12, AT-13) | **Met** | `jv/at-12-closing-blocked-cp` 5/5 (confirm with one unverified blocking CP rejected; AI / service identity cannot confirm), `jv/at-13-cp-non-waivable` 5/5, `gates/at-12-gate-side` 2/2; the four former bypasses are closed with the intended codes (§1.3: decision reuse, non-legal release, validity edit, external approval on rejected evidence); `jv/p4-domain-fixes` 14/14 (Legal cannot release a blocking CP either; lapsed CP needs an approved extension; daily long-stop scan), `jv/p4-decision-reliance` 8/8 (incl. the concurrent double confirmation → exactly one, the other 409). Low residual DOM-P34R-08 (a CP can be created non-blocking by the PM). |
| Financial reconciliation | **Met** | Full suite (§1.6): `finance/finance-figures` "UT: unreconciled intercompany difference flagged", "reconciling needs an explained difference and a reviewer other than the preparer"; `finance/p4-domain-fixes-finance` "DOM-P4-16 … the creator cannot review after another person edited the explanation; a third person can"; `finance/p4-decision-reliance-finance` "opening balance" (no approval on rejected external evidence); `finance/at-29-currency-unit-aggregation` 12/12 (no mixed-currency / unit total without a stated basis). Low residual DOM-P34R-09 (an intermediate editor of the explanation is not excluded from the review). |

Partner isolation and "NDA alone insufficient" are P4 security / QA criteria; they were not re-reviewed here (the P4 domain review
found them holding, and no fix in this package touched them).

---

## 3. Status of every original finding

### 3.1 P3 domain review (`docs/reviews/P3-domain-review.md`)

| Finding | Status | Evidence |
|---|---|---|
| DOM-P3-01 (High) — descriptive PATCH re-binds a failed blocker | **PARTIALLY FIXED** | Check PATCH refuses `cutoverPlanId` / `siteId` (400); `POST …/rebind` with a reason, refused for a FAILED gating check (`readiness.check.rebind_failed`) and for an open check leaving a decided plan; history entries `check_unbound` / `check_bound` (`checks.service.ts:382-412`). Probe passes plain. **But** the plan side of the same scope is still descriptive: `PATCH …/cutover-plans/:id {siteId}` (planning / rehearsal) takes the plan out from under its site's FAILED checklist and the GO is accepted → **DOM-P34R-01 (High)**. |
| DOM-P3-02 (Medium) — one specialist releases a failed non-waivable blocker by re-determination | **PARTIALLY FIXED** | `assertReadinessDetermination` refuses lowering `blocker` / `mandatory` of a failed check (422 `readiness.determination.release_not_allowed`, also reproduced as CONTROL in DOM-P34R-02). **But** the same specialist's "not applicable" sign-off is allowed from `failed` with a note and clears the GO → **DOM-P34R-02 (Medium)**. Q-P3-02 is recorded as a question. |
| DOM-P3-03 (Medium) — GO on a stale evaluation | **FIXED (verified)** | `hub_readiness:<projectId>` advisory lock first in the GO, the execution record and every command changing a gating input (12 call sites); race probe passes plain (deterministic). Lock order documented (business-gates.md §5 rule 4); no cycle with `hub_gates` / `hub_dimensions` found by code review (the waiver service takes no advisory lock; gates code never takes the readiness lock). |
| DOM-P3-04 (Medium) — blocker failing after the GO | **FIXED (verified)** | `flagGoPlans` on a failed test / reopen / evidence invalidation; `record-execution` re-evaluates under the lock and is refused (`readiness.execution_blocked`, refusal kept in history); `return_to_planning` from `approved_go`; a new GO needs a new decision. Probe passes plain; `p3-fixes-readiness` test passes. |
| DOM-P3-05 (High) — "transfer not applicable" counts as transferred | **FIXED (verified)** for the reported effects | N/A on an in-scope item: specialist determination before baseline (403 `transfer.not_applicable_specialist` for the transfer manager), change request after baseline, never both aspects (`transfer.not_applicable_in_scope`); the dimension never counts an in-scope N/A item as transferred; reconciliation reports `transfer_not_applicable`. Probes 5a / 5b pass plain. New gap in the fix's own rule: an aspect marked N/A while the item is Excluded is carried into Included by `classify` → **DOM-P34R-05 (Medium)**. Q-P3-05 recorded. |
| DOM-P3-06 (High) — extension decision not bound to its end date | **PARTIALLY FIXED** | `extensionTermsBinding` refuses a different date on the **currently linked** decision once it left draft (`tsa.extension.terms_bound`, CONTROL of DOM-P34R-04); probe passes plain. **But** the binding lives only in the TSA row's current link: linking the request to any other pending `tsa_approval_or_extension` paper and then back to the approved one with a new date records the TSA as extended by the approved decision to a date it never saw → **DOM-P34R-04 (High)**. |
| DOM-P3-07 (Low) — extended to a past date | **FIXED (verified)** | `tsa.extension.end_date_past` at request and record; probe (now asserting the rule) passes. |
| DOM-P3-08 (Medium) — incorporation verified after evidence rejected | **FIXED (verified)** | `newco.incorporation_evidence_changed` job returns the verification to "proposed"; the dimension also requires active, uncontested evidence in the owning project (`status-dimensions.service.ts:102-108, 156`). Probe passes plain; `p3-fixes-newco` 2/2. |
| DOM-P3-09 (High) — rejected sign-off evidence leaves a blocker passed | **FIXED (verified)** for readiness checks (the finding's recommendation) | GO rule fails closed on invalid evidence (`evidenceInvalid`), worker reaction reopens the check and flags the GO. Probe passes plain. The same gap named in the finding for **transfers verified on evidence** and the **TSA replacement acceptance** was explicitly left open by the implementer ("recorded for the P3 gate report"); reproduced for transfers → **DOM-P34R-06 (Medium)**; TSA replacement acceptance not probed. |
| DOM-P3-10 (Medium) — evidence recorder signs off / verifies | **FIXED (verified)** | Evidence linkers are `not_self` subjects for readiness sign-off, incorporation verification, regulatory outcome, transfer verification. Probes 10 and 10b pass plain; `p3-fixes-carveout` transfer case passes. |
| DOM-P3-11 (Medium) — TSA problems vanish after G4 | **FIXED (verified)** | `carveout.ts:221-225`: after G4 a breached / expired TSA stays stated, terminal state needs every TSA exited; `isCarveOutComplete` requires it. Probe passes plain (pure rule). |
| DOM-P3-12 (Medium) — dimension states vs documented machines | **PARTIALLY FIXED** | The rule now produces only documented states (`DIMENSION_STATES` = template, unit-tested; probe passes) and never `day1_ready` without a GO. Template and business-gates.md §1 amended — the amendments are stated as an owner question (A-P3-12 / Q-P3-12), and the earlier unfounded label "interim arrangements active" was replaced by "other in-scope items pending". **But** the inputs that are supposed to move the operational dimension (GO, its withdrawal, execution, post-transition acceptance) do not trigger a recompute → the stored dimension lags or contradicts the plans → **DOM-P34R-03 (Medium)**. |
| DOM-P3-13 (Medium) — one decision, TSA A terms and TSA B extension | **FIXED — conservative option** | `assertSameTsa` (`tsa.service.ts:80-88`); probe asserts 422 `tsa.extension.decision_other_tsa`; `p3-fixes-tsa` covers the reverse. Q-P3-13 stated as a question for the governance owner. |
| DOM-P3-14 (Low) — recompute not serialized | **FIXED** | `hub_dimensions:<projectId>` lock (`status-dimensions.service.ts:186`); `gates/p3-dimension-lock` 1/1 (not independently probed). |
| DOM-P3-15 (Low) — descriptive fields feeding rules | **FIXED** | `testResult` not a PATCH field; `isEnduringArrangement` locked after terms approval (`tsa.enduring_locked`) and counted "approved" only then; consent need read from the specialist class. `p3-fixes-tsa`, `p3-fixes-carveout` pass. |
| DOM-P3-16 (Low) — summary counts expired waivers | **FIXED** | `p3-fixes-tsa` "a waiver that expired: the blocker is open again in the summary" passes. |
| DOM-P3-17 (Low) — TSA / agreement guards | **FIXED** | `tsa.activate.not_started`; remedy returns to the pre-breach status; `accelerate_exit` added; legal reviewer must hold `legal_restricted`. Tests pass. `accelerate_exit` takes the "deciding" decision only as free text — recorded as an owner question (A-P3-17b / Q-P3-17), not decided silently. |
| DOM-P3-I1 (Info) | **Resolved** | The `p2-qa-final-race` fixture was fixed after `5bf274b`; see the full-suite result (§1.6). |
| DOM-P3-I2 (Info) | Unchanged (Info) | Interim arrangement is still free text; G3-C02 criterion review is the approval. |

### 3.2 P4 domain review (`docs/reviews/P4-domain-review.md`)

| Finding | Status | Evidence |
|---|---|---|
| DOM-P4-01 (High) — one decision confirms several closings | **FIXED (verified)** | Registry kind `closing`; refusal `jv.closing.decision_already_used` (audit row, §1.3); concurrent double confirmation → one confirmed, the other 409 (`p4-decision-reliance`). Signing part: a signing relies on the decision that approved the current G5 cycle without consuming it — see Info DOM-P34R-I1. |
| DOM-P4-02 (High) — signing before G5 | **FIXED (verified)** | `assertSigningGatePassed` at request and inside the record; refusal `jv.signing.g5_not_passed`; flagged G5 → `jv.signing.g5_under_reassessment` (`p4-domain-fixes`). |
| DOM-P4-03 (High) — non-legal approver releases a non-waivable blocking CP | **FIXED (verified)** | `jv.cp.set_waivability` held by `legal_restricted` only (functional approver denied, audit row); Legal cannot release a blocking CP either (`jv.cp.blocking_release_not_allowed`, `p4-domain-fixes`). Residual at creation → Low DOM-P34R-08. |
| DOM-P4-04 (Medium) — CP validity / long-stop edited away | **FIXED (verified)** | `jv.cp.validity_locked`; long-stop later / cleared needs an approved extension; daily scan lapses and escalates (`p4-domain-fixes` 4 tests). |
| DOM-P4-05 (Medium) — DD evidence version disclosed ≠ reviewed | **FIXED (verified)** | Evidence version ids pinned at submit (`evidenceVersionIds` in the audit row), disclosure of the pinned version; a newer version before review refuses the approval (`p4-domain-fixes`). |
| DOM-P4-06 (High) — one valuation decision approves another version's values | **FIXED (verified)** | `finance.model.decision_already_used` (audit row). |
| DOM-P4-07 (High) — budget approvals exceed the decision amount | **FIXED (verified)** | `finance.budget.decision_already_used` (audit row); a decision without an amount backs no non-zero approval; currency and unit must match (`p4-decision-reliance-finance`). |
| DOM-P4-08 (Medium) — external approval on rejected evidence | **FIXED (verified)** | `jv.closing.decision_evidence_invalid` (audit row) and the same re-check in signing, long-stop extension, negotiation, valuation, budget, opening balance (`p4-decision-reliance`, `-finance`). Finance records already approved on such a decision are not flagged afterwards — documented as open for the governance owner (P4 review fix status), not decided silently. |
| DOM-P4-09 (Medium) — no TSA issue in the demo | **FIXED** | Demo seed has a TSA issue scenario (`readiness-demo-seed` in the full suite, §1.6). |
| DOM-P4-10 (Low) — `jv_transaction` states | **FIXED** | `carveout.ts:240-265`; `p4-domain-fixes` DOM-P4-10 tests. |
| DOM-P4-11 (Low) — flagged G7 accepted for program closure | **FIXED** | `p4-domain-fixes` "flagged: G7 not passed and the request is refused". |
| DOM-P4-12 (Low) — benefit definition editable after acceptance | **FIXED** | `p4-domain-fixes-finance` DOM-P4-12. |
| DOM-P4-13 (Low) — negotiation issues accept any decision | **Open — documented** | business-gates.md §8.1 (proposed, to be confirmed); evidence re-check added. |
| DOM-P4-14 (Low) — single-person checklist / funds flow | **Checklist part FIXED** (SEC-P34-10: request + confirmation by a second `jv.cp.verify` holder bound to the item version, `transactions.service.ts:622-681`); **funds-flow part open — documented**. business-gates.md §8.1 still describes the checklist step as single-person → DOM-P34R-07. |
| DOM-P4-15 (Low) — "materials access approved by" | **Open — documented** (business-gates.md §8 rule 4). |
| DOM-P4-16 (Low) — reconciliation separation | **FIXED** for the creator and the last editor (`finance.ts:494-496`; test passes); residual → DOM-P34R-09. |
| DOM-P4-17 (Low) — documentation | **FIXED** (§8 rules 4–5, G7-C02 note), except the new staleness in §8.1 (DOM-P34R-07). |

---

## 4. New findings

| ID | Severity | Phase | One line |
|---|---|---|---|
| DOM-P34R-01 | **High** | P3 | A descriptive PATCH of the cutover **plan's** `siteId` takes it out from under its site's FAILED blocker; the GO is accepted (DOM-P3-01 by the other side of the scope). |
| DOM-P34R-04 | **High** | P3 | The extension terms binding is cleared by re-linking the request to a second decision and back; the TSA is recorded as extended by the approved decision to a date it never saw (DOM-P3-06 by a detour). |
| DOM-P34R-02 | Medium | P3 | One specialist determines a FAILED non-waivable blocker "not applicable"; the GO is accepted (DOM-P3-02 by the sign-off path). |
| DOM-P34R-03 | Medium | P3 | GO, its withdrawal, execution and acceptance do not trigger a dimension recompute: the GO is not shown, and a withdrawn GO is still shown as "Day-1 GO approved for every transition plan". |
| DOM-P34R-05 | Medium | P3 | "Not applicable" marked while an item is Excluded is carried into Included by `classify`: no specialist, both aspects, and the item is stuck (N/A is terminal). |
| DOM-P34R-06 | Medium | P3 | The only evidence of a verified transfer is rejected; the perimeter still reads "All in-scope items transferred with verified evidence" (DOM-P3-09 gap left open for transfers). |
| DOM-P34R-07 | Low | P3/P4 | Documentation does not match the implementation: rebind "leave **or enter**" (code checks leaving only); §8.1 calls the checklist "not required" single-person (now two-person). |
| DOM-P34R-08 | Low | P4 | A CP can be created `blocking: false` by the project manager (`jv.cp.manage`) — a blocking-status determination outside Legal. Code review. |
| DOM-P34R-09 | Low | P4 | Reconciliation review excludes the creator and the last editor only; an intermediate editor of the explanation can review. Code review. |
| DOM-P34R-I1 | Info | P4 | One approved G5 cycle can back several signings (non-consuming reliance); governance owner to confirm. Code review. |

### DOM-P34R-01 — High — The plan's site is still a descriptive field: a FAILED site blocker escapes the GO

- **Where:** `apps/api/src/modules/readiness/cutover.service.ts:282-322` (`update` applies any `planDescriptive` field while the plan
  is `planning` / `rehearsal`); `packages/contracts/src/readiness.ts:395` (`planDescriptive.siteId`); `packages/domain/src/readiness.ts:227-231`
  (`readinessCheckAppliesToPlan`: an unbound site check gates a plan only while `check.siteId === plan.siteId`).
- **Finding:** the DOM-P3-01 fix made *which transitions a check gates* a command on the **check** (reason, refused for a failed
  check, history entries). The same relation is also defined by the **plan's** `siteId`, which stays a plain PATCH field. Site
  checklists are the standard model (REQ-RDY-002 instantiates the template per site). The PM changes the plan's site; the site's
  FAILED blocker no longer gates it; no reason, no `check_unbound` entry in the plan's decision history; the GO decider sees an
  evaluation without blockers, and the execution record re-evaluates with the same scoping, so nothing stops the go-live.
- **Reproduction (executed):** `DEFECT DOM-P34R-01` (`p34-domain-re-readiness.spec.ts`): site A plan in rehearsal, a site-A blocker
  fails (the plan's `goEvaluation` lists it); `PATCH …/cutover-plans/:id {siteId: B}` → **200**; link + submit; sponsor GO → **201
  `approved_go`**; check still `failed`; history `["rehearsal","submitted","go"]`. CONTROL: same set-up without the PATCH → 422
  `readiness.go_blocked`.
- **Spec / rule:** §7.4 "checklists with mandatory blockers"; §19 P3 exit "blockers prevent go-live"; AT-09; business-gates.md §5
  rule 1 ("which plans a check gates is not a description … a failed gating check keeps gating the transition(s) it was raised
  for until it is cleared"); CLAUDE.md "no generic PATCH may change a status column" (same effect). REQ-RDY-001, REQ-RDY-004,
  REQ-PHS-005.
- **Recommendation:** treat the plan's `siteId` like the check's binding: refuse the change while a gating check of the current
  site is failed / open (or move it to a command with a reason that writes `check_unbound` / `check_bound` entries and applies
  `assertReadinessCheckRebind` to every check that would stop gating the plan). A regression test should cover both directions
  (check re-bound, plan re-sited).

### DOM-P34R-04 — High — The extension terms binding is released by a detour through a second decision

- **Where:** `packages/domain/src/readiness.ts:408-424` (`extensionTermsBinding` returns `free` whenever the decision in the request
  is not the one currently linked on the TSA row); `apps/api/src/modules/readiness/tsa.service.ts:499-532` (`requestExtension`
  overwrites `extensionDecisionId` / `proposedEndDate` / `continuityPlan`); `:535-566` (`recordExtension` applies the stored date).
  `assertDecisionLinkable` (`readiness.ts:327-337`) accepts any decision of the right type that is not rejected or superseded, so
  a fresh draft paper is enough.
- **Finding:** the binding is a property of the TSA row's *current* link, not of the decision. Re-linking the request to another
  `tsa_approval_or_extension` paper (D2) clears it; re-linking back to the approved paper (D1) with a new date is then "free". The
  committee approved "to X"; the TSA is recorded as extended by D1 "to Y".
- **Reproduction (executed):** `DEFECT DOM-P34R-04` (`p34-domain-re-tsa.spec.ts`): request "to X" (2027-01-19) on D1 under review;
  D1 approved; direct re-request "to Y" on D1 → 422 `tsa.extension.terms_bound` (CONTROL); request "to Y" on D2 (under review) →
  201; request "to Y" on D1 → **201**; record → **201 `extended`**, end date **2036-09-28**; `decision_use` of D1 =
  `tsa_extension` of this TSA.
- **Spec / rule:** §7.3 "never automatically extend … an extension decision"; AT-10 "extension / continuity options await
  approval"; business-gates.md §6 rule 5 ("`record-extension` applies the end date the decision saw"); module guide "Relying on a
  governance decision". Same class and severity as DOM-P3-06. REQ-TSA-005.
- **Recommendation:** bind the terms to the decision, not to the TSA row: record `{tsaId, proposedEndDate, continuityPlan}` (or
  their hash) per decision when the paper leaves draft (e.g. on the decision-use registry or an extension-request row) and, at
  `record-extension`, refuse any stored terms that differ from those bound to the linked decision; alternatively refuse
  re-linking a request to a decision that already carried other terms for this TSA. Show the requested end date on the paper.

### DOM-P34R-02 — Medium — A FAILED non-waivable blocker released by one specialist's "not applicable"

- **Where:** `packages/domain/src/readiness.ts:37` (`determine_not_applicable` from `failed`) and `:93-96` (only a note);
  `apps/api/src/modules/readiness/checks.service.ts:508-547` (`signOff`).
- **Finding:** after the DOM-P3-02 fix, lowering `blocker` / `mandatory` of a failed check is refused, but the sign-off specialist can
  still set the same failed, non-waivable blocker `not_applicable` alone; `not_applicable` clears the GO. business-gates.md §5 rule 3
  and A-P3-02 say "a determination never releases an open blocker … a non-waivable one cannot be released"; the platform's rule
  for gate criteria needs a second person for "not applicable" (DOM-P2-15).
- **Reproduction (executed):** `DEFECT DOM-P34R-02`: failed non-waivable blocker; CONTROL inside — determination lowering it → 422
  `readiness.determination.release_not_allowed`; the same `approver` signs off `not_applicable` → 201; sponsor GO → **201**.
- **Spec / rule:** §3 "an exception cannot override a non-waivable condition"; AT-09, AT-13; REQ-RDY-001, REQ-RDY-004.
- **Recommendation (Operations specialist to confirm — fits Q-P3-02):** refuse "not applicable" on a FAILED gating check (and on an
  open one gating a plan under decision or with a GO), or require a second person; record the rule in business-gates.md §5.

### DOM-P34R-03 — Medium — The Day-1 GO and its withdrawal do not move the operational dimension

- **Where:** `apps/api/src/modules/readiness/cutover.service.ts:323-338` (`apply` — used by GO / NO-GO, return to planning,
  execution, rollback, acceptance — writes no `readiness.changed` event and calls no recompute); `apps/api/src/modules/gates/gates.jobs.ts:18`
  (`DIMENSION_EVENTS`). Since DOM-P3-12, `buildInput` reads the plans (`status-dimensions.service.ts:146-152`), so these commands are
  dimension inputs.
- **Finding:** the stored dimension changes only on an unrelated event (check change, perimeter change …) or an explicit recompute.
  After a GO it keeps "0 of 1 transition plan(s) with an approved Day-1 GO"; after the GO is withdrawn it keeps
  `day1_go_approved` — "Day-1 GO approved for every transition plan" — while the only plan is back in planning. The same applies to
  execution / acceptance (`operating_with_transitional_services`) and rollback (not executed for those).
- **Reproduction (executed):** `DEFECT DOM-P34R-03a` / `-03b` (`p34-domain-re-dimension.spec.ts`), worker drained after each
  command, stored dimension read with GET; CONTROL between them: an explicit recompute gives `day1_go_approved` (the rule is right).
- **Spec / rule:** §3 "display that distinction accurately"; business-gates.md §1 rule 8 ("never Day-1 ready without a GO
  decision"; "What moves it: … go/no-go decision, post-transition acceptance"); REQ-LCY-006, REQ-LCY-014.
- **Recommendation:** emit `readiness.changed` (deduplicated per plan version) from `CutoverService.apply` — as `ReadinessSupport.enqueueDimensions`
  does for checks and TSAs — and add an API-level test that drives the dimension through a real GO, a withdrawal and an acceptance.

### DOM-P34R-05 — Medium — "Not applicable" carried into the transferring scope by a reclassification

- **Where:** `apps/api/src/modules/carveout/transfers.service.ts:157-161` (on an Excluded item `mark_not_applicable` is the transfer
  manager's plain command); `apps/api/src/modules/carveout/perimeter.service.ts:711-741` (`classify` changes disposition and scope
  only — transfer statuses untouched); `packages/domain/src/workflows.ts:280` (`not_applicable` is terminal).
- **Finding:** the DOM-P3-05 fix requires, for an Included / Shared item, a specialist determination (before baseline) and never both
  aspects. Marking the aspects while the item is Excluded and then classifying it Included (before baseline: applied directly by the
  same PM) produces an in-scope item with both aspects "not applicable", no specialist, no basis — and no way out, since nothing
  leaves `not_applicable`, while the dimension tells the user to "reclassify them or plan the transfer". With one aspect only, the
  item would count as transferred on the other aspect alone (`combinedTransferStatus`, `carveout.ts:145-149`), the dimension
  disclosing "one transfer aspect **determined** not applicable" although nobody determined it (code reading, not executed).
- **Reproduction (executed):** `DEFECT DOM-P34R-05` (`p34-domain-re-perimeter.spec.ts`): Excluded contract item; legal N/A 201,
  economic N/A 201 (PM, note "Retained"); `classify → included` → **201 applied**, no change request; item `included`,
  `{legal: not_applicable, economic: not_applicable}`. `OBSERVED DOM-P34R-05`: `allowedTransferCommands {legal: [], economic: []}`;
  the perimeter explanation contains "neither a legal nor an economic transfer".
- **Spec / rule:** §7.1; AT-07; A-P3-05 / business-gates.md §1 rule 8; REQ-PER-002, REQ-PER-007.
- **Recommendation:** when an item becomes Included / Shared, reset `not_applicable` aspects to `not_started` (history kept) or refuse
  the reclassification until a specialist determines them; owner of the N/A rule: Legal / Finance (Q-P3-05).

### DOM-P34R-06 — Medium — A verified transfer stays "verified" after its only evidence is rejected

- **Where:** no `evidence.changed` consumer for `transfer` targets (only readiness checks, legal entities, gates and AI subscribe —
  `apps/api/src/modules/*/*.jobs.ts`); `status-dimensions.service.ts:109-112` reads the stored transfer status only;
  `carveout.ts:183` (`transferred_verified`).
- **Finding:** named in DOM-P3-09 ("the same gap exists for transfers verified on evidence, TSA replacement acceptance") and left
  open by the implementer. The documents module's rejection leaves both aspects `transferred_verified` with zero active evidence and
  the perimeter dimension "All in-scope items transferred with verified evidence". It is the perimeter twin of DOM-P3-08.
- **Reproduction (executed):** `DEFECT DOM-P34R-06`: the only in-scope item transferred on both aspects and verified by Legal on the
  PM's evidence → `transferred_verified` (CONTROL); the secretary rejects the link (201); worker drained; item still
  `transferred_verified`, evidence `{active: 0}`, dimension `transferred_verified`.
- **Impact:** with incorporation verified and G4 approved with every TSA exited, `carveOutComplete` would be true on rejected
  transfer evidence (AT-06) — not executed end to end.
- **Spec / rule:** §3 controlled reopen; AT-06, AT-14; REQ-PER-007, REQ-LCY-006.
- **Recommendation:** apply the readiness / NewCo reaction to transfers: when the active evidence of a verified aspect is rejected,
  superseded or contested, return it to `in_progress` through `reject_evidence` (service principal, audited, history kept) or keep
  it but count it as evidence pending in the dimension. Do the same for the TSA replacement acceptance.

### DOM-P34R-07 — Low — Documentation contradicts the implementation in two places

- business-gates.md §5 rule 1 (line 387) says re-binding is refused for an open gating check "that would leave **or enter**" a plan
  at `ready_for_decision` / `approved_go`; `checks.service.ts:395-396` checks `leaving` only (entering is fail-safe — the evaluation
  then shows the blocker — but the GO is not flagged with a `go_flagged` entry, only `check_bound`). Align the text or the code.
- business-gates.md §8.1 (line 533) still says a closing checklist item set `not_required` is a single-person step; since
  SEC-P34-10 it is requested by the checklist manager and confirmed by a second `jv.cp.verify` holder. Update §8.1 (funds-flow part
  unchanged).

### DOM-P34R-08 — Low — A CP can be recorded non-blocking by the project manager (code review, not executed)

- `apps/api/src/modules/jv/transactions.service.ts:748-779` (`createCp`, permission `jv.cp.manage`, held by `project_manager` and
  `legal_restricted`) stores `blocking: body.blocking` from the request. The DOM-P4-03 fix restricts *changing* blocking status to
  Legal (`jv.cp.set_waivability`, "Legal specialist determination of a closing condition's blocking status"), but the initial status
  is the creator's choice. The CP list and the confirmation snapshot show it, and Legal can raise it. Recommendation (Legal to
  confirm): create every CP blocking and let Legal lower it only at creation review, or require `jv.cp.set_waivability` for
  `blocking: false`.

### DOM-P34R-09 — Low — Reconciliation review: intermediate editors are not excluded (code review, not executed)

- `packages/domain/src/finance.ts:486-497` excludes `preparedBy` (last editor) and `createdBy`. A person who edited the explanation
  between them can review the reconciliation. Recommendation: exclude every person who edited the reconciliation (the record
  history has them), consistent with the evidence-linker rule of SEC-P34-01.

### DOM-P34R-I1 — Info — One G5 approval can back several signings (code review)

- `transactions.service.ts:450-451, 492-498` and module-guide / business-gates.md §8 rule 5: the signing relies on the decision
  that approved the current G5 cycle "and adds no registry row of its own"; nothing refuses a second signing (for example with
  another partner) on the same G5 cycle. Spec §3 requires multiple **closings**, not multiple signings. For the governance owner:
  whether a G5 approval covers one signing (and one partner) only.

---

## 5. New behaviour introduced by the fixes (item 3 of the brief)

| Behaviour | Assessment |
|---|---|
| Readiness re-binding command (`POST …/rebind`) | Sound for the check side (reason, lock, refusals, history entries; `p3-fixes-readiness` 2 tests). Gap: the plan side (DOM-P34R-01); doc "or enter" (DOM-P34R-07). |
| Transfer "not applicable" determination | Specialist before baseline, change request after, never both, never counted as transferred — sound for in-scope items. Gap: through reclassification (DOM-P34R-05); the N/A state is terminal. Who may determine which aspect is an owner question (Q-P3-05), stated as a question. |
| Extension terms binding | Closes the direct path; bypass by detour (DOM-P34R-04). |
| Dimension vocabulary | Only documented states produced; template amended without inventing facts (the unfounded "interim arrangements active" label removed); amendments stated as Q-P3-12. Gap: GO / acceptance inputs not triggering a recompute (DOM-P34R-03). |
| TSA lifecycle changes | `activate` after the start date, remedy back to the pre-breach status, `accelerate_exit` (breached → exit in progress) — none of them can declare an exit (exit acceptance still needs the accepted replacement with evidence and an independent approver). `accelerate_exit` names its decision only in free text and removes the "breached" problem from the operational dimension; this is recorded as A-P3-17b / Q-P3-17 (owner question), not decided silently. |
| Two-person "not required" on closing checklists | Sound: request bound to the item version, decided by a second `jv.cp.verify` holder (never the requester), stale requests invalidated, row lock against concurrent requests (`transactions.service.ts:622-681`). Documentation lag only (DOM-P34R-07). |
| Readiness lock / GO withdrawal | `hub_readiness` lock taken by every gating-input command; `return_to_planning` from `approved_go` is conservative (it can only prevent a go-live); the consumed decision cannot back a new GO. |

**Open owner questions.** `docs/assumptions-and-open-questions.md` lines 105-126 record A-P3-02 / -05 / -12 / -13 / -17a / -17b /
-SEC05 as the build's current written rules with "how to reverse", and Q-P3-02 / -05 / -12 / -13 / -17 / -SEC05 as questions with an
owner role and "Assessment pending". AMQ-10 (contributor powers at creation) is in `docs/security/access-matrix.md` §12 as a
question with "Role — To be confirmed". None of them is presented as a Mobily decision. No legal / regulatory determination, partner
identity, amount, date or incorporation status was invented by the fixes (seed and template diffs read).

---

## 6. Not verified / NOT EXECUTED

- Reaching an approved G4 (and therefore `carveOutComplete: true`) through the API was not attempted; the AT-06 impact of
  DOM-P34R-06 is stated from the rule (`isCarveOutComplete`).
- DOM-P34R-03: execution, acceptance and rollback were not driven through the API (same code path `apply` as the GO and the
  withdrawal, which were executed).
- DOM-P34R-05: the one-aspect variant (item counted as transferred on the other aspect) was not executed.
- DOM-P34R-08, -09, -I1: code review only.
- DOM-P3-09 residual for the TSA replacement acceptance: not probed.
- DOM-P3-14 was not independently probed (the implementers' `p3-dimension-lock` test passes).
- Playwright was not run (not requested for this review); partner isolation and NDA criteria of P4 were not re-reviewed (security /
  QA scope, no fix touched them).

## 7. Verdict

- **P3: FAIL.** Open High: DOM-P34R-01, DOM-P34R-04. Open Medium: DOM-P34R-02, -03, -05, -06. DOM-P3-01, -02, -06, -12 are
  partially fixed through these findings; every other P3 finding is fixed (verified) or, for the owner-dependent ones, implemented
  with the conservative option and recorded as a question.
  Requirements whose `Tested` status should be re-checked: REQ-RDY-001 / REQ-RDY-004 (DOM-P34R-01, -02), REQ-TSA-005 (DOM-P34R-04),
  REQ-LCY-006 / REQ-LCY-014 (DOM-P34R-03), REQ-PER-002 / REQ-PER-007 (DOM-P34R-05, -06); REQ-PHS-005 stays open.
  To reach PASS: fix DOM-P34R-01 and DOM-P34R-04 with their probes turned into regression tests (assertions unchanged); fix the
  four Medium findings or have the domain owner accept them with a recorded decision; then a focused re-check of those probes.
- **P4: PASS WITH CONDITIONS.** No open Critical / High / Medium P4 finding. Conditions for the P4 gate report: DOM-P34R-07 (P4 part:
  §8.1), DOM-P34R-08, DOM-P34R-09 and the documented Lows DOM-P4-13, DOM-P4-14 (funds flow), DOM-P4-15 with owners; DOM-P34R-I1
  and the finance reassessment point of DOM-P4-08 to the governance owner.
