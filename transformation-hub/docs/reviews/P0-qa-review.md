# P0 (Discovery & Blueprint): independent QA gate review

| Item | Value |
|---|---|
| Reviewer | qa-test-engineer (general-purpose subagent in its own context, following `.claude/agents/qa-test-engineer.md` and `.claude/AGENT_RULES.md`) |
| Independence | I did not write any artifact under review. I did not read `docs/reviews/P0-domain-review.md`, which appeared during this review, so this assessment is not influenced by it. |
| Revision reviewed | **`e2daae7`** ("P0 docs and P1 foundation: API platform, identity, portfolio, demo seed") on branch `claude/mobily-transformation-hub` |
| Revision note | HEAD moved to `9901330` (a P1 commit) while this review was running. `git diff --stat e2daae7 -- <every reviewed path>` is empty, and `git diff --name-only e2daae7 9901330` changes only `apps/api/**`, `packages/contracts/**`, `.gitignore` and the new `docs/architecture/module-guide.md`. Every file reviewed here is therefore byte-identical to `e2daae7`. |
| Spec checksum | `docs/MASTER_PROMPT.md`, SHA-256 `c02419ca7d33bd4d99ef1fe2512160cd1881db2726bf5e17981fa9a42af1d912` |
| Scope | Master prompt §19 P0 exit criteria: (1) traceability, (2) testability, (3) separation of source facts from design proposals, (4) executed evidence and quality of the domain tests, (5) data dictionary coverage of §14 |
| Date | 2026-09-29 |

**Severity scale used in this review**
- **Critical:** a security or isolation bypass, or a fabricated fact or piece of evidence that invalidates the gate.
- **High:** a P0 exit criterion, or a `must` requirement scoped to P0, is not met; or a delivered artifact contradicts an acceptance scenario's (AT's) required outcome.
- **Medium:** a defect or inconsistency that will make a later-phase AT fail or mislead reviewers unless it is fixed before that phase's gate.
- **Low:** clarity, robustness or documentation fidelity.

---

## 1. Commands run and real output

All commands were run in this environment. The outputs below are excerpts from what the commands actually printed.

### 1.1 Revision
```
$ git -C /home/user/My-owns log --oneline -1          # at start of review
e2daae7 P0 docs and P1 foundation: API platform, identity, portfolio, demo seed
$ git -C /home/user/My-owns rev-parse --short HEAD     # at end of review
9901330
$ git diff --stat e2daae7 -- transformation-hub/docs/requirements transformation-hub/docs/source-register.md \
    transformation-hub/docs/assumptions-and-open-questions.md transformation-hub/docs/architecture/data-dictionary.md \
    transformation-hub/docs/MASTER_PROMPT.md transformation-hub/packages/domain/src transformation-hub/packages/db/seed \
    transformation-hub/packages/db/scripts transformation-hub/packages/db/src/schema transformation-hub/docs/security
(no output — identical)
```

### 1.2 Domain unit tests
```
$ cd transformation-hub/packages/domain && npx vitest run
 RUN  v4.1.11 /home/user/My-owns/transformation-hub/packages/domain
 Test Files  5 passed (5)
      Tests  75 passed (75)
   Duration  731ms

$ npx vitest run --reporter=verbose ; echo EXIT=$?
EXIT=0
 ✓ src/schedule.test.ts > AT-15 — delay impact … > propagates a 3-working-day delay on A to C and M and the project finish
 ✓ src/governance.test.ts > AT-05 — vote eligibility rules (server-side) > rejects a recused member
 ✓ src/governance.test.ts > AT-05 — vote eligibility rules (server-side) > rejects self-approval by the requester
 ✓ src/rules.test.ts > AT-11 / AT-12 — partner access and closing > closing is blocked by a mandatory CP without evidence even if everything else is green
 ✓ src/rules.test.ts > AT-29 — money aggregation > rejects mixed currencies without a conversion basis
 … (75 total: calendar 6, policy 6, rules 35, schedule 10, governance 18)
```

### 1.3 Template validator
```
$ node transformation-hub/packages/db/scripts/validate-templates.mjs ; echo EXIT=$?
dc-carveout.v1.json: gates=8 workstreams=12 wbs=113 kpis=15 readinessAreas=14
  wbs per workstream: WS01=10 WS02=10 WS03=10 WS04=10 WS05=7 WS06=8 WS07=12 WS08=7 WS09=7 WS10=6 WS11=13 WS12=13
  criteria per gate:  G0=8 G1=8 G2=7 G3=9 G4=8 G5=9 G6=7 G7=8
  milestones=11 waivable criteria=G3-C08,G5-C01
  G5 prerequisite closure: G0,G1; JV signing upstream gates: G0,G1,G5
general-transformation.v1.json: gates=4 workstreams=4 wbs=17 kpis=5
  criteria per gate:  T0=4 T1=5 T2=5 T3=4
checks executed: 23735
PASS — all checks passed
EXIT=0
```

### 1.4 Requirements register analysis
This was a Python/PyYAML script run in the reviewer's scratchpad; no repository file was changed.
```
count 394 | duplicate ids: [] | every record has all 16 fields (id … evidence)
areas: PLT 8, SRC 10, LCY 15, GOV 27, ENT 13, WS 7, PER 7, AGR 8, TSA 6, RDY 6, FIN 10, JV 19, PLN 24, UX 28, RPT 17,
       AI 39, ARC 15, DAT 17, SEC 24, DEP 22, INT 15, AGT 12, PHS 29, SET 16
sections covered: §1–§22 (every section has ≥3 requirements); §23 (start-execution instructions) not a section tag
status: Planned 394 | priority: must 379, should 15 | evidence: [] on every record
AT-01..AT-30: every scenario referenced (min AT-27 = 1 requirement, max AT-03 = 17)
test kinds: UT 201, AT refs 183, IT 101, REVIEW 65, E2E 39, EVAL 14, VIS 1
```

