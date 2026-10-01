# P3 independent domain review: Carve-out & NewCo

| Item | Value |
|---|---|
| Reviewer | carveout-domain-analyst (REVIEW mode, separate context). The reviewer did not write any of the code under review. |
| Revision reviewed | `5bf274b917493f0c02e5de032c8f64f7b6cafc57` (`5bf274b`) on `claude/mobily-transformation-hub`, identical to `origin/claude/mobily-transformation-hub` when fetched on 2026-09-30 (`git merge` → "Already up to date"). The worktree was frozen on it. |
| Review branch | `worktree-agent-ac07592f47557d05e`. The review added only this report and five probe files: `apps/api/test/reviews/p3-domain-readiness-go.spec.ts`, `p3-domain-readiness-race.spec.ts`, `p3-domain-perimeter.spec.ts`, `p3-domain-tsa.spec.ts` and `p3-domain-dimensions.spec.ts`. No application code, existing test, test kit, seed, template, migration or governance document was changed. |
| Date | 2026-09-30 |
| Scope | Master prompt §3 (G1–G4, four status dimensions), §7.1–7.4, §19 P3 row, §20 AT-06 to AT-10, §21 demo data. Code: `apps/api/src/modules/{carveout,newco,readiness}`, `packages/domain/src/{carveout,perimeter,newco,readiness,decision-reliance}.ts`, the gates module's `status-dimensions.service.ts` (owner of the dimensions), the `dc-carveout` template, and the P3 web screens only for rule correctness. Platform rules: `docs/governance/business-gates.md`, `authority-matrix.md`, `decision-workflow.md`, `docs/architecture/module-guide.md` ("Relying on a governance decision", "One writer of a project's gate state at a time"), `docs/security/access-matrix.md` §2.4, `docs/reviews/P2-domain-final-review.md`. |
| **Verdict** | **FAIL** — 4 High, 8 Medium, 5 Low, 2 Info (§3). The P3 exit criterion "blockers prevent go-live" does not hold on the server (DOM-P3-01, -09 High; -02, -03, -04 Medium), "extensions await an approved decision" does not hold (DOM-P3-06 High), and the perimeter-transfer dimension can report a verified transfer for items that never transferred (DOM-P3-05 High). The P2 closure re-check (condition C2) is **CONFIRMED for all five probe files** (§5). |

This review makes no legal, tax, zakat, accounting or regulatory determination and does not set Mobily policy. Where a
recommendation depends on a governance or specialist choice, it says so ("for the owning function to confirm").

---

## 1. Commands and real results

All commands ran from `transformation-hub/` in the review worktree at `5bf274b`. Only the reviewer's own databases were used:
`hub_test_p3dom` (full suite), `hub_test_p3dom_boot` (empty-database test) and `hub_test_p3dom_probe` (probe iterations).
Docker was not started. No database or process of another agent was touched. Logs are in the reviewer's scratch directory.

### 1.1 Set-up

```
$ git fetch origin claude/mobily-transformation-hub && git merge origin/claude/mobily-transformation-hub
Already up to date.
$ git rev-parse HEAD
5bf274b917493f0c02e5de032c8f64f7b6cafc57
$ pg_isready -h 127.0.0.1 -p 5432                         → accepting connections
$ HUB_DATABASES="hub_test_p3dom hub_test_p3dom_boot" bash scripts/dev/pg-init-roles.sh
roles hub_owner/hub_app and databases ready: hub_test_p3dom hub_test_p3dom_boot
$ HUB_DATABASES="hub_test_p3dom_probe" bash scripts/dev/pg-init-roles.sh
roles hub_owner/hub_app and databases ready: hub_test_p3dom_probe
$ pnpm install --frozen-lockfile --offline                → Done
$ pnpm build:packages                                     → exit 0
```

### 1.2 Unit tests and lint

```
$ (packages/domain) npx vitest run
 Test Files  21 passed (21)
      Tests  424 passed (424)
$ (apps/api) pnpm run lint        # tsc --noEmit (including this review's probe files) + module boundaries
module boundary check passed: 43 cross-module imports, 19 module edges, acyclic, only published surfaces
$ GITLEAKS=<gitleaks 8.30.1 binary> bash scripts/ops/secret-scan.sh tree        # after committing this review
tree: 1078 committed files at HEAD c00748c
SECRET SCAN (tree): PASS
```

### 1.3 This review's probes

Five files, one DC project each (`P3D-GO`, `P3D-RACE`, `P3D-PER`, `P3D-TSA`; the dimensions file is pure). Convention of the
common review rules: `DEFECT …` asserts the REQUIRED behaviour with `it.fails` (the suite stays green while the defect is open;
the probe turns red once fixed); `OBSERVED …` pins current behaviour; `CONTROL …` shows the rule working where it does.
`P3D_PROBE_PLAIN=1` runs the DEFECT probes as plain tests to show their failure message.

Plain mode (probe database). Every DEFECT probe failed **at its final assertion**; every setup step before it passed through the
real API. Output trimmed to the assertion messages:

```
$ P3D_PROBE_PLAIN=1 TEST_DATABASE_URL=…/hub_test_p3dom_probe TEST_DATABASE_MIGRATION_URL=…/hub_test_p3dom_probe \
  npx vitest run test/reviews/p3-domain-*.spec.ts --reporter=verbose        (runs 1–5, final state of each file)
DOM-P3-01  PATCH 200 {"version":3}; check now {"status":"failed","cutover_plan_id":"01a0f431-18bc…"} (another plan);
           GO 201 {"status":"approved_go","goNoGo":"go"}: expected 201 not to be 201
DOM-P3-02  determination 201 {"version":3}; GO 201 {"status":"approved_go"}: expected 201 not to be 201
DOM-P3-03  failed test committed while the GO waited: true (201 {"status":"failed","seq":2}); GO 201 {"status":"approved_go"};
           check now failed; plan approved_go, recorded evaluation {"blockers":[],"missing":[]}: expected true to be false
DOM-P3-04  plan before execution: status approved_go, goEvaluation {"allowed":false,"blockers":[{… "status":"failed","blocker":true}]};
           execution 201 {"status":"executed"}; history ["rehearsal","submitted","go","executed"]: expected 201 not to be 201
DOM-P3-05a legal N/A 201, economic N/A 201; item disposition included, transfer {"legal":"not_applicable","economic":"not_applicable",
           "combined":"not_applicable"}; dimension {"state":"transferred_verified","explanation":"All in-scope items transferred with
           verified evidence.","counts":{"not_applicable":1}}; reconciliation findings []: expected 'transferred_verified' not to be …
DOM-P3-05b legal 201, economic 201 …"status":"not_applicable"…; item included …"combined":"not_applicable"}, pendingChange null;
           change requests []: expected true to be false
DOM-P3-06  request 1 (X=2027-01-19) 201; request 2 (Y=2036-09-28) 201; record 201 {"status":"extended"}; TSA extended end 2036-09-28;
           audit [request_extension {decisionStatus:"under_review", proposedEndDate:"2027-01-19"}, request_extension
           {decisionStatus:"approved", proposedEndDate:"2036-09-28"}, record_extension {endDate:"2036-09-28", previousEndDate:
           "2026-10-21"}]: expected '2036-09-28' not to be '2036-09-28'
DOM-P3-08  entity incorporation {"status":"incorporated","verification":"confirmed",…}, evidence {"active":0,"conflicting":0};
           dimension {"state":"incorporated_verified","explanation":"Incorporation confirmed with verified evidence."}
DOM-P3-09  check after rejection: status passed, evidence {"active":0,"conflicting":0}; GO 201 {"status":"approved_go"}
DOM-P3-10  evidence linked by pm.b 01a0f435-…; sign-off by pm.b 201 {"status":"passed"}: expected 201 to be 403
DOM-P3-10b evidence … linked by Legal; verification by Legal 201 {"status":"incorporated","verification":"confirmed",…}: expected 201 to be 403
DOM-P3-11  dimension {"state":"standalone_accepted","explanation":"Standalone operations accepted (G4). Dependencies: 2 transitional
           service(s) not yet exited, 0 approved enduring arrangement(s)."}; carveOutComplete true:
           expected { surfaced: false, complete: true } to deeply equal { surfaced: true, complete: false }
```

