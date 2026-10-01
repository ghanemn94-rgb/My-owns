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

---

## 8. Fix status (implementer, separate context)

Written by the implementer (`backend-data-engineer`, implementation mode) in its own context, on the branch merged with
`df5a0c9`; the reviewer's text above is unchanged. Commits: `8fe5989` (DOM-P34R-01, -03), `0d9a1c8` (DOM-P34R-04), `1293faa`
(DOM-P34R-02), `8e1947f` (DOM-P34R-05, -06 and the TSA replacement-acceptance residual), `2707f4c` (DOM-P34R-07, -08, -09 and
the documentation), `085cd6a` (requirement evidence). Every fixed `DEFECT` probe of `p34-domain-re-*.spec.ts` is renamed
"… (fixed, regression)" and is a plain `it` with its assertion unchanged; the `defect` alias stays in each file (with
`void defect;`) so that `P34DRE_PROBE_PLAIN=1` keeps working. The one `OBSERVED` probe (DOM-P34R-05) pinned the reported
behaviour; following the probe convention it was updated with the fix (setup unchanged) and now pins the implemented rule.
`CONTROL` probes are unchanged. Rules are written down in `docs/governance/business-gates.md` (§1 rule 8, §5 rules 1/3/4, §6
rules 5 and 10, §7, §8.1), `docs/security/access-matrix.md` (§5.1, §9) and `docs/architecture/module-guide.md`; owner
questions in `docs/assumptions-and-open-questions.md` (A-P3-02, A-P3-05b, A-P34R-08 / Q-P34R-08).

| Finding | Status | Rule → file | Tests |
|---|---|---|---|
| **DOM-P34R-01** (High) | **Fixed** | The plan's `siteId` is no longer a PATCH field (400). It changes only through `POST …/cutover-plans/:planId/site` (reason required, readiness lock), before the go/no-go (`readiness.cutover.locked` otherwise), refused while a FAILED gating check of the plan's current scope would stop gating it (`readiness.cutover.site_change_failed_check`); the decision history records `site_changed` with the checks leaving and entering; `readiness.changed` emitted. The site is the only plan field that decides which checks gate it (`readinessCheckAppliesToPlan`) → `packages/domain/src/readiness.ts` (`assertCutoverPlanSiteChange`), `packages/contracts/src/readiness.ts` (`UpdateCutoverPlanBody` without `siteId`, `changeCutoverPlanSite`), `apps/api/src/modules/readiness/{cutover.service.ts (changeSite), readiness.controller.ts, readiness.support.ts}`; web: "Change site" dialog on the plan page, site locked in the edit form, history label and refusal texts (en + ar) | `p34-domain-re-readiness.spec.ts` "DOM-P34R-01: … (fixed, regression)"; `readiness/p34r-fixes-readiness.spec.ts` DOM-P34R-01 describe (4 tests: PATCH 400; failed site blocker 422 and plan unchanged; open check leaves with reason and history; locked under decision); `readiness.test.ts` "reason required; only before the go/no-go; refused while a FAILED gating check would stop gating the plan" |
| **DOM-P34R-04** (High) | **Fixed** | The extension terms are bound to the DECISION: new table `tsa_extension_terms` (one row per decision: TSA, end date, continuity plan; unique on the decision). A request binds its terms; they change only while the decision is a draft; afterwards another date / plan is `tsa.extension.terms_bound` and another TSA `tsa.extension.decision_other_tsa`, whatever the TSA row was linked to in between. `record-extension` applies only the terms bound to the linked decision (`tsa.extension.terms_mismatch`). The decision row is read `FOR SHARE` (a concurrent submission is serialized); the registry check runs first (a consumed decision is still `decision_already_used`) → `packages/domain/src/readiness.ts` (`extensionTermsBinding`, `assertExtensionTermsRecordable`), `packages/db/src/schema/carveout.ts` (`tsaExtensionTerms`), `apps/api/src/modules/readiness/tsa.service.ts` (`requestExtension`, `recordExtension`); single migration and data dictionary / ERD regenerated; refusal text en + ar | `p34-domain-re-tsa.spec.ts` "DOM-P34R-04: … (fixed, regression)" (the CONTROL still 422 `terms_bound`); `readiness/p34r-fixes-tsa.spec.ts` (draft terms change, bound after draft, detour refused, record of the bound date; one TSA per decision, re-purposed draft → `terms_mismatch`); `readiness.test.ts` "DOM-P3-06 …", "DOM-P34R-04: the terms are bound per DECISION …" |
| **DOM-P34R-02** | **Fixed** (Operations specialist to confirm, Q-P3-02) | The sign-off as "not applicable" follows the determination rule of DOM-P3-02: refused for a FAILED gating check (status or latest test) and for an open gating check of a plan under go/no-go decision or with a GO (`readiness.signoff.na_release_not_allowed`); a non-gating check, or an open one of a plan in planning, may still be determined not applicable with a basis → `readiness.ts` (`assertReadinessSignoffAllowed`), `checks.service.ts` (`signOff`); refusal text en + ar | `p34-domain-re-readiness.spec.ts` "DOM-P34R-02: … (fixed, regression)"; `p34r-fixes-readiness.spec.ts` DOM-P34R-02 describe (2 tests); `readiness.test.ts` "DOM-P34R-02: …" |
| **DOM-P34R-03** | **Fixed** | Every cutover state command (`CutoverService.apply`: GO / NO-GO, withdrawal, execution, rollback, acceptance) and the site change emit `readiness.changed` deduplicated per plan version (`ReadinessSupport.enqueueDimensions`, kind `plan`) → the gates job recomputes the dimensions → `cutover.service.ts`, `readiness.support.ts` | `p34-domain-re-dimension.spec.ts` "DOM-P34R-03a: … (fixed, regression)", "DOM-P34R-03b: … (fixed, regression)"; `gates/p34r-cutover-dimension.spec.ts` "GO → day1_go_approved; execution keeps it; acceptance → operating_with_transitional_services (worker drained, no explicit recompute)" |
| **DOM-P34R-05** | **Fixed** (Legal / Finance to confirm, Q-P3-05) | When an item ENTERS the transferring scope (classification before the baseline, applied change request after it), every aspect marked "not applicable" while it was out of scope is reset to `not_started`, recorded in the transfer history as `scope_reset` (check constraint extended) — to be planned or determined by the specialist; never carried in as a determination → `packages/domain/src/perimeter.ts` (`scopeEntryTransferReset`), `apps/api/src/modules/carveout/perimeter.service.ts` (`classify`, `applyChange`), `packages/db/src/schema/carveout.ts`; web history label (en + ar) | `p34-domain-re-perimeter.spec.ts` "DOM-P34R-05: … (fixed, regression)" and the updated OBSERVED probe "DOM-P34R-05 (fixed): entering the scope resets …"; `carveout/p34r-fixes-carveout.spec.ts` (before baseline, one aspect; after baseline, applied change request); `perimeter.test.ts` DOM-P34R-05 |
| **DOM-P34R-06** | **Fixed** (and the TSA replacement-acceptance residual of DOM-P3-09) | Transfers: the status dimension fails closed at once (an aspect `transferred_verified` without active, uncontested transfer evidence counts as evidence pending — `status-dimensions.service.ts` `buildInput`), and the new evidence reaction (job `carveout.transfer_evidence_changed`, service identity `svc-carveout`, allowlist `carveout.register.read` + `carveout.transfer.manage`) returns every verified aspect to `in_progress` through `reject_evidence` (system entry: `transfer_record.recorded_by` now nullable, DTO `recordedBy` nullable, shown as "System" in en + ar), audited, record history kept → `transfers.service.ts` (`processEvidenceChange`), `carveout.jobs.ts`. TSAs: the readiness evidence reaction now also handles `tsa_service` targets and withdraws a replacement acceptance whose evidence is no longer valid (an accepted exit stays recorded, audited, and is not counted as exited in the dimension — `exitEvidenceValid`, message `dimension.readiness.exit_evidence_invalid`) → `tsa.service.ts` (`processEvidenceChange`), `readiness.jobs.ts`, `packages/domain/src/carveout.ts` | `p34-domain-re-perimeter.spec.ts` "DOM-P34R-06: … (fixed, regression)"; `p34r-fixes-carveout.spec.ts` "the dimension fails closed at once (evidence pending); …"; `p34r-fixes-tsa.spec.ts` "the evidence reaction withdraws the replacement acceptance …"; `rules.test.ts` "DOM-P34R-06: an accepted TSA exit whose acceptance evidence is no longer valid is not an exit …"; `gates/at-06-status-dimensions.spec.ts` setup now links the transfer evidence its verified items rely on |
| DOM-P34R-07 | **Fixed** | Code aligned with the documented rule: an open gating check re-bound INTO a plan at `approved_go` flags that GO (`go_flagged` entry, audit; the execution record is then refused); business-gates.md §5 rule 1 now says the refusal is for LEAVING a decided plan. §8.1 updated: the checklist "not required" is a two-person step since SEC-P34-10 → `checks.service.ts` (`rebind`), `docs/governance/business-gates.md` | `p34r-fixes-readiness.spec.ts` "rebind into a plan at approved_go: check_bound and go_flagged entries; the execution record is refused" |
| DOM-P34R-08 | **Fixed** (test written first; Legal to confirm, Q-P34R-08) | The CP manager creates conditions blocking; a non-blocking CP needs `jv.cp.set_waivability` (Legal) — 403 `jv.cp.non_blocking_requires_specialist`, nothing created; the web CP form disables the option for other users (hint en + ar) → `apps/api/src/modules/jv/transactions.service.ts` (`createCp`), `apps/web/…/jv/_components/event-detail.tsx`; `p4-domain-fixes.spec.ts` now creates its informational CP as Legal | `jv/p4-domain-fixes.spec.ts` "DOM-P34R-08: the CP manager creates conditions blocking — …" (failed against the previous service: 201 for the PM) |
| DOM-P34R-09 | **Fixed** (test written first) | The reconciliation reviewer is none of the people who created or edited it — the record history (`record_version` rows `created` / `updated`) — besides the creator and the last preparer → `packages/domain/src/finance.ts` (`assertReconcilable`, `editorUserIds`), `apps/api/src/modules/finance/reconciliations.service.ts`; access-matrix §5.1 | `finance/p34r-fixes-finance.spec.ts` "created by Finance, explained by Legal, re-explained by the approver: Legal (an intermediate editor) is refused (403); a fourth person reviews" (failed against the previous service: 201); `p4-domain-fixes.test.ts` "DOM-P34R-09: …" |
| DOM-P34R-I1 | Info — not changed (governance owner) | — | — |