### 1.5 Independent template content scan
This was a Python script over every string in both templates (3,956 and 767 strings), aimed at gaps in the validator.
```
arabic_indic_digits: 0 | arabic_percent (U+066A): 0 | money words (SAR/USD/million/مليون/ريال…): 0
titles/person markers (CEO/Chief/Dr/معالي…): 0 | company names (STC/Zain/Mobily/Equinix…): 0
Arabic abbreviation expansions: 0 | numerals in text: only IDs, "100-day plan" (spec §6), formula "x 100",
"Assumed: N person-days" effort labels
WBS status/verificationStatus: ('draft','proposed') × 113 | durations: assumed 92, TBD 21 | KPI target: null, status 'proposal'
```

### 1.6 Data dictionary cross-check
This was a Python script comparing the spec, `docs/architecture/data-dictionary.md` and `packages/db/src/schema/*.ts`.
```
spec §14 entities parsed from MASTER_PROMPT.md: 64 (matches reviewer list: True)
coverage rows: 64 | all 'yes': True | spec entities missing from table: [] | extra rows: []
pgTable() definitions in schema/*.ts: 100 | coverage tables missing from schema: []
dictionary table sections: 100 | undocumented schema tables: [] | documented-but-absent: []
```

### 1.7 Behaviour probes of domain rules
The script was `scratchpad/probe.ts`, run with `packages/domain/node_modules/.bin/tsx`. No repository file was changed.
```ts
// P1: requester u3 present with chair,u1; quorum min 3 present
computeQuorum({members:[chair,u1,u2,u3,u4], presentUserIds:['chair','u1','u3'], recusedUserIds:[], …})
// P1b: same, policy.recusedMembersExcludedFromQuorum=false, recused u2 present
// P2: sumMoney([1 SAR ×1e6, 500 SAR ×1e3]) with no options
// P3: /probabilit(y|ies)":/ against {"delayProbability":0.4} and {"likelihood":0.4}
// P4: transition('tsa', TSA_MACHINE, 'active', 'record_extension')
// P5: transition('decision', DECISION_MACHINE, 'under_review', 'record_approval')
```
```
P1 quorum with requester present: {"eligibleVoting":5,"presentVoting":3,"required":3,"met":true,…} | members able to vote: [ 'chair', 'u1' ]
P1b recusedMembersExcludedFromQuorum=false, recused u2 present: {"eligibleVoting":5,"presentVoting":3,"required":3,"met":true,…}
P2 mixed unit scales without basis: {"total":{"amount":"1.5000","currency":"SAR","unitScale":1000000},"count":2,"conversions":[]}
P3 regex catches {"delayProbability":0.4}? false | {"likelihood":0.4}? false
P4 TSA active -> record_extension (no decision input): extended
P5 decision under_review -> record_approval: approved
```

### 1.8 Artifact presence
```
$ git ls-files docs | grep -E "WORK_LOG|DELIVERY_STATUS"      → (none)    [also absent at 9901330]
$ grep -rn "historical_unverified|sourceClaim|source_claim" apps/api/src/cli   → No matches
```

---

## 2. Traceability (scope item 1)

### 2.1 Coverage of the master prompt: 86 sampled bullets across §1–§22

Legend: ✓ = requirement present with a sensible acceptance test; ⚠ = present but the test is weak or the priority or wording is distorted (see finding); ✗ = the requirement's P0 artifact is missing.