Two probe-authoring corrections were made while iterating (both setup, no assertion changed): DOM-P3-03 first counted lock
waits in `pg_stat_activity.wait_event_type`, which the owner role cannot read for the application role's sessions (0 → setup
failure), and now counts non-granted `pg_locks` of this database's backends; DOM-P3-10 first used the gate kit's
workstream-scoped `tech.lead`, which has no project-level `documents.evidence.link` (403) — a project-level `workstream_lead`
is refused (`membership.scope_not_allowed`), so the probe uses a second project manager who also holds `functional_approver`
(the demo persona `pm.b`); its two grants are revoked in a `finally` block — see §1.5 for why.

Default mode (as the shared suite runs them):

```
$ TEST_DATABASE_URL=…/hub_test_p3dom_probe … npx vitest run test/reviews/p3-domain-dimensions.spec.ts \
  test/reviews/p3-domain-perimeter.spec.ts test/reviews/p3-domain-tsa.spec.ts test/reviews/p3-domain-readiness-go.spec.ts \
  test/reviews/p3-domain-readiness-race.spec.ts --reporter=verbose
 Test Files  5 passed (5)
      Tests  6 passed | 12 expected fail (18)
EXIT 0
```

The 12 expected failures are the 12 DEFECT probes (DOM-P3-01, -02, -03, -04, -05a, -05b, -06, -08, -09, -10, -10b, -11). The 6
plain tests are 3 CONTROL probes (GO refused on a bound failed blocker; nothing transferred → `not_started`; expired TSA blocks
the dimension before G4) and 3 OBSERVED probes (DOM-P3-07, -12, -13).

### 1.4 P2 closure probes (condition C2)

```
$ TEST_DATABASE_URL=…/hub_test_p3dom_probe … npx vitest run test/reviews/p2-domain-rereview.spec.ts \
  test/reviews/p2-domain-rereview-perimeter.spec.ts test/reviews/p2-domain-final.spec.ts \
  test/reviews/p2-domain-final-perimeter.spec.ts test/reviews/p2-domain-final-readiness.spec.ts --reporter=verbose
 Test Files  5 passed (5)
      Tests  24 passed | 2 expected fail (26)
EXIT 0
```

The 2 expected failures are the open Low probes DOM-P2F-02 and DOM-P2F-04 (`p2-domain-final.spec.ts`). The refusal codes behind
the perimeter probes were read from the audit log of that run:

```
$ psql …/hub_test_p3dom_probe -Atc "select action, outcome, reason from audit_event … projects DRR-PV, DFR-PV, outcome <> 'success'"
carveout.approvePerimeterVersion|rejected|perimeter.version.decision_other_subject: Decision DEC-001 authorizes another record …
carveout.approvePerimeterVersion|rejected|perimeter.version.decision_no_subject: Decision DEC-002 was not raised for a specific record …
carveout.approvePerimeterVersion|rejected|perimeter.version.decision_already_used: Decision DEC-001 already backs another perimeter version …
```

### 1.5 Full API suite at `5bf274b` with this review's probes

```
$ (apps/api) TEST_DATABASE_URL=postgres://hub_app:…@127.0.0.1:5432/hub_test_p3dom \
  TEST_DATABASE_MIGRATION_URL=postgres://hub_owner:…@127.0.0.1:5432/hub_test_p3dom pnpm test --reporter=verbose
 Test Files  1 failed | 105 passed (106)
      Tests  1 failed | 860 passed | 14 expected fail (875)
   Duration  1053.35s
 × test/reviews/p2-qa-final-race.spec.ts > QA-P2-01 re-check … > both kinds of use are accepted on one G1 decision …   (known, below)
```

The 14 expected failures are this review's 12 DEFECT probes and the open P2 Lows DOM-P2F-02 / -04. The P3 acceptance specs all
passed in this run: `carveout/at-06-incorporation-separate` (7), `at-07-perimeter-change-control` (9),
`at-08-day1-contract-position` (8), `carveout-rules` (10), `carveout-isolation` (4), `setup-wizard` (4),
`gates/at-06-status-dimensions` (6), `readiness/at-09-readiness-go-no-go` (13), `at-10-tsa-expiry` (11),
`p2f-decision-reliance` (5), `readiness-isolation` (7), `readiness-waiver-n02` (7), `readiness-demo-seed` (3), all
without failure. `p1/p1-closure-empty-db.spec.ts` ran on `hub_test_p3dom_boot` (3/3).
The two isolation specs broken by the first version of the DOM-P3-10 probe (next paragraph) pass (27/27).

An earlier full run with the probes (same command, `hub_test_p3dom`) gave `Test Files 3 failed | 103 passed (106)`,
`Tests 3 failed | 858 passed | 14 expected fail (875)`: the known failure below plus two isolation tests that the DOM-P3-10 probe
itself broke — it had left `pm.b` (the Project-B persona of AT-03) with roles on the probe project
(`p1/isolation-and-auth.spec.ts` "lists only authorized projects": `expected [ 'DEMO-TRANSFORM', 'P3D-GO' ] to deeply equal
[ 'DEMO-TRANSFORM' ]`; `planning/acceptance-and-access.spec.ts` My Work totals). The probe now revokes its grants in `finally`
(verified: both memberships `revoked_at` set after the run) and the suite was run again (result above).

Two other full runs were killed when the container ran out of memory (several agents running suites at once — lead's
messages): one before the probes existed (it had reported only the known failure below) and one rerun after the DOM-P3-10
correction. Neither is counted; the run above is the complete one.

**Known pre-existing failure at `5bf274b` (lead-confirmed, recorded as such):** `reviews/p2-qa-final-race.spec.ts` › "both kinds
of use are accepted on one G1 decision …" fails with `perimeter 422:perimeter.version.decision_no_subject`. That P2 QA probe was
written before the DOM-P2F-08 fix (a G1 paper must be raised FOR the perimeter version it approves); the two branches met at
`5bf274b`. The lead fixed the fixture in the next commit; it is the only failing test of CI run 48 at `5bf274b`. It is not a P3
finding (DOM-P3-I1 below records it for the gate report).

---

## 2. P3 exit criteria and acceptance tests (real runs)

| Criterion (§19 P3 row, §20) | Result | Evidence |
|---|---|---|
| Incorporation recorded while transfer / operations remain incomplete; states kept separate; the carve-out never shown complete (AT-06) | **Partly met** | `carveout/at-06-incorporation-separate.spec.ts` and `gates/at-06-status-dimensions.spec.ts` pass (§1.5): incorporation `incorporated_verified` with transfer `not_started` / `in_progress`, `carveOutComplete: false`. But the perimeter dimension claims "all in-scope items transferred with verified evidence" for an included item that never transferred (DOM-P3-05, High), the incorporation stays "verified" after its only evidence is rejected (DOM-P3-08), and after G4 an expired-unresolved TSA disappears and the carve-out reads complete (DOM-P3-11). |
| Blockers prevent go-live (Day-1 GO / NO-GO, AT-09) | **Not met** | `readiness/at-09-readiness-go-no-go.spec.ts` passes and the CONTROL probe shows the GO refused on a bound failed blocker. Five ways around it reproduced: a descriptive PATCH moves the failed blocker off the plan (DOM-P3-01, High); the check's evidence is rejected as defective yet the check still clears the GO (DOM-P3-09, High); one specialist re-determines a failed non-waivable blocker as non-blocking (DOM-P3-02); a GO commits on an evaluation that missed a concurrent failure (DOM-P3-03); a blocker failing after the GO does not stop the go-live being recorded (DOM-P3-04). |
| Perimeter-change impact: change request + financial / TSA / readiness / transaction impact, previous version preserved (AT-07) | **Partly met** | `carveout/at-07-perimeter-change-control.spec.ts` passes; impacts mark financial / valuation / transaction effects "Assessment pending — specialist" (no determination by the software); versions and `record_version` preserve history. But "transfer not applicable" on both aspects takes an in-baseline included item out of the transfer with no change request (DOM-P3-05b). |
| A customer contract that cannot transfer on Day 1 shows consent / interim arrangement / accountability / remediation (AT-08) | **Met** (Low note) | `carveout/at-08-day1-contract-position.spec.ts` passes; the class needs a specialist (`carveout.contract.classify`), "not required" consents need that specialist, and the Day-1 position lists every missing element. Note: the interim arrangement is free text with no approval of its own; G3-C02 asks for an "approved interim arrangement" — only the human criterion review covers that (DOM-P3-I2). |
| A TSA past its end date without an accepted replacement escalates and never counts as exit (AT-10) | **Met for the TSA register**; dimension defect after G4 | `readiness/at-10-tsa-expiry.spec.ts` passes (expiry scan → `expired_unresolved` + escalation with options; exit only through an independent approval of an evidenced replacement). An expired TSA can be "extended" to a date already passed (DOM-P3-07, Low); after G4 the expired TSA vanishes from the operational dimension (DOM-P3-11). |
| Extensions await an approved decision (AT-10) | **Not met** | The decision is checked at `record-extension`, but the end date it authorizes is not bound to it: after approval the TSA manager re-requests on the same decision with another end date and records it (DOM-P3-06, High). A decision that approved the terms of TSA A extends TSA B (DOM-P3-13, documented rule — owner to confirm). |

