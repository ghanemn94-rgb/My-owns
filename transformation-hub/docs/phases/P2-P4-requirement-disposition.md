# P2, P3 and P4 requirements: status and disposition

| Item | Value |
|---|---|
| Purpose | Replace the `Planned` status of every P2, P3 and P4 requirement with an evidenced status (Tested / Implemented / Deferred / Planned), name the gaps with an owner, and map the acceptance tests of these phases to executed evidence. Input for the P2, P3 and P4 gate reports. |
| Author | delivery-orchestrator, 2026-09-30, at revision `124f3d8` of `claude/mobily-transformation-hub` (worktree branch `worktree-agent-a4bf7486cd40b03e9`; no application code or test changed) |
| Status source | `docs/requirements/status-evidence.yaml` (new block "P2 / P3 / P4 requirement disposition", 161 entries), checked with `python3 scripts/requirements/apply_status.py --check` → `status-evidence.yaml OK (263 entries)`, applied to `requirements.yaml` and re-rendered into `requirements-traceability.md` with `python3 scripts/requirements/apply_status.py` |
| Scope | All requirements with `phase: P2` (85), `phase: P3` (37) and `phase: P4` (39) in `docs/requirements/requirements.yaml`. All 161 are `priority: must`. Register total unchanged: 394. |
| Model | `docs/phases/P1-must-disposition.md` |

## 1. Evidence baseline (commands run for this disposition)

All runs at `124f3d8` in this worktree, on databases created for this task only (`hub_test_trace`, `hub_test_trace_boot`,
`hub_test_trace_e2e`). No other database was touched, Docker was not started, and no process started by others was stopped.

```
$ HUB_DATABASES="hub_test_trace hub_test_trace_boot" bash scripts/dev/pg-init-roles.sh
roles hub_owner/hub_app and databases ready: hub_test_trace hub_test_trace_boot
$ pnpm install --frozen-lockfile && pnpm build:packages                        # OK

$ TEST_DATABASE_URL=postgres://hub_app:hub_dev_only@127.0.0.1:5432/hub_test_trace \
  TEST_DATABASE_MIGRATION_URL=postgres://hub_owner:hub_dev_only@127.0.0.1:5432/hub_test_trace \
  pnpm --filter @hub/api test
 Test Files  78 passed (78)
      Tests  691 passed (691)
   Duration  691.15s

$ pnpm --filter @hub/domain test
 Test Files  17 passed (17)
      Tests  348 passed (348)

$ pnpm --filter @hub/contracts test
 Test Files  2 passed (2)
      Tests  100 passed (100)

$ pnpm --filter @hub/db run validate:templates
checks executed: 23735
PASS — all checks passed      (dc-carveout: gates=8, criteria per gate G0=8 G1=8 G2=7 G3=9 G4=8 G5=9 G6=7 G7=8)
```

**E2E (Playwright), local run at `124f3d8`.** A separate stack on this task's own database and ports, set up like the
CI e2e job: `hub_test_trace_e2e` migrated with `node deploy/docker/api-entrypoint.cjs migrate` and loaded with the demo seed
(`apps/api/dist/cli/seed-demo.js`); API `dist/main.js` on :4893 with `HUB_RATE_LIMIT_PUBLIC_PER_MINUTE=1000`, worker
`dist/worker.js`, production web build (`env -u NODE_ENV HUB_API_URL=http://127.0.0.1:4893 pnpm --filter @hub/web run build`)
served by `next start -p 3893`.

```
$ HUB_WEB_URL=http://127.0.0.1:3893 pnpm --filter @hub/e2e exec playwright test
Running 149 tests using 1 worker
  1 failed
    [chromium] › tests/p3-carveout.spec.ts:72:7 › P3 carve-out & NewCo › (a) AT-07: an addition after baseline is held
    Pending with an impact assessment and enters scope only once its change request is approved and applied
    Error: expect(locator).toBeHidden() failed — getByRole('dialog', { name: 'Approve change' }) stayed visible
  3 did not run          (p3-carveout.spec.ts (b), (c), (d): serial describe, skipped after (a) failed)
  145 passed (14.6m)     (incl. a11y.spec.ts: 114 axe scans, 0 serious/critical violations; all p1-*, p2-*, qa-p1-review,
                          p3-readiness tests)

$ HUB_WEB_URL=http://127.0.0.1:3893 pnpm --filter @hub/e2e exec playwright test tests/p3-carveout.spec.ts --grep "\((b|c|d)\) "
  3 passed (51.6s)
```

Result: **148 of 149 e2e tests passed at `124f3d8`; 1 failed.** The failure is a real regression, not an environment
problem: the Demo Sponsor's approval of the perimeter change request is refused with 422 `change_control.amount_unquantified`
("The cost impact of this change request is stated as text only (impacts.cost) and has no amount …"), and the UI has no field
to record the amount (finding F-13). The failure screenshots are under `e2e/test-results/` (not committed). The run rewrote
tracked screenshots and `docs/test-evidence/a11y-report.md`; both were restored and are not part of this change. The stack was
stopped after the run.

**CI.** GitHub Actions run 23 on `a471265`: the Playwright e2e job passed (as reported by the lead in `docs/WORK_LOG.md`; not
re-queried here, there is no `gh` CLI). All e2e specs are unchanged between `a471265` and `124f3d8` except
`e2e/tests/p2-gates.spec.ts` (test (d) rewritten for DOM-P2-01). The application changed in between (P2 domain-review
fixes, `3e2a29d` and `c1338f7`), so the local run above is the evidence used in this document; run 23 is quoted only as
the earlier result.

**Rule applied** (same as P1): `Tested` only when an executed test that checks the requirement's acceptance test (AT)
passed at `124f3d8`, or a documented AT variance where the implementation meets the statement another way (listed in §6
for the gate reviewer). Partial coverage stays `Implemented` with the missing part named. A sub-part that the lead has
explicitly moved to a later phase is noted in the evidence and does not block `Tested` (P1 precedent: REQ-ENT-002,
REQ-DAT-012). `Deferred` needs a target phase, owner and reason. UI-only P4 requirements stay `Planned` while the P4 screens
are being built.

## 2. Summary

| Phase | Requirements | Tested | Implemented | Deferred | Planned |
|---|---|---|---|---|---|
| P2 | 85 | 55 | 28 | 2 | 0 |
| P3 | 37 | 34 | 3 | 0 | 0 |
| P4 | 39 | 35 | 2 | 0 | 2 |
| **Total** | **161** | **124** | **33** | **2** | **2** |

Deferred (both re-phased by the lead, P2 domain review): REQ-PLT-008 → P6 (DOM-P2-11, notification inbox, outbox delivery,
AT-19) and REQ-PLN-019 → P6 (DOM-P2-08, per-project RAG thresholds). Planned: REQ-UX-013 and REQ-UX-014 (P4 screens in
progress; their backends are Tested).

The backends of P2, P3 and P4 are well covered: every business rule in the P3 and P4 registers has an executed API or
domain test. Most P2 items that are not `Tested` are screen-level acceptance tests (E2E) or parts of a statement that are
not built. The findings (§5) include one proposed **High**: a change request whose cost impact is stated as text cannot be
approved from the UI, so every perimeter change after baseline is blocked in the UI and the AT-07 E2E fails at `124f3d8`
(F-13). Two are proposed **Medium**: conflict declarations are not required before voting (F-01), and the P2 cockpit tiles
are still placeholders (F-05). The P2 domain review did not list these gaps.

## 3. Tables (every requirement; all are `must`)

"Disposition" is one of: **Done** (Tested) · **Close before Pn gate** (the named test or change must exist and pass before
PASS) · **Close at Pn gate** (review or gate report) · **Accept at Pn gate** (AT variance for the gate reviewer) · **Web
follow-up in progress / P4 web in progress** (another agent is building it) · **Deferred to Pn** · **P2 open item**
(DOM-P2-16). The evidence column lists the test files cited in `status-evidence.yaml`; the exact test titles are there and
are checked by `apply_status.py --check`.

### P2 — all 85 `must` requirements