| § | Spec bullet (abridged) | Requirement(s) | Verdict |
|---|---|---|---|
| 1-R2 | Requirement ID, story, module and AT for every requirement; nothing silently omitted | REQ-AGT-002 | ✓ (no validator script, QA-17) |
| 1-R5 | Do not invent employees, amounts, dates, partners, % or incorporation status | REQ-PLT-004 | ✓ AT-28 + bootstrap UT |
| 1-R7 | Implemented/Tested/Simulated/Not configured/Blocked; a mock is never "Connected" | REQ-PLT-006 | ✓ |
| 1-R10 | Cost components; no invented prices | REQ-DEP-001 | ✓ |
| 1 | Configurable working name | REQ-PLT-001 | ⚠ priority `should` (QA-06) |
| 2 | Source Register fields (id, type, checksum, three dates, location, confidence, status, conflict) | REQ-SRC-005/006/007 | ✓ |
| 2 | Historical Completed/On Track kept as source-reported values only | REQ-SRC-003 | ✓ AT-01 |
| 2 | Compare before merge; preserve the previous source | REQ-SRC-009 | ✓ |
| 2 | Record that image extraction was not performed | REQ-SRC-001 | ✓ (source-register.md SRC-002) |
| 3 | At least four independent status dimensions | REQ-LCY-006 | ✓ AT-06 |
| 3 | 100% task completion does not unlock a gate | REQ-LCY-011 | ✓ AT-12 |
| 3 | An exception cannot override a non-waivable condition | REQ-LCY-012/013 | ✓ AT-13 |
| 3 | Signing separate from Closing; multiple closings | REQ-LCY-009 | ✓ |
| 3 | Reopen when evidence is defective, preserving history | REQ-LCY-015 | ✓ AT-14 |
| 3 | Transaction phases separate from software phases | REQ-LCY-001 | ✓ |
| 4.1 | Do not default the chair to the CEO or any chief | REQ-GOV-006 | ✓ |
| 4.1 | No production authority before the delegation matrix is approved | REQ-GOV-010 | ✓ AT-04 |
| 4.1 | Proposed cadence, not presented as confirmed | REQ-GOV-009 | ⚠ `should` (QA-06) |
| 4.2 | Decision-paper contents (13 elements) | REQ-GOV-014 | ⚠ QA-05 |
| 4.2 | Ten decision states | REQ-GOV-019 | ✓ |
| 4.2 | Approval separate from execution | REQ-GOV-020 | ⚠ AT wording (QA-13) |
| 4.2 | Decisions beyond mandate become a Recommendation or Pending external authority | REQ-GOV-023 | ✓ AT-04 |
| 4.2 | Historical votes unchanged when delegation or membership changes | REQ-GOV-024 | ✓ |
| 4.2 | Internal approvals are not legal signatures | REQ-GOV-027 | ✓ |
| 5 | Legal Entity separate from Project | REQ-ENT-003 | ✓ |
| 5 | Versioned templates; no silent reshaping of projects | REQ-ENT-008/009 | ✓ AT-26 |
| 5 | No inference from titles, search results or aggregate counts | REQ-ENT-013 | ✓ AT-03 |
| 6 | 12 editable workstreams | REQ-WS-001 | ✓ (validator checks all 12 names) |
| 6 | At least 80 useful WBS activities | REQ-WS-004 | ✓ (113) |
| 6 | Initial status Draft/Unverified | REQ-WS-007 | ✓ (113/113 draft/proposed) |
| 7.1 | Perimeter covers liabilities, contracts, people, data, IP and more, not only physical assets | REQ-PER-003 | ✓ |
| 7.1 | Post-baseline additions create a change request (CR) and keep the prior version | REQ-PER-005 | ✓ AT-07 |
| 7.2 | Do not assume abbreviation expansions | REQ-AGR-002 | ✓ templates comply (QA-15 for a security doc) |
| 7.2 | Contract transferability set by specialist assessment | REQ-AGR-006 | ✓ AT-08 |
| 7.3 | End date ≠ exit | REQ-TSA-003 | ✓ AT-10 |
| 7.3 | Never extend a TSA automatically | REQ-TSA-005 | ⚠ domain test (QA-04) |
| 7.4 | No control of DC devices, networks or power | REQ-RDY-006 | ✓ |
| 7.5 | Detect EV vs equity confusion and currency/unit mix-ups | REQ-FIN-007 | ⚠ units (QA-03) |
| 7.5 | Human financial validation before approval | REQ-FIN-010 | ✓ |
| 8 | NDA alone does not grant access | REQ-JV-005 | ✓ |
| 8 | CP attributes (reference, owner, blocking, waivability, long-stop date…) | REQ-JV-013 | ✓ (schema has every field) |
| 8 | Track financial flows without executing payments | REQ-JV-015 | ✓ |
| 9 | Missing data gives "Incomplete schedule" | REQ-PLN-009 | ✓ |
| 9-M3 | A green average must not hide a red CP | REQ-PLN-018 | ✓ |
| 9-M8 | No LLM delay probabilities | REQ-PLN-023 | ✓ |
| 9 | Responsibility/resource matrix | REQ-PLN-014 | ⚠ `should` (QA-06) |
| 10 | All 16 screens | REQ-UX-004..020 | ✓ (screen 16 split into a/b) |
| 10 | Restricted-access state leaks no titles or counts | REQ-UX-022 | ✓ |
| 10 | Contrast, keyboard access, screen-reader labels | REQ-UX-026 | ✓ |
| 10 | No fabricated logo | REQ-UX-003 | ⚠ prohibition carried by a `should` (QA-06) |
| 11 | Genuine Office files (not renamed HTML) | REQ-RPT-010 | ✓ |
| 11 | Visually verify Arabic output | REQ-RPT-008 | ⚠ PDF only (QA-07) |
| 11 | Immutable snapshots; permissions rechecked on access | REQ-RPT-016/017 | ✓ |
| 11 | BI-ready views or documented API | REQ-RPT-011 | ⚠ `should` (QA-06) |
| 12.1 | ACL enforced before retrieval, per chunk and before output | REQ-AI-006 | ✓ AT-03 |
| 12.3 | Prohibited autonomous actions | REQ-AI-025 | ✓ AT-12/17 |
| 12.4 | Approval bound to payload, version and approver | REQ-AI-030 | ✓ AT-18 |
| 12.4 | Emergency stop | REQ-AI-031 | ✓ |
| 12.4 | Rollback/compensation | REQ-AI-032 | ⚠ `should` (QA-06) |
| 12.5 | Imported text is untrusted data | REQ-AI-036 | ✓ AT-17 |
| 13 | Mandatory mutation flow | REQ-ARC-014 | ✓ |
| 13 | No external SaaS for core services | REQ-ARC-012 | ✓ AT-22 |
| 14 | No cross-project linking by ID | REQ-DAT-002 | ✓ AT-03 |
| 14 | Never call a table tamper-proof | REQ-DAT-008 | ✓ |
| 14 | Authorized disposal procedures | REQ-DAT-011 | ⚠ `should` (QA-06) |
| 15 | Technical admin ≠ content access | REQ-SEC-002 | ✓ |
| 15 | CSRF/XSS/injection/IDOR | REQ-SEC-016 | ⚠ QA-08 |
| 15 | CSV/Excel formula injection | REQ-SEC-017 | ✓ AT-25 |
| 16 | Non-root images with probes | REQ-DEP-006 | ✓ |
| 16 | RPO/RTO proposed; restore measured | REQ-DEP-018 | ✓ AT-23 |
| 16 | Do not assume Claude weights are available | REQ-DEP-021 | ✓ |
| 17 | Unclear OCR must not populate official fields | REQ-INT-005 | ✓ AT-01 |
| 17 | "Connected" only after a successful connectivity test | REQ-INT-013 | ✓ |
| 17 | Excel cannot overwrite governed records | REQ-INT-015 | ✓ |
| 18 | 11 agent roles with boundaries | REQ-AGT-007 | ✓ (11 files) |
| 18 | Disclose when independent agents cannot run | REQ-AGT-006/012 | ✓ (ADR-0015) |
| 19 | No pass with open Critical/High findings | REQ-PHS-012 | ✓ |
| 19 | Checkpoint on session end | REQ-PHS-015 | ✗ artifact missing (QA-01) |
| 20 | Each AT linked to a requirement, a fixture and a result | REQ-PHS-016 | ✓ |
| 20 | Performance with dataset size and workload stated | REQ-DEP-017 | ✓ |
| 21 | Demo data excluded from actual reporting | REQ-SET-005 | ✓ |
| 21 | No default passwords or backdoor accounts | REQ-SET-008 | ✓ |
| 21 | NewCo status with evidence (wizard step 2) | REQ-SET-010 | ✓ AT-06 |
| 22 | Traceability chain (Requirement → … → Status) | REQ-AGT-002 (16 fields) | ✓ |
| 22 | docs/DELIVERY_STATUS.md | REQ-PHS-025 | ✗ artifact missing (QA-01) |
| 22 | Engineering verification ≠ production approval | REQ-PHS-027 | ✓ |

