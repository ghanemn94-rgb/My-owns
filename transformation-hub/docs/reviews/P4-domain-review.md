# P4 independent domain review: JV & Finance

| Item | Value |
|---|---|
| Reviewer | carveout-domain-analyst (REVIEW mode, separate context). This reviewer did not author the code under review. |
| Revision reviewed | `40fac200ca39476fa92d2a98ded8705e60bef490` (`40fac20`) on `claude/mobily-transformation-hub`, merged into the review worktree (fast-forward, "Already up to date") and frozen for the review. |
| Review branch | `worktree-agent-a3118ac3c8ffa6a49`. This review adds only this report and two probe files: `apps/api/test/reviews/p4-domain-jv.spec.ts` and `apps/api/test/reviews/p4-domain-finance.spec.ts`. No application code, existing test, migration or seed was changed. |
| Date | 2026-09-30 |
| Scope | Master prompt §19 (P4 row), §3 (G5–G7, status dimensions), §7.5 (finance), §8 (partner, JV, DD, closing), §20 (AT-03, AT-11, AT-12, AT-13, AT-29, and AT-04 / AT-10 / AT-19 through P4 requirements), §21 (demo data). Code: `apps/api/src/modules/{finance,jv}`, `packages/domain/src/{jv,finance,money,workflows,carveout}.ts`, the policy matrix, the G5–G7 template, the JV / finance demo seeds, the web screens `apps/web/src/app/(app)/projects/[projectId]/{finance,jv}` and `/partner-access` (read only, where they show a rule outcome). All 39 `phase: P4` requirements and the P4 part of `docs/phases/P2-P4-requirement-disposition.md` (with its updates). |
| Platform rules used | `docs/governance/business-gates.md` (§1 dimensions, §3 G5–G7, §4 evaluation, §7 CP semantics, §8 partner stages), `docs/governance/authority-matrix.md` (decision types `jv_signing_authorization` → G5, `jv_closing_confirmation` → G6, `valuation_and_ownership_terms`, budget types), `docs/reviews/P2-domain-review.md` (the P2 fixes: a decision backs one approval only; external approvals rest on verified evidence, DOM-P2-12). |
| **Verdict** | **FAIL.** 5 High, 4 Medium and 8 Low findings. No Critical. The P4 domain gate cannot pass with open High findings. |

This review makes no legal, tax, zakat, accounting or regulatory determination. Where a finding touches such a rule (for
example, who may decide that a condition precedent is not a condition to closing), the report states the conflict between
the implementation and the platform's own documented rule; the owning function confirms the rule ("Assessment pending —
specialist").

---

## 1. Commands and real results

All commands were run from `transformation-hub/` in the review worktree, against databases created for this review only
(`hub_test_p4dom`, `hub_test_p4dom_boot`, `hub_test_p4dom_probe`, `hub_test_p4dom_e2e`). Docker was not started. No process
started by others was touched (API, worker and web processes of another session were running; this review's e2e stack used
ports 4410/3410 and was stopped by PID).
Logs are in the reviewer's scratch directory.

```
$ git fetch origin claude/mobily-transformation-hub && git merge origin/claude/mobily-transformation-hub
Already up to date.                                   # HEAD = 40fac200ca39476fa92d2a98ded8705e60bef490
$ pg_isready -h 127.0.0.1 -p 5432                     # 127.0.0.1:5432 - accepting connections (already running)
$ HUB_DATABASES="hub_test_p4dom hub_test_p4dom_boot" bash scripts/dev/pg-init-roles.sh
roles hub_owner/hub_app and databases ready: hub_test_p4dom hub_test_p4dom_boot
$ pnpm install --frozen-lockfile                      # exit 0
$ pnpm build:packages                                 # exit 0
```

### 1.1 Unit and integration tests at `40fac20` (before the probes)

```
$ pnpm --filter @hub/domain test
 Test Files  17 passed (17)
      Tests  357 passed (357)

$ TEST_DATABASE_URL=postgres://hub_app:hub_dev_only@127.0.0.1:5432/hub_test_p4dom \
  TEST_DATABASE_MIGRATION_URL=postgres://hub_owner:hub_dev_only@127.0.0.1:5432/hub_test_p4dom \
  pnpm --filter @hub/api test
 Test Files  82 passed (82)
      Tests  730 passed | 3 expected fail (733)        # the 3 expected fails are pre-existing P2 QA probes
   Duration  771.60s                                   # exit 0

# P4 subset, verbose (own database hub_test_p4dom_probe):
$ npx vitest run test/jv test/finance test/gates/at-12-gate-side.spec.ts test/gates/at-13-non-waivable.spec.ts \
    test/gates/gate-evaluation-rules.spec.ts test/documents/at-03-documents-isolation.spec.ts \
    test/documents/clean-team-room.spec.ts --reporter=verbose
 Test Files  18 passed (18)
      Tests  139 passed (139)

# Domain rules of P4, verbose:
$ (packages/domain) npx vitest run src/jv.test.ts src/finance.test.ts src/rules.test.ts --reporter=verbose
 Test Files  3 passed (3)
      Tests  107 passed (107)

$ pnpm --filter @hub/api run typecheck                # tsc -p tsconfig.json --noEmit (src + test, incl. the probes): exit 0
$ python3 scripts/requirements/apply_status.py --check
status-evidence.yaml OK (263 entries)
```

### 1.2 Defect probes (added by this review)

The probes assert the REQUIRED behaviour. They are declared with `it.fails` (the suite stays green while the defect is
open; a fixed defect makes its probe fail, and the probe is then turned into a plain `it`). `P4_PROBE_PLAIN=1` runs them as
plain tests so the failing assertion is visible. Setup runs in plain `it` steps; the probe bodies use no throwing helper.