| ID | Title | Status | Evidence (tests cited in status-evidence.yaml) | Gap / note | Disposition | Owner |
|---|---|---|---|---|---|---|
| REQ-PLT-008 | Internal in-app notifications through the outbox | Deferred | — (AT-19 is covered for AI in P5 and for room downloads in REQ-JV-009) | No inbox API/UI, no outbox delivery, no suppression after revocation (DOM-P2-11) | Deferred to P6 | integration-reporting-engineer (+ backend-data-engineer) |
| REQ-LCY-001 | Business lifecycle separate from software phases | Tested | P1 projects-templates-audit; P1 qa-p1-14-bilingual | — | Done | — |
| REQ-LCY-002 | G0 Mandate & Governance gate template | Tested | validate:templates; P1 qa-p1-14-bilingual | G0 content checked by the P2 domain review (not by a test) | Done | — |
| REQ-LCY-005 | Gate evidence is a proposal; applicability set by specialists | Tested | gates gate-evaluation-rules; gates p2-gate-authority-reassessment | — | Done | — |
| REQ-LCY-010 | Complete gate structure | Implemented | gates gate-evaluation-rules; gates at-04-gate-blocked-by-recommendation | DOM-P2-16 open: gate owner / reviewer roles not enforced, no gate-level review step; AT (gate without approver) has no test | P2 open item | backend-data-engineer (gates) + ux-frontend-engineer |
| REQ-LCY-011 | Task completion never unlocks a gate | Tested | gates gate-evaluation-rules; gates at-12-gate-side; D rules | — | Done | — |
| REQ-LCY-012 | Non-waivable conditions cannot be overridden | Tested | gates at-13-non-waivable; readiness readiness-waiver-n02; D rules | — | Done | — |
| REQ-LCY-013 | Waivability, waiver authority and waiver record | Tested | gates at-13-non-waivable; D rules | — | Done | — |
| REQ-LCY-015 | Controlled reassessment when evidence proves defective | Tested | gates at-14-reassessment; gates p2-gate-authority-reassessment; D rules | — | Done | — |
| REQ-GOV-001 | Committee Workspace linked to the program | Tested | governance governance-integrity | AT variance: visibility by role (access matrix) and classification, not by committee seat | Accept at P2 gate | P2 gate reviewer |
| REQ-GOV-002 | Multiple committees and delegated authority levels | Implemented | governance governance-integrity; governance at-04-decision-outside-delegation | No test with two committees holding distinct approved matrices (AT) | Close before P2 gate | qa-test-engineer |
| REQ-GOV-003 | Program committee distinct from NewCo and JV boards | Tested | governance governance-integrity; gates p2-gate-authority-reassessment; D gates | — | Done | — |
| REQ-GOV-004 | Approvable draft committee charter | Tested | governance governance-integrity | — | Done | — |
| REQ-GOV-005 | Charter roles and proposed functional membership | Tested | governance governance-integrity; D governance.p2 | — | Done | — |
| REQ-GOV-006 | Chair never defaulted | Tested | P1 p1-closure-empty-db; governance governance-integrity | — | Done | — |
| REQ-GOV-007 | Membership, quorum, voting and conflict rules | Tested | governance p2-governance-authority; governance governance-integrity; D governance.p2 | AT variance: rules read from the approved authority-matrix version, not the charter version; abstention / casting-vote rules await Q-40 / Q-41 | Accept at P2 gate | P2 gate reviewer; governance owner (Q-40, Q-41) |
| REQ-GOV-008 | Classification, access, minutes retention and escalation | Implemented | — | Minutes retention is charter text, not enforced; no test | Close before P2 gate or re-phase retention with REQ-DAT-011 | backend-data-engineer (governance) |
| REQ-GOV-009 | Configurable proposed meeting cadence | Implemented | governance governance-integrity | No meeting series generated from the cadence (AT) | Close before P2 gate (or accept: cadence flag only) | backend-data-engineer (governance) |
| REQ-GOV-010 | No production approval authority before delegation approved | Tested | governance governance-integrity; governance p2-governance-authority; D governance | — | Done | — |
| REQ-GOV-011 | Quorum, thresholds and limits from approved data | Tested | governance governance-integrity; D governance | — | Done | — |
| REQ-GOV-012 | Agenda request and secretariat screening | Implemented | governance decision-lifecycle; D governance.p2 | No merge / reject screening outcomes; requester not notified (finding F-02) | Close before P2 gate; notification part to P6 | backend-data-engineer (governance) |
| REQ-GOV-013 | Numbered agendas linked to issues and decisions | Implemented | governance decision-lifecycle | Agenda numbers not unique-constrained per meeting (finding F-03) | Close before P2 gate | backend-data-engineer (governance); lead for the migration |
| REQ-GOV-014 | Decision paper completeness | Implemented | governance decision-lifecycle; D governance | DOM-P2-14 open: evidence / attachments not required at submit | Close before P2 gate | backend-data-engineer (governance) |
| REQ-GOV-015 | Quorum and conflict checks before voting | Implemented | governance at-05-quorum-recusal-self-approval; governance p2-governance-authority | Conflict declarations not required before voting (finding F-01) | Close before P2 gate | backend-data-engineer (governance); governance owner confirms the rule |
| REQ-GOV-016 | Voting, circulation and attendance/vote/recusal records | Tested | governance decision-lifecycle; governance p2-governance-authority; governance governance-integrity; governance at-05-quorum-recusal-self-approval | — | Done | — |
| REQ-GOV-017 | Minutes drafting and approval | Tested | governance decision-lifecycle; D governance.p2 | — | Done | — |
| REQ-GOV-018 | Actions, implementation tracking and verified closure | Tested | governance decision-lifecycle; D governance.p2 | — | Done | — |
| REQ-GOV-019 | Decision state machine | Implemented | governance decision-lifecycle; D governance; governance governance-integrity | No exhaustive illegal-transition test; 422 instead of 409 (F-10) | Close before P2 gate | qa-test-engineer |
| REQ-GOV-020 | Approval separate from execution | Tested | D governance; governance decision-lifecycle | — | Done | — |
| REQ-GOV-021 | Frozen meeting packs with versioned changes | Tested | governance decision-lifecycle | — | Done | — |
| REQ-GOV-022 | Approvals enforce delegated authority | Tested | governance at-04-decision-outside-delegation; governance p2-governance-authority; gates p2-gate-authority-reassessment; governance at-05-quorum-recusal-self-approval | — | Done | — |
| REQ-GOV-023 | Out-of-mandate decisions become recommendations | Tested | governance at-04-decision-outside-delegation; gates at-04-gate-blocked-by-recommendation; governance p2-governance-authority | Web external-approval dialog returns 422 until the P2 web follow-up merges | Done | — |
| REQ-GOV-024 | Historical votes immutable despite membership changes | Tested | governance governance-integrity; governance at-05-quorum-recusal-self-approval | — | Done | — |
| REQ-GOV-025 | Escalations with action, deadline and options | Tested | governance governance-integrity; governance at-04-decision-outside-delegation | — | Done | — |
| REQ-GOV-027 | Internal approvals are not legal signatures | Implemented | — | Label exists (packs, contract, web); no test; exports P6 | Close before P2 gate | qa-test-engineer |
| REQ-ENT-004 | Portfolio, program, project and workstream views | Tested | P1 isolation-and-auth; P1 arch-rereview-hardening; e2e p1-smoke | Proposed GET /portfolios/:id and /programs/:id endpoints not built; views are Portfolio Home and Program Overview | Done | — |
| REQ-ENT-010 | Cross-project dependencies with minimum disclosure | Implemented | planning cross-project-and-prerequisites | API only; single-side readers see nothing instead of a redacted remote item (F-08); screen in progress | Web follow-up in progress; variance to accept at P2 gate | ux-frontend-engineer; P2 gate reviewer |
| REQ-ENT-013 | No inference of confidential documents | Tested | documents at-03-documents-isolation | — | Done | — |
| REQ-WS-003 | Workstream required elements | Implemented | planning measurement | No-lead data-quality flag untested; other required elements not checked per workstream | Close before P2 gate (flag test); element coverage with REQ-WS-002 | backend-data-engineer (planning) + carveout-domain-analyst |
| REQ-PLN-001 | Connected planning modules | Tested | P1 architecture-hardening; planning schedule-rules; documents at-14-conflicting-evidence | — | Done | — |
| REQ-PLN-002 | WBS list, table, Kanban and Gantt views | Implemented | e2e p2-planning | No Kanban view; AT E2E not built (F-06) | Close before P2 gate | ux-frontend-engineer |
| REQ-PLN-003 | Single accountable owner plus RACI | Tested | planning acceptance-and-access | — | Done | — |
| REQ-PLN-004 | Baseline versions with separate forecast and actual | Tested | planning at-16-baseline-concurrency; P1 arch-rereview-hardening; planning at-15-delay-impact; governance p2-governance-authority | — | Done | — |
| REQ-PLN-005 | Acyclic dependency graph | Tested | planning schedule-rules; D schedule | — | Done | — |
| REQ-PLN-006 | Dependencies link approvals, agreements, evidence, decisions and gates | Tested | planning cross-project-and-prerequisites; D planning | API only; prerequisites screen in progress | Done | — |
| REQ-PLN-007 | FS relationships, lag and working calendars first | Tested | planning schedule-rules; D calendar; D schedule | — | Done | — |
| REQ-PLN-008 | Critical path and float only for supported relationships | Tested | D schedule; planning at-15-delay-impact | — | Done | — |
| REQ-PLN-009 | Incomplete schedule when data missing | Tested | planning schedule-rules; D schedule | — | Done | — |
| REQ-PLN-010 | Asia/Riyadh calendar, UTC timestamps and local business dates | Tested | D calendar; planning at-15-delay-impact; planning raid-lookahead | — | Done | — |
| REQ-PLN-011 | Task states, verified progress and acceptance | Tested | planning acceptance-and-access; planning approver-role-and-my-work | — | Done | — |
| REQ-PLN-012 | RAID register | Tested | planning raid-lookahead; D planning | — | Done | — |
| REQ-PLN-013 | Change requests with impacts and rebaselining | Tested | planning at-16-baseline-concurrency; governance p2-governance-authority; e2e p2-planning | API Tested; web costImpact field and decision picker in progress (F-13) | Done | — |
| REQ-PLN-014 | Responsibility matrix and owner conflicts | Tested | planning raid-lookahead | — | Done | — |
| REQ-PLN-015 | Periodic updates with review and frozen versions | Tested | planning measurement; planning acceptance-and-access | — | Done | — |
| REQ-PLN-016 | Progress weighted by approved deliverable weights | Tested | planning measurement; D rules | — | Done | — |
| REQ-PLN-017 | Show denominator and exclusions | Tested | planning measurement; D planning | — | Done | — |
| REQ-PLN-018 | Green average never hides red CP or blocker | Tested | planning measurement; D rules | — | Done | — |
| REQ-PLN-019 | Configurable RAG thresholds with explanations | Deferred | P2 measurement (explanations only) | Thresholds are code defaults; no configuration API (DOM-P2-08) | Deferred to P6 | backend-data-engineer (project-config) |
| REQ-PLN-020 | Unknown and stale data never Green | Tested | planning measurement; D rules; D planning | — | Done | — |
| REQ-PLN-021 | Manual RAG override with reason, expiry and reviewer | Tested | planning measurement; D rules | — | Done | — |
| REQ-PLN-022 | Recalculate metrics while preserving snapshots | Tested | planning measurement; governance decision-lifecycle | Published report snapshots are P6 | Done | — |
| REQ-PLN-023 | Schedule-based forecasts, no LLM delay probabilities | Implemented | planning at-15-delay-impact; e2e p2-planning | AT (AI response schema rejects a delay probability) not tested | Re-phase the AT to P5 | ai-runtime-engineer |
| REQ-PLN-024 | Predecessor delay impact analysis | Tested | planning at-15-delay-impact; D schedule; D planning | — | Done | — |
| REQ-UX-005 | Screen 2: DC Executive Cockpit | Implemented | e2e p1-smoke; e2e p2-planning | Top decisions / blockers and committee-asks tiles are NotImplementedYet (labelled P2); no overall health tile (F-05) | Close before P2 gate | ux-frontend-engineer |
| REQ-UX-006 | Screen 3: Program Overview & Charter | Implemented | e2e p1-smoke | Committee charter version and approved baseline not shown (F-07) | Close before P2 gate | ux-frontend-engineer |
| REQ-UX-007 | Screen 4: Committee Hub | Implemented | e2e p2-governance | External-approval recording fails with 422 from the UI until the web follow-up merges | Web follow-up in progress | ux-frontend-engineer |
| REQ-UX-008 | Screen 5: Integrated Plan | Implemented | e2e p2-planning | Critical path / baseline variance on the Gantt not asserted; dependency screens in progress | Close before P2 gate | ux-frontend-engineer + qa-test-engineer |
| REQ-UX-009 | Screen 6: Workstream Workspace | Implemented | e2e p2-planning | No E2E of a lead submitting an update from the workspace | Close before P2 gate | qa-test-engineer |
| REQ-UX-015 | Screen 12: RAID & Change Control | Implemented | e2e p2-planning | Raise-CR-from-risk not tested; a change request with a text-only cost impact cannot be approved from the UI until the costImpact field merges (F-13) | Close before P2 gate | ux-frontend-engineer + qa-test-engineer |
| REQ-UX-016 | Screen 13: Document & Evidence Center | Tested | e2e p2-documents; documents at-03-documents-isolation | — | Done | — |
| REQ-UX-018 | Screen 15: My Work / Inbox | Implemented | e2e p2-planning; planning approver-role-and-my-work; gates p2-gate-authority-reassessment | Missing item types (agenda screening, external authority, claim reviews), no comments; notifications P6 | Close before P2 gate; notifications P6 | backend-data-engineer (planning My Work) + ux-frontend-engineer |
| REQ-UX-021 | Search and filtering on every screen | Tested | P1 qa-p1-sec016-injection; P1 qa-p1-13-list-sort; documents at-03-documents-isolation | Screens of later phases get search / filters with those screens | Done | — |
| REQ-UX-022 | Loading, empty, error and restricted-access states | Implemented | e2e p1-smoke | No E2E renders the four states per screen | Close before P2 gate (P2 screens) | qa-test-engineer + ux-frontend-engineer |
| REQ-UX-023 | Activity history and source links | Implemented | e2e p2-governance | No E2E of edit → history entry with actor and reason | Close before P2 gate | qa-test-engineer |
| REQ-UX-024 | Metric drill-down to contributing records | Implemented | e2e p2-governance | No KPI-tile drill-down E2E; contributors API not built | Close before P2 gate | ux-frontend-engineer + backend-data-engineer |
| REQ-DAT-010 | Retention and legal hold enforcement | Tested | documents at-27-legal-hold; P1 projects-templates-audit | — | Done | — |
| REQ-DAT-013 | Domain commands; CRUD cannot change state | Implemented | governance decision-lifecycle; P1 qa-p1-sec016-injection; carveout at-07-perimeter-change-control; finance finance-registers; C carveout | No registry-wide PATCH/status test; some PATCH routes strip instead of reject (F-11) | Close before P2 gate | solution-architect |
| REQ-DAT-014 | Reassessment and cache invalidation on change | Tested | gates p2-gate-authority-reassessment; documents at-03-documents-isolation; gates at-06-status-dimensions | — | Done | — |
| REQ-SEC-004 | Segregation of request and approval; no self-approval | Tested | governance at-05-quorum-recusal-self-approval; planning at-16-baseline-concurrency; planning measurement; D policy | — | Done | — |
| REQ-SEC-005 | Protected quorum calculation | Tested | governance at-05-quorum-recusal-self-approval; governance p2-governance-authority | — | Done | — |
| REQ-SEC-013 | File validation and malware quarantine | Tested | documents at-25-file-safety; D documents | Enterprise malware scanner Not configured; built-in signature check only | Done | — |
| REQ-SEC-019 | Sensitive-access logging | Tested | documents at-27-legal-hold; jv at-03-partner-room-isolation | Exports / snapshots access logging with P6 | Done | — |
| REQ-PHS-004 | P2 exit: authorized decision journey | Implemented | governance decision-lifecycle; governance at-04-decision-outside-delegation | Domain re-review and QA review not run; DOM-P2-14, DOM-P2-16 open | Close at P2 gate | delivery-orchestrator |
| REQ-SET-013 | Wizard step 5: committee, delegation and quorum | Implemented | P1 qa-p1-sec016-injection | No wizard step 5 (committee, delegation, quorum); setup gaps only; no E2E | Close before P2 gate or accept setup-gap approach | ux-frontend-engineer + backend-data-engineer |
| REQ-SET-014 | Wizard step 6: baseline and gates | Implemented | planning at-16-baseline-concurrency | No wizard step 6 (baseline, gates); setup gaps only; no E2E | Close before P2 gate or accept setup-gap approach | ux-frontend-engineer + backend-data-engineer |