**Result.** None of the 86 bullets checked was omitted. No requirement changes the meaning of the spec, apart from the priority downgrades (QA-06) and the two AT-wording mismatches (QA-13, QA-14). §23 (start-execution instructions) has no section tag, but its substantive items are carried by REQ-AGT-001/004, REQ-PHS-001 and REQ-PHS-027, which I judged acceptable.

### 2.2 Each AT against the requirement whose statement or security rule matches the required outcome

| AT | Best-matching requirement(s) and match | Verdict |
|---|---|---|
| AT-01 | REQ-SRC-003: "never set the current status"; UT "Completed claim leaves task Draft/Unverified" | ✓ |
| AT-02 | REQ-ENT-005 (+ENT-006): own templates and phases, no code change | ✓ |
| AT-03 | REQ-SEC-007 ("including worker and cache paths"), REQ-ENT-013 (counts), REQ-AI-007 (caches) | ✓ |
| AT-04 | REQ-GOV-023: becomes Recommended, routed, "keep dependent gates blocked" | ✓ |
| AT-05 | REQ-SEC-004 ("rejected server-side and logged, even when the UI is bypassed") + REQ-GOV-015/SEC-005 | ✓ (implementation gap QA-02) |
| AT-06 | REQ-LCY-006: confirming incorporation leaves the other dimensions unchanged | ✓ |
| AT-07 | REQ-PER-005: CR plus impacts, prior version kept | ✓ |
| AT-08 | REQ-AGR-008: consent/interim arrangement, service/billing/SLA accountability, remediation | ✓ |
| AT-09 | REQ-RDY-004: failed blocker blocks go/no-go; contingency runbook and history shown | ✓ |
| AT-10 | REQ-TSA-003/004/005: Expired-unresolved plus escalation; no automatic extension | ✓ (test gap QA-04) |
| AT-11 | REQ-LCY-008 (parallel work) + LCY-009 (signing separate from closing) | ✓ |
| AT-12 | REQ-JV-018: closing rejected while a blocking CP is unverified; AI cannot bypass or create a waiver | ✓ |
| AT-13 | REQ-LCY-012: rejected and logged; condition stays unmet | ✓ |
| AT-14 | REQ-LCY-015 + REQ-SRC-007: conflict flagged, controlled reassessment, originals kept | ✓ |
| AT-15 | REQ-PLN-024 (reproducible, calendar-based, assumptions stated) + PLN-023 (no probabilities) | ✓ (weak assertion QA-11) |
| AT-16 | REQ-DAT-005: expectedVersion, 409, reload/review | ✓ |
| AT-17 | REQ-AI-036: imported text cannot grant authority or disclosure | ✓ |
| AT-18 | REQ-AI-030: payload, recipient or version change invalidates approval | ✓ |
| AT-19 | REQ-AI-027 / REQ-INT-012: authorization rechecked at execution/send | ✓ |
| AT-20 | REQ-AI-028: idempotency; "reconciled rather than blindly resent" | ✓ |
| AT-21 | REQ-AI-034 / AI-019: core APIs keep working when over budget, provider down or AI Off | ✓ |
| AT-22 | REQ-DEP-014: no external requests in private mode; fonts and assets internal | ✓ |
| AT-23 | REQ-DEP-018/019: consistent restore; no mass job redelivery | ✓ |
| AT-24 | REQ-RPT-009/010 (valid files, figures match snapshot) + RPT-008 (visual RTL, PDF only) | ⚠ QA-07 |
| AT-25 | REQ-SEC-013/014/015/017: quarantine, SSRF, sandbox, formula neutralization | ✓ |
| AT-26 | REQ-ENT-009: preview plus approval; nothing changes before approval | ✓ |
| AT-27 | REQ-DAT-010: rejected and audited; review evidence preserved | ✓ (single requirement) |
| AT-28 | REQ-AI-009: "missing evidence"; no demo or other-project data | ✓ |
| AT-29 | REQ-DAT-004: rejected without a basis; basis shown where used | ✓ (implementation conflict QA-03) |
| AT-30 | Spread across REQ-PHS-001, REQ-PLT-003, REQ-ENT-006, REQ-GOV-018; no single requirement states the full journey | ⚠ QA-12 |