```
$ P4_PROBE_PLAIN=1 TEST_DATABASE_URL=…/hub_test_p4dom_probe TEST_DATABASE_MIGRATION_URL=…/hub_test_p4dom_probe \
  npx vitest run test/reviews/p4-domain-jv.spec.ts test/reviews/p4-domain-finance.spec.ts
 × DEFECT DOM-P4-01 … AssertionError: closing #2 confirmed on the decision already used by closing #1 (request 201):
     expected 'confirmed' not to be 'confirmed'
 × DEFECT DOM-P4-02 … AssertionError: signing recorded while G5 is not passed (request 201):
     expected 'confirmed' not to be 'confirmed'
 × DEFECT DOM-P4-03 … AssertionError: CP no longer blocks the closing after the functional approver's determination
     (status 201): expected [] to include 'CP-001'
 × DEFECT DOM-P4-04 … AssertionError: the lapsed CP stopped blocking after a PATCH of validTo by the CP manager
     (status 200): expected [] to include 'CP-002'
 × DEFECT DOM-P4-05 … AssertionError: the release disclosed the evidence version uploaded after the review approval:
     expected [ Array(1) ] to not include '01a0f2e2-…'
 × DEFECT DOM-P4-06 … AssertionError: v2 (EV 900 SAR m) recorded as approved on the decision that approved v1
     (EV 500 SAR m) — status 201: expected [ { key: 'ev', …(8) } ] to be null
 × DEFECT DOM-P4-07 … AssertionError: line B approved 100 000 SAR on a 100 000 SAR decision already fully recorded on
     line A (status 201): expected { amount: '100000.0000', …(2) } to be null
 × DEFECT DOM-P4-08 … AssertionError: closing confirmed on an external approval whose evidence was rejected
     (request 201): expected 'confirmed' not to be 'confirmed'
 Test Files  2 failed (2)
      Tests  8 failed | 8 passed (16)                 # 8 reproductions fail as expected; all 8 setup steps pass

$ (same, default mode — it.fails)                    # first run, before DOM-P4-08 was added:
 Test Files  2 passed (2)
      Tests  7 passed | 7 expected fail (14)
```

The full API suite with both probe files is recorded in §1.4.

### 1.3 End-to-end (P4 Playwright specs, local stack configured like the CI e2e job)

```
$ HUB_DATABASES=hub_test_p4dom_e2e bash scripts/dev/pg-init-roles.sh
$ DATABASE_URL=…/hub_test_p4dom_e2e DATABASE_MIGRATION_URL=…/hub_test_p4dom_e2e HUB_MODE=demo NODE_ENV=development \
  node deploy/docker/api-entrypoint.cjs migrate            # exit 0
$ … node apps/api/dist/cli/seed-demo.js                     # exit 0, "demo seed complete"
$ env -u NODE_ENV HUB_API_URL=http://127.0.0.1:4410 pnpm --filter @hub/web run build     # exit 0
$ PORT=4410 HUB_RATE_LIMIT_PUBLIC_PER_MINUTE=1000 … node apps/api/dist/main.js    # readyz {"status":"ready"}
$ … node apps/api/dist/worker.js
$ (apps/web) env -u NODE_ENV next start -p 3410                                     # /login → 200
$ (e2e) HUB_WEB_URL=http://127.0.0.1:3410 PLAYWRIGHT_BROWSERS_PATH=/opt/pw-browsers \
  npx playwright test tests/p4-finance.spec.ts tests/p4-jv.spec.ts --reporter=list
  ✓ p4-finance AT-29 / REQ-DAT-004: a mixed-currency total is refused without a conversion basis; …
  ✓ p4-finance REQ-FIN-010: validated by a second person, approved by a third; …
  ✓ p4-finance REQ-UX-013: a user without finance access sees the restricted-access state; …
  ✓ p4-finance Finance & Value screens in en / ar / 390 px with the Demo badge on seeded records
  ✓ p4-finance REQ-FIN-005..007: each valuation output states its basis; … approved values stay empty; …
  ✓ p4-finance REQ-FIN-008: model outputs imported as figures keep their source document, sheet and cell
  ✓ p4-finance SEC-P1R-03 (P3 follow-up): a legal entity linked from its owning project is read-only …
  ✓ p4-jv AT-11: partner preparation and DD proceed before G3; stages are never skipped
  ✓ p4-jv AT-12: closing blocked — the message names the unmet CPs and the confirmation is refused
  ✓ p4-jv AT-13: a non-waivable CP offers no waiver in the UI; a bypassing request is refused and logged
  ✓ p4-jv AT-03: the partner-A user sees only its own room; partner B's room and internal views stay restricted
  11 passed (3.1m)
$ kill 20589 20597 20706        # the API, worker and web started by this review (checked by cwd/environ); ports closed
$ git checkout -- e2e/screenshots/p4/   # the run regenerated the tracked P4 screenshots; restored, not committed
```

### 1.4 Full API suite with the probes