### P3 — all 37 `must` requirements

| ID | Title | Status | Evidence (tests cited in status-evidence.yaml) | Gap / note | Disposition | Owner |
|---|---|---|---|---|---|---|
| REQ-LCY-003 | G1–G4 separation gate templates | Tested | validate:templates; P1 qa-p1-14-bilingual; gates at-13-non-waivable | G1–G4 content vs spec §3 inspected only (P3 domain review not run) | Done | — |
| REQ-LCY-006 | Four independent status dimensions | Tested | gates at-06-status-dimensions; D rules | — | Done | — |
| REQ-LCY-007 | Registered NewCo with incomplete transfer displayed accurately | Tested | carveout at-06-incorporation-separate; D newco; e2e p3-carveout | — | Done | — |
| REQ-LCY-014 | Independence definition includes TSAs and enduring arrangements | Tested | gates at-06-status-dimensions; readiness at-10-tsa-expiry; D rules | — | Done | — |
| REQ-PER-001 | Perimeter item attributes | Tested | C carveout; carveout carveout-rules | — | Done | — |
| REQ-PER-002 | Included/Excluded/Shared/Pending classification | Tested | carveout at-07-perimeter-change-control; C carveout | — | Done | — |
| REQ-PER-003 | Full perimeter category coverage | Tested | carveout carveout-rules; D perimeter; carveout carveout-isolation | — | Done | — |
| REQ-PER-004 | Perimeter change impact analysis | Tested | carveout at-07-perimeter-change-control; D perimeter | — | Done | — |
| REQ-PER-005 | Post-baseline perimeter change via change request | Tested | carveout at-07-perimeter-change-control; carveout setup-wizard; D perimeter | — | Done | — |
| REQ-PER-006 | Reconciliation of items lacking plan or evidence | Tested | D perimeter; carveout at-08-day1-contract-position | — | Done | — |
| REQ-PER-007 | Transfer records verified by command | Tested | carveout at-08-day1-contract-position; D perimeter | — | Done | — |
| REQ-AGR-001 | Agreement Register | Tested | D perimeter; carveout carveout-rules | — | Done | — |
| REQ-AGR-002 | No assumed abbreviation expansions | Tested | carveout carveout-rules; D perimeter | — | Done | — |
| REQ-AGR-003 | Agreement tracking attributes | Tested | carveout carveout-rules; D perimeter | — | Done | — |
| REQ-AGR-004 | Regulatory approval register | Tested | carveout carveout-rules; D newco | — | Done | — |
| REQ-AGR-005 | External-party and internal approval registers | Tested | D newco; carveout carveout-rules; e2e p3-carveout | — | Done | — |
| REQ-AGR-006 | Contract transferability classification by specialists | Tested | carveout at-08-day1-contract-position; D rules | — | Done | — |
| REQ-AGR-007 | No assertion that licenses/approvals are mandatory or obtained | Tested | D newco; carveout carveout-rules | — | Done | — |
| REQ-AGR-008 | Consent tracking and Day-1 contract exceptions | Tested | carveout at-08-day1-contract-position; D perimeter | G3 link through criterion G3-C02 (reviewed evidence), not automatic | Done | — |
| REQ-TSA-001 | TSA service attributes | Tested | readiness at-10-tsa-expiry; D readiness | — | Done | — |
| REQ-TSA-002 | TSA state machine | Tested | D readiness; readiness at-10-tsa-expiry | — | Done | — |
| REQ-TSA-003 | End date is not a successful exit | Tested | readiness at-10-tsa-expiry; D readiness | — | Done | — |
| REQ-TSA-004 | Replacement failure triggers escalation and continuity planning | Tested | readiness at-10-tsa-expiry | — | Done | — |
| REQ-TSA-005 | No automatic TSA extension | Tested | readiness at-10-tsa-expiry; D readiness | — | Done | — |
| REQ-TSA-006 | approveTSAExit requires replacement acceptance evidence | Tested | readiness at-10-tsa-expiry; D readiness | — | Done | — |
| REQ-RDY-001 | Site/workstream readiness checklists with blockers and sign-offs | Tested | readiness at-09-readiness-go-no-go; D readiness | — | Done | — |
| REQ-RDY-002 | Readiness domain coverage | Tested | readiness at-09-readiness-go-no-go; D readiness | — | Done | — |
| REQ-RDY-003 | Cutover plan required elements | Tested | readiness at-09-readiness-go-no-go; D readiness | — | Done | — |
| REQ-RDY-004 | Failed blocker prevents go-live, with contingency and history | Tested | readiness at-09-readiness-go-no-go; D readiness; e2e p3-readiness | — | Done | — |
| REQ-RDY-005 | Post-transition acceptance | Tested | readiness at-09-readiness-go-no-go; D readiness | — | Done | — |
| REQ-RDY-006 | No control of data center devices | Implemented | readiness at-09-readiness-go-no-go | REVIEW AT: architecture reviewer confirms at the P3 gate | Close at P3 gate | P3 architecture reviewer |
| REQ-UX-010 | Screen 7: Perimeter & Transfers | Implemented | e2e p3-carveout | E2E (a) AT-07 FAILED at 124f3d8: the change-request approval returns 422 amount_unquantified (F-13); reconciliation update not asserted | Close before P3 gate | ux-frontend-engineer (costImpact field, in progress) + qa-test-engineer |
| REQ-UX-011 | Screen 8: NewCo & Regulatory Readiness | Tested | e2e p3-carveout | — | Done | — |
| REQ-UX-012 | Screen 9: Day-1 & TSA Center | Tested | e2e p3-readiness | — | Done | — |
| REQ-PHS-005 | P3 exit: separation states, blockers and perimeter impact | Implemented | carveout at-06-incorporation-separate; carveout at-07-perimeter-change-control; carveout at-08-day1-contract-position; readiness at-09-readiness-go-no-go; readiness at-10-tsa-expiry; e2e p3-readiness; e2e p3-carveout | P3 reviews not run; AT-07 E2E fails at 124f3d8 (F-13); P3 screens not in the axe scan list | Close at P3 gate | delivery-orchestrator |
| REQ-SET-010 | Wizard step 2: NewCo status with evidence | Tested | carveout setup-wizard; carveout at-06-incorporation-separate; D newco | — | Done | — |
| REQ-SET-012 | Wizard step 4: approve perimeter, workstreams and owners | Tested | carveout setup-wizard; D perimeter | AT variance: tested through the API, no Playwright test of the wizard step | Accept at P3 gate | P3 gate reviewer |