---

## 3. Testability (scope item 2)

Overall the register is testable:
- 337 of 394 requirements name at least one executable UT, IT, E2E, EVAL or VIS test with a concrete expected outcome.
- 9 more rely on AT references.
- 48 are REVIEW-only. These are mostly documentation and process items in P0, P7 and P8, where a document review is the appropriate test. REQUIREMENT IDs, phases and modules are consistent, and security rules are specific; for example, REQ-SEC-017 names the leading characters to escape (`= + - @ tab CR`). The vague or weak items are listed under QA-08 and QA-10.

---

## 4. Separation of source facts from design (scope item 3)

- **`docs/source-register.md`:** correct. SRC-002 (the image) and SRC-003 (the workbook) are marked **NOT PERFORMED**. Claims CLM-001…008 are `Historical-unverified` at Medium confidence and flagged as second-hand. CLM-009 (Completed/On Track) is Historical-unverified and "must not be applied as current status". CLM-010 is `Unknown`. No name, date, figure or percentage from the image was used. **One exception:** line 37 says CLM-009 "is represented in the demo sandbox as a `source_claim`", but no such seed exists at `e2daae7` (QA-09).
- **`docs/assumptions-and-open-questions.md`:** correct. There is one consolidated question list (Q-01…Q-22, each with an owner role and what it blocks). Assumptions are reversible and labelled. Proposed abbreviation expansions (A-21) and RPO/RTO (Q-22) are explicitly "to be confirmed" or "pending".
- **Templates (`dc-carveout.v1.json`, `general-transformation.v1.json`):** correct. All 113+17 WBS activities are `draft`/`proposed`; every gate criterion has `applicability: "proposed"`; both waivable criteria carry "Proposed — to be confirmed by … specialist". Every KPI has `target: null` and `status: "proposal"`. Owners are functional roles only. Effort and duration are `Assumed: N person-days` or `TBD`. No money, percentage, year, name, company, title or Arabic-Indic digit appears (§1.5). ATA is not expanded in the WBS (WS03-A07 says "the expansion of ATA is to be confirmed"). The template description states "All … are proposals".
- **Validator robustness:** the content rules check only ASCII and English patterns (QA-16), so a future Arabic-only fabrication would pass.

---

## 5. Executed evidence and quality of the domain tests (scope item 4)

All 75 tests pass and the template validator passes (§1.2, §1.3). Assessment of whether the tests assert what each AT requires:

| AT | Test | Assessment |
|---|---|---|
| AT-15 | `schedule.test.ts:80-103` | ✓ Reproducible (`a` equals `b`), calendar-based (skips Fri/Sat, 14 → 19 Oct), assumptions include "not probabilities", float absorbs a non-critical delay, and an incomplete schedule refuses to compute. ⚠ The "no probability" assertion (`:90`) is case-sensitive and key-specific; it misses `delayProbability` or `likelihood` (probe P3). See QA-11. |
| AT-05 | `governance.test.ts:45-52, 29-43, 54-57` | ✓ Recused voter rejected; requester self-approval rejected; advisory or expired members rejected; no outcome without quorum. ✗ **Quorum counts the requester, who is barred from voting** (probe P1: quorum "met" with 3 present, only 2 of whom can vote), contradicting A-19. A configuration flag also lets recused members count (P1b), contradicting REQ-GOV-015. Neither case is tested. See QA-02. |
| AT-12 | `rules.test.ts:199-214` | ✓ Blocking CP `open` blocks closing while all else is verified; closing needs confirmed signing; AI cannot perform `verify_condition`, `create_waiver` or `declare_closing` (`:219-223`). Minor gap: no test that a waived CP which is not waivable still blocks, or that a passed long-stop date blocks (the code handles both). |
| AT-29 | `rules.test.ts:106-132` | ✓ SAR+USD without a basis is rejected; the basis is used and reported; EV/equity is flagged; float-like input is rejected. ✗ **Mixed unit scales are silently aggregated without an explicit basis, and nothing is disclosed** (probe P2: `conversions: []`). This contradicts REQ-DAT-004, REQ-FIN-007 ("mixed units rejected") and CLAUDE.md:69-70. The test covers only the explicit `targetUnitScale` path. See QA-03. |
| AT-10 | `rules.test.ts:183-189` | ⚠ Expiry and "not an exit" are tested. But the test commented "No automatic extension" asserts that `expired_unresolved → record_extension` **succeeds** with no decision input. There is no domain guard requiring an approved decision (probe P4). See QA-04. |
| AT-04 | `governance.test.ts:76-113` | ✓ `checkAuthority` covers reserved types, over-limit amounts, currency mismatch and unknown types. ⚠ The test titled "recommended … can only be approved via a recorded outcome" does not prove "only". `under_review → record_approval` is allowed for any decision (probe P5), so enforcement depends on a P2 service guard that has no test yet. See QA-14. |
| AT-06, 07, 08, 09, 11, 13, 14, 17, 18, 26 | `rules.test.ts` | ✓ These assert the required outcomes at the domain level. The service-level parts (logging, persistence, escalation records) are P2–P5 integration tests and are correctly not claimed here. |
| GOV-014 (decision paper) | `governance.test.ts:114-118` | ⚠ `arrayContaining` over a subset. `missingDecisionPaperFields` checks 8 of the 13 elements the spec requires, and accepts `requiredAuthority` without validating it. See QA-05. |