```
# Run 1 (both probe files present; own database hub_test_p4dom)
$ TEST_DATABASE_URL=…/hub_test_p4dom TEST_DATABASE_MIGRATION_URL=…/hub_test_p4dom pnpm --filter @hub/api test
 FAIL  test/reviews/p2-qa-adversarial.spec.ts > QA-P2 adversarial — agenda numbering under concurrency [REQ-GOV-013]
       > three agenda requests accepted onto the same meeting at the same instant get distinct numbers
       Error: Expect test to fail
 Test Files  1 failed | 83 passed (84)
      Tests  1 failed | 738 passed | 10 expected fail (749)     # 10 = the 8 P4 probes + 2 of the 3 P2 QA probes
   Duration  1005.09s                                           # exit 1

# The failing item is a pre-existing P2 QA concurrency probe (it.fails) whose race did not occur in that run. Alone:
$ npx vitest run test/reviews/p2-qa-adversarial.spec.ts     (hub_test_p4dom_probe)
 Test Files  1 passed (1)
      Tests  9 passed | 3 expected fail (12)                     # exit 0 — the race reproduced again
```

```
# Run 2 (same command, same revision, both probe files present)
$ TEST_DATABASE_URL=…/hub_test_p4dom TEST_DATABASE_MIGRATION_URL=…/hub_test_p4dom pnpm --filter @hub/api test
 Test Files  84 passed (84)
      Tests  738 passed | 11 expected fail (749)     # 11 = the 8 P4 probes + the 3 P2 QA probes
   Duration  919.83s                                 # exit 0
```

Observation (outside P4 scope, for the P2 QA owner): the agenda-numbering probe in `p2-qa-adversarial.spec.ts` is
timing-dependent — it failed as expected in the baseline run (§1.1) and in isolation, but not in run 1. A concurrency
probe should force the interleaving (for example with an advisory lock held by the test) so that the suite result does not
depend on scheduling. All eight P4 probes behaved as expected in both full runs and in isolation.

---

## 2. Rules checked against the specification (summary)

| Rule (assignment checklist) | Verdict | Evidence |
|---|---|---|
| Partner stages can never be skipped; outreach and NDA are separate approvals | Holds | `PARTNER_MACHINE` has only direct forward moves (`workflows.ts:229-244`); approval stages only through their commands (`assertPartnerStageGuards`); no create/PATCH path sets a stage (`CreatePartnerBody`, `UpdatePartnerBody`). Tests: at-11 "REQ-JV-003: the stage machine rejects skipped stages …", D jv.test "follows the ordered stages …", e2e AT-11. Doc variance: Low DOM-P4-17. |
| Partner preparation and DD run in parallel with G3/G4 (G5 needs only G1) | Holds | Template G5 prerequisites G0/G1 only; gate-evaluation-rules "G5 … depends only on G1"; at-11 (2 tests); e2e AT-11. |
| Signing / closing have their own dependencies | **Does not hold** for signing | DOM-P4-02: a signing is recorded while G5 has not passed. |
| An NDA alone grants no access | Holds | `assertRoomGrantAllowed` needs stage ≥ `materials_access` AND an explicit grant by another person; at-03 "IT: partner with an executed NDA but no grant cannot list room documents", "a grant is refused while the partner is only at NDA". Low DOM-P4-15 on how the stage is recorded. |
| Clean-team and room isolation | Holds (as tested) | at-03-partner-room-isolation (12 tests), documents clean-team-room (3), at-03-documents-isolation (12), finance-isolation (10), e2e AT-03. |
| DD answers released only after review by another person | Holds for the answer text; **not for its evidence** | Release needs `approved_for_release`, reviewer ≠ drafter, releaser ≠ drafter (jv-diligence test). DOM-P4-05: the evidence document version disclosed is the one current at release, not the one reviewed. |
| A non-waivable CP can never be waived; waivable CPs need the designated authority | Waiver path holds; **blocking status does not** | Waiver register refuses non-waivable CPs and approvals outside `waiverAuthorityRole` (at-13-cp-non-waivable, 5 tests). DOM-P4-03: a functional approver alone turns a non-waivable blocking CP into a non-blocking one and the closing unblocks. |
| Closing blocked by unmet / unverified CPs; confirmation needs a FINAL decision of the authorized body | Holds for the CP set at confirm time; **decision binding does not** | `eventBlockers` re-evaluated inside the confirm transaction (at-12, 5 tests; e2e AT-12). DOM-P4-01 (decision reused for another closing), DOM-P4-04 (validity edited away), DOM-P4-08 (external approval whose evidence was later rejected). |
| Funds flow is record-only | Holds | No pay/execute route (jv-closing-rules "no payment endpoint exists"); `FUNDS_FLOW_MACHINE` = confirm / report_settled (with external reference) / cancel. Low DOM-P4-14 (one person does all steps). |
| Money has currency and unit; no mixed totals without a conversion basis | Holds | `sumMoney` / `aggregateFigures` (explicit basis with source and date; explicit unit normalization, disclosed; kinds never mixed); summary and cost view grouped per currency/unit. at-29 (12 tests), D finance.test (8), e2e AT-29. |
| Validation and approval by separate people | Holds | `assertFigureValidatable` / `assertFigureApprovable` (preparer ≠ validator ≠ approver; approval bound to the validated content hash); finance-figures (13 tests); e2e REQ-FIN-010. |
| Valuation outputs state their basis; approved values never defaulted | Holds; **but approval is not bound to its decision** | `basis` required per output, `headlineBasis` required for valuations; `approvedValues` null until `approveValues` with a FINAL `valuation_and_ownership_terms` decision. DOM-P4-06: the same decision approves different values of a later version. |
| No double counting of TSA charges | Holds | One budget line per TSA (unique index `budget_line_tsa_uq`), one category per line reference, `separationCostView` counts each TSA once (finance-registers, D finance.test). |
| Benefits verified independently | Holds | verifier ≠ owner ≠ reporter, human only, verification source required (finance-registers 3 tests). Low DOM-P4-12 (definition/target editable after acceptance). |
| KPI observations append-only | Holds | Insert-only service; trigger `hub_append_only` + `REVOKE UPDATE, DELETE ON kpi_observation FROM hub_app` (`packages/db/sql/post-migrate.sql:1005-1012`); finance-registers "observations are append-only". |
| Finance-domain clearance applied | Holds | `FinanceSupport.fx()` on every list (`visibleSql`), read (`canRead`) and command (`assert`, `assertGranted`); finance-isolation "finance_restricted reads … strictly_confidential; the chair … sees snapshots but not the valuation"; e2e REQ-UX-013. |
| Budget approvals within the decided amount | **Does not hold** | DOM-P4-07: one decision's amount is recorded in full on several lines. |
| Nothing invented (partners, %, amounts, dates, legal determinations); % TBD and Proposed; demo synthetic and labelled | Holds | Seeds: two partners "Demo Partner Alpha/Beta (fictional)", scenario percentages `null` ("TBD — to be negotiated"), funds flow "amount TBD", models without versions or values, CP titles "applicability to be confirmed"; `blankOwnership`; web: scenario callout "proposed", TBD markers, proposed vs approved value panels; jv-demo-seed / finance-demo-seed tests; e2e Demo badge. Low DOM-P4-17 on "100-day" in G7-C02. |