### P4 — all 39 `must` requirements

| ID | Title | Status | Evidence (tests cited in status-evidence.yaml) | Gap / note | Disposition | Owner |
|---|---|---|---|---|---|---|
| REQ-LCY-004 | G5–G7 transaction gate templates | Tested | validate:templates; jv jv-demo-seed | G5–G7 content vs spec §3 checked by the P4 domain review (§5: matches; G7-C02 "100-day" wording noted, DOM-P4-17) | Done | — |
| REQ-LCY-008 | Partner preparation in parallel with separation | Tested | jv at-11-partner-parallel; D jv; gates gate-evaluation-rules | — | Done | — |
| REQ-LCY-009 | Signing separate from Closing; multiple closings | Tested | jv at-11-partner-parallel; jv p4-domain-fixes (DOM-P4-02); jv p4-decision-reliance (DOM-P4-01); D jv | — | Done | — |
| REQ-ENT-012 | Partner, advisor and Clean Team data separation | Tested | jv at-03-partner-room-isolation; documents clean-team-room; documents at-03-documents-isolation | — | Done | — |
| REQ-FIN-001 | Baseline, forecast and actual financials | Tested | finance at-29-currency-unit-aggregation; D finance; finance finance-figures | Backend only; screen in progress | Done | — |
| REQ-FIN-002 | Separation cost categories without double counting | Tested | finance finance-registers; D finance | — | Done | — |
| REQ-FIN-003 | Committed versus spent | Tested | finance finance-registers; finance p4-decision-reliance-finance (DOM-P4-07); D finance; D p4-decision-reliance | — | Done | — |
| REQ-FIN-004 | Working capital, opening balances and intercompany reconciliation | Tested | finance finance-figures; D finance | — | Done | — |
| REQ-FIN-005 | Versioned business plans and valuation cases | Tested | finance finance-registers; D finance | — | Done | — |
| REQ-FIN-006 | Proposed versus approved valuation and ownership | Tested | finance finance-registers; finance p4-decision-reliance-finance (DOM-P4-06/08) | — | Done | — |
| REQ-FIN-007 | EV/equity and unit/currency confusion checks | Tested | finance at-29-currency-unit-aggregation; D finance; D rules | — | Done | — |
| REQ-FIN-008 | Import financial model outputs linked to sources | Tested | finance finance-figures | — | Done | — |
| REQ-FIN-009 | Benefits Register | Tested | finance finance-registers; D finance | — | Done | — |
| REQ-FIN-010 | Human financial validation before approval | Tested | finance finance-figures; D finance | — | Done | — |
| REQ-JV-001 | Access-controlled Partner Workspace | Tested | jv at-03-partner-room-isolation | Backend only; screen in progress | Done | — |
| REQ-JV-002 | Partner longlist/shortlist with criteria and conflicts | Tested | jv jv-partner-rules; D jv | — | Done | — |
| REQ-JV-003 | Partner engagement stages | Tested | jv at-11-partner-parallel; D jv | — | Done | — |
| REQ-JV-004 | Outreach approval separate | Tested | jv jv-partner-rules; D jv | — | Done | — |
| REQ-JV-005 | NDA alone does not grant document access | Tested | jv at-03-partner-room-isolation; D jv | — | Done | — |
| REQ-JV-006 | Proposals and assessments separating fact from judgement | Tested | jv jv-partner-rules; D jv | — | Done | — |
| REQ-JV-007 | Versioned ownership and governance scenarios | Tested | jv jv-partner-rules; D jv | — | Done | — |
| REQ-JV-008 | Terms and negotiation issues register | Tested | jv jv-partner-rules; D jv | — | Done | — |
| REQ-JV-009 | VDR index, permissions and disclosure history | Tested | jv at-03-partner-room-isolation; D jv | — | Done | — |
| REQ-JV-010 | DD requests and Q&A workflow | Tested | jv jv-diligence; D jv | — | Done | — |
| REQ-JV-011 | Diligence findings with implications | Tested | jv jv-diligence; D jv | — | Done | — |
| REQ-JV-012 | Separate signing and closing checklists | Tested | jv at-11-partner-parallel | — | Done | — |
| REQ-JV-013 | Condition precedent attributes and verification | Tested | jv at-12-closing-blocked-cp; jv at-13-cp-non-waivable; D jv | — | Done | — |
| REQ-JV-014 | Closing deliverables, decisions and executed documents | Tested | jv jv-closing-rules | — | Done | — |
| REQ-JV-015 | Track financial flows without executing payments | Tested | jv jv-closing-rules; D jv | — | Done | — |
| REQ-JV-016 | Conditions subsequent and post-close obligations | Tested | jv jv-closing-rules; D jv | — | Done | — |
| REQ-JV-017 | Task completion does not close the transaction | Tested | jv at-12-closing-blocked-cp; jv p4-decision-reliance (DOM-P4-01/08) | — | Done | — |
| REQ-JV-018 | Missing mandatory CP blocks closing | Tested | jv at-12-closing-blocked-cp; jv at-13-cp-non-waivable; jv p4-domain-fixes (DOM-P4-03/04); jv p4-decision-reliance (DOM-P4-01/08); D jv | — | Done | — |
| REQ-JV-019 | Program closure follows its own handover criteria | Tested | jv jv-closing-rules; D jv | — | Done | — |
| REQ-UX-013 | Screen 10: Finance & Value | Planned | backend: finance (5 files); screen placeholder | Finance & Value screen is a placeholder (in progress); backend Tested | P4 web in progress | ux-frontend-engineer |
| REQ-UX-014 | Screen 11: JV & Diligence | Planned | backend: jv (8 files); screen placeholder | JV & Diligence screen is a placeholder (in progress); backend Tested | P4 web in progress | ux-frontend-engineer |
| REQ-DAT-004 | No invalid cross-currency/unit aggregation | Tested | finance at-29-currency-unit-aggregation; D finance | — | Done | — |
| REQ-PHS-006 | P4 exit: CP blocking, partner isolation, NDA, reconciliation | Implemented | jv at-12-closing-blocked-cp; jv at-03-partner-room-isolation | Web screens in progress; P4 reviews not run | Close at P4 gate | delivery-orchestrator |
| REQ-SET-002 | Two fictional demo partners | Tested | jv jv-demo-seed | — | Done | — |
| REQ-SET-004 | Demo scenarios: blocked CP, TSA issue, out-of-authority decision | Implemented | jv jv-demo-seed; governance governance-integrity; readiness readiness-demo-seed | Demo TSA is not an issue scenario; no E2E (F-09) | Close before P4 gate | backend-data-engineer (readiness seed) + qa-test-engineer |