No test asserts a wrong behaviour as correct, **except** the AT-10 extension assertion, which proves the opposite of what its comment claims.

---

## 6. Data dictionary (scope item 5)

- The coverage table at `docs/architecture/data-dictionary.md:6-73` lists all **64** §14 entities as present. Each maps to a `pgTable` in `packages/db/src/schema/*.ts`, and all 100 schema tables are documented (§1.6).
- Spot-check of 5 entities against the schema:

| Entity | Table (schema file) | Result |
|---|---|---|
| Vote | `vote` (governance.ts:278) | ✓ org_id, project_id, composite FKs to decision and membership, `member_role_at_vote`, `authority_matrix_version_id` (GOV-024), append-only trigger, `vote_uq(decision_id,user_id)`. The dictionary does not show the unique index (QA-18). |
| ClosingCondition | `closing_condition` (jv.ts) | ✓ reference, owner, parties, blocking, waivable, waiver authority, valid_to, long_stop_date, status, verified_by/at, version, is_demo: every §8 CP attribute. |
| FinancialSnapshot | `financial_snapshot` (finance.ts:30) | ✓ kind (Baseline/Forecast/Actual), period, `numeric(20,4)`, currency, unit_scale with CHECK in (1, 1000, 1000000) in the migration, source, approval, classification restricted, version. The dictionary shows only `numeric` and no CHECK (QA-18). |
| SourceClaim | `source_claim` (documents.ts:158) | ✓ location, extracted, source-reported and confirmed values, confidence, verification_status (default `unknown`), reviewer, conflict link, `applied_to_record` false. The three dates sit on `source_record`, which the SRC-006 design allows. |
| AuditEvent | `audit_event` (platform.ts) | ✓ actor, time, reason, before/after, correlation_id, hash chain (`prev_hash`, `hash`, `chain_pos`), append-only and chain triggers (DAT-006/008). |

---

## 7. Findings