---

## 3. Findings

| ID | Severity | One line |
|---|---|---|
| DOM-P3-01 | **High** | A descriptive PATCH re-binds a FAILED Day-1 blocker to another plan (or site); the original plan's GO is then accepted. |
| DOM-P3-05 | **High** | "Transfer not applicable" on both aspects of an INCLUDED item makes the perimeter dimension "transferred_verified — all in-scope items transferred with verified evidence", clears reconciliation, and after baseline bypasses the change request (AT-07). |
| DOM-P3-06 | **High** | The approved TSA-extension decision is not bound to the end date it approved: re-requested after approval with another date (10 years later) on the same decision, and recorded. |
| DOM-P3-09 | **High** | A blocker's sign-off evidence rejected as defective leaves the check "passed" with 0 active evidence, and the GO is accepted. |
| DOM-P3-02 | Medium | The sign-off specialist alone re-determines a FAILED non-waivable blocker as non-blocking and non-mandatory; the GO is accepted (no waiver register, no second person). |
| DOM-P3-03 | Medium | Concurrency: a GO whose evaluation read the blocker as passed commits after a failed test of that blocker committed; the recorded evaluation says "no blockers". |
| DOM-P3-04 | Medium | A blocker that fails after the GO neither flags the GO nor stops the execution (go-live) being recorded. |
| DOM-P3-08 | Medium | Incorporation stays `incorporated_verified` ("confirmed with verified evidence") after its only evidence is rejected as defective. |
| DOM-P3-10 | Medium | Separation of duties: the person who recorded the evidence can sign off a readiness check / verify incorporation on it (access-matrix §2.4 excludes "the person who recorded the status/evidence"); reachable with standard roles for incorporation (Legal). |
| DOM-P3-11 | Medium | After G4 approval an expired-unresolved or breached TSA disappears from the operational dimension and `carveOutComplete` is true. |
| DOM-P3-12 | Medium | Dimension states differ from business-gates.md §1 / the template: `day1_ready` without any GO, never `day1_go_approved`, `operating_with_transitional_services`, `transitional_services_exited` or `perimeter_approved`; undocumented states shown. |
| DOM-P3-13 | Medium | Documented rule "one decision may approve the terms of a TSA and one extension (of that TSA or another)": the decision about TSA A's terms extends TSA B (governance owner to confirm). |
| DOM-P3-07 | Low | An expired TSA can be "extended" to an end date that has already passed (new date only has to follow the old one). |
| DOM-P3-14 | Low | Status-dimension recompute is not serialized: concurrent recomputes can store a stale state and silently drop history rows (`onConflictDoNothing`). Code review, not executed. |
| DOM-P3-15 | Low | Descriptive PATCH fields feed rules or rule labels: readiness `testResult` (rewrites the recorded result text), TSA `isEnduringArrangement` (counted as "approved enduring arrangement"), perimeter `consentRequired` (hides `consent_outstanding`). Code review. |
| DOM-P3-16 | Low | Readiness summary counts a waived waivable blocker as cleared even when its waiver expired or is not approved (GO and dimension do check). Code review. |
| DOM-P3-17 | Low | TSA / agreement guards: `activate` needs no start date reached; `remedy_breach` turns an extended TSA `active`; the "legal reviewer" of an agreement can be any member (the PM can name themselves and confirm an abbreviation's expansion). Code review. |
| DOM-P3-I1 | Info | Known pre-existing failure at `5bf274b`: `p2-qa-final-race.spec.ts` (lead-confirmed, fixed in the next commit). |
| DOM-P3-I2 | Info | G3-C02 asks for an "approved interim arrangement"; the Day-1 position accepts any text — the criterion review is the only approval. |

---

## 4. Finding details

### DOM-P3-01 — High — A descriptive PATCH takes a failed blocker out of the GO evaluation

- **Where:** `apps/api/src/modules/readiness/checks.service.ts:333-366` (`update` accepts `cutoverPlanId`, `siteId`,
  `workstreamId` whatever the check's status or the plan's state); `packages/contracts/src/readiness.ts:336-346`
  (`checkDescriptive` includes `cutoverPlanId` and `siteId`; the route summary says "never its status, criticality,
  waivability or sign-off"); `packages/domain/src/readiness.ts:197-201` (`readinessCheckAppliesToPlan`: a check bound to a plan
  gates only that plan).
- **Finding:** which plan a check gates is a scope attribute, not a description. The check manager (`readiness.check.manage`:
  PM, workstream lead, contributor-owner) moves a FAILED blocker to any other plan of the project — including one already
  executed — and the plan under decision no longer sees it. No specialist, no second person, no reason.
- **Reproduction (executed):** `DEFECT DOM-P3-01` — plan A with a failed connectivity blocker: GO 422 `readiness.go_blocked`;
  PM `PATCH …/readiness-checks/:id {cutoverPlanId: <other plan>}` → 200; sponsor GO on plan A → **201 `approved_go`**; the check
  is still `failed`.
- **Spec / rule:** §7.4 "checklists with mandatory blockers"; §19 P3 exit "blockers prevent go-live"; business-gates.md §5 "Any
  open blocker check forces a no-go [server]"; AT-09. CLAUDE.md "No generic PATCH may change a status column" (the effect is the
  same). REQ-RDY-001, REQ-RDY-004.
- **Recommendation:** make the gating scope (`cutoverPlanId`, `siteId`) a command with a reason, refused while the check is
  not cleared or while a plan it gates is `ready_for_decision` / `approved_go`; or keep a check gating every plan it was bound
  to until it is cleared. Record the re-binding in the plan's decision history.

### DOM-P3-05 — High — "Transfer not applicable" on an included item counts as a verified transfer and bypasses change control

- **Where:** `packages/domain/src/workflows.ts:276` (`mark_not_applicable` from `not_started` / `planned`, described "Not
  transferring (excluded/retained)"); `packages/domain/src/perimeter.ts:136` (`mark_not_applicable` is scope-free — allowed on an
  INCLUDED item) and `:176-179` (only a note is required); `packages/domain/src/carveout.ts:111-112` and `:139`
  (`verified + naCount === inScope.length` → `transferred_verified`); `carveout.ts:245` (no `no_transfer_plan` finding for a
  combined `not_applicable`); `apps/api/src/modules/carveout/transfers.service.ts:153-166` (`carveout.transfer.manage`: PM and
  workstream lead).
- **Finding:** the transfer manager declares that an item which stays INCLUDED in the transferring perimeter does not transfer.
  The perimeter dimension then reports "All in-scope items transferred with verified evidence" although nothing transferred and
  nobody verified anything; reconciliation shows no finding. After a baseline, this takes an in-baseline item out of the
  transfer without the change request that AT-07 requires for moving an item out of the transferring scope.
- **Reproduction (executed):** `DEFECT DOM-P3-05a` (only included item; legal and economic `mark_not_applicable` → 201, 201;
  `perimeter_transfer` = `transferred_verified`, `counts: {not_applicable: 1}`, reconciliation `[]`) and `DEFECT DOM-P3-05b`
  (after `approveBaseline`, item `inApprovedBaseline: true`; both aspects N/A → 201; `pendingChange: null`; no change request).
  CONTROL: the same item untouched is `not_started`.
- **Impact:** with incorporation verified and G4 approved, `carveOutComplete` becomes true with an untransferred perimeter
  (`isCarveOutComplete`, `carveout.ts:199-206`) — the AT-06 statement "never shown complete" fails.