## 4. Gaps: every `must` that is Planned, Deferred or Implemented without a test of its AT (by recommended owner)

> Superseded for P2 by "Update at the P2 gate" at the end of this document (current owners and targets). Kept as written.

- **ux-frontend-engineer (blocking, F-13):** the `costImpact` money field on the change-request assess / edit dialogs (P2 web
  follow-up in progress), then re-run `e2e/tests/p3-carveout.spec.ts`; until then no perimeter change after baseline can be
  approved from the UI (UX-010, UX-015, PLN-013, AT-07).
- **backend-data-engineer (governance):**
  - GOV-012: add the merge and reject screening outcomes (reason required) and an outbox event for the requester (F-02).
  - GOV-013: make the agenda number unique per meeting (unique index on `(meeting_id, number)` for accepted items, or a
    lock on the meeting) and add a concurrency test (F-03). The migration is lead-owned.
  - GOV-014: DOM-P2-14 — require an evidence link, an attachment or an explicit "none — reason" at submission.
  - GOV-015: require a recorded conflict-of-interest declaration (no conflict / conflict → recusal) before a member's vote
    is accepted, or record the governance owner's decision that declarations are optional (F-01).
  - GOV-008: enforce the charter's minutes retention on minutes and packs (or re-phase with REQ-DAT-011) and test that
    minutes inherit the classification.
  - GOV-009: generate the proposed meeting series from the cadence (labelled Proposed), or have the lead accept the flag-only
    approach as an AT variance.
- **backend-data-engineer (gates) + ux-frontend-engineer:** LCY-010 / DOM-P2-16 (P2 open item) — gate-owner submission,
  gate-level review step (`POST …/gates/:gateId/assessment/review`), My Work item, and a test that a gate without an
  approver cannot be assessed.
- **backend-data-engineer (planning) + carveout-domain-analyst:** WS-003 — a test for the "No accountable workstream lead"
  data-quality flag; per-element required-scope checks together with REQ-WS-002.
- **backend-data-engineer (planning My Work) + ux-frontend-engineer:** UX-018 — My Work item types for agenda screening,
  external-authority recording and claim reviews (DOM-P2-09 residual).
- **backend-data-engineer (readiness seed) + qa-test-engineer:** SET-004 — a demo TSA issue scenario (for example
  expired-unresolved or a reported replacement failure) and an E2E that reproduces the blocked states (F-09).
- **ux-frontend-engineer (P2 screens):**
  - UX-005: the cockpit's top decisions / blockers and committee-asks tiles and an overall health tile, with the AT E2E (F-05).
  - UX-006: show the committee charter version and the approved baseline on Program Overview & Charter (F-07).
  - PLN-002: a Kanban view over the same task data, with the AT E2E (F-06).
  - UX-024: KPI drill-down to a filtered list matching the count (the contributors API is also missing).
  - UX-007, GOV-023: the external-approval evidence picker (in progress); UX-015, PLN-013: the `costImpact` money field and
    the decision picker (in progress); ENT-010, PLN-006, UX-008: the cross-project dependency and prerequisite screens
    (in progress).
  - SET-013, SET-014: setup-wizard steps 5 and 6, or a lead decision that the setup-gap links to the Committee Hub and the
    plan satisfy these steps.
- **ux-frontend-engineer (P4 screens, in progress):** UX-013 (Finance & Value with the restricted-state E2E), UX-014 (JV &
  Diligence with the "closing blocked shows unmet CPs" E2E).
- **qa-test-engineer:**
  - GOV-002: two committees with distinct approved matrices.
  - GOV-019: an exhaustive table test of `DECISION_MACHINE` (every command from every state).
  - GOV-027: the "internal electronic approval" label on approval records.
  - UX-008: critical path and baseline variance on the Gantt; UX-009: a lead submits an update from the workspace; UX-015:
    raise a change request from a risk; UX-022: loading / empty / error / restricted states per P2 screen; UX-023: edit →
    history entry with actor and reason; UX-010: the reconciliation view updates after an item is added.
- **solution-architect:** DAT-013 — a registry-wide contract test: no PATCH body schema of any module accepts a status
  field, and one consistent behaviour (reject with 400) (F-11).
- **ai-runtime-engineer (P5):** PLN-023 — a unit test that the AI response schema rejects a delay probability.
- **Deferred to P6:** PLT-008 (integration-reporting-engineer), PLN-019 (backend-data-engineer, project-config).
- **Close at the gate (review / report):** PHS-004 (P2), PHS-005 and RDY-006 (P3), PHS-006 (P4) — delivery-orchestrator and
  the phase reviewers.

## 5. Findings (not fixed here; application code and tests unchanged)