Schema (single migration regenerated): new table `tsa_extension_terms`; `transfer_record.recorded_by` nullable;
`transfer_record_command_ck` accepts `scope_reset`. Not changed: REQ-PHS-005 stays Implemented (it closes with the P3 gate
report, lead's); the decision paper does not yet display the requested extension end date (the governance paper form —
recommendation of DOM-P34R-04, not needed for the rule, which binds the terms to the decision).

Verification at `085cd6a` (own databases `hub_test_p3fix*`): `pnpm lint` and `pnpm typecheck` pass; domain unit tests
22 files, 459/459; full API suite **129 files, 1007 passed + 2 expected fail** (the two
open P2 Lows DOM-P2F-02 / DOM-P2F-04 — every DOM-P34R probe now passes as a plain test); `P34DRE_PROBE_PLAIN=1` on the
four `p34-domain-re-*` files 13/13; the -08 / -09 tests were run against the previous services first and failed there
(201 instead of 403); Playwright on the implementer's own stack (production web build): `p3-carveout`, `p3-readiness`,
`p4-jv` 11/11; secret scan (tree) PASS.

---

## 9. Re-check of the fixes (lead request)

| Item | Value |
|---|---|
| Reviewer | carveout-domain-analyst (REVIEW mode, separate context) — the author of §1–§7, not of the fixes in §8 or of the security re-check fixes. |
| Revision re-checked | `2ed5d55` on `claude/mobily-transformation-hub` (fetch + merge of `origin/claude/mobily-transformation-hub` → fast-forward from this review's commit `aea6b0c`, which is an ancestor). Frozen. It contains the DOM-P34R fixes (§8) and the security re-check fixes SEC-P34R-* (`0f484b4`, `52a6c8a`, `50ef3d9`, `b6d1415`, `73a81d2`). |
| Added by this re-check | This section and three probe files: `apps/api/test/reviews/p34-domain-re2-tsa.spec.ts`, `p34-domain-re2-readiness.spec.ts`, `p34-domain-re2-perimeter.spec.ts`. No other file changed; §1–§8 above are unchanged. |
| Date | 2026-10-01 |
| **Verdict P3** | **FAIL** — one High open: **DOM-P34R2-01**, an equivalent path around the DOM-P34R-04 fix. A decision that was already final when the first extension terms were bound to it backs an extension to any date chosen after the vote. This includes the decision that approved the TSA's own terms, so the TSA manager alone can extend any approved TSA once. Every other DOM-P34R finding is fixed and verified, and "blockers prevent go-live" is now **met**. |
| **Verdict P4** | **PASS WITH CONDITIONS** — DOM-P34R-07 (P4 part), -08 and -09 fixed and verified; the security re-check changes do not break the P4 domain rules checked. Conditions unchanged: documented Lows DOM-P4-13, DOM-P4-14 (funds-flow part), DOM-P4-15 and Info DOM-P34R-I1 with owners; Q-P34R-08 (Legal) is stated as a question. |

### 9.1 Commands and real results

Own databases only (`hub_test_p34dre`, `hub_test_p34dre_boot`, `hub_test_p34dre_probe`); no Docker, no e2e stack; another agent's
test processes were running and were not touched.

```
$ merge of origin/claude/mobily-transformation-hub          → fast-forward to 2ed5d55 (aea6b0c is an ancestor)
$ pnpm install --frozen-lockfile --offline; pnpm build:packages; (apps/api) npx tsc -p tsconfig.build.json   → exit 0, 0, 0
$ (packages/domain) npx vitest run                         Test Files 22 passed (22)   Tests 461 passed (461)
$ (apps/api) pnpm run lint                                  module boundary check passed: 43 cross-module imports, 19 module edges … (exit 0)
```

**This review's probes, plain mode** (`P34DRE_PROBE_PLAIN=1`; every former DEFECT probe is now a plain `it` named
"… (fixed, regression)"):