- **Spec / rule:** §7.1 "transfer status, acceptance evidence … reconciliation identifying items without a transfer plan or
  evidence"; business-gates.md §1 (`transferred_verified` is moved by "transfer evidence and reconciliation"); AT-06, AT-07;
  REQ-PER-002, REQ-PER-007, REQ-LCY-006.
- **Recommendation:** refuse `mark_not_applicable` on an Included item (a non-transferring item is Excluded / Shared through
  `classify`, i.e. under change control after baseline); if a specific aspect can legitimately be N/A (e.g. no separate
  economic transfer), require the specialist class / a second person and never count an all-N/A item as "transferred verified"
  in the dimension (show it separately). For the owning function (Legal / Finance) to confirm which aspects may be N/A.

### DOM-P3-06 — High — An approved extension decision is not bound to the end date it approved

- **Where:** `apps/api/src/modules/readiness/tsa.service.ts:446-464` (`requestExtension` overwrites `proposedEndDate`,
  `continuityPlan` and even `extensionDecisionId` at any time, including after the linked decision became final);
  `:467-496` (`recordExtension` applies whatever `proposedEndDate` is stored).
- **Finding:** the extension is requested "to X" while the committee's paper is under review; the committee approves; the TSA
  manager then re-requests on the SAME decision "to Y" and records Y. The audit shows the change, but the TSA is recorded as
  extended by that decision to a date the committee never had before it.
- **Reproduction (executed):** `DEFECT DOM-P3-06` — request X=2027-01-19 (decision `under_review`) 201; decision approved;
  request Y=2036-09-28 on the same decision 201; record 201 → TSA `extended`, end 2036-09-28 (previous end 2026-10-21).
- **Spec / rule:** §7.3 "never automatically extend the contract … an extension decision"; AT-10 "extension/continuity options
  await approval"; business-gates.md §6 rule 2; module guide "Relying on a governance decision" (the decision backs the record
  it was relied on for; approvals are bound to `subjectVersion` + `payloadHash`, as the TSA exit is). Same class as DOM-P4-06
  (High: approved values of v1 recorded for v2). REQ-TSA-005.
- **Recommendation:** freeze the extension request once its decision is submitted (a change needs a new decision), or bind the
  record to a hash of `{tsaId, proposedEndDate, continuityPlan}` captured when the decision was linked and refuse a mismatch at
  `record-extension`; show the requested end date on the decision paper.

### DOM-P3-09 — High — A blocker whose sign-off evidence was rejected still clears the GO

- **Where:** `apps/api/src/modules/readiness/checks.service.ts` (no reaction to `evidence.changed`; sign-off evidence is checked
  only at `signOff`, `:441-476`); `packages/domain/src/carveout.ts:313-314` (`goDecisionBlockers`: `passed` clears whatever the
  evidence). Compare the gates module: business-gates.md §4 rule 9 (a rejected link "returns an accepted criterion … to unmet").
- **Finding:** the only evidence behind a passed blocker is rejected as defective in the documents module's verification; the
  check stays `passed` with `evidence {active: 0}`; the GO is accepted on it. The same gap exists for transfers verified on
  evidence, TSA replacement acceptance and incorporation (DOM-P3-08).
- **Reproduction (executed):** `DEFECT DOM-P3-09` — PM records a passing test and links the report; the functional approver signs
  off; the secretary rejects the link (`POST …/evidence/:id/verify {decision: reject}` 201); worker drained; sponsor GO → **201**.
- **Spec / rule:** §3 "If approved evidence is found defective, reopen the assessment through a controlled process while
  preserving previous status and decisions"; AT-14; REQ-RDY-001 "signed off on evidence", REQ-RDY-004, REQ-DAT-014.
- **Recommendation:** apply the gate rule to readiness checks: a rejected / superseded / conflicting link that leaves a passed
  check without active evidence returns it to `in_progress` (audited, history kept) and flags any plan it gated; plans already
  at `approved_go` get a decision-history entry and the DOM-P3-04 treatment.

### DOM-P3-02 — Medium — One specialist releases a failed non-waivable blocker by re-determination

- **Where:** `apps/api/src/modules/readiness/checks.service.ts:369-410` (`determine` may set `blocker: false, mandatory: false`
  on a `failed` check); `packages/domain/src/readiness.ts:110-131` (no rule about the check's state or about lowering
  criticality).
- **Finding:** the assigned sign-off specialist (not the author) lowers a failed, non-waivable blocker to non-blocking with a
  basis; the GO evaluation no longer lists it. This is an exception to a non-waivable condition without the waiver register
  (no impact, no approval by a waiver authority, no second person).
- **Reproduction (executed):** `DEFECT DOM-P3-02` — failed blocker `waivable: false`; `approver` posts `determination
  {mandatory:false, blocker:false, waivable:false}` → 201; sponsor GO → **201**.