| ID | Severity (proposed) | Requirement | Finding | Evidence |
|---|---|---|---|---|
| F-01 | Medium | REQ-GOV-015 | Conflict-of-interest declarations are recorded but never required: a member can vote without having declared. The statement says the server "requires conflict-of-interest declarations" before voting. | `apps/api/src/modules/governance/decisions.service.ts` `castVote` checks session, presence, quorum, recusal, requester and duplicates, not a declaration; `docs/governance/decision-workflow.md` step 5 lists "declared conflicts" |
| F-02 | Low | REQ-GOV-012 | Agenda screening offers accept / return / defer only; merge and reject are missing, and the requester is not notified (no outbox event on screening). | `meetings.service.ts` `screenAgendaRequest`; `AGENDA_SCREENING_MACHINE` |
| F-03 | Low | REQ-GOV-013 | Agenda item numbers are `max(number) + 1` over accepted items with no unique index and no lock; two concurrent screenings can give the same number. | `packages/db/src/schema/governance.ts` (`agenda_item` has no `(meeting_id, number)` index; meetings do have `meeting_number_uq`) |
| F-04 | Low | REQ-GOV-014 | DOM-P2-14 (evidence and attachments at submission) is still open, but `docs/WORK_LOG.md` names only DOM-P2-16 as the open Low finding. | `packages/domain/src/governance.ts` `missingDecisionPaperFields`; neither fix-status section of `docs/reviews/P2-domain-review.md` addresses DOM-P2-14 |
| F-05 | Medium | REQ-UX-005 | The DC Executive Cockpit still renders the top-decisions / blockers and committee-asks tiles as `NotImplementedYet` labelled **P2**, and has no overall-health tile. `docs/DELIVERY_STATUS.md` rates the web client "Tested" without this caveat. | `apps/web/src/app/(app)/projects/[projectId]/page.tsx` (section "later") |
| F-06 | Low | REQ-PLN-002 | There is no Kanban view (the plan tabs are WBS, timeline, milestones, deliverables, dependencies, baselines, look-ahead, what-if, health). | `apps/web/src/app/(app)/projects/[projectId]/plan/page.tsx` `TABS` |
| F-07 | Low | REQ-UX-006 | Program Overview & Charter shows the project charter (objective, programme, entities, phases) but not the committee charter version or the approved baseline named in the AT. | `charter/page.tsx` |
| F-08 | Low (variance) | REQ-ENT-010 | A user who can read only one end of a cross-project dependency sees nothing, not a redacted remote item (date and status) as the statement and AT describe. Safe, but the dependent team loses visibility of the constraint. | `planning cross-project-and-prerequisites.spec.ts` "a reader of only one of the two projects sees nothing …" |
| F-09 | Low | REQ-SET-004 | The demo sandbox has a blocked CP and an out-of-authority decision, but its only TSA is "in negotiation" with dates, charges and replacement to be confirmed; there is no TSA issue scenario (expired-unresolved, breach or replacement failure). | `apps/api/src/modules/readiness/readiness.seed.ts`; `readiness readiness-demo-seed.spec.ts` |
| F-10 | Low | REQ-GOV-019 | Illegal decision transitions answer 422 `decision.invalid_transition`; the register's security rule says 409. No test covers every illegal transition. | `governance decision-lifecycle.spec.ts` step 6 |
| F-11 | Low | REQ-DAT-013 | PATCH routes treat a `status` field inconsistently: decisions strip it (200, unchanged), RAID and perimeter reject it (400). The AT expects rejection on every resource; no registry-wide test exists. | `decision-lifecycle.spec.ts` step 2; `raid-lookahead.spec.ts`; `carveout.test.ts` |
| F-12 | Low (test labelling) | REQ-PLN-019, REQ-GOV-006/007/009 | Some `describe` titles cite requirements that none of their tests exercise: `planning/measurement.spec.ts` "RAG: … [REQ-PLN-019 …]" (thresholds are not configurable), `governance/governance-integrity.spec.ts` "Committees, charters and memberships [REQ-GOV-002, 003, 004, 005, 006, 007, 009]" (no quorum-rule, bootstrap-chair or meeting-series assertion). The tests themselves check what their `it` titles say. | the two describe blocks |
| F-13 | High (proposed; P3 web regression) | REQ-UX-010, REQ-UX-015, REQ-PLN-013, AT-07 | A change request whose cost impact is stated as text cannot be approved from the UI: the approval returns 422 `change_control.amount_unquantified` and the UI has no field to record the amount (`costImpact`). Every perimeter change after baseline is affected, because its change request states the budget effect as text. The AT-07 E2E fails at `124f3d8`. This is a side effect of the DOM-P2-03 fix (`3e2a29d`); `docs/WORK_LOG.md` lists only the external-approval dialog as a known web regression. The `costImpact` web follow-up that is in progress should fix it; re-run `e2e/tests/p3-carveout.spec.ts` after it merges. | local e2e run §1: `p3-carveout.spec.ts` (a) fails at `confirmCommand(… 'Approve change')`; failure screenshot shows the problem detail "The cost impact of this change request is stated as text only (impacts.cost) and has no amount …" |
| F-14 | Info | e2e evidence | CI run 23 (`a471265`) predates the P2 domain-review fixes that changed server behaviour used by the screens, so it cannot stand as e2e evidence for `124f3d8`. The local run in §1 replaces it for this document. A CI run at `124f3d8` or later is still needed for the gate reports. | §1 |

## 6. AT variances (for the gate reviewers to accept or reject)

- **REQ-GOV-001:** "non-member" is read as a user without project access or clearance. Committee content is visible to the
  roles holding `governance.committee.read` in `docs/security/access-matrix.md` (and within their clearance), not only to
  committee seat holders.
- **REQ-GOV-007:** quorum, thresholds, ties and recusal rules are structured policy in the approved authority-matrix
  version, not in the charter version. Abstentions count as not approving and the chair's vote decides a tie; both await the
  governance owner (Q-40, Q-41).
- **REQ-ENT-010:** see F-08 (nothing shown instead of a redacted remote item). The status is Implemented, not Tested.
- **REQ-SET-012:** the perimeter-approval step is tested through the API (`setup-wizard.spec.ts`); no Playwright test drives
  the wizard step.
- **REQ-SEC-019:** every download is audited, a superset of "download of a Legal Restricted file".
- **REQ-LCY-002 / 003 / 004:** the ATs (criteria seeded with evidence types) are tested; the content of each gate against
  spec §3 is checked by review (G0: P2 domain review) or by inspection only (G1–G7: P3 and P4 domain reviews not run).

## 7. Acceptance tests of P2–P4 and their evidence

| AT | Requirements (P2–P4) | Result at `124f3d8` | Evidence |
|---|---|---|---|
| AT-01 historical statuses | UX-016, AGR-007 | Tested | `documents at-01-historical-claims.spec.ts`, `documents at-01-claim-verification.spec.ts` (DOM-P2-04 fixed), D `documents.test.ts`, D `newco.test.ts`; e2e `p2-documents.spec.ts` (c) |
| AT-03 isolation | ENT-010, ENT-012, ENT-013, UX-016, UX-021, JV-001, SET-002 | Tested (ENT-010 variance F-08) | `documents at-03-documents-isolation.spec.ts`, `jv at-03-partner-room-isolation.spec.ts`, `carveout carveout-isolation.spec.ts`, `readiness readiness-isolation.spec.ts`, `finance finance-isolation.spec.ts`, `governance governance-integrity.spec.ts`; e2e `p2-documents.spec.ts` (b) |
| AT-04 decision outside delegation | GOV-010, GOV-022, GOV-023, UX-007, PHS-004, SET-013, SET-004 | Tested (API); UI regression on external-approval recording | `governance at-04-decision-outside-delegation.spec.ts`, `gates at-04-gate-blocked-by-recommendation.spec.ts`, `governance p2-governance-authority.spec.ts` (DOM-P2-03, -12), `gates p2-gate-authority-reassessment.spec.ts` (DOM-P2-01) |
| AT-05 quorum, recusal, self-approval | GOV-015, GOV-016, GOV-022, SEC-004, SEC-005, PHS-004 | Tested (declaration gap F-01) | `governance at-05-quorum-recusal-self-approval.spec.ts`, `governance p2-governance-authority.spec.ts` (DOM-P2-02, -06, -13, -20); e2e `p2-governance.spec.ts` (recused vote refused in the UI) |
| AT-06 incorporation ≠ carve-out complete | LCY-006, LCY-007, PER-007, UX-005, UX-011, PHS-005, SET-010 | Tested | `gates at-06-status-dimensions.spec.ts`, `carveout at-06-incorporation-separate.spec.ts`, D `rules.test.ts`, D `newco.test.ts`; e2e `p3-carveout.spec.ts` (b) |
| AT-07 perimeter change after baseline | PER-002, PER-004, PER-005, PLN-013, UX-010, UX-015, PHS-005 | Tested (API); UI E2E FAILED at `124f3d8` (F-13) | `carveout at-07-perimeter-change-control.spec.ts`, `carveout setup-wizard.spec.ts`, D `perimeter.test.ts`; e2e `p3-carveout.spec.ts` (a) FAILED |
| AT-08 Day-1 contract that cannot transfer | AGR-006, AGR-008 | Tested | `carveout at-08-day1-contract-position.spec.ts`, D `perimeter.test.ts` |
| AT-09 failed readiness blocks go-live | RDY-001, RDY-004, UX-012, PHS-005 | Tested | `readiness at-09-readiness-go-no-go.spec.ts`, `readiness readiness-demo-seed.spec.ts`, D `readiness.test.ts`; e2e `p3-readiness.spec.ts` AT-09 |
| AT-10 TSA end date is not an exit | TSA-003, TSA-004, TSA-005, TSA-006, UX-012, SET-004 | Tested; demo TSA issue scenario added (DOM-P4-09) | `readiness at-10-tsa-expiry.spec.ts`, `readiness readiness-demo-seed.spec.ts` (demo TSA issue), D `readiness.test.ts`; e2e `p3-readiness.spec.ts` AT-10 and demo TSA issue |
| AT-11 partner work in parallel; signing ≠ closing | LCY-008, LCY-009, JV-003, JV-012, UX-014 | Tested (API + screen); signing after G5 fixed (DOM-P4-02) | `jv at-11-partner-parallel.spec.ts`, `jv p4-domain-fixes.spec.ts` (DOM-P4-02), `gates gate-evaluation-rules.spec.ts` (G5 needs only G1), D `jv.test.ts`; e2e `p4-jv.spec.ts` AT-11 |
| AT-12 missing CP blocks closing | LCY-011, PLN-018, JV-013, JV-017, JV-018, JV-019, UX-014, SET-004 | Tested (API + screen); decision reuse and external evidence fixed (DOM-P4-01/08) | `jv at-12-closing-blocked-cp.spec.ts`, `jv p4-domain-fixes.spec.ts` (DOM-P4-03/04), `jv p4-decision-reliance.spec.ts` (DOM-P4-01/08), `gates at-12-gate-side.spec.ts`, `planning measurement.spec.ts`, D `jv.test.ts`, D `rules.test.ts`; e2e `p4-jv.spec.ts` AT-12 |
| AT-13 non-waivable condition | LCY-012, LCY-013, JV-013, JV-018 | Tested | `gates at-13-non-waivable.spec.ts`, `jv at-13-cp-non-waivable.spec.ts`, `readiness readiness-waiver-n02.spec.ts`, D `rules.test.ts` |
| AT-14 conflicting / defective evidence | LCY-015, DAT-014 | Tested | `gates at-14-reassessment.spec.ts`, `gates p2-gate-authority-reassessment.spec.ts` (DOM-P2-05), `documents at-14-conflicting-evidence.spec.ts`, `documents at-01-claim-verification.spec.ts` (DOM-P2-19) |
| AT-15 predecessor delay impact | PLN-008, PLN-009, PLN-023, PLN-024, UX-008 | Tested (AI-schema part of PLN-023 → P5) | `planning at-15-delay-impact.spec.ts`, `planning schedule-rules.spec.ts`, D `schedule.test.ts` |
| AT-16 concurrent baseline approval | PLN-004, PLN-013 | Tested | `planning at-16-baseline-concurrency.spec.ts`, `governance governance-integrity.spec.ts` (stale command → 409) |
| AT-19 access revoked after scheduling | PLT-008, JV-009 | JV side Tested; notification side Deferred to P6 | `jv at-03-partner-room-isolation.spec.ts` (revoked grant blocks downloads, history kept); AI side is P5 (`ai at-19-ai-revocation.spec.ts`) |
| AT-25 malicious / oversized upload | SEC-013 | Tested (enterprise scanner Not configured) | `documents at-25-file-safety.spec.ts`, D `documents.test.ts` |
| AT-27 legal hold | DAT-010 | Tested | `documents at-27-legal-hold.spec.ts`, `P1 projects-templates-audit.spec.ts` |
| AT-29 currency / unit aggregation | DAT-004, FIN-007, UX-013, PHS-006 | Tested (API + screen) | `finance at-29-currency-unit-aggregation.spec.ts`, D `finance.test.ts`, D `rules.test.ts`; e2e `p4-finance.spec.ts` AT-29 |
| AT-30 governance journey (part) | GOV-018, UX-018 | Governance part Tested; AT-30 as a whole with REQ-PLT-003 (P8) | `governance decision-lifecycle.spec.ts`; e2e `p2-planning.spec.ts` (b) (approval found in My Work) |