```
$ P34DRE_PROBE_PLAIN=1 TEST_DATABASE_URL=…/hub_test_p34dre_probe … npx vitest run test/reviews/p34-domain-re-{readiness,dimension,tsa,perimeter}.spec.ts --reporter=verbose
 ✓ CONTROL: a failed SITE blocker gates the plan of that site — the GO is refused (422 readiness.go_blocked)
 ✓ DOM-P34R-01 … (fixed, regression)     ✓ DOM-P34R-02 … (fixed, regression)
 ✓ CONTROL: request "to X" on decision D1 …; re-requesting "to Y" on D1 is refused (422 tsa.extension.terms_bound)
 ✓ DOM-P34R-04 … (fixed, regression)
 ✓ CONTROL: the only in-scope item transferred … → transferred_verified      ✓ DOM-P34R-06 … (fixed, regression)
 ✓ DOM-P34R-05 … (fixed, regression)     ✓ DOM-P34R-05 (fixed): entering the scope resets the "not applicable" aspects …
 ✓ CONTROL: one plan, its only blocker cleared, plan submitted …             ✓ DOM-P34R-03a … (fixed, regression)
 ✓ CONTROL: an explicit recompute after the GO gives day1_go_approved        ✓ DOM-P34R-03b … (fixed, regression)
 Test Files  4 passed (4)
      Tests  13 passed (13)
```

Reason check — rejected / refused audit rows of that run (each probe passes for the intended reason):

```
$ psql …/hub_test_p34dre_probe -Atc "select p.code, a.action, a.outcome, left(a.reason,160) from audit_event a join project p … where p.code like 'P34R-%' and a.outcome <> 'success' …"
P34R-GO |readiness.determineCheck  |rejected|readiness.determination.release_not_allowed: RC-003 is a failed gating check …   (CONTROL in DOM-P34R-02)
P34R-GO |readiness.signOffCheck    |rejected|readiness.signoff.na_release_not_allowed: RC-003 is a failed gating check: a "not applicable" sign-off cannot release it …   (DOM-P34R-02)
P34R-GO |readiness.decideGoNoGo    |rejected|cutover.invalid_transition: Cannot decide_go a cutover in state "rehearsal" …     (DOM-P34R-01, see note)
P34R-TSA|readiness.requestExtension|rejected|tsa.extension.terms_bound: … (end date 2027-01-19) is before the committee …    (CONTROL)
P34R-TSA|readiness.requestExtension|rejected|tsa.extension.terms_bound: … (end date 2027-01-19) is before the committee …    (DOM-P34R-04: back to D1 with Y)
P34R-TSA|readiness.recordExtension |rejected|tsa.extension_requires_decision: … The linked decision is under_review …        (DOM-P34R-04: TSA left on D2)
$ … where p.code='P34R-PER' and action like 'carveout.transfer.%' …
P34R-PER|carveout.transfer.evidence_invalidated|The transfer evidence was rejected, superseded or contested after verification (active 0, contested 0) …|{"legal": "in_progress", "economic": "in_progress", …}   (DOM-P34R-06)
```

Note on DOM-P34R-01: the probe now passes because the contract refuses a plan PATCH carrying `siteId` (400, contract validation,
so no audit row). The probe's GO then meets a plan that was never submitted (`cutover.invalid_transition`). The assertion still
holds and is unchanged. This re-check's CONTROL (§9.2) and the implementer's `p34r-fixes-readiness` tests show the new site
command refusing the move itself.

**Weakening check** (`diff aea6b0c..2ed5d55` on the four probe files):
- The DEFECT probes changed only by `defect(…)` → `it(…)`, the "(fixed, regression)" suffixes, a comment and `void defect;`.
- The one OBSERVED probe (DOM-P34R-05) now asserts the implemented rule, with setup unchanged: both aspects `not_started`, `plan` allowed, two `scope_reset` records, and the "neither … nor" message gone.
- No assertion of a DEFECT probe and no CONTROL changed. **Not weakened.**

**Re-check probes** (equivalent paths, one or more per finding; plain mode):

```
$ P34DRE_PROBE_PLAIN=1 … npx vitest run test/reviews/p34-domain-re2-{tsa,readiness,perimeter}.spec.ts --reporter=verbose
 ✓ VARIANT DOM-P34R-06: a second link is flagged as conflicting with the verified transfer's evidence — … no longer transferred_verified … both aspects to in_progress
 ✓ VARIANT DOM-P34R-05: an item added after the baseline is held pending; the PM marks its legal transfer not applicable; … applied … aspect reset
 ✓ CONTROL: the site command refuses to move a plan away from its FAILED site blocker (422 readiness.cutover.site_change_failed_check), the plan unchanged
 ✓ OBSERVED DOM-P34R2-O1: after the PM records a passing test (failed → in_progress, never signed off), the site command moves the plan … the GO is accepted
 ✓ OBSERVED DOM-P34R2-O2: after the PM records a passing test, the sign-off specialist determines the open blocker "not applicable" while its plan is in planning …
 × DEFECT DOM-P34R2-01a: terms decision {"status":"approved","outcome_recorded_at":"2026-10-01 06:01:57.345+00"}; request 201; record 201 {"status":"extended"};
     TSA extended end 2036-09-28; bound terms [{"end_date":"2036-09-28","bound_at":"2026-10-01 06:01:57.445728+00"}]: expected '2036-09-28' not to be '2036-09-28'
 × DEFECT DOM-P34R2-01b: extension decision {"status":"approved","outcome_recorded_at":"2026-10-01 06:01:58.026+00"}; request 201; record 201 {"status":"extended"};
     TSA extended end 2034-12-18; bound terms [{"end_date":"2034-12-18","bound_at":"2026-10-01 06:01:58.057232+00"}]: expected '2034-12-18' not to be '2034-12-18'
 Test Files  1 failed | 2 passed (3)
      Tests  2 failed | 5 passed (7)
```

**Subset, default mode.** It covers the implementer's regression specs, the security re-check probes, the P3 / P4 acceptance
specs and every probe file of this review:

```
$ TEST_DATABASE_URL=…/hub_test_p34dre_probe … npx vitest run <28 files> --reporter=verbose
 Test Files  28 passed (28)
      Tests  183 passed | 2 expected fail (185)          # the 2 expected fails: DEFECT DOM-P34R2-01a / -01b
   Duration  259.71s
```