- **Spec / rule:** §3 "An exception cannot override a non-waivable condition"; AT-13; the platform rule adopted for CPs in the
  P4 fix (business-gates.md §7, DOM-P4-03: "A determination never releases a blocking CP … a waivable one is released only
  through the waiver register"). Severity Medium (not High as DOM-P4-03) because the actor is the designated specialist and the
  basis is audited.
- **Recommendation (Operations specialist to confirm):** refuse lowering `blocker` / `mandatory` while the check is not cleared,
  or require a second person; releasing an open blocker goes through the waiver register.

### DOM-P3-03 — Medium — GO and a concurrent failed test: the GO commits on a stale evaluation

- **Where:** `apps/api/src/modules/readiness/cutover.service.ts:401-462` — `evaluation()` reads the checks without a lock
  (`:426`); the only lock is the decision row (`lockDecisionAndRecheck`, `:448`), taken after the evaluation; a test run
  (`checks.service.ts:413-438`) touches neither the plan nor the decision.
- **Finding:** write skew. The brief asked whether readiness commands need protection like the gates' per-project lock: yes for
  the GO — it must re-read the gating checks under a lock that a check change also takes.
- **Reproduction (executed, deterministic):** `DEFECT DOM-P3-03` — an owner transaction holds the decision row; the GO request
  waits after evaluating; the PM's failed test commits (201, `seq: 2`); the lock is released; GO **201** `approved_go`; its
  recorded evaluation is `{"blockers":[]}` while the check is `failed`.
- **Spec / rule:** AT-09; AT-16 "prevent lost updates"; business-gates.md §5 [server]. REQ-RDY-004.
- **Recommendation:** in `decide`, lock the gating checks (`SELECT … FOR SHARE` on the check rows, or a per-plan /
  per-project readiness advisory lock also taken by test, sign-off, determination, waiver and re-binding commands) before
  evaluating; the lock order must be documented like "One writer of a project's gate state at a time".

### DOM-P3-04 — Medium — A blocker failing after the GO does not block the go-live record

- **Where:** `apps/api/src/modules/readiness/cutover.service.ts:498-502` (`recordExecution` re-evaluates nothing);
  `checks.service.ts:413-438` (a failed test has no effect on plans at `approved_go`).
- **Reproduction (executed):** `DEFECT DOM-P3-04` — blocker cleared, GO 201; the connectivity test is re-run and fails; the plan
  still shows `approved_go` with `goEvaluation.allowed: false`; `POST …/execution` → **201 `executed`**; history
  `["rehearsal","submitted","go","executed"]`.
- **Spec / rule:** AT-09 "readiness test fails → block go-live according to the blocker"; §7.4 contingency / rollback; §3
  controlled reopen. REQ-RDY-004.
- **Recommendation:** a gating blocker that fails after the GO withdraws or flags the GO (decision-history entry, escalation,
  contingency shown) and `record-execution` is refused until the blocker is cleared / waived or a new GO is decided.

### DOM-P3-08 — Medium — Incorporation stays "verified" after its evidence is rejected

- **Where:** `apps/api/src/modules/newco/legal-entities.service.ts:280-316` (verification is a one-time check);
  `apps/api/src/modules/gates/status-dimensions.service.ts:137` (`evidenceVerified: verification === 'confirmed'`, the evidence
  is not re-read); `newco.jobs.ts` (no `evidence.changed` handler).
- **Reproduction (executed):** `DEFECT DOM-P3-08` — PM links the extract and records `incorporated`; Legal verifies; the secretary
  rejects the extract as defective (201); worker drained; entity `verification: confirmed`, `evidence {active: 0}`; dimension
  `incorporated_verified` "Incorporation confirmed with verified evidence."
- **Spec / rule:** business-gates.md §1 rule 3 (evidence-pending states); §3 controlled reopen; AT-06, AT-14; REQ-SET-010,
  REQ-LCY-007.
- **Recommendation:** when the active evidence of a verified incorporation is rejected / superseded / conflicting, show it as
  evidence pending (or flagged) and ask Legal to re-verify; keep the recorded verification in history.

### DOM-P3-10 — Medium — The evidence recorder can sign off / verify on the evidence they recorded

- **Where:** `packages/domain/src/readiness.ts:75-104` and `checks.service.ts:452` (`selfUserIds: [owner, creator, latest test
  recorder]` — the evidence linker is not included); `legal-entities.service.ts:284-286` (`not_self` only against the status
  recorder).
- **Finding:** access-matrix.md §2.4 lists `readiness.check.signoff` and `newco.incorporation.verify` as not_self against "record
  owner and the person who recorded the status/evidence". The evidence recorder is not checked. For incorporation it is reachable
  with the standard roles: Legal links the extract (`documents.evidence.link` + `newco.incorporation.manage`), the PM records,
  the same Legal member verifies.
- **Reproduction (executed):** `DEFECT DOM-P3-10` (a second PM who also holds `functional_approver` links the evidence and signs
  off → 201) and `DEFECT DOM-P3-10b` (Legal links, PM records `incorporated`, Legal verifies → 201 `confirmed`).
- **Recommendation:** pass the ids of the linkers of the active evidence as additional not_self subjects (sign-off, incorporation
  verification, transfer verification), as the gate criteria do with the evidence owner.

### DOM-P3-11 — Medium — After G4, TSA problems vanish and the carve-out reads complete

- **Where:** `packages/domain/src/carveout.ts:158-161` (`standaloneAccepted` short-circuits before `tsaProblems`) and `:199-206`.
- **Reproduction (executed, pure rule used by the service):** `DEFECT DOM-P3-11` — G4 approved, one `expired_unresolved` and one
  `breached` TSA: `standalone_accepted`, explanation "Dependencies: 2 transitional service(s) not yet exited …" (no problem
  stated), `isCarveOutComplete` true. CONTROL: before G4 the same TSA makes the dimension `blocked`.
- **Spec / rule:** AT-10; business-gates.md §6 rule 3, G7-C03 ("no TSA is in Expired-unresolved state"); REQ-LCY-014.
- **Recommendation:** after G4 keep the TSA problem visible (message and a state such as `operating_with_transitional_services`
  flagged) and do not report the carve-out complete while a TSA is expired-unresolved or breached.

### DOM-P3-12 — Medium — The dimension states are not the documented state machines

- **Where:** `packages/domain/src/carveout.ts:116-196` vs business-gates.md §1 and `packages/db/seed/templates/dc-carveout.v1.json`
  `statusDimensions`.
- **Finding (executed, `OBSERVED DOM-P3-12`):** produced but undocumented — incorporation `incorporated_unverified` (template:
  `incorporated_evidence_pending`); perimeter `blocked`, `in_progress`, `perimeter_not_defined`; operational `blocked`,
  `day1_ready`, `in_progress`. Documented but never produced — `day1_go_approved`, `operating_with_transitional_services`,
  `transitional_services_exited`, `perimeter_approved` (`DimensionInput` has no GO, perimeter-version or TSA-exit input).
  Every mandatory check passed with no GO decision already reads `day1_ready`; G4 with an active TSA reads `standalone_accepted`.
- **Spec / rule:** §3 "Show transitional services and approved enduring arrangements and their effect on the approved definition
  of independence"; business-gates.md §1 ("What moves it: … go/no-go decision, post-transition acceptance, TSA exits").
  REQ-LCY-006, REQ-LCY-014.
- **Recommendation:** either implement the documented machines (feed the GO, post-transition acceptance, approved perimeter
  version and TSA exits into `DimensionInput`) or amend business-gates.md §1 and the template to the implemented vocabulary,
  approved by the domain owner; in both cases never label "Day-1 ready" without the GO decision.

### DOM-P3-13 — Medium — One decision: terms of TSA A, extension of TSA B

- **Where:** `packages/domain/src/decision-reliance.ts:161-166` ("one `tsa_approval_or_extension` decision may approve the terms
  of a TSA and one extension (of that TSA or another)"); `tsa.service.ts:50-61` (subject rule `if_set`).
- **Reproduction (executed):** `OBSERVED DOM-P3-13` — the decision that approved TSA A's terms is used to request and record an
  extension of TSA B → 201; `decision_use` rows `tsa_service → A`, `tsa_extension → B`.
- **Assessment:** documented design, but the committee decided about A; B is recorded as extended "by" that decision. Same
  class as DOM-P2F-08. **Governance owner to confirm**; conservative option: a decision already used for the terms of TSA A may
  back only an extension of A (and vice versa), until papers can name a TSA (`DECISION_SUBJECT_TYPES`, open question listed in
  WORK_LOG).

### DOM-P3-07 — Low — "Extended" to a past date

- `packages/domain/src/readiness.ts:359-367` checks only `proposedEndDate > currentEndDate`. `OBSERVED DOM-P3-07`: an
  `expired_unresolved` TSA (end −10 days) is extended to −5 days → `extended`, `expiry.kind: expired_unresolved`; it leaves the
  expired state until the next daily scan. Recommendation: require the new end date after "today" (project timezone).

### DOM-P3-14 — Low — Status-dimension recompute is not serialized (code review, not executed)

- `apps/api/src/modules/gates/status-dimensions.service.ts:161-230` reads, computes and writes without a lock; the HTTP commands
  (`legal-entities.service.ts:241-246`) and the worker job recompute concurrently. Two recomputes that both changed a dimension:
  the one with the older snapshot can commit last (stale state until the next event), and `RecordVersionService.snapshot` uses
  `onConflictDoNothing` (`apps/api/src/platform/helpers.ts:92`), so the second writer's history rows are dropped silently while
  the row version advances. Recommendation: take a per-project advisory lock (e.g. `hub_dimensions:<projectId>`) in
  `recomputeDimensions`, or re-read under `FOR UPDATE` of the project's dimension rows. **NOT EXECUTED** (no deterministic
  interleaving was built).

### DOM-P3-15 — Low — Descriptive PATCH fields that feed rules (code review)

- `checks.service.ts:333-366`: `testResult` (the text the test-run command writes, "failed: …") can be rewritten to anything
  while the status stays `failed`. `tsa.service.ts:290-326`: `isEnduringArrangement` is set by the TSA manager and the dimension
  then calls it an "approved enduring arrangement" (`carveout.ts:78`) — no approval exists. `perimeter.service.ts:618`:
  `consentRequired` can be reset to false after the specialist's class set it, removing the `consent_outstanding`
  reconciliation finding (the Day-1 position, which uses the class, still flags it). Recommendation: make these commands with
  a reason / approval, or drop the word "approved" and read consent needs from the specialist class only.

### DOM-P3-16 — Low — Summary counts expired waivers as cleared (code review)

- `apps/api/src/modules/readiness/summary.service.ts:30` excludes `status = 'waived' and waivable` from open blockers without
  checking the waiver's approval / expiry, unlike the GO (`waiverEffectiveFor`) and the dimension (`waivedValid`). The Day-1
  centre can show fewer open blockers than the GO evaluation. Recommendation: join the waiver and apply `waiverIsEffective`.

### DOM-P3-17 — Low — TSA and agreement guards (code review)

- `tsa.service.ts:338-348`: `activate` has no guard ("service start date reached and service confirmed", business-gates.md §6).
- `workflows.ts:208-209`: `remedy_breach` returns an `extended` TSA to `active`; the documented "breached → exit_in_progress:
  exit accelerated by decision" is not implemented.
- `agreements.service.ts:144-148`: the legal reviewer only has to be a member; the agreement manager (PM) can name themselves,
  pass the "legal reviewer assigned" guard of `agree_in_principle` / `record_signing` and confirm the abbreviation's expansion
  (`perimeter.ts:442-446`). Recommendation: require a legal role for the legal reviewer (Legal to confirm).

### DOM-P3-I1 — Info — Known pre-existing failure at `5bf274b`

See §1.5. Lead-confirmed; fixed after the frozen revision. The P2/P3 gate reports must cite a green run on their own revisions.

### DOM-P3-I2 — Info — "Approved interim arrangement"

`packages/domain/src/carveout.ts:283-305` accepts any interim-arrangement text with the three accountable owners and a
remediation plan; G3-C02 speaks of an approved arrangement. Acceptable while the G3-C02 criterion review is the approval; to be
confirmed by the Commercial / Legal owners.

---

## 5. P2 closure re-check (condition C2 of `docs/reviews/P2-qa-final-review.md`)

Method: `git log -p` of each probe file since the reviewer's commit, comparison of the original assertion with the current one,
and a run of the five files (§1.4: 24 passed + 2 expected fail).

| Probe file | Implementer edits | Result |
|---|---|---|
| `p2-domain-rereview.spec.ts` | `4077ce6`: DEFECT DOM-P2R-03, -04a, -04b renamed "(fixed, regression)", assertions unchanged. OBSERVATION DOM-P2R-01 (pinned "approved 1 to 0 at once") and DOM-P2R-02 (pinned "approved on the requester's own 0") turned into regression tests of the implemented (proposed) rules: early outcome 422 `governance.outcome.votes_outstanding`, secretariat cannot close (403), chair closes with a reason, late vote 422, non-voters recorded; amount 422 `change_control.amount_unconfirmed` until an assessor other than the requester records it, then 422 `outside_delegated_authority`. RE DOM-P2-20: setup adds Legal's vote (needed by the new closing rule); assertions unchanged. | **CONFIRMED** — defect probes unchanged; observations became stricter assertions of the fix. Note (not a weakening): after a chair's closure a 1–0 outcome is still possible (Q-40, governance owner). |
| `p2-domain-rereview-perimeter.spec.ts` | `4077ce6` rename; `63f9fef`: the G1 paper is now raised FOR version 1 (needed since DOM-P2F-08). Assertion unchanged (`not.toBe(201)`). | **CONFIRMED** — the refusal of version 2 is still the registry's: audit `perimeter.version.decision_already_used` (§1.4), because `decisionRelianceIssue` checks prior uses before the subject. |
| `p2-domain-final.spec.ts` | `672be24`: DOM-P2F-01 renamed, assertion unchanged plus the code `governance.voting.chair_recused`. DOM-P2F-03: choreography changed (the original awaited the close while holding the vote-table lock, a wait-for cycle through the test once the fix locks the decision row) and the assertion rewritten from "vote 422" to "never vote committed AND listed not-voted in the close record", with the vote status in {201, 422}. | **CONFIRMED** — DOM-P2F-01 unweakened; DOM-P2F-03 encodes the requirement the original probe stated ("the vote is refused, or the close waits for it — never both committed"). Residual (Low, test quality): in the regression direction the probe relies on a fixed 300 ms sleep (line 263) for the close to finish before the vote lock is released; if the fix were removed and the close took longer, the probe could pass falsely. Suggest polling `pg_locks` for the close's lock wait instead. |
| `p2-domain-final-perimeter.spec.ts` | `63f9fef`: OBSERVATION DOM-P2F-08 (pinned 201 on an unbound G1 paper) now asserts 422 `perimeter.version.decision_no_subject` and version 2 still `proposed`; RE DOM-P2R-03/-05 part unchanged. | **CONFIRMED** — the observation became the implemented conservative rule; stricter than before (audit shows `decision_other_subject` and `decision_no_subject`). |
| `p2-domain-final-readiness.spec.ts` | `63f9fef`: `defect` alias removed, renamed "(fixed, regression)", assertion unchanged (second TSA on the same decision → 422). | **CONFIRMED.** |

---

## 6. Other checks (no finding)

- **Legal / regulatory determinations by the software:** none found. New regulatory entries start "Assessment pending —
  specialist" whatever their origin (`newco.ts:84-86`); applicability is a specialist command with a basis and not by the
  registrant; outcomes need evidence and the specialist; perimeter impacts mark financial statements, valuation, TSA need,
  budget and transaction effects "Assessment pending — specialist"; contract transferability is a specialist class; a consent
  "not required" needs that specialist; abbreviation expansions stay "Unconfirmed" until confirmed (but see DOM-P3-17).
- **Demo / seed data:** carve-out, NewCo and readiness seeds use fictional, "Demo"-labelled names; no amounts; TSA and transfer
  dates are labelled synthetic / assumed; the NewCo stays "incorporation in progress, proposed" as declared at creation — no
  incorporation or approval invented. "CST" appears as written in the source (CLM-005; glossary: proposed expansion). The
  readiness seed computes "today" in `Asia/Riyadh` literally instead of the project timezone (same value for the demo project).
- **Calendar / timezone:** business dates are `YYYY-MM-DD` compared as strings or as UTC-midnight differences; "today" comes from
  `clock.today(project.timezone)` in the TSA scan, validity, consent, transfer and agreement rules. No defect found.
- **Decision reliance (DOM-P2F-09 fix):** TSA terms, extensions and cutover GO use the shared helpers (pre-check 422, row lock +
  re-check 409, registered use, external-evidence re-check); a GO after a rollback needs a new decision; a NO-GO relies on none.
  Gaps are DOM-P3-06 (terms of the extension not bound) and DOM-P3-13 (cross-TSA use).
- **Separation of duties elsewhere:** GO decider ≠ submitter (`assertApproval` with `requesterUserId`); post-transition acceptance
  by the accountable owner ≠ executor; TSA exit approver ≠ requester / owner / replacement acceptor, bound to TSA version +
  payload hash; transfer verifier ≠ reporter; applicability assessor ≠ registrant; conditions closer ≠ outcome recorder.
- **Other concurrency:** TSA scan vs. user commands uses optimistic versions (a conflict fails that scan run, retried); the expiry
  schedule creation takes an advisory lock; perimeter-version approval locks the version row and the decision row.
- **Status only through commands:** check, plan, TSA, agreement, consent and perimeter PATCH bodies are strict and exclude status
  columns (400 on `status`, AT-10 test). DOM-P3-01 and DOM-P3-15 are rule inputs reachable through descriptive fields.
- **Web (rule correctness only):** the NewCo screen shows `carveOutComplete` with the hint "Never true because a single dimension
  … is complete"; it is computed on the server. The TSA screen lets the manager re-request an extension at any time (consistent
  with DOM-P3-06).