## 8. Recommended follow-ups for other documents (not edited here)

- `docs/WORK_LOG.md` "Known failures and risks": add F-13 (change requests with a text-only cost impact cannot be approved
  from the UI; AT-07 E2E fails at `124f3d8`) next to the external-approval regression, and DOM-P2-14 next to DOM-P2-16 as an
  open Low finding (F-04).
- `docs/DELIVERY_STATUS.md`: the "Web client … Tested" row should note that the cockpit's P2 tiles (top decisions, committee
  asks), the Kanban view and several screen-level ATs are not built (F-05, F-06, F-07, §4).
- Tag hygiene in test titles (F-12) when the owning agents next touch those files.

## Updates after this disposition (lead)

- **REQ-LCY-010 → Tested.**
  - DOM-P2-16 is fixed: the gate's owner role (or the PM) starts and submits, and the designated reviewer endorses or
    returns the assessment before submission. The endorsement is bound to the criterion state; the reviewer can neither
    submit nor decide.
  - Evidence: `apps/api/test/gates/dom-p2-16-gate-roles.spec.ts` (11 tests) and e2e `p2-gates.spec.ts` (d).
  - The register was re-rendered from `status-evidence.yaml`.
- **F-13 is fixed** by the P2 web follow-ups (`costImpact` field in change-request assessment). `p3-carveout.spec.ts`
  (a) AT-07 passes. Full Playwright suite on the merged tree: 261/261 (local stack configured as in CI).
- **P4 web screens are merged**:
  - finance: `e2e/tests/p4-finance.spec.ts`;
  - JV & Diligence: `e2e/tests/p4-jv.spec.ts`.
  REQ-UX-013 / REQ-UX-014 still need their status-evidence entries; they will be added at the P4 disposition update.


### Update at the P2 gate (lead, 2026-09-30) — the P2 `must` requirements still Implemented

State of the register: 85 P2 musts — 60 Tested, 23 Implemented, 2 Deferred (REQ-PLT-008 and REQ-PLN-019 to P6, owners in
§4). Since §4 was written, REQ-GOV-013, GOV-014, GOV-015, UX-005, UX-013, UX-014 and LCY-010 became Tested, and F-01, F-02
(partly), F-03, F-04, F-05 and F-13 were fixed. The P2 QA final re-review (`docs/reviews/P2-qa-final-review.md`, condition
C1) asked for a phase, an owner and a reason for every P2 must still Implemented. All 23 are below (21 in the table, plus
REQ-ENT-010 and REQ-PHS-004 after it). None of them is a
Critical or High finding; each has working behaviour whose acceptance test is missing or partial.

"P2 residuals" = the follow-up assignment run in parallel with the P3/P4 reviews; it must finish before the P3 gate. An item
not closed by then is re-dispositioned in the P3 gate report.