Per file (all passed):

| Group | Files (tests) |
|---|---|
| Implementer regressions | `readiness/p34r-fixes-readiness` (7), `readiness/p34r-fixes-tsa` (3), `carveout/p34r-fixes-carveout` (3), `gates/p34r-cutover-dimension` (1), `finance/p34r-fixes-finance` (1), `jv/p4-domain-fixes` (15, incl. DOM-P34R-08) |
| Security re-check probes | `reviews/p34-sec-re-fixes` (11), `reviews/p34-sec-re-jv-ai` (12), `reviews/p34-sec-re-registers` (12) |
| P3 / P4 acceptance specs | `carveout/at-06-incorporation-separate` (7), `gates/at-06-status-dimensions` (6), `carveout/at-07-perimeter-change-control` (9), `carveout/at-08-day1-contract-position` (8), `readiness/at-09-readiness-go-no-go` (13), `readiness/at-10-tsa-expiry` (11), `jv/at-12-closing-blocked-cp` (5), `jv/at-13-cp-non-waivable` (5), `finance/finance-figures` (15) |
| Earlier review probes | `reviews/p3-domain-readiness-go` (6), `reviews/p3-domain-tsa` (3), `reviews/p4-domain-jv` (12) |
| This review's probes | `p34-domain-re-*` (13), `p34-domain-re2-*` (7, of which 2 expected fail) |

**Full API suite** (once, at the end):

```
$ free -g                                                    → 9 GB free before the start
$ (apps/api) TEST_DATABASE_URL=…/hub_test_p34dre TEST_DATABASE_MIGRATION_URL=…/hub_test_p34dre pnpm test --reporter=verbose
 Test Files  135 passed (135)
      Tests  1047 passed | 4 expected fail (1051)
   Duration  1373.93s
exit 0
```

The 4 expected failures are the two open DEFECT probes of this re-check (DOM-P34R2-01a, -01b) and the two open P2 Lows
DOM-P2F-02 / DOM-P2F-04. Every former DOM-P3 / DOM-P4 / DOM-P34R probe passes as a plain test.
`p1/p1-closure-empty-db.spec.ts` ran on `hub_test_p34dre_boot` and passed.

### 9.2 Status of the re-review findings

| Finding | Status | Evidence |
|---|---|---|
| DOM-P34R-01 (High) — plan site by PATCH | **FIXED (verified)** | `UpdateCutoverPlanBody` has no `siteId` (400). The new command `POST …/cutover-plans/:planId/site` takes a reason and the readiness lock, works only before the go/no-go, and refuses while a FAILED gating check would stop gating the plan. Re-check CONTROL: 422 `readiness.cutover.site_change_failed_check`, plan unchanged. A `site_changed` history entry names the checks leaving and entering; `readiness.changed` is emitted (`cutover.service.ts:345-388`, `readiness.ts:288-315`). The probe passes plain. Equivalent paths tried: (1) the site command on the failed check: refused. (2) The PM first records a passing test (`failed → in_progress`), then moves the plan: allowed with a reason and a history entry naming the check, and the GO is accepted (**OBSERVED DOM-P34R2-O1**, consistent with the documented rule for open checks of a plan in planning, §9.4). (3) A plan made project-wide (`siteId: null`) is gated by more checks, not fewer (`readinessCheckAppliesToPlan`). |
| DOM-P34R-02 (Medium) — N/A of a failed blocker | **FIXED (verified)** | `readiness.signoff.na_release_not_allowed` for a FAILED gating check (status or latest test) and for an open check of a plan under decision / with a GO (audit row above). Variant: the PM records a passing test, then the specialist determines N/A while the plan is in planning; the GO is accepted (**OBSERVED DOM-P34R2-O2**: two people, basis recorded, before the plan is under decision; §9.4). |
| DOM-P34R-03 (Medium) — GO does not move the dimension | **FIXED (verified)** | `CutoverService.apply` (every cutover state command) and the site command enqueue the recompute (`readiness.changed`, deduplicated per plan version). Probes 03a / 03b pass plain. `gates/p34r-cutover-dimension` passes: "GO → day1_go_approved; execution keeps it; acceptance → operating_with_transitional_services (worker drained, no explicit recompute)". |
| DOM-P34R-04 (High) — terms binding released by a detour | **PARTIALLY FIXED** | The terms now belong to the decision (`tsa_extension_terms`, unique per decision). The D2 detour is refused (`terms_bound`, audit above), and `record-extension` applies only the bound terms (`terms_mismatch`). The probe passes plain. **But** a decision that is already final when terms are first bound gets whatever terms the TSA manager requests (`extensionTermsBinding` returns `new` for any status, `readiness.ts:475-476`) → **DOM-P34R2-01 (High)**. |
| DOM-P34R-05 (Medium) — N/A carried into scope | **FIXED (verified)** | `scopeEntryTransferReset` runs on `classify` and on an applied change request (`perimeter.service.ts:737-780, 832, 861`). The probe passes plain. Re-check variant: N/A marked while an item added after the baseline is held `pending`, then its creation change request applied — the aspect is reset (`VARIANT DOM-P34R-05` passes). |
| DOM-P34R-06 (Medium) — transfer evidence rejected | **FIXED (verified)** | The dimension fails closed at once (`status-dimensions.service.ts:112-125`), and the `svc-carveout` reaction returns verified aspects to `in_progress` (system entry, audited — audit row above). Re-check variant with CONTESTED evidence (a second link flagged as conflicting, AT-14): the dimension is not `transferred_verified` before the worker runs, and both aspects are `in_progress` after it (`VARIANT DOM-P34R-06` passes). TSA replacement-acceptance residual: the implementer's `p34r-fixes-tsa` test passes, and accepted exits with invalid evidence are not counted as exited (`status-dimensions.service.ts:148-159`); not independently probed. |
| DOM-P34R-07 (Low) — documentation | **FIXED** | business-gates.md §5 rule 1 (lines 392-400) now says LEAVE is refused, ENTER into an `approved_go` plan flags the GO, and covers the plan side of the relation. §8.1 (line 559) describes the two-person "not required". The code flags the GO on a rebind into `approved_go` (`p34r-fixes-readiness` test passes). |
| DOM-P34R-08 (Low) — non-blocking CP by the PM | **FIXED** | `createCp` refuses `blocking: false` without `jv.cp.set_waivability` (403 `jv.cp.non_blocking_requires_specialist`, `transactions.service.ts:764-768`). The CP PATCH body has no `blocking` field. The `p4-domain-fixes` test passes. Q-P34R-08 (Legal) is recorded as a question. |
| DOM-P34R-09 (Low) — reconciliation editors | **FIXED** | A reviewer is excluded if they created or edited the reconciliation (record history `created` / `updated`, `reconciliations.service.ts:239-243`, `finance.ts:494-511`). The `p34r-fixes-finance` test passes. |
| DOM-P34R-I1 (Info) | Unchanged | Governance owner (several signings per G5 cycle). |