## 7. Not verified / NOT EXECUTED

- DOM-P3-14 to -17 are code-review findings; no probe was run for them.
- Reaching an approved G4 through the API (G0–G3 approved) was not attempted; DOM-P3-11 and -12 exercise the pure rule the service
  stores (`computeStatusDimensions` / `isCarveOutComplete`), with the inputs `buildInput` produces.
- Playwright E2E was not run (not requested for this review); the QA review covers the P3 screens.
- The P3 security questions noted in WORK_LOG (contributor self-owner claims on create commands) are left to the security review.

## 8. Verdict

**FAIL** for the P3 domain gate at `5bf274b`.

- Open High: DOM-P3-01, DOM-P3-05, DOM-P3-06, DOM-P3-09. Open Medium: DOM-P3-02, -03, -04, -08, -10, -11, -12, -13.
- Requirements whose status should be re-checked against these findings (currently `Tested`): REQ-RDY-001, REQ-RDY-004
  (DOM-P3-01, -02, -03, -04, -09, -10), REQ-PER-002 / REQ-PER-007 (DOM-P3-05), REQ-TSA-005 (DOM-P3-06, -13), REQ-LCY-006 /
  REQ-LCY-007 / REQ-SET-010 (DOM-P3-05, -08, -10b, -12), REQ-LCY-014 (DOM-P3-11, -12).
- Conditions to reach PASS: fix the four High findings with their probes turned into regression tests (assertions unchanged);
  fix or have the domain owner accept DOM-P3-02, -03, -04, -08, -10, -11, -12 with a recorded decision; governance owner to
  confirm DOM-P3-13; Lows go to the P3 gate report with owners.

**Next action for the implementers:** readiness first (DOM-P3-01, -09, then -02, -03, -04, -10 — one change can cover several:
a readiness lock taken by every command that changes a gating input, evidence reactions like the gates module's, and a
post-GO invalidation rule), then DOM-P3-05 (transfer N/A on included items), DOM-P3-06 (bind the extension terms to the
decision), then the dimension work (DOM-P3-08, -11, -12, -14).

---

## 9. Fix status (implementer, separate context)