| Requirement | Missing for Tested | Owner | Target |
|---|---|---|---|
| REQ-GOV-002 | Test of the AT: two committees with distinct APPROVED authority levels deciding differently | backend-data-engineer (governance) | P2 residuals — **Result (P2 residuals): Tested.** Two committees of DEMO-DC with their own approved matrices: the same type and amount is approved within one mandate and only recommended (escalated) by the other (`governance/p2r-residuals-governance.spec.ts`, `governance.p2r.test.ts`). |
| REQ-GOV-019 | Test walking every illegal transition of `DECISION_MACHINE`; the register's 409 vs the implemented 422 `decision.invalid_transition` (F-10) is an AT variance: the platform answers 422 for every illegal state transition and 409 only for version conflicts | backend-data-engineer (governance) | P2 residuals (variance recorded in the P2 gate report) — **Result: Tested** with the variance. Every (state, command) pair of `DECISION_MACHINE` (20 legal, 90 refused with 422 `decision.invalid_transition`) against an independent table (`governance.p2r.test.ts`); API 422 / 409 check in `p2r-residuals-governance.spec.ts`. |
| REQ-GOV-027 | Test that approval records carry the "Internal electronic approval — not a legally certified signature" label; exports are P6 | backend-data-engineer (governance) | P2 residuals (exports: P6) — **Result: Tested** (exports: P6). Decision outcome and external decision, charter, matrix and minutes approvals and the frozen pack carry the label in API responses; `approval_record.method` is `internal_electronic` (check constraint). **Result (P6 reporting, 2026-10-01): exports Tested.** The minutes file (DOCX, en and ar) carries the label (`reporting/at-24-report-exports.spec.ts` "IT: DOCX validates as OOXML document (not renamed HTML); minutes content = snapshot"); decisions, minutes and committee-pack sections carry it in every format (XLSX / PDF / PPTX / DOCX) and on the Reports screen. |
| REQ-GOV-008 | Minutes retention is a charter text field, not enforced; test that minutes and packs inherit the charter classification | backend-data-engineer (governance) | classification test: P2 residuals; retention enforcement: P7 with REQ-DAT-011 (records retention) — **Result: classification Tested; the requirement stays Implemented** until retention (P7). A restricted committee: its meeting, minutes and pack are 404 for a confidential reader, and absent from lists, counts and the activity feed. |
| REQ-GOV-009 | No meeting series is generated from the cadence (AT: generated series labelled Proposed) | backend-data-engineer (governance) + ux-frontend-engineer | P2 residuals — **Result: Tested.** Secretariat command `POST …/committees/:id/cadence/proposed-meetings` (charter `cadenceRule` + first meeting given by the user): meetings are created **Proposed** (new meeting status; explicit `confirm` to Planned), idempotent, nothing invented; Committee Hub action (en + ar) with an e2e. |
| REQ-GOV-012 | Screening outcomes merge and reject; notification of the requester | backend-data-engineer (governance) | outcomes: P2 residuals; notification: P6 with REQ-PLT-008 — **Result: merge and reject done; stays Implemented** until the requester notification (P6). Reasons required; merge only into a live request of the same meeting; every outcome emits `agenda_request.screened` (new outbox type) for the P6 notification; web dialog en + ar. |
| REQ-DAT-013 | Registry-wide test that no PATCH body accepts a status field, with one behaviour (400) (F-11) | solution-architect / backend-data-engineer | P2 residuals — **Result: Tested.** Registry-wide contract test (`contracts/src/patch-status.test.ts`) and API test (`governance/dat-013-no-status-patch.spec.ts`): every PATCH / PUT body is strict and refuses a status field with 400; the assumption verification status moved to a command. |
| REQ-WS-003 | Test of the "no accountable workstream lead" data-quality flag; per-element checks with REQ-WS-002 | backend-data-engineer (planning) | flag test: P2 residuals; per-element checks: P6 (configuration) — **Result: Tested** (flag). `planning/p2r-residuals-planning.spec.ts`: every lead-less workstream carries `plan.dq.no_lead`; assigning the lead clears it for that workstream only. Per-element checks stay P6. |
| REQ-SET-013 | Setup-wizard step 5 (committee, delegation, quorum) — today done in the Committee Hub, listed as setup gaps | backend-data-engineer + ux-frontend-engineer | P2 residuals — **Result (P2 residuals, web): Tested** with an AT variance. Setup wizard step 5 (`projects/[projectId]/setup`): create / select the committee and load the quorum rules and the delegation table as a DRAFT authority-matrix version that stays pending approval; nothing is approved in the wizard (`e2e p2-residuals.spec.ts` (d)). Variance: no `POST …/setup/steps/committee` — the step runs the existing audited commands. |
| REQ-SET-014 | Setup-wizard step 6 (draft baseline, gates) — today done in the Integrated Plan and gates screen | backend-data-engineer + ux-frontend-engineer | P2 residuals — **Result: Tested** with an AT variance. Step 6 proposes the first baseline (status `proposed` — the "draft baseline", not approved and not the reference) and lists the gates with status, approver role and blockers (`e2e p2-residuals.spec.ts` (d)). Variance: no `POST …/setup/steps/baseline` and no persisted `draft` before a proposal. |
| REQ-PLN-002 | Kanban view over the same task data (F-06) | ux-frontend-engineer | P2 residuals — **Result: Tested.** Kanban tab over the same tasks; a move is the task status command (keyboard "Move" or drag), reflected in the WBS table and the Gantt; RTL (`e2e p2-residuals.spec.ts` (a)). |
| REQ-UX-006 | Program Overview shows the committee charter version and the approved baseline (F-07) | ux-frontend-engineer | P2 residuals — **Result: Tested.** Committee charter version with its approval state, approved baseline with version, approval date, approver and the approver's project role at the approval time (new `BaselineDto.approvedByName` / `approverRoles`), none-yet and restricted states (`e2e p2-residuals.spec.ts` (b); API `planning/p2r-drilldown-overview.spec.ts`). |
| REQ-UX-008 | E2E: critical path and baseline variance on the Gantt | ux-frontend-engineer / qa-test-engineer | P2 residuals — **Result: Tested.** Critical path listed and drawn, baseline variance per Gantt row in calendar days (`e2e p2-residuals.spec.ts` (f)). |
| REQ-UX-009 | E2E: a lead submits an update from the workstream workspace | ux-frontend-engineer / qa-test-engineer | P2 residuals — **Result: Tested.** The Demo Operations Lead submits a WS07 update from the workspace (`e2e p2-residuals.spec.ts` (g)). |
| REQ-UX-015 | E2E: raise a change request from a risk | ux-frontend-engineer / qa-test-engineer | P2 residuals — **Result: Tested.** "Raise change request" on a risk creates a change request whose subject is the risk, linked both ways (`e2e p2-residuals.spec.ts` (h)). |
| REQ-UX-018 | My Work item types for agenda screening, external-authority recording and claim reviews (DOM-P2-09 residual) | backend-data-engineer (planning My Work) + ux-frontend-engineer | P2 residuals — **Result: Tested.** My Work types `agenda_screening`, `external_approval_recording`, `claim_review`, each with the command's own inputs (the refused person is shown refused), web en + ar, e2e `p2r-governance-my-work.spec.ts`. |
| REQ-UX-022 | E2E: loading, empty, error and restricted states on each P2 screen | ux-frontend-engineer / qa-test-engineer | P2 residuals — **Result: Tested.** Loading, empty, error (with retry) and restricted (404, no titles or counts) on Portfolio Home, the cockpit, Program Overview & Charter, Committee Hub, Integrated Plan (WBS, Kanban), Workstream Workspace, RAID, Documents, My Work, the setup wizard, AI PM Center and Administration, plus a Project-B outsider on every DEMO-DC screen (`e2e p2-residuals.spec.ts` (i)); P3/P4 screens: `qa-p34-states.spec.ts`. |
| REQ-UX-023 | E2E: an edit shows in the record history with actor and reason | ux-frontend-engineer / qa-test-engineer | P2 residuals — **Result: Tested.** An owner change and a charter amendment with a reason appear in the record history with the actor; the reason is shown to audit readers (the feed returns reasons only with `audit.event.read`, by design) (`e2e p2-residuals.spec.ts` (j)). |
| REQ-UX-024 | KPI tile drill-down to a filtered list matching the count (the contributors API is also missing) | ux-frontend-engineer + backend-data-engineer | P2 residuals — **Result: Tested** with an AT variance. Every Committee Hub tile, cockpit metric, committee-ask count and Portfolio Home count opens a list whose row count equals the number, for a full and a partial reader (`e2e p2-residuals.spec.ts` (c)); the project counts now use the list scope (a restricted paper's overdue action was counted before) and the escalation list has an `unresolved` filter (API `planning/p2r-drilldown-overview.spec.ts`). Variance: no separate metric-contributors endpoint; Finance & Value KPI tiles not in this E2E. |
| REQ-UX-007 | AT-04 in the UI: a reserved decision shown as "Recommended — pending external authority" with its escalation, driven from the Committee Hub (today only the metric) | ux-frontend-engineer / qa-test-engineer | P2 residuals — **Result: Tested.** AT-04 driven from the Committee Hub: the recorded outcome is Recommended — pending external authority with its escalation (Decision requested), never Approved (`e2e p2-residuals.spec.ts` (e)). |
| REQ-PLN-023 | Unit test that the AI response schema rejects a delay probability | ai-runtime-engineer | P5 review cycle |
| REQ-PLN-019 (Deferred at the P2 gate, see the paragraph above) | Per-project RAG thresholds with proposed defaults, changed only by an approved change, explanation naming the thresholds used (DOM-P2-08) | backend-data-engineer (project-config) | P6 — **Result (P6 configuration, 2026-10-01): Tested.** Threshold versions per project: the project manager proposes, another person with `config.project_settings.approve` (portfolio administration, never the proposer) approves; until then the pinned template version's stated default is in force. Planning health reads the thresholds in force and every calculated RAG that compared against a threshold names the version used; the Health tab shows it (`config/rag-thresholds.spec.ts`, D `config.test.ts` "UT: status explanation shows threshold applied …", `e2e p6-config.spec.ts` (b)). |

Also carried: REQ-ENT-010 (Implemented; F-08 variance — a reader of one end sees nothing instead of a redacted remote item,
awaiting the governance owner); REQ-PHS-004 is closed by the P2 gate report itself (the decision journey passes: request →
authorized approval → action → verified closure, `governance decision-lifecycle.spec.ts` and the QA final e2e
`qa-p2-final-authority-ui.spec.ts`).

### Update after the P3/P4 QA fixes (implementer, 2026-10-01) — QA-P34-04

The P3/P4 QA review (`docs/reviews/P3-P4-qa-review.md`, QA-P34-04) found stale or inconsistent evidence on four P3 musts.
The rows of §3 are kept as written; the result of each is below (evidence in `docs/requirements/status-evidence.yaml`, runs
in the review's "Fix status").

| Requirement | Finding | Result |
|---|---|---|
| REQ-UX-010 | The evidence still recorded `p3-carveout (a)` as failed (F-13, since fixed); the AT "add perimeter item and see reconciliation update" had no test | **Result: Tested.** AT-07 through the API and `p3-carveout.spec.ts` (a); the AT's E2E is `qa-p34-journeys.spec.ts` J5 (an item added in the UI is listed in the reconciliation tab, item count +1); English / Arabic / 390 px rendering and axe (QA-P34-01a/f, -02, -03 fixed). |
| REQ-LCY-007 | The E2E evidence was the NewCo screen (the AT names the cockpit) and cited a skipped run | **Result: stays Tested, now with the AT's E2E.** New `p3-carveout.spec.ts` (e): the cockpit shows the NewCo "Incorporated — evidence verified" next to "Transfer in progress" (perimeter dimension recomputed by the worker), operational readiness not terminal. |
| REQ-SET-012 | Tested while its only AT is an E2E that no Playwright test drives | **Result: lowered to Implemented**, gap stated: the perimeter approval is reached from the Perimeter versions tab (propose = the setup step-4 endpoint, approve = the sponsor with a final G1 decision); the wizard screens are in the P2 residual screens package. Tested again when that E2E passes, or Implemented with the variance accepted by the P3 gate reviewer (§6). |
| REQ-PHS-005 | "P3 screens not yet in the axe scan list" | **Result: evidence refreshed; stays Implemented** until `docs/phases/P3-gate-report.json`. The P3 screens are in `a11y.spec.ts` (27 screen states, both locales — QA-P34-02); the P3 domain, security and QA reviews have run and their fixes are merged. |