### 9.3 New finding of the re-check

#### DOM-P34R2-01 — High — Extension terms first bound after the decision is final: any end date, on any approved TSA

- **Where:**
  - `packages/domain/src/readiness.ts:475-476` (`extensionTermsBinding`): with no bound terms it returns `new`, whatever the decision's status.
  - `apps/api/src/modules/readiness/tsa.service.ts`: `requestExtension` writes the first `tsa_extension_terms` row; `recordExtension` applies it.
  - business-gates.md §6 rule 5 ("written when the extension is first requested on it") and rule 6 ("the same decision may still approve the terms of A and one extension of A").
- **Finding:** the binding protects the terms only if they were attached while the paper was before the committee. A decision
  that became final with no terms attached gets its first terms afterwards, freely. Rule 6 lets the decision that approved a
  TSA's own TERMS back one extension of that TSA, and that decision is always final before an extension can be requested. So
  the TSA manager alone can extend any approved TSA once, to any future date, with no decision about an extension. An extension
  paper approved before it was linked behaves the same way.
- **Reproduction (executed):**
  - `DEFECT DOM-P34R2-01a` (`p34-domain-re2-tsa.spec.ts`): the terms decision is approved (`outcome_recorded_at` 06:01:57.345). A request-extension on it to +3650 days → 201 (terms bound at 06:01:57.445, after the outcome). Record → 201 `extended`, end **2036-09-28**.
  - `DEFECT DOM-P34R2-01b`: a `tsa_approval_or_extension` paper is voted and approved first, then linked → extended to **2034-12-18**.
- **Spec / rule:**
  - §7.3 "a replacement-service failure must trigger … an extension decision; never automatically extend the contract".
  - AT-10 "extension/continuity options await approval".
  - REQ-TSA-005 "extension requires an approved decision recorded against the TSA".
  - business-gates.md §6 rule 5, whose heading reads "an extension decision is bound to the terms it approved"; here the decision approved no terms.
  - Same effect as DOM-P3-06 / DOM-P34R-04 (High), and reachable by one person.
- **Recommendation:**
  - Bind extension terms only while the paper is still before the committee. Refuse the FIRST binding to a decision that already has an outcome (`approved`, `pending_external_authority`, …), with a dedicated code. A final decision then backs an extension only with the terms it carried when it was decided.
  - Consequence for rule 6: a terms decision can never carry extension terms before it is final, so an extension would always need its own paper. That is the conservative reading.
  - The governance owner may instead want a terms decision to approve an extension OPTION. In that case its maximum end date must be recorded with the terms approval and enforced at `record-extension` (extend Q-P3-13).
  - Showing the requested end date on the paper (open since §8) remains useful.

### 9.4 Observations (not counted as defects)

- **DOM-P34R2-O1 (Info).** The "failed" rules key on the check's current status.
  - The check manager can record a passing test (`record_pass` from `failed` → `in_progress`, no evidence, no sign-off) and then move the plan's site away from the check before the go/no-go.
  - This is consistent with the documented rule that an OPEN check may leave a plan in planning / rehearsal with a reason.
  - The move stays visible: the decision history names the check (`site_changed` "… no longer gating: RC-…"), the test runs (failed, then passed) stay in the append-only history, and the GO decider sees both.
  - For the Operations owner (Q-P3-02): should a re-test claim without evidence be enough to take a previously failed blocker out of a transition's scope?
- **DOM-P34R2-O2 (Info).** The same pattern applies to "not applicable". After a passing test, the sign-off specialist (a second
  person, with a basis) may determine the open blocker not applicable while its plan is in planning (A-P3-02 / business-gates.md
  §5 rule 3 allow it). The GO is then accepted.

### 9.5 New behaviour and the security re-check changes

| Behaviour | Assessment |
|---|---|
| Cutover plan site-change command | Sound: reason, readiness lock, only before the go/no-go, refused for a FAILED gating check, a history entry naming the checks leaving / entering, and a dimension recompute. The refusal names only checks within the caller's readiness reach (SEC-P34R-08), while the rule weighs every check. See O1. |
| `tsa_extension_terms` | Closes the re-request and detour paths: unique per decision, `FOR SHARE` on the decision row, registry checked first, `terms_mismatch` at record. Gap: first binding after the outcome (DOM-P34R2-01). |
| `svc-carveout` evidence reaction | Explicit allowlist (`carveout.register.read`, `carveout.transfer.manage`; access-matrix §9 line 704). It only applies `reject_evidence` to verified aspects, as a system entry that is audited, keeps record history and emits `perimeter.changed`. The dimension does not wait for it (fails closed at once). Verified with rejected (probe) and contested (variant) evidence. |
| Non-blocking CPs Legal-only | Sound: 403 for the CP manager, and Legal still cannot release an existing blocking CP (DOM-P4-03 test). Q-P34R-08 stated as a question. |
| Scope reset of N/A aspects | Sound on all three entry paths checked: classify before the baseline, an applied reclassification change request, and an applied creation change request of an item held pending. The reset is recorded (`scope_reset`) and never presented as a determination. |
| SEC-P34R-03/-04/-09 single evidence "self" (`evidenceSelfIds`) | Stricter than before for the domain rules: linkers of active / conflicting evidence **plus** uploaders of the linked versions. No verification became easier. DOM-P3-10 / -10b regressions pass (`p3-domain-readiness-go`, subset). |
| SEC-P34R-07 supersede / flag-conflict authorization | Adds only the target's write authorization. The `evidence.changed` emission is unchanged, so the readiness, NewCo, transfer and TSA reactions still fire (the DOM-P3-09 regression and the contested-evidence variant pass). |
| SEC-P34R-01/-02/-08 404 before 403 on the new routes | Route-level; no domain rule changed. All domain probes and regressions pass. |

### 9.6 Exit criteria, re-assessed at `2ed5d55`

| Criterion | Result | Evidence |
|---|---|---|
| P3 — incorporation recorded while transfer / operations remain incomplete; states separate; never complete | **Met** | AT-06 specs pass (subset); the accuracy residuals of §2.1 are fixed (DOM-P34R-03, -06 and the contested variant). |
| P3 — blockers prevent go-live (AT-09) | **Met** | DOM-P34R-01 / -02 fixed and verified; the five original paths stay closed (`p3-domain-readiness-go` 6/6); `at-09` 13/13. The remaining variants O1 / O2 are visible in the decision history and follow documented rules (owner question). |
| P3 — perimeter-change impact (AT-07) | **Met** | `at-07` 9/9; scope reset on applied change requests. |
| P3 — AT-10 extension awaits an approved decision | **Not met** | DOM-P34R2-01 (High). |
| P4 — missing CP blocks closing; financial reconciliation | **Met** | `at-12` 5/5, `at-13` 5/5, `p4-domain-jv` 12/12, `p4-domain-fixes` 15/15, `finance-figures` 15/15, `p34r-fixes-finance` 1/1. |