Written by the implementer (`backend-data-engineer`, implementation mode) in its own context; the reviewer's text above is
unchanged. Commits on the implementer's branch: `3e9c021` (readiness), `bae6077` (carve-out), `d799aad` (TSA, summary,
dimension lock), `593c408` (NewCo), `49a0426` + `aceb8f8` (status dimensions), `a493f34` (documentation). Every fixed
`DEFECT` probe is renamed "… (fixed, regression)" and is a plain `it` with its assertion unchanged; the `defect` alias stays
in each probe file so that `P3D_PROBE_PLAIN=1` keeps working (checked: `P3D_PROBE_PLAIN=1` on `p3-domain-dimensions.spec.ts`
3/3). The three `OBSERVED` probes (DOM-P3-07, -12, -13) pinned the reported behaviour; following the probe convention they
were updated together with the fix (setup unchanged) and now pin the implemented rule. `CONTROL` probes are unchanged.
The rules are written down in `docs/governance/business-gates.md` §1 rule 8, §5 and §6 rules 5–9, `docs/security/access-matrix.md`
§5.1 and `docs/architecture/module-guide.md`; owner questions are A-P3-* / Q-P3-* in `docs/assumptions-and-open-questions.md`.

| Finding | Status | Rule → file | Tests |
|---|---|---|---|
| **DOM-P3-01** (High) | **Fixed** | Which plan / site a check gates changes only through the command `POST …/readiness-checks/:checkId/rebind` (reason required, readiness lock): refused for a FAILED gating check (`readiness.check.rebind_failed`) and for an open check that would leave or enter a plan at `ready_for_decision` / `approved_go` (`readiness.check.rebind_plan_locked`); every plan left / entered gets a decision-history entry; the descriptive PATCH refuses `cutoverPlanId` / `siteId` (400) → `packages/domain/src/readiness.ts` (`assertReadinessCheckRebind`), `apps/api/src/modules/readiness/{checks.service.ts (rebind), readiness.controller.ts, readiness.support.ts (plansGatedBy, recordPlanHistory)}`, `packages/contracts/src/readiness.ts` (`rebindReadinessCheck`, `UpdateReadinessCheckBody`); web: cutover plan page, refusal texts en + ar | `p3-domain-readiness-go.spec.ts` "DOM-P3-01: … (fixed, regression)"; `readiness/p3-fixes-readiness.spec.ts` "a descriptive PATCH may not carry cutoverPlanId / siteId (400); the rebind command moves an open check off a plan in planning, with a reason and history entries", "a FAILED gating check cannot be re-bound …"; `readiness.test.ts` "re-binding: reason required; …" |
| **DOM-P3-09** (High) | **Fixed** | A passed check clears the GO only while its evidence has an ACTIVE link and no conflicting one (`goDecisionBlockers` → blocker with `evidenceInvalid`, fails closed when unknown); the `evidence.changed` reaction (job `readiness.check_evidence_changed`, service principal) returns such a check to `in_progress` (audited, history kept) and flags the GOs it gated (DOM-P3-04 treatment) → `packages/domain/src/carveout.ts` (`goDecisionBlockers`), `apps/api/src/modules/readiness/{readiness.support.ts (signoffEvidenceValid), checks.service.ts (processEvidenceChange), readiness.jobs.ts, cutover.service.ts, summary.service.ts}` | `p3-domain-readiness-go.spec.ts` "DOM-P3-09: … (fixed, regression)"; `p3-fixes-readiness.spec.ts` "evidence rejected: the GO is refused at once (blocker evidenceInvalid), then the worker returns the check to in_progress with an audit record"; `readiness.test.ts` "a passed check clears the GO only while its sign-off evidence is valid (fails closed when unknown)". Not changed: transfers verified on evidence and the TSA replacement acceptance (named in the finding text as the same gap) do not react to `evidence.changed` yet — outside this finding's recommendation; recorded for the P3 gate report |
| **DOM-P3-05** (High) | **Fixed** | On an Included / Shared item "not applicable" is: before the item is in an approved baseline, a specialist determination (`POST …/perimeter-items/:itemId/transfer-not-applicable`, `carveout.transfer.verify`, not the item's owner / creator, basis required; the transfer manager is refused 403 `transfer.not_applicable_specialist`); once in the approved baseline, a change request raised by the transfer manager and applied by `apply-change`; never on both aspects (`transfer.not_applicable_in_scope` — reclassify instead). The dimension never counts an in-scope N/A item as transferred (`dimension.perimeter.not_applicable_in_scope`, `aspect_not_applicable`); reconciliation reports `transfer_not_applicable` → `packages/domain/src/{perimeter.ts, carveout.ts (reconcilePerimeter, computeStatusDimensions)}`, `apps/api/src/modules/carveout/{transfers.service.ts (determineNotApplicable, notApplicableChangeRequest), perimeter.service.ts (raiseTransferNotApplicableChange, applyChange), carveout.controller.ts}`, `packages/contracts/src/carveout.ts`; web item sections + refusal texts en + ar | `p3-domain-perimeter.spec.ts` "DOM-P3-05a: … (fixed, regression)", "DOM-P3-05b: … (fixed, regression)"; `carveout/p3-fixes-carveout.spec.ts` (DOM-P3-05 describes: 5 tests); `rules.test.ts` "perimeter: draft → not started → … N/A never counts as transferred". Owner question Q-P3-05 (which aspects may be N/A) |
| **DOM-P3-06** (High) | **Fixed** | Once the linked decision has left draft, the requested extension terms (end date, continuity plan) are bound to it: a re-request with other terms on that decision is 422 `tsa.extension.terms_bound` (same terms: idempotent); a new date needs a new decision; `record-extension` applies the bound date → `packages/domain/src/readiness.ts` (`extensionTermsBinding`), `apps/api/src/modules/readiness/tsa.service.ts` (`requestExtension`) | `p3-domain-tsa.spec.ts` "DOM-P3-06: … (fixed, regression)"; `readiness/p3-fixes-tsa.spec.ts` "DOM-P3-06: once its decision left draft, the requested extension terms are frozen on that decision …"; `readiness.test.ts` "DOM-P3-06: the extension terms are bound to their decision once it left draft; the same terms are idempotent" |
| **DOM-P3-02** | **Fixed** (Operations specialist to confirm, Q-P3-02) | A determination never lowers `blocker` / `mandatory` of a FAILED check, nor of an open check gating a plan under decision / with a GO (`readiness.determination.release_not_allowed`); release goes through the waiver register → `packages/domain/src/readiness.ts` (`assertReadinessDetermination`), `checks.service.ts` (`determine`) | `p3-domain-readiness-go.spec.ts` "DOM-P3-02: … (fixed, regression)"; `p3-fixes-readiness.spec.ts` "lowering a failed blocker is refused …", "lowering a NOT-STARTED blocker that gates no plan under decision is still a specialist determination"; `readiness.test.ts` "DOM-P3-02: a determination never releases an open gating check …" |
| **DOM-P3-03** | **Fixed** | Per-project transaction advisory lock `hub_readiness:<projectId>` taken first by the GO and the execution record and by every command that changes a gating input (creation / instantiation, test run, sign-off, determination, reopen, waiver application, re-binding, evidence reaction); lock order `hub_readiness` → decision row → `readiness.support.ts` (`lockReadiness`), `checks.service.ts`, `cutover.service.ts`; module guide "One writer of a project's Day-1 readiness state" | `p3-domain-readiness-race.spec.ts` "DOM-P3-03 (concurrency): … (fixed, regression)" (deterministic: the GO now waits for the test's lock and sees the failure) |
| **DOM-P3-04** | **Fixed** | A gating check open again after the GO (failed test, reopen, invalid evidence) flags the GO (`go_flagged` decision-history entry, audit); `record-execution` is refused (`readiness.execution_blocked`, the refusal is recorded) until it is cleared or the GO is withdrawn (`return_to_planning` now allowed from `approved_go`; a new GO needs a new decision) → `packages/domain/src/readiness.ts` (`assertExecutionAllowed`, `CUTOVER_MACHINE`), `readiness.support.ts` (`flagGoPlans`), `cutover.service.ts` (`recordExecution`, `recordRefusedExecution`); `cutover_decision_record.actor_user_id` nullable (system entries) | `p3-domain-readiness-go.spec.ts` "DOM-P3-04: … (fixed, regression)"; `p3-fixes-readiness.spec.ts` "the failed test flags the GO in the history; execution is refused (422, refusal kept in the history); the GO can be withdrawn and a new GO needs a new decision"; `readiness.test.ts` "execution after a GO is refused while a gating check is open again; …" |
| **DOM-P3-08** | **Fixed** | The `evidence.changed` reaction (job `newco.incorporation_evidence_changed`) returns a confirmed incorporation whose evidence is no longer active to "proposed" (audited, history kept, linked projects told, dimensions recomputed); the dimension counts the verification only while its evidence is active in the owning project → `apps/api/src/modules/newco/{legal-entities.service.ts (processEvidenceChange), newco.jobs.ts}`, `apps/api/src/modules/gates/status-dimensions.service.ts` | `p3-domain-perimeter.spec.ts` "DOM-P3-08: … (fixed, regression)"; `carveout/p3-fixes-newco.spec.ts` "the verification returns to "proposed" (evidence pending, audited, history kept); Legal verifies again on new evidence linked by someone else" |
| **DOM-P3-10** (= SEC-P34-01, P3 part) | **Fixed** | Every person who linked active (or conflicting) evidence of the record is an additional `not_self` subject (checked one by one, fails closed): readiness sign-off, incorporation verify, regulatory outcome and conditions satisfied, transfer verify → `readiness.support.ts` / `newco.support.ts` / `carveout.support.ts` (`evidenceLinkers`), `checks.service.ts` (`signOff`), `legal-entities.service.ts`, `regulatory.service.ts`, `transfers.service.ts`; access-matrix §5.1 note | `p3-domain-readiness-go.spec.ts` "DOM-P3-10: … (fixed, regression)"; `p3-domain-perimeter.spec.ts` "DOM-P3-10b: … (fixed, regression)"; `p3-fixes-newco.spec.ts` "DOM-P3-10: whoever linked the incorporation evidence does not verify on it (403); the refusal is audited"; `p3-fixes-carveout.spec.ts` "a second PM who also holds a verifier role links the transfer evidence and is refused the verification (403)" |
| **DOM-P3-11** | **Fixed** | After G4 a breached / expired-unresolved TSA stays stated in the operational dimension (`standalone_accepted` + `dimension.readiness.tsa_blocked`); the terminal state `transitional_services_exited` needs every transitional service exited (approved enduring arrangements excepted); `isCarveOutComplete` requires it → `packages/domain/src/carveout.ts` | `p3-domain-dimensions.spec.ts` "DOM-P3-11: … (fixed, regression)"; `rules.test.ts` "after G4: running TSAs keep "standalone accepted"; a TSA problem stays visible and the carve-out incomplete; all exited → terminal" |
| **DOM-P3-12** | **Fixed** (vocabulary amendments for the domain owner, Q-P3-12) | The rule produces only the documented states (`DIMENSION_STATES` = template `statusDimensions`, compared by a unit test): the Day-1 GO and post-transition acceptance of every transition plan (`day1_go_approved`, `operating_with_transitional_services`; a flagged GO does not count), the approved perimeter version (`perimeter_approved`), partial transfer (`partially_transferred`) and TSA exits (`transitional_services_exited`) move the dimensions; never "Day-1 ready" without a GO (`day1_ready` is no longer produced); `blocked` kept as the exception state; template and business-gates.md §1 amended accordingly → `packages/domain/src/carveout.ts`, `apps/api/src/modules/gates/status-dimensions.service.ts` (`buildInput`: perimeter approval, plans + flagged GO), `packages/db/seed/templates/dc-carveout.v1.json`, web `gates.messages.dimension.*` / `statuses.dimensionStates` en + ar | `p3-domain-dimensions.spec.ts` "DOM-P3-12 (fixed): the computed states are the documented state machines — …" (OBSERVED probe updated with the fix: no undocumented state; every documented state reachable); `rules.test.ts` describe "DOM-P3-11 / DOM-P3-12 — the dimension machines …" (6 tests incl. "the dc-carveout template lists exactly the states the rule produces (DIMENSION_STATES)"); `gates/at-06-status-dimensions.spec.ts`, `carveout/at-06-incorporation-separate.spec.ts` (vocabulary) |
| **DOM-P3-13** | **Fixed — conservative option** (governance owner to confirm, Q-P3-13) | A `tsa_approval_or_extension` decision used for TSA A (terms or extension) never backs a use for TSA B (`tsa.extension.decision_other_tsa`, `tsa.approve.decision_other_tsa`) → `tsa.service.ts` (`assertSameTsa`); `packages/domain/src/decision-reliance.ts` comment, module guide reliance table | `p3-domain-tsa.spec.ts` "DOM-P3-13 (fixed — conservative option, governance owner to confirm): …"; `p3-fixes-tsa.spec.ts` "DOM-P3-13 (conservative, governance owner to confirm): the decision that approved the terms of TSA A does not back an extension of TSA B — nor the reverse" |
| DOM-P3-07 | **Fixed** | The new end date must be after today (project timezone), at the request and at the record (`tsa.extension.end_date_past`) → `readiness.ts` (`assertExtensionRequestValid`, `assertExtensionEndDateAhead`), `tsa.service.ts` | `p3-domain-tsa.spec.ts` "DOM-P3-07 (fixed): …"; `p3-fixes-tsa.spec.ts` "DOM-P3-07: the new end date must be after today …" |
| DOM-P3-14 | **Fixed** (test written first) | `recomputeDimensions` takes the transaction advisory lock `hub_dimensions:<projectId>` before reading → `status-dimensions.service.ts` | `gates/p3-dimension-lock.spec.ts` "a recompute waits for a recompute in progress (advisory lock hub_dimensions:<projectId>), then succeeds" (failed before the fix) |
| DOM-P3-15 | **Fixed** (tests written first) | `testResult` is not a PATCH field (written by the test-run command only); `isEnduringArrangement` locked after the terms approval (`tsa.enduring_locked`) and counted "approved" only from then on; the consent need follows the specialist class (`perimeter.consent_required_by_class`; reconciliation reads the class) → `packages/contracts/src/readiness.ts`, `tsa.service.ts`, `carveout.ts` (dimension), `perimeter.service.ts` | `p3-fixes-tsa.spec.ts` "readiness: the recorded test result of a failed check cannot be rewritten …", "TSA: whether a service is an enduring arrangement is part of its approved terms …"; `p3-fixes-carveout.spec.ts` "after the specialist classifies a contract "consent required", resetting consentRequired to false does not remove the consent_outstanding finding"; `rules.test.ts` "DOM-P3-15: an enduring arrangement counts as approved only once its terms are approved" |
| DOM-P3-16 | **Fixed** (test written first) | The Day-1 summary counts a waived blocker as cleared only with an effective waiver and a passed one only with valid evidence (`waiverEffectiveFor`, `signoffEvidenceValid`) → `summary.service.ts` | `p3-fixes-tsa.spec.ts` "a waiver that expired: the blocker is open again in the summary (as in the GO evaluation)" |
| DOM-P3-17 | **Fixed** (tests written first; Legal to confirm the roles, Q-P3-17) | `activate` needs the start date reached (`tsa.activate.not_started`); `remedy_breach` returns to the pre-breach status (`tsa_service.pre_breach_status`); `accelerate_exit` (`breached → exit_in_progress`, the accelerating decision stated in the required note); the legal reviewer of an agreement must hold the `legal_restricted` role (`agreement.legal_reviewer_not_legal`) → `readiness.ts` (`assertTsaActivatable`, `statusAfterRemedy`), `workflows.ts` (`TSA_MACHINE`), `tsa.service.ts`, `agreements.service.ts`; web TSA page (accelerate action) | `p3-fixes-tsa.spec.ts` (DOM-P3-17 describe: 3 tests); `p3-fixes-carveout.spec.ts` "the agreement manager cannot name a non-legal member (e.g. themselves) as legal reviewer (422); a Legal member can be named"; `readiness.test.ts` "DOM-P3-17: …" |
| DOM-P3-I1, DOM-P3-I2 | Info — not changed | — | — |

Schema: `cutover_decision_record.actor_user_id` nullable, `tsa_service.pre_breach_status`; the single migration
`0000_initial_schema.sql` was regenerated and the data dictionary re-generated. The results of the final verification (full
API suite, domain unit tests, Playwright specs touched) are in the implementer's hand-off report.