| ID | Severity | Location | Description | Requirement / AT | Recommendation |
|---|---|---|---|---|---|
| QA-01 | **High** | `docs/WORK_LOG.md`, `docs/DELIVERY_STATUS.md` (absent at `e2daae7` and `9901330`); `CLAUDE.md:7,118,121` | Two mandatory checkpoint/status artifacts do not exist. Four P0-scoped `must` requirements cannot be verified: REQ-PHS-015 (checkpoint), REQ-PHS-025 (DELIVERY_STATUS), REQ-AGT-001 ("WORK_LOG records repository inspection") and REQ-AGT-010 ("WORK_LOG records actual delegation capabilities"). CLAUDE.md's resumption procedure step 1 points to a missing file, so the §19 step 9 checkpoint is not in place. | REQ-PHS-015, REQ-PHS-025, REQ-AGT-001, REQ-AGT-010; §19-9, §22 | Create both files. WORK_LOG: current phase, latest commit, known failures (including this review's findings), next action, repository inspection, delegation capabilities (see ADR-0015). DELIVERY_STATUS: the honest-vocabulary status per requirement, consistent with requirements.yaml (currently all Planned; domain rules are unit-tested but carry no recorded evidence). |
| QA-02 | Medium | `packages/domain/src/governance.ts:56-65`; `docs/assumptions-and-open-questions.md:35,53`; `requirements.yaml:800` | `computeQuorum` counts the decision requester toward quorum although `assertMayVote` bars them from voting (probe P1: quorum "met" with 2 eligible voters out of 3 required). This contradicts A-19. With `recusedMembersExcludedFromQuorum=false`, present recused members also count (P1b), contradicting REQ-GOV-015 ("recused members are excluded from quorum and voting"). Neither case is tested. | REQ-GOV-015, REQ-SEC-005; AT-05; §15 "protect quorum calculations" | Add the requester and other conflicted members to the quorum inputs (or a policy flag defaulting to exclusion) and remove or justify the recused flag. Add UTs for a present recused member and a present requester. Fix before the P2 gate. |
| QA-03 | Medium | `packages/domain/src/money.ts:50-64`; `requirements.yaml:4282` (DAT-004), `:1877` (FIN-007); `CLAUDE.md:69-70`; `rules.test.ts:118-123` | `sumMoney` normalizes different unit scales with no explicit basis and reports nothing (probe P2: `conversions: []`). The requirements and CLAUDE.md say unit mixing is rejected without an explicit basis and the basis is shown. `Money` also carries no period, so period mixing (§14 "explicit units/periods") is unchecked. Only the explicit-target path is tested. | REQ-DAT-004, REQ-FIN-007; AT-29 | Pick one rule and apply it everywhere: either reject differing `unitScale` unless `targetUnitScale` is given, or allow scaling but return a `normalizations` disclosure and update DAT-004, FIN-007 and CLAUDE.md. Add a negative UT. Define where period consistency is enforced. |
| QA-04 | Medium | `packages/domain/src/rules.test.ts:186-187`; `workflows.ts:205-209` | The test is labelled AT-10 and commented "No automatic extension", yet it asserts that `record_extension` succeeds from `expired_unresolved` with no decision input. No domain guard takes the approved extension decision (probe P4). The UT specified by REQ-TSA-005 ("Extended transition without approved decision rejected") has no counterpart. | REQ-TSA-005, REQ-TSA-004; AT-10 | Add a domain guard (for example `assertExtensionAuthorized({approvedDecisionId, decisionStatus})`) with positive and negative UTs, and reword the test comment. Otherwise mark the assertion as covering transitions only and add the P3 IT to the AT-10 plan. |
| QA-05 | Medium | `packages/domain/src/governance.ts:189-209`; `governance.test.ts:114-118`; `requirements.yaml:784` | REQ-GOV-014 requires 13 decision-paper elements before submission. `missingDecisionPaperFields` checks 8. It does not check dependencies, requester, required approving authorities, evidence or attachments, or the financial/operational/schedule impacts individually. It accepts `requiredAuthority` but never validates it. The test uses `arrayContaining` over a subset, so it would not detect these omissions. The requirement's own acceptance test also checks only one field. | REQ-GOV-014; §4.2 | Validate every element (allowing "none" explicitly where legitimate), and assert the exact `toEqual` list plus one negative case per element. Strengthen the REQ-GOV-014 acceptance test to a parameterized UT over all 13. |
| QA-06 | Medium | `requirements.yaml` priority of REQ-PLT-001, GOV-009, PLN-014, UX-003, RPT-011, AI-015, AI-032, ARC-009, DAT-007, DAT-011 | The register defines `must` as "stated as mandatory". These 10 items are imperative in the spec (e.g. §14 "authorized disposal procedures", §12.4 "Rollback/compensation", §11 "BI-ready views…", §9 "Responsibility/resource matrix"), but they are `should`. UX-003 and GOV-009 carry prohibitions ("Do not fabricate an official logo", "Do not present these as confirmed") under `should`. This risks silent descoping, which §19 step 7 forbids. (INT-003, INT-006, DEP-004, DEP-005 and AI-022 are legitimately optional or conditional.) | §1-R2, §19-7; listed REQs | Reclassify the 10 as `must`, or record per-item rationale. Split prohibitions out of UX-003 and GOV-009 as `must`. Use `Blocked` (not `should`) for items that depend on Mobily approvals. |
| QA-07 | Medium | `requirements.yaml:3217` (RPT-009), `:3233` (RPT-010); register-wide VIS count = 1 | AT-24 requires "correct direction, no clipping/overlap" for the Arabic/English committee pack (PPTX) and minutes (DOCX). Only the PDF requirement (RPT-008) has a visual check; PPTX, DOCX and XLSX have only OOXML validity and figure checks. The QA agent definition requires rendering to PNG and inspecting. | REQ-RPT-009, REQ-RPT-010, REQ-RPT-007; AT-24; §11 "Visually verify Arabic output" | Add `VIS:` acceptance tests (render to PNG, inspect RTL, shaping, clipping and leakage) for PPTX, DOCX and XLSX in Arabic and English. |
| QA-08 | Medium | `requirements.yaml:4749` (SEC-016) | The requirement names CSRF, XSS, injection and IDOR, but its acceptance tests cover only CSRF and IDOR. XSS (stored/reflected, including rich text, file names and Arabic text) and SQL/NoSQL/header injection have no test. | REQ-SEC-016; §15 | Add IT/E2E tests: an XSS payload rendered inert (CSP plus escaping) and injection attempts on search, sort and filter parameters rejected or parameterized. |
| QA-09 | Medium | `docs/source-register.md:37-38` | States that CLM-009 "is represented in the demo sandbox as a `source_claim` … (acceptance test AT-01)". No seed code creates any `source_claim` at `e2daae7` (grep of `apps/api/src/cli` finds nothing). A planned state is described as implemented, which conflicts with honest status (AGENT_RULES §4). | REQ-SRC-003; AT-01; AGENT_RULES rules 3–4 | Reword as "will be represented (planned, P1/P2)", or add the seed plus the AT-01 test and then keep the sentence. |
| QA-10 | Low | `requirements.yaml`: PER-001 (:1337), FIN-003 (:1813), RPT-002 (:3105), PLT-003, PLN-014 | Vague or weak acceptance tests. PER-001: "contract validation" does not say which of 17 attributes are mandatory. FIN-003: "tracked separately" is tautological. RPT-002: "fits one page" is typed UT but needs rendering (IT/VIS). PLT-003: "full carve-out journey" has no defined steps. PLN-014: "overloaded owner" has no threshold. | listed REQs | Make each measurable (mandatory field list, a specific double-count case, rendered page count, a scripted step list, a numeric overload threshold). |
| QA-11 | Low | `packages/domain/src/schedule.test.ts:90` | `not.toMatch(/probabilit(y|ies)":/)` is case-sensitive and key-specific. It would not catch `delayProbability`, `likelihood`, `confidence` or `chance` (probe P3). | REQ-PLN-023; AT-15 | Assert the exact key set of `DelayImpact`, or use a case-insensitive pattern covering the synonyms. |
| QA-12 | Low | `requirements.yaml:5689` (PHS-001) and other AT-30 references | No single requirement states AT-30's whole outcome: a *new* user creates a project, assigns an owner, submits a decision, records evidence and sees the report impact, without developer intervention. The PHS-001 E2E omits owner assignment and evidence. | AT-30 | Add a requirement (or amend PHS-001) with an E2E that scripts exactly these 5 steps for a freshly provisioned user. |
| QA-13 | Low | `requirements.yaml:880` (GOV-020) vs `workflows.ts:79-92` | The GOV-020 acceptance test says "approval leaves decision in Implementation Pending", but the domain moves approval to `approved` and needs an explicit `start_implementation`. Spec §4.2 lists both states. | REQ-GOV-020 | Align the acceptance-test wording ("approval leaves the decision Approved; never Implemented-Verified without verified actions"). |
| QA-14 | Low | `governance.test.ts:110-113`; `requirements.yaml:1976` (JV-003) vs `workflows.ts:235` | (a) The test title claims out-of-mandate decisions can "only" be approved via a recorded outcome, but it does not prove "only"; `under_review → record_approval` is permitted (probe P5). (b) The JV-003 acceptance test says "rejects skipped stages", but `record_proposal` is allowed from `materials_access`, which skips DD. | REQ-GOV-023, REQ-JV-003; AT-04, AT-11 | (a) Rename the test and add a P2 IT that combines `checkAuthority` with the command. (b) Either document that skipping DD is allowed or align the acceptance test with the machine. |
| QA-15 | Low | `docs/security/control-applicability-matrix.md:112` | The heading expands CST as "Communications, Space & Technology Commission" without the "(proposed expansion — to be confirmed)" label that A-21, Q-08 and the glossary use for the source abbreviation. CST-03 ties it to transaction approvals. | REQ-AGR-002; §7.2 | Add the "to be confirmed" label, or state that this section references the sector regulator independently of the image's "CST". |
| QA-16 | Low | `packages/db/scripts/validate-templates.mjs:217-223` | Content rules are ASCII/English-only: the ASCII `%` only (not the Arabic `٪`), Latin-digit years, `SAR <digit>`, and English abbreviation expansions. The current templates are clean (§1.5), but Arabic-only fabrications would pass. There is also no person-name heuristic (such as honorifics). | REQ-WS-006, REQ-PLT-004 | Extend the checks to `[٠-٩۰-۹]`, `٪`, Arabic currency/amount words, Arabic abbreviation expansions and honorific markers. Run the validator in `pnpm test`; it is not part of `test:unit` today. |
| QA-17 | Low | REQ-AGT-002 acceptance test; no script in the repository | The acceptance test names a "requirements.yaml validator", but none is tracked. This review's check (§1.4: 394 records, all 16 fields present, no duplicates, AT-01..30 all referenced) was ad hoc. | REQ-AGT-002, REQ-PHS-013 | Add a scripted validator (fields, ID uniqueness, AT coverage, requirement count never decreasing) and run it in CI. |
| QA-18 | Low | `docs/architecture/data-dictionary.md` (generator `packages/db/src/cli/data-dictionary.ts`) | The generated dictionary shows `numeric` without precision (the schema has `numeric(20,4)`) and omits CHECK constraints and unique indexes (for example `vote_uq` and `financial_snapshot_scale_chk`). These are the integrity controls §14 and DAT-003 require. Documentation is less precise than the implementation. | REQ-DAT-001, REQ-DAT-003, REQ-GOV-016 | Emit `numeric(p,s)`, CHECK constraints and unique/partial indexes in the generator. |
| QA-19 | Low | REQ-PHS-020 (P0) | Requires `docs/architecture` to contain data flows and API contracts. Data flows are in `docs/security/threat-model.md` §4. API contracts exist only as code (`packages/contracts`, the `apps/api/src/cli/openapi.ts` generator) and ADR-0007; no OpenAPI document is committed. | REQ-PHS-020 | Link or move the data-flow section into docs/architecture and commit a generated `openapi.json` (or amend the requirement). |