---

## 3. Findings

Severity follows the phase-gate rule (no PASS with an open Critical or High). Every High and Medium finding except
DOM-P4-09 has an executed probe (§1.2). Requirement IDs refer to `docs/requirements/requirements.yaml`.

### DOM-P4-01 — High — One closing-confirmation decision confirms several closings

- **Where:** `apps/api/src/modules/jv/transactions.service.ts:369-398` (`requestConfirmation` checks type and that the
  decision is not rejected/superseded) and `:405-450` (`confirm` → `assertEventConfirmable`, `packages/domain/src/jv.ts:535-554`,
  checks the decision is FINAL and of type `jv_closing_confirmation`). Nothing checks that the decision has not already
  confirmed another event, nor that it was raised for this closing.
- **Reproduction:** probe `DEFECT DOM-P4-01` (`apps/api/test/reviews/p4-domain-jv.spec.ts`): signing confirmed; closing #1
  confirmed by the sponsor on FINAL decision D; closing #2 of the same signing is made ready, the PM requests confirmation
  with the same D (201) and the sponsor confirms (closing #2 `confirmed`).
- **Spec / platform rule:** §3 "support multiple closings", §8 "Closing requires authorized confirmation"; G6 purpose
  "each closing is confirmed separately"; G6-C06 "Authorized closing confirmation recorded by the authorized body **for this
  closing**"; the P2 fixes (gates `gates.decide.decision_reused`, change control and TSA `decision_already_used`): a decision
  backs one approval only.
- **Requirements / AT:** REQ-JV-017, REQ-JV-018, REQ-LCY-009; AT-12. The same gap applies to signings (one
  `jv_signing_authorization` decision can record several signings).
- **Impact:** a closing (and its funds flow, CP set and effectiveness) is confirmed without any decision of the authorized
  body about it. The `jv_transaction` dimension then reports `closed`.
- **Recommendation:** bind each confirmation decision to one event (unique `closing.confirmation_decision_id` among
  confirmed events, or a decision subject reference checked at request and at confirm); refuse reuse with a dedicated code
  and audit the refusal.

### DOM-P4-02 — High — A signing is recorded while gate G5 (JV Signing Readiness) has not passed

- **Where:** `transactions.service.ts:369-450` (request / confirm of a signing check blockers = signing checklist items and a
  FINAL `jv_signing_authorization` decision; no gate check); partner stage `signing` has no guard
  (`packages/domain/src/workflows.ts:237`, `jv.ts:150-163`).
- **Reproduction:** probe `DEFECT DOM-P4-02`: G5 current assessment not approved (asserted in setup); a signing is made
  ready; a FINAL `jv_signing_authorization` decision raised **for G5** (gate key G5, external approval with verified
  evidence) is linked; the PM requests confirmation (201) and the sponsor records the signing (`confirmed`). The existing
  AT-12 / AT-11 fixtures do the same (they record signings with no G5 cycle at all).
- **Spec / platform rule:** §3 "enforceable gates … Validate evidence, approvals, and mandatory criteria on the server";
  G5 purpose "Establish readiness to sign"; business-gates.md §8 rule 5 "`signing` needs a recorded signing (**after G5**)";
  authority-matrix.md assigns `jv_signing_authorization` to G5 (`gateKeys`), i.e. the decision is meant to back the gate,
  not to replace its criteria (DD complete G5-C03, valuation approved G5-C04, negotiation issues closed G5-C05, signing
  package G5-C08, …).
- **Requirements / AT:** REQ-LCY-009 ("separate signing/closing and their dependencies"), REQ-LCY-004; AT-11.
- **Impact:** the signing-readiness gate is decorative for the act it governs: a signing can be recorded with diligence,
  valuation, negotiation issues or the signing package unassessed, and the `jv_transaction` dimension shows `signed`.
- **Recommendation:** refuse the signing request / record unless the current G5 assessment is approved (and not flagged for
  reassessment), and require the linked decision to be the one that approved that G5 cycle (or record the link). Keep
  partner preparation free of this dependency (AT-11).

### DOM-P4-03 — High — A non-legal approver makes a non-waivable blocking CP non-blocking; the closing unblocks

- **Where:** `transactions.service.ts:639-656` (`determineWaivability` sets `blocking`, `waivable`, `waiverAuthorityRole`
  with permission `gates.criterion.set_waivability`, held by `functional_approver`, `finance_restricted` and
  `legal_restricted` in `packages/domain/src/policy/policy-matrix.json`); `jv.ts:519` (`eventBlockers` skips every
  non-blocking CP).
- **Reproduction:** probe `DEFECT DOM-P4-03`: Legal creates a blocking CP (non-waivable by default) on closing #3; the
  closing blockers name it. The `approver` persona (only `functional_approver`) posts `determine-waivability`
  `{blocking: false, waivable: false, basis: …}` → 201, and the closing has no blocker left for that CP.
- **Spec / platform rule:** §3 "An exception cannot override a non-waivable condition. Authorized specialists determine
  waivability"; business-gates.md §7 "Waivability and authority — Set only by authorized **legal** specialists per the
  agreement"; AT-13 "the condition remains unmet" (here it stays unmet but no longer blocks). Compare DOM-P2-15: gate
  criteria determinations are bound to the designated specialist, and not-applicable needs a second person.
- **Requirements / AT:** REQ-JV-013, REQ-JV-018; AT-12, AT-13.
- **Impact:** one person outside Legal removes a non-waivable closing condition without the waiver register, without a
  second person, and the closing becomes confirmable. The confirmation snapshot records `blocking: false`, but no blocker
  is shown to the confirmer.
- **Recommendation (for the owning function to confirm):** restrict CP determinations to Legal (the designated specialist);
  treat a change of `blocking` from true to false as a controlled determination reviewed by a second person (like
  not-applicable for gate criteria), and never allow it on a non-waivable CP outside the waiver process.

### DOM-P4-06 — High — The decision that approved valuation v1 records different values of v2 as approved

- **Where:** `apps/api/src/modules/finance/models.service.ts:412-447` (`approveValues`: FINAL decision of type
  `valuation_and_ownership_terms`, separation of duties, validated content hash; no check that the decision is not already
  used, nor that it concerns this version's values). `approvedValues: v.outputs` (`:430`).
- **Reproduction:** probe `DEFECT DOM-P4-06` (`apps/api/test/reviews/p4-domain-finance.spec.ts`): v1 (EV 500 SAR m) validated
  and approved on decision V; v2 (EV 900 SAR m) created and validated; Legal records v2's values as approved with the same
  V → 201, `approvedValues` = v2's outputs.
- **Spec / platform rule:** §7.5 "Separate proposed from approved valuation/ownership values"; G5-C04 "Business plan and
  valuation approved"; the P2 rule that a decision backs one approval only.
- **Requirements / AT:** REQ-FIN-006, REQ-FIN-010; (feeds G5-C04 and AT-28 later).
- **Impact:** "approved" valuation or ownership values that the authorized body never approved are shown and exported as
  approved (and could feed signing readiness).
- **Recommendation:** one decision approves one version (or record the approved content hash in the decision / approval
  and refuse any other content); refuse reuse with a dedicated code.

### DOM-P4-07 — High — Approvals recorded from one budget decision exceed its amount in total

- **Where:** `apps/api/src/modules/finance/budget.service.ts:259-300` (`recordApproval`): the amount is compared with the
  decision's amount per line only (`:268-277`); reuse is refused only on the same line (`:278`). By code reading, a decision
  whose paper states no amount (`d.amountAmount === null`) sets no upper bound at all (not probed).
- **Reproduction:** probe `DEFECT DOM-P4-07`: FINAL `change_request_budget` decision B (paper amount 100 000 SAR,
  synthetic); line A records 100 000 SAR on B (201); line B records 100 000 SAR on the same B → 201, approved 100 000 SAR.
  Total approved from B: 200 000 SAR.
- **Spec / platform rule:** §4 delegated authority (decisions within approved limits), §7.5 approved vs committed vs spent;
  budget.service's own contract "within the decision's amount"; the P2 QA probe on one decision backing two change requests
  (same principle).
- **Requirements / AT:** REQ-FIN-003; AT-04 principle (authority limits).
- **Impact:** the approved budget can be multiplied from one decision; commitments then look covered by approvals that do
  not exist.
- **Recommendation:** keep the sum of approved amounts recorded from one decision within its amount (same currency and unit)
  — or one decision per line — and refuse a decision without an amount for these types (as change control does with
  `decision_amount_missing`).

### DOM-P4-04 — Medium — CP validity and long-stop dates can be moved without an approved extension or re-verification

- **Where:** `transactions.service.ts:627-637` (`updateCp`: `validTo`, `longStopDate` editable — and nullable — by
  `jv.cp.manage`, any state while the event is open); no job raises the long-stop escalation or moves a CP to `lapsed`
  (`apps/api/src/modules/jv/jv.jobs.ts` registers only the obligation scan; `mark_lapsed` is filtered out of the
  allowed commands, `transactions.service.ts:167`).
- **Reproduction:** probe `DEFECT DOM-P4-04`: a blocking CP with `validTo` = yesterday is verified with evidence; closing
  #3 shows `jv.closing.cp_validity_lapsed`; the PM patches `validTo` to +30 days (200) and the blocker disappears while the
  CP stays `verified` without any new verification.
- **Spec / platform rule:** §8 "Each CP: … validity, long-stop date, and verified state"; business-gates.md §7
  "Validity — an expired approval re-opens the CP"; "Long-stop date — approaching it without evidence raises an escalation;
  passing it without an approved extension makes the CP `lapsed` and blocks closing"; G6-C03.
- **Requirements / AT:** REQ-JV-013, REQ-JV-018.
- **Impact:** a closing can be confirmed on an expired approval, or past a long-stop date, by one CP manager's edit (audited,
  but not approved).
- **Recommendation:** changing `validTo` of a verified/waived CP returns it for verification; moving or clearing a passed
  long-stop date needs an approved extension (decision link); add the long-stop escalation job and the `lapsed` transition.

### DOM-P4-05 — Medium — A DD answer's evidence is disclosed in a version the reviewer never saw

- **Where:** `apps/api/src/modules/jv/diligence.service.ts:212` (the draft stores evidence **document** ids, not version ids)
  and `:274` (release discloses `d.currentVersionId` at release time).
- **Reproduction:** probe `DEFECT DOM-P4-05`: an answer with evidence document v1 is reviewed and approved for release by
  Legal; the PM then uploads v2 of the evidence document; Legal releases → the room disclosure is v2.
- **Spec / platform rule:** §8 DD Q&A "answer draft, reviewer, release approval, **disclosed version**"; REQ-JV-010 "release
  requires approval by a role other than the drafter".
- **Impact:** content that no reviewer approved is disclosed to a counterparty. The disclosed version is recorded, so it is
  traceable, but not controlled.
- **Recommendation:** pin evidence version ids at draft / submit, show them to the reviewer, and disclose exactly those; a
  newer version invalidates the review (back to draft or review).

### DOM-P4-08 — Medium — Signing/closing, valuation and budget approvals still count an external approval whose evidence was rejected

- **Where:** `packages/domain/src/jv.ts:328-334` (`decisionIsFinalApproval`: a `pending_external_authority` decision counts
  when `externalAuthorityReference` is non-empty); `apps/api/src/modules/jv/jv.support.ts:271-273`; the finance module uses
  `linkedDecisionIssue` with the same inputs. The evidence link recorded by DOM-P2-12 (`decision.external_evidence_link_id`)
  is never re-read; `documents` allows rejecting a verified link later (`evidence.service.ts:246-283`) and no module reacts
  to that for decisions (no `evidence.changed` consumer in governance).
- **Reproduction:** probe `DEFECT DOM-P4-08`: decision E (`jv_closing_confirmation`) approved by the authorized body on a
  verified evidence link; Legal then rejects that link as defective (201, `rejected`); decision E stays `approved`; closing
  #4 is requested (201) and confirmed on E.
- **Spec / platform rule:** §3 "If approved evidence is found defective, reopen the assessment through a controlled
  process"; DOM-P2-12 (external approvals rest on verified evidence) — satisfied only at recording time.
- **Requirements / AT:** REQ-JV-017, REQ-JV-018, REQ-FIN-006; AT-04, AT-14 principle.
- **Recommendation:** evaluate the external evidence link (active and verified) wherever a decision's finality is used, or
  flag the decision for controlled reassessment when that link is rejected or superseded (owner: governance with JV and
  finance consumers).

### DOM-P4-09 — Medium — The demo sandbox still has no TSA issue scenario (REQ-SET-004)

- **Where:** `apps/api/src/modules/readiness/readiness.seed.ts:26,104-124` (one TSA "in negotiation", dates/charges and
  replacement "to be confirmed").
- **Spec:** §21 "scenarios containing a blocked CP, **TSA issue**, and decision outside authority". The disposition marked
  this "Close before P4 gate" (F-09); it is still open at `40fac20` (status `Implemented`, same gap text).
- **Requirements / AT:** REQ-SET-004 (AT-10 through the demo). The blocked CP and the out-of-authority decision exist
  (jv-demo-seed, governance-integrity).
- **Recommendation:** add a synthetic, labelled TSA in `expired_unresolved` or `breached` state (or with a reported
  replacement failure) through the readiness services, with a test.

### DOM-P4-10 — Low — The `jv_transaction` dimension differs from the documented model

- `packages/domain/src/carveout.ts:156-166` computes `not_started / preparing / signed / partially_closed / closed`;
  business-gates.md §1 documents `not_started → partner_preparation → diligence_and_negotiation → signing_ready → signed →
  closing_conditions_in_progress → partially_closed → closed; or terminated`. Aborted closings are counted
  (`status-dimensions.service.ts:119`), so one confirmed and one aborted closing stay `partially_closed` forever; there is no
  `terminated`; partner preparation and DD in progress show `not_started`. Align code or document (REQ-LCY-007/009).

### DOM-P4-11 — Low — Program closure ignores a G7 approval flagged for reassessment

- `apps/api/src/modules/jv/postclose.service.ts:247-256` + `assertG7Passed` (`jv.ts:605-609`) accept any current G7 in
  `approved`/`approved_with_exceptions`, even when its evaluation carries `needsReassessment` (DOM-P2-05). The G4 standalone
  dimension already excludes a flagged approval (`status-dimensions.service.ts:138`). REQ-JV-019.

### DOM-P4-12 — Low — A benefit's definition, baseline and target can change after independent acceptance

- `apps/api/src/modules/finance/benefits.service.ts:158-195`: while `approved`, `tracking` or `realized_unverified`,
  `measurementDefinition`, `baselineValue`, `targetValue`, `unit` and the value remain editable by `finance.benefit.manage`
  (PM or Finance) without re-acceptance; only `verificationSource` and owner are frozen while a realization awaits
  verification. Changes are versioned and audited. REQ-FIN-009, G7-C04 ("baselined"). Recommendation: a change of
  definition/baseline/target returns the benefit to `proposed` (or needs a fresh acceptance).

### DOM-P4-13 — Low — Negotiation issues accept any final decision, and the same decision for several issues

- `apps/api/src/modules/jv/deals.service.ts:328-332` → `assertNegotiationAgreementAllowed` (`jv.ts:337-343`) calls
  `decisionIsFinalApproval` without a type list; the existing test links a `partner_outreach_and_access` decision to an
  issue. REQ-JV-008 ("required approval"), G5-C05.

### DOM-P4-14 — Low — Single-person steps in the closing checklist and the funds flow

- `transactions.service.ts:520-527`: a checklist item (e.g. an executed document) is set `not_required` by any
  `jv.closing_checklist.manage` holder with a reason; `eventBlockers` then treats it as satisfied. The confirmer sees it in
  the detail and the snapshot, but no specialist determination or second person is required (compare not-applicable for gate
  criteria). `transactions.service.ts:767-781`: one Finance user can create, confirm and report a funds-flow line settled
  (G6-C05 "approved by Finance"). Record-only is respected.

### DOM-P4-15 — Low — "Materials access approved by" is recorded without an approval

- `apps/api/src/modules/jv/partners.service.ts:350-364` (`advance` to `materials_access` stores
  `materialsAccessApprovedBy = caller`) — any `jv.partner.advance_stage` holder (PM, Legal), including the person who
  requested the outreach and submitted the NDA (the test kit `partnerAt` does exactly this), with no authority check against
  `partner_outreach_and_access`. Actual document access still needs a two-person room grant, so REQ-JV-005 holds. REQ-JV-003
  security rule "Stage transitions require the authorization of the target stage". Either add an approval step or rename
  the field to what it is (stage moved by).

### DOM-P4-16 — Low — Reconciliation review separation checks only the last preparer

- `packages/domain/src/finance.ts:486-495` + `reconciliations.service.ts:223,233-237`: `preparedBy` is replaced by the last
  editor; the creator of the balance can review it after another person edits the explanation. Snapshots exclude both
  `createdBy` and `preparedBy` (`finance.ts:145,165`). REQ-FIN-004.

### DOM-P4-17 — Low — Documentation and evidence text out of date or ahead of the source

- business-gates.md §8 rule 4 ("skipping requires a recorded reason and the approvals of the skipped stage") and rule 5
  (`closing` stage "needs at least one authorized closing confirmation") differ from the implementation (skipping is never
  allowed — stricter; the `closing` stage needs a confirmed **signing**). Align the document.
- G7-C02 "**100-day** post-close plan" states a duration the specification does not give (§3: "post-close plan"); mark it
  Proposed / to be confirmed.
- `docs/requirements/status-evidence.yaml`: REQ-FIN-001 and REQ-JV-001 still say "backend only: the … screen is in
  progress"; REQ-PHS-006 says "web screens in progress"; the disposition §7 still lists AT-11 / AT-12 / AT-29 "screen
  Planned" and REQ-LCY-004 "P4 domain review not run". The P4 screens are merged and their specs pass (§1.3).

---

## 4. Acceptance tests mapped to P4

| AT | P4 requirements | Result at `40fac20` | Evidence (executed in this review) |
|---|---|---|---|
| AT-03 isolation (partner rooms, clean team, finance) | ENT-012, JV-001, SET-002 | **PASS** | at-03-partner-room-isolation (12), clean-team-room (3), at-03-documents-isolation (12), finance-isolation (10); e2e p4-jv AT-03 |
| AT-04 decision outside delegation (demo scenario) | SET-004 | **PASS** (demo scenario) | governance-integrity (full suite); jv-demo-seed; not a P4 rule change |
| AT-10 TSA expiry (demo scenario) | SET-004 | **FAIL (gap)** — no TSA issue scenario in the demo (DOM-P4-09); the AT-10 rule itself is P3 and tested there | readiness-demo-seed (full suite) |
| AT-11 partner preparation in parallel; signing ≠ closing and their dependencies | LCY-008, LCY-009, JV-003, JV-012, UX-014, PHS-006 | **FAIL (partial)** — parallel preparation and signing ≠ closing hold; the signing's own dependency on G5 is not enforced (DOM-P4-02) | at-11 (6), gate-evaluation-rules "G5 … depends only on G1"; e2e p4-jv AT-11; probe DOM-P4-02 |
| AT-12 all green but a mandatory CP lacks evidence | JV-013, JV-017, JV-018, UX-014, PHS-006, SET-004 | **PASS** for the scenario as stated (closing blocked, re-evaluated at confirm, AI cannot confirm/verify/waive); human bypass paths are listed under AT-13 and DOM-P4-01/04/08 | at-12-closing-blocked-cp (5), at-12-gate-side (2), jv-demo-seed; e2e p4-jv AT-12 |
| AT-13 non-waivable condition or unauthorized waiver | JV-018, PHS-006 | **FAIL** — waiver requests on non-waivable CPs and approvals outside the authority are refused and logged (pass), but a non-legal approver removes the blocking status of a non-waivable CP and the closing unblocks (DOM-P4-03) | at-13-cp-non-waivable (5), gates at-13-non-waivable (9); e2e p4-jv AT-13; probe DOM-P4-03 |
| AT-19 revoked access (JV side) | JV-009 | **PASS** | at-03 "download → revoke → 404, and the access/disclosure history keeps every event" |
| AT-29 currencies / units | FIN-007, UX-013, DAT-004, PHS-006 | **PASS** | at-29-currency-unit-aggregation (12), D finance.test (8); e2e p4-finance AT-29 |

---

## 5. Disposition check (P4 part of `docs/phases/P2-P4-requirement-disposition.md` and its updates)

Current register at `40fac20` (checked with `apply_status.py --check`, OK): 39 P4 requirements, 37 `Tested`, 2
`Implemented` (REQ-PHS-006, REQ-SET-004). The update after the disposition moved REQ-UX-013 / REQ-UX-014 to `Tested` with
e2e evidence; this review re-ran those specs on a local stack (11/11 passed, §1.3), so the web evidence is confirmed.

Statuses this review does **not** accept as `Tested` at `40fac20` (recommend `Implemented` until the finding is fixed and
its probe turned into a plain test):

| Requirement | Recorded | Recommended | Reason |
|---|---|---|---|
| REQ-JV-013 CP attributes and verification | Tested | Implemented | blocking status and waivability set by non-legal roles alone (DOM-P4-03); validity / long-stop edited without extension or re-verification (DOM-P4-04) |
| REQ-JV-017 task completion does not close; authorized confirmation | Tested | Implemented | a closing is confirmed without its own authorized decision (DOM-P4-01, DOM-P4-08) |
| REQ-JV-018 missing mandatory CP blocks closing | Tested | Implemented | the block is removable by one non-legal approver (DOM-P4-03) or by editing the validity date (DOM-P4-04) |
| REQ-LCY-009 signing separate from closing; multiple closings | Tested | Implemented | signing has no dependency on G5 (DOM-P4-02); multiple closings share one decision (DOM-P4-01) |
| REQ-JV-010 DD Q&A release after review | Tested | Implemented | disclosed evidence version ≠ reviewed version (DOM-P4-05) |
| REQ-FIN-006 proposed vs approved valuation / ownership | Tested | Implemented | approved values recorded from a decision about other values (DOM-P4-06) |
| REQ-FIN-003 committed vs spent (approved budget from a decision) | Tested | Implemented | approved amounts exceed the decision's amount (DOM-P4-07) |

Other checks:

- **REQ-LCY-004 (G5–G7 content vs spec §3)** — checked by this review against the template
  (`dc-carveout.v1.json`): G5 covers valuation, diligence and material findings, negotiated terms, approval matrix and
  signing package (C01–C09); G6 covers CPs, required approvals, closing documents/deliverables and authorized closing
  confirmation (C01–C07, plus funds flow record-only); G7 covers conditions subsequent, post-close plan,
  performance/benefits, TSA exit, handover acceptance and administrative closure (C01–C08). Prerequisites G5←G1, G6←G5,
  G7←G4+G6 match A-16. Every criterion is `applicability: proposed`; the only waivable one (G5-C01) records its authority as
  "Proposed — to be confirmed by Corporate Development specialist". One wording issue (DOM-P4-17, "100-day"). The
  "inspection only" caveat in the evidence can be replaced by a reference to this review.
- **REQ-SET-004** stays `Implemented` (DOM-P4-09 still open; the disposition asked to close it before the P4 gate).
- **REQ-PHS-006** stays `Implemented`: it closes with the P4 gate report, which needs the fixes above and the P4 security
  and QA reviews.
- Stale evidence wording (DOM-P4-17) should be refreshed at the next `apply_status.py` run.

---

## 6. Verified as correct (non-exhaustive)

- Partner stage machine, outreach approval (requester ≠ approver, conflicted person excluded, authority matrix coverage,
  approval bound to the partner version) and NDA recording by Legal (not the submitter), with the executed copy.
- NDA ≠ access: room grants only by another person, only at `materials_access` or later, external accounts bound to one
  counterparty, 90-day maximum external grant (proposed default), clean-team grants only by Legal with the clean_team role
  and an attestation; withdrawal and unbinding revoke external grants and keep the history.
- CP verification: evidence required, verifier ≠ owner ≠ evidence submitter, human only, refusals audited; CP set
  re-evaluated inside the confirm transaction; a CP added after readiness blocks; evidence withdrawn after verification
  blocks; waivers only for waivable CPs by the designated authority holding `jv.cp.waive`, never the requester.
- Closing needs its own confirmed signing; confirmation needs a pending request by another person and a FINAL decision of
  type `jv_closing_confirmation`; the readiness snapshot is stored; completing tasks changes nothing.
- Funds flow is record-only (no route or command executes, initiates or instructs a payment); settlement is reported with an
  external reference.
- Program closure requires G7 approved and a second person (Low DOM-P4-11 aside).
- Finance: every figure has period, currency, unit scale and source; imports keep document, sheet and cell; three-person
  validate / approve bound to the content hash; opening balances need a FINAL `opening_balance_sheet` decision; approved
  valuation values empty until a FINAL `valuation_and_ownership_terms` decision; business-plan approval refused as "not
  configured" (no approval invented); EV/equity, currency and unit confusion flagged and never compared; aggregates need an
  explicit, disclosed basis; TSA charges counted once; KPI observations append-only in the database; finance-domain
  clearance applied in SQL.
- Demo data: two fictional, labelled partners; scenario percentages null; amounts TBD; no approval, valuation, ownership
  percentage or partner identity invented (jv-demo-seed, finance-demo-seed; e2e Demo badge).

---

## 7. Verdict

**FAIL** at `40fac20`.

- Open: **5 High** (DOM-P4-01, -02, -03, -06, -07), **4 Medium** (DOM-P4-04, -05, -08, -09), **8 Low** (DOM-P4-10 … -17).
  No Critical.
- All required verification for this review was executed (§1): domain unit tests, full API suite, P4 subset, typecheck,
  status-evidence check, the P4 Playwright specs on a local stack, and eight defect probes. Nothing is reported as passed
  that was not run.
- To pass: fix the five High findings (turning DOM-P4-01/02/03/06/07 into plain regression tests), re-run the full API
  suite and the P4 Playwright specs, and request a domain re-review. The Medium findings should be fixed or explicitly
  re-phased by the lead with owner and impact before the P4 gate report.