### 9.7 Not executed

- Playwright (not requested). The web parts of the fixes (site dialog, CP form hint, history labels) were not reviewed.
- The TSA replacement-acceptance reaction and the "accepted exit with invalid evidence" dimension rule were not independently
  probed (the implementer's tests and `rules.test.ts` pass).
- DOM-P34R2-01 with `pending_external_authority` decisions (same code path, not executed).

### 9.8 Verdict of the re-check

- **P3: FAIL** — open High DOM-P34R2-01. To pass:
  1. Refuse the first binding of extension terms to a decision that already has an outcome (or the owner-approved alternative of §9.3).
  2. Turn `DEFECT DOM-P34R2-01a` / `-01b` into regression tests with their assertions unchanged, and re-run them.
  3. Record the owner's answer on rule 6 (Q-P3-13).

  O1 / O2 go to the gate report as Info for the Operations owner.
- **P4: PASS WITH CONDITIONS** — conditions as stated in the table at the top of §9.

### 9.9 Fix status of the re-check (implementer, separate context)

Written by the implementer (`backend-data-engineer`, implementation mode) in its own context, on the branch merged with
`c4bf83b`. The reviewer's text above (§9 to §9.8) is unchanged. Commits:

- `0f3395f`: the rule, the API fixtures, the renamed tests and the probes.
- `5af7f08`: the e2e AT-10 flow.
- `3ff29e5`: the requirement evidence and the module guide.
- `1a6cea9`: the escalated path and every decision status.
- `e3fbeaa`: the dialog hint (en + ar).
- This note.

| Finding | Status | Rule → file | Tests |
|---|---|---|---|
| **DOM-P34R2-01** (High) | **Fixed**, conservative reading. The governance owner should confirm (Q-P34R2-01, Q-P3-13). | Extension terms are bound to a decision for the first time only while its paper is before the committee: `draft`, `submitted` or `under_review` (`EXTENSION_TERMS_BINDABLE_STATUSES`). Every other status refuses a first request, with 422 `tsa.extension.terms_after_outcome`; the refusal is audited and nothing is bound. These are the statuses with an outcome (`recommended`, including pending an external authority; `approved`; `implementation_pending`; `implemented_verified`; `rejected`; `superseded`), plus `deferred`, which goes back to `under_review` when resumed. Terms bound before the outcome stay usable after it (same terms). DOM-P34R-04 is unchanged: `terms_bound`, `decision_other_tsa` and `terms_mismatch`; the decision row is read `FOR SHARE`; the registry check runs first. Files: `packages/domain/src/readiness.ts` (`extensionTermsBinding`), called from `apps/api/src/modules/readiness/tsa.service.ts` (`requestExtension`, not changed). Refusal text en + ar (`readiness.refusal.codes.extension_terms_after_outcome`, `apps/web/src/lib/refusals.ts`). Request-extension dialog hint (`tsaDetail.requestExtension.effect`): link a paper the committee has not decided yet. Docs: `docs/governance/business-gates.md` §6 rules 5–6, Q-P34R2-01 in `docs/assumptions-and-open-questions.md`, and `docs/architecture/module-guide.md` (reliance row and the "decision carries its terms" pattern). | `p34-domain-re2-tsa.spec.ts`: "DOM-P34R2-01a: … (fixed, regression)" and "DOM-P34R2-01b: … (fixed, regression)". New `readiness/p34r2-fixes-tsa.spec.ts`, 2 tests (see below). `readiness.test.ts`: "DOM-P34R2-01: terms are bound for the FIRST time only while the paper is before the committee (draft / submitted / under review)", run over every decision status. Renamed `p2f-decision-reliance` and `p3-fixes-tsa` DOM-P3-13 tests (see below). |

**The lead's patch was kept as it is.** Two statuses were reviewed:

- `deferred` has no committee outcome yet. Refusing it costs nothing: the paper is resumed to `under_review` before the committee decides it, and the request can be made then.
- `recommended` is refused because the committee has decided. The external authority approves what the committee recommended, so terms bound afterwards were never before the committee.

**Consequence for rule 6.** The decision that approved a TSA's own terms is final before any extension can be requested on it, so it no longer backs an extension of that TSA. Every extension needs its own paper. The alternative in §9.3 is not implemented: a terms decision that approves an extension option with a maximum end date. It stays with the governance owner (Q-P3-13, Q-P34R2-01).

**Test refactor: fixtures only.** The assertions about each rule under test are unchanged. The real flow is: table the extension paper, request the extension on it, have the committee approve it, then record the extension.

- `apps/api/test/readiness/readiness-kit.ts`: new `approveTabledDecision`. It completes the vote and outcome on a paper tabled with `decisionOfType(…, { vote: false })`.
- `readiness/at-10-tsa-expiry.spec.ts`: the REQ-TSA-005 test.
- `readiness/p3-fixes-tsa.spec.ts`: the remedied breach, DOM-P3-06 and DOM-P3-07.
- `readiness/p2f-decision-reliance.spec.ts`: the extension of X.
- `e2e/tests/p3-readiness.spec.ts`: `governanceDecision` is split into a create step and `approveDecision`. In AT-10, the drafted paper is linked in the UI as before, approved through the governance API, and the extension is then recorded in the UI.
- Checked, with no change needed:
  - `readiness/readiness-isolation.spec.ts`: a decision of another project gives 404 before the rule.
  - `readiness/p34r-fixes-tsa.spec.ts`: it uses draft papers; its approved decisions only approve TSA terms.
  - `reviews/p3-domain-tsa.spec.ts`: its requests are refused earlier by the reliance or date rules; the codes are unchanged.
  - `reviews/p34-domain-re-tsa.spec.ts`: D1 is requested while under review.
  - `reviews/p34-sec-re-fixes.spec.ts`: an unknown decision gives 404.

**Renamed tests, because they asserted the former rule 6** ("the terms decision may authorize one extension"):

- `readiness/p2f-decision-reliance.spec.ts`:
  - Old title: "one decision authorizes one extension (kind tsa_extension): not a second TSA, not a further extension; the terms decision may authorize one extension".
  - New title: "…; the terms decision, final before any extension was requested on it, authorizes none (DOM-P34R2-01)".
  - Its last part now asserts 422 `tsa.extension.terms_after_outcome` for TSA Y on its own terms decision. The registry then holds only the `tsa_service` use.
- `readiness/p3-fixes-tsa.spec.ts`:
  - Old title: "DOM-P3-13 (conservative, governance owner to confirm): the decision that approved the terms of TSA A does not back an extension of TSA B — nor the reverse".
  - New title: "DOM-P3-13 / DOM-P34R2-01 (conservative, governance owner to confirm): the decision that approved the terms of TSA A backs no extension — of TSA B, nor afterwards of A — and a decision used for an extension of A approves no other TSA's terms".
  - A's own request on its terms decision is now 422 `terms_after_outcome`. A is extended on its own paper.
  - The reverse part is unchanged: that paper does not approve C's terms (`tsa.approve.decision_other_tsa` or `tsa.approve.decision_already_used`, as before).
- Both citations are updated in `docs/requirements/status-evidence.yaml` (REQ-TSA-005), and the DOM-P34R2-01 evidence is added there. No requirement status changed: REQ-TSA-005 stays Tested.

**Probes.** The two `DEFECT DOM-P34R2-01a` / `-01b` probes in `p34-domain-re2-tsa.spec.ts` are renamed "… (fixed, regression)" and are now plain `it`. Their assertions are unchanged. The `defect` alias stays (with `void defect;`), so `P34DRE_PROBE_PLAIN=1` keeps working. Their request is now refused (422 `terms_after_outcome`), so the TSA keeps its end date.

**New tests for the path §9.7 did not execute (pending external authority)** — `readiness/p34r2-fixes-tsa.spec.ts`. In both tests, the `tsa_approval_or_extension` paper is above the DEMO limit (2,500,000 SAR).

1. The extension is requested on the paper while it is under review. The committee then records `recommended` / `pending_external_authority`, and record-extension is refused (422 `tsa.extension_requires_decision`). After the external approval, the TSA is extended to the bound date.
2. The same kind of paper is first linked once the committee has recommended it, and again once it is approved externally. Both requests are refused (422 `terms_after_outcome`), both refusals are audited, nothing is bound, and the TSA is unchanged.

**Verification** at `e3fbeaa`, on own databases `hub_test_p3fix*`:

| Check | Result |
|---|---|
| `pnpm lint`, `pnpm typecheck`, e2e `tsc` | Pass |
| i18n check | Pass |
| `apply_status.py --check` | OK |
| Domain unit tests | 23 files, 473/473 |
| Touched specs while iterating (the nine readiness / reviews files) | 53/53 |
| New `p34r2-fixes-tsa` | 2/2. The audit shows the refusals with `(recommended)` and `(approved)`. |
| Full API suite | **137 files, 1058 passed + 2 expected fail** |
| `P34DRE_PROBE_PLAIN=1` on the seven `p34-domain-re*-*` files | 20/20 |
| Playwright `p3-readiness` on the implementer's own stack (production web build) | 3/3, including AT-10 with the new flow |
| Secret scan (tree) | PASS |

In the full suite, the two expected fails are the open P2 Lows DOM-P2F-02 and DOM-P2F-04. Every DOM-P34R2 probe passes as a plain test.

**Not changed:**

- The decision paper does not yet show the requested extension end date (governance paper form; §8 and the last bullet of §9.3). The rule does not need it, because the terms are bound to the decision before its outcome.
- O1 and O2 stay Info for the Operations owner.
- Item 3 of §9.8 is not done: the owner's answer on rule 6. It belongs to the governance owner. The questions are recorded (Q-P3-13, Q-P34R2-01) and the conservative reading is implemented until the owner answers.

### 9.10 Re-check of DOM-P34R2-01 (lead request)

| Item | Value |
|---|---|
| Revision | `c990f5c` on `claude/mobily-transformation-hub` (fetch + merge → fast-forward from this review's `e911811`, which is an ancestor). Frozen. |
| Added | This subsection and one probe file, `apps/api/test/reviews/p34-domain-re3-tsa.spec.ts`. §1–§9.9 above are unchanged. |
| **DOM-P34R2-01** | **FIXED (verified)** — conservative reading; the governance owner should confirm it (Q-P3-13, Q-P34R2-01, recorded as questions). |
| New | **DOM-P34R3-01 (Medium):** the binding window closes at the outcome, not at the vote. |
| **Final P3 verdict** | **PASS WITH CONDITIONS** — no open Critical or High. Medium DOM-P34R3-01 must be fixed, or accepted by the governance owner with a recorded decision, before the P3 gate report. Info O1 / O2 and the owner questions go to the gate report. |

**Probes, plain mode** (`P34DRE_PROBE_PLAIN=1`):

```
$ P34DRE_PROBE_PLAIN=1 TEST_DATABASE_URL=…/hub_test_p34dre_probe … npx vitest run test/reviews/p34-domain-re2-tsa.spec.ts test/reviews/p34-domain-re3-tsa.spec.ts --reporter=verbose
 ✓ DOM-P34R2-01a: the decision that approved the TSA's TERMS … (fixed, regression)
 ✓ DOM-P34R2-01b: an extension paper approved BEFORE it was linked to the TSA … (fixed, regression)
 ✓ CONTROL: a deferred paper binds no terms (422 tsa.extension.terms_after_outcome); resumed, it opens a new vote round and the request binds before that vote
 × DEFECT DOM-P34R3-01: votes {"t":"2026-10-01 08:15:36.095667+00","n":4}; request 201; outcome 201 approved; record 201 {"status":"extended"};
     TSA extended end 2035-07-06; bound terms [{"end_date":"2035-07-06","bound_at":"2026-10-01 08:15:36.137441+00"}]: expected '2035-07-06' not to be '2035-07-06'
 Test Files  1 failed | 1 passed (2)
      Tests  1 failed | 3 passed (4)
$ psql …/hub_test_p34dre_probe -Atc "… audit_event … where p.code in ('P34R2-TSA','P34R3-TSA') and a.outcome <> 'success'"
P34R3-TSA|readiness.requestExtension|rejected|tsa.extension.terms_after_outcome: This decision already has an outcome (deferred) …
P34R2-TSA|readiness.requestExtension|rejected|tsa.extension.terms_after_outcome: This decision already has an outcome (approved) …   (01a)
P34R2-TSA|readiness.requestExtension|rejected|tsa.extension.terms_after_outcome: This decision already has an outcome (approved) …   (01b)
```

Both DOM-P34R2-01 probes now pass for the intended reason: the first binding on an approved decision is refused, and the TSA
keeps its end date.

**Weakening check** (`diff e911811..c990f5c`):

- `p34-domain-re2-tsa.spec.ts`: rename to "(fixed, regression)" and `void defect;` only; the assertions are unchanged.
- The fixture refactor (table → request → approve → record, `approveTabledDecision` in `readiness-kit.ts`) in `at-10-tsa-expiry`,
  `p3-fixes-tsa` (remedied breach, DOM-P3-06, DOM-P3-07) and `p2f-decision-reliance` changes only *when* the paper is approved.
  Every assertion of those tests (201 / 422 codes, end dates, registry rows) is unchanged.
- The two renamed tests asserted the former rule 6 ("the terms decision may authorize one extension"), which is exactly what
  DOM-P34R2-01 required to be refused:
  - **`p2f-decision-reliance`:** "not a second TSA" and "not a further extension" and the registry rows of X are unchanged. Only
    the last part flips, from 201 to 422 `terms_after_outcome`, and the registry for Y's terms decision holds `tsa_service`
    only.
  - **`p3-fixes-tsa` DOM-P3-13:** part 1 (A's terms decision refused for B, `decision_other_tsa`) is unchanged. A's own request on
    its terms decision is now 422 `terms_after_outcome`. A is then extended on its own paper.
  - The "reverse" check of `p3-fixes-tsa` now uses that extension paper. It asserts that a decision used for an extension of A
    does not approve C's terms; before, the terms+extension decision of A was used. Both cross-TSA directions are still
    asserted.
- **Not a weakening of anything this review required.** The flipped assertions encode the refusal recommended in §9.3.

**Touched specs, default mode:**

```
$ TEST_DATABASE_URL=…/hub_test_p34dre_probe … npx vitest run <12 files> --reporter=verbose
 Test Files  12 passed (12)
      Tests  57 passed | 1 expected fail (58)          # the expected fail: DEFECT DOM-P34R3-01
```

| Spec | Tests |
|---|---|
| `readiness/p34r2-fixes-tsa` | 2 |
| `readiness/at-10-tsa-expiry` | 11 |
| `readiness/p3-fixes-tsa` | 9 |
| `readiness/p2f-decision-reliance` | 5 |
| `readiness/p34r-fixes-tsa` | 3 |
| `readiness/readiness-isolation` | 7 |
| `reviews/p3-domain-tsa` | 3 |
| `reviews/p34-domain-re-tsa` | 2 |
| `reviews/p34-domain-re2-tsa` | 2 |
| `reviews/p34-domain-re3-tsa` | 2 |
| `reviews/p34-sec-re-fixes` | 11 |
| `reviews/p2-domain-final-readiness` | 1 |

Also run:

```
$ (packages/domain) npx vitest run       Test Files 23 passed (23)   Tests 473 passed (473)
$ (apps/api) pnpm run lint               module boundary check passed: 43 cross-module imports, 19 module edges … (exit 0)
```

**Full API suite** (once, at the end):

```
$ free -g                                                    → 6 GB free (12 GB available) at the start; one other agent was running tests
$ (apps/api) TEST_DATABASE_URL=…/hub_test_p34dre TEST_DATABASE_MIGRATION_URL=…/hub_test_p34dre pnpm test --reporter=verbose
 Test Files  138 passed (138)
      Tests  1059 passed | 3 expected fail (1062)
   Duration  1512.49s
exit 0
```

The 3 expected failures are DEFECT DOM-P34R3-01 and the two open P2 Lows DOM-P2F-02 / DOM-P2F-04. Every DOM-P3 / DOM-P4 /
DOM-P34R / DOM-P34R2 probe passes as a plain test.

**Equivalent paths tried:**

| Path | Result |
|---|---|
| Decision deferred, then resumed | **Closed by design** (CONTROL). A deferred paper binds nothing (`terms_after_outcome (deferred)`). `resume` returns it to `under_review` with `vote_round + 1`, so terms bound then precede the new round's votes. |
| Decision superseded / rejected / recommended / implementation statuses | Refused (`terms_after_outcome`). Covered by the implementer's `readiness.test.ts` over every decision status and by `p34r2-fixes-tsa` (recommended / pending external authority, then externally approved). |
| Decision first linked to another TSA's extension | Already closed by DOM-P34R-04: `decision_other_tsa` once the paper has left draft. While it is a draft it may be re-pointed (`rebind`), which is before the committee. |
| **Votes cast, outcome not yet recorded** | **Open → DOM-P34R3-01.** |

#### DOM-P34R3-01 — Medium — Extension terms can be bound after the committee has voted, before the outcome is recorded

- **Where:** `packages/domain/src/readiness.ts:460` (`EXTENSION_TERMS_BINDABLE_STATUSES = ['draft', 'submitted', 'under_review']`)
  and `:479-491`. A decision stays `under_review` until the secretariat records the outcome, even after every vote of the
  round has been cast. In circulation the votes come in over days, so the window can be long.
- **Finding:** the window closes at the outcome, not at the first vote. A paper voted with no terms bound gets its end date
  between the last vote and the outcome. A partially voted paper gets it before the remaining voters, while the earlier voters
  never had it. The paper itself does not display the bound terms (open since §8), so the voters cannot see them in any case.
  business-gates.md §6 rule 5 says the binding window ensures "the committee always decides on a paper that carries the end
  date and continuity plan it approves"; this holds only for terms bound before the first vote.
- **Reproduction (executed):** `DEFECT DOM-P34R3-01` (`p34-domain-re3-tsa.spec.ts`):
  1. The extension paper is tabled with no terms; all 4 votes are cast (approve, last at 08:15:36.095).
  2. The PM requests the extension "to +3200 days" → 201, terms bound at 08:15:36.137.
  3. The secretariat records the outcome `approved`; record-extension → 201 `extended`, end **2035-07-06**.
- **Severity:** Medium rather than High.
  - It is the same effect as DOM-P34R2-01 (an end date the voters never had), and it is reachable by the TSA manager alone.
  - But it needs an extension paper the committee actually voted on, and it only works inside the voting window of that
    paper.
  - It no longer works on any approved decision at any time, as DOM-P34R2-01a did.
- **Spec / rule:** §7.3; AT-10; REQ-TSA-005; business-gates.md §6 rule 5.
- **Recommendation (governance owner to confirm):**
  - Close the first-binding window at the first vote of the current round: refuse while any vote of `vote_round` exists.
  - Alternatively, make a first binding during voting open a new vote round, as `resume` does.
  - Show the bound end date and continuity plan on the decision paper, so the voters see what they approve.

**P3 exit criteria at `c990f5c`:**

| Criterion | Result | Evidence |
|---|---|---|
| Incorporation recorded while transfer / operations remain incomplete; states separate; never shown complete | **Met** | §9.6, unchanged code paths; AT-06 specs in the full suite. |
| Blockers prevent go-live (AT-09) | **Met** | §9.6 (O1 / O2 Info). |
| Perimeter-change impact (AT-07) | **Met** | §9.6. |
| AT-10: expiry escalates, never an exit; extension awaits an approved decision | **Met, with Medium residual DOM-P34R3-01** | `at-10-tsa-expiry` 11/11. Every extension now needs its own paper, linked before the paper's outcome (DOM-P34R2-01a/-01b regressions, `p34r2-fixes-tsa`, renamed rule-6 tests). Residual: the end date may be bound after the votes and before the outcome. |

**Final verdicts:**

- **P3: PASS WITH CONDITIONS.** Conditions for the P3 gate report:
  1. DOM-P34R3-01 (Medium): fixed with its probe turned into a regression test, or accepted by the governance owner with a
     recorded decision.
  2. Owner questions: Q-P3-13 / Q-P34R2-01 (governance), Q-P3-02 with O1 / O2 (Operations), Q-P3-05 (Legal / Finance),
     Q-P3-12 (domain owner), Q-P3-17.
  3. Decision papers do not yet display the extension terms.
  4. REQ-PHS-005 closes with the gate report.
- **P4:** unchanged, **PASS WITH CONDITIONS** (§9 table). No P4 code path was touched by this fix.