**Counts: Critical 0 · High 1 · Medium 8 · Low 10.**

---

## 8. Verdict

**FAIL** for revision `e2daae7`, identical for all reviewed paths at `9901330`.

Reasons:
1. **QA-01 (High).** Four P0-scoped `must` requirements (REQ-PHS-015, REQ-PHS-025, REQ-AGT-001, REQ-AGT-010) cannot be verified because `docs/WORK_LOG.md` and `docs/DELIVERY_STATUS.md` do not exist, and CLAUDE.md's resumption procedure depends on them. Under §19 step 6 and REQ-PHS-012 the phase cannot pass with this open.
2. The core P0 exit criteria are otherwise **substantially met**:
   - **Traceability** is complete: 394 requirements, all 16 chain fields present, all 30 ATs referenced, each with a matching requirement, and no omitted spec bullet in an 86-item sample.
   - **Separation of source facts from design** holds in the templates, assumptions and source register, apart from QA-09.
   - **Evidence is real**: 75/75 domain tests and 23,735 template checks passed in this environment.
3. The Medium findings do not block P0, but each must be fixed or explicitly deferred with an owner before the gate of the phase that owns the requirement: QA-02, QA-04, QA-05 before P2/P3; QA-03 before P4; QA-07 before P6; QA-08 before P1/P2; QA-06 and QA-09 now.

**To reach PASS:** fix QA-01, then rerun this review's §1.4 and §1.8 checks. I also recommend correcting QA-06 and QA-09 in the same change, since both are P0 documentation fixes.

## 9. Files changed by this review
- `docs/reviews/P0-qa-review.md` (this file) is the only one. Throwaway scripts (`stats.py`, `scan.py`, `dd.py`, `probe.ts`) stayed in the reviewer's scratchpad and are not part of the repository.
