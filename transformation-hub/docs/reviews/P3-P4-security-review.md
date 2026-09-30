# P3 / P4 security review: carve-out, NewCo, readiness / TSA (P3) — JV and finance (P4) — and the P2 closure re-check

| Item | Value |
|---|---|
| Reviewer | `security-privacy-reviewer`, independent review in its own context (REVIEW mode). The reviewer implemented none of the reviewed code. It added two probe specs (`apps/api/test/reviews/p34-sec-registers.spec.ts`, `apps/api/test/reviews/p34-sec-jv.spec.ts`) and this document; no implementation file, migration, seed or existing test was changed. |
| Revision reviewed | **`5bf274b917493f0c02e5de032c8f64f7b6cafc57`** (`5bf274b`, head of `claude/mobily-transformation-hub` after `git fetch` + `git merge` — "Already up to date"). Frozen for the whole review; every result below was produced at `5bf274b` plus the two uncommitted probe specs (test files only). |
| Scope | P3: `apps/api/src/modules/{carveout,newco,readiness}`; P4: `apps/api/src/modules/{finance,jv}`; their contracts (`packages/contracts/src/{carveout,newco,readiness,finance,jv}.ts`); `packages/domain/src/policy/policy-matrix.json` vs `docs/security/access-matrix.md`; `apps/api/src/platform/{policy.service,record-visibility}.ts` for the P3/P4 record types; `packages/db/sql/post-migrate.sql` §1–3, §8, §10, §22, §23; the P3/P4 job handlers and service identities; the AI retrieval of P3/P4 records (`modules/ai/ai-knowledge.service.ts`, `ai-tools.service.ts`, `ai-detections.service.ts` — only where they read P3/P4 registers; the AI module itself is P5 scope). Plus the P2 gate condition C2 (§4). |
| Databases | Own databases on the shared cluster `127.0.0.1:5432`, created with `HUB_DATABASES="hub_test_p34sec hub_test_p34sec_boot hub_test_p34secprobe hub_test_p34secprobe_boot" bash scripts/dev/pg-init-roles.sh`: `hub_test_p34sec` for the full API suite, `hub_test_p34secprobe` for the single probe-spec runs. No other database was touched. PostgreSQL was already running (not started by the reviewer). |
| Processes | Only `pnpm`/`tsc`/`vitest` runs of this worktree and read-only inspection. No server, no Docker, no external host. A first full-suite run was killed by the container restart (memory exhaustion from several agents' suites, per the lead); it was re-run once at the end (§1.3). |
| Known pre-existing failure | `apps/api/test/reviews/p2-qa-final-race.spec.ts` "both kinds of use are accepted on one G1 decision …" fails at `5bf274b` with `422 perimeter.version.decision_no_subject` (P2 QA probe written before the DOM-P2F-08 fix; the lead fixed the fixture in the next commit). Reproduced in both full runs here; **not a P3/P4 finding**. |
| **Verdict P3** | **PASS WITH CONDITIONS** — no Critical/High; Medium SEC-P34-01 (readiness / NewCo verifications), SEC-P34-02, SEC-P34-05, SEC-P34-07 must be fixed before the P3 gate (their `DEFECT` probes turning red). |
| **Verdict P4** | **PASS WITH CONDITIONS** — no Critical/High; Medium SEC-P34-01 (CP / benefit verifications), SEC-P34-03, SEC-P34-04 must be fixed before the P4 gate. Until SEC-P34-03 is fixed the P4 exit criterion "financial data visible only with the finance-domain clearance **and reach**" is **not met for the AI channel** (it is met in the finance module itself). |
| **P2 closure re-check (C2)** | SEC-P2-02 probe **CONFIRMED WITH RESIDUAL** (Low SEC-P34-13); SEC-P2-03 **CONFIRMED**; SEC-P2-06 **CONFIRMED**; SEC-P2-01 **CONFIRMED WITH RESIDUAL** (Low SEC-P34-12); SEC-P2-05 **CONFIRMED** (§4). |

Severity scale (as in the P1/P2 reviews): **Critical** isolation/security bypass; **High** a control the gate relies on does
not work or is unverified; **Medium** a control is materially weaker than documented, with compensation elsewhere; **Low**
limited exposure or defence-in-depth gap; **Info** observation / documentation.

---

## 1. Commands run and real results

All commands ran in `transformation-hub/` of the review worktree (`/home/user/My-owns/.claude/worktrees/agent-a184d0f6cf1351f76`).

### 1.1 Environment
```
$ git fetch origin claude/mobily-transformation-hub; git merge origin/claude/mobily-transformation-hub
  → Already up to date.   git rev-parse HEAD → 5bf274b917493f0c02e5de032c8f64f7b6cafc57
$ pg_isready -h 127.0.0.1 -p 5432                     → accepting connections
$ pnpm install --frozen-lockfile --prefer-offline      → Done in 2.6s
$ pnpm build:packages                                  → domain / contracts / db built
$ HUB_DATABASES="hub_test_p34sec hub_test_p34sec_boot hub_test_p34secprobe hub_test_p34secprobe_boot" bash scripts/dev/pg-init-roles.sh
  → roles hub_owner/hub_app and databases ready: hub_test_p34sec hub_test_p34sec_boot hub_test_p34secprobe hub_test_p34secprobe_boot
```

### 1.2 Unit tests and static checks
```
$ (packages/domain)    npx vitest run   → Test Files 21 passed (21)  Tests 424 passed (424)   (includes policy.test.ts
                                           "matches the JSON block in docs/security/access-matrix.md (no drift)")
$ (packages/contracts) npx vitest run   → Test Files 2 passed (2)    Tests 100 passed (100)
$ (apps/api) npx tsc -p tsconfig.json --noEmit → exit 0 (includes test/**, with both probe specs)
```

### 1.3 Full API suite at `5bf274b` (+ the two probe specs)
```
$ (apps/api) TEST_DATABASE_URL=postgres://hub_app:…@127.0.0.1:5432/hub_test_p34sec \
  TEST_DATABASE_MIGRATION_URL=postgres://hub_owner:…@127.0.0.1:5432/hub_test_p34sec pnpm test
 ❯ test/reviews/p2-qa-final-race.spec.ts (8 tests | 1 failed) 34919ms
     × both kinds of use are accepted on one G1 decision (documented rule: one record of EACH kind); registered once each; …
       AssertionError: {"…","status":422,"code":"perimeter.version.decision_no_subject",…}: expected 422 to be 201
 Test Files  1 failed | 102 passed (103)
      Tests  1 failed | 869 passed | 14 expected fail (884)
   Duration  1262.02s
exit=1
```
103 files = the 101 committed `apps/api/test/**/*.spec.ts` at `5bf274b` (`git ls-files … | wc -l` → 101) + the two probe specs.
The single failure is the known pre-existing one (header row "Known pre-existing failure"). The 14 expected fails are the
12 `DEFECT` probes of this review (7 + 5) and the 2 open `DEFECT` probes of `p2-domain-final.spec.ts` (DOM-P2F-02/04). Every
other P3/P4 spec passes in this run, including the ones cited as evidence in §2–§3: `jv/at-03-partner-room-isolation`,
`jv/at-11-partner-parallel`, `jv/at-12-closing-blocked-cp`, `jv/at-13-cp-non-waivable`, `jv/jv-diligence`, `jv/jv-closing-rules`,
`documents/clean-team-room`, `finance/finance-isolation`, `reviews/p1-sec-finance-visibility`, `readiness/readiness-isolation`,
`readiness/at-09-…`, `readiness/at-10-…`, `carveout/carveout-isolation`, `carveout/carveout-rules`, `ai/ai-retrieval-acl`, and
`reviews/p2-sec-probes` (§4). (A first full run, started before the probes existed, was killed by the container restart after
the same `p2-qa-final-race` failure; it is not counted.)

### 1.4 Probe specs (own database `hub_test_p34secprobe`, single-file runs)
```
$ (apps/api) TEST_DATABASE_URL=…/hub_test_p34secprobe TEST_DATABASE_MIGRATION_URL=…/hub_test_p34secprobe \
    npx vitest run test/reviews/p34-sec-registers.spec.ts --reporter=verbose
SEC-P34-01 observed: sign-off by the evidence linker → 201 {"id":"01a0f430-…","status":"passed","version":3}
 ✓ … DEFECT SEC-P34-01: whoever recorded the evidence of a check cannot sign it off (403)            [expected fail]
 ✓ … SEC-P34-02 CONTROL: the TSA is hidden from the PM and the contributor (clearance confidential): GET 404, absent from the list
SEC-P34-02 observed: 200; detections of the hidden TSA shown to the contributor: [{"code":"tsa_expiring","severity":"warning",
  "entityType":"tsa_service","entityId":"01a0f430-ea30-…","label":"TSA-001 P34SEC-TSA-CANARY restricted transition service
  (synthetic)","detail":"TSA service TSA-001 ends 2026-10-11 without an accepted replacement (status active). …
 ✓ … DEFECT SEC-P34-02: GET /ai/detections never lists (id, code, name, end date) a TSA the caller cannot read   [expected fail]
 ✓ … SEC-P34-03 CONTROL: the finance module hides the project-level figure from the tech lead … — 404, absent from the list
SEC-P34-03 observed: retrieval → [{"id":"01a0f430-ecdd-…","label":"P34SEC-FIGURE-CANARY programme-level actual (synthetic)",
  "kind":"actual","period":"2026-09","amount":"9876.0000","currency":"SAR","unitScale":1,…,"classification":"confidential"}];
  ask → 201, answer contains the figure: true
 ✓ … DEFECT SEC-P34-03: the AI never retrieves nor answers with a figure outside the caller's finance reach       [expected fail]
SEC-P34-05 observed: applicability by the functional approver → 201 applicability=not_applicable
 ✓ … DEFECT SEC-P34-05: only Legal / Regulatory roles record an applicability determination (the approver is refused, 403)  [expected fail]
SEC-P34-06 observed: charge shown to the tech lead → {"charge":{"amount":"4321.0000","currency":"SAR","unitScale":1},
  "chargeBasis":"Monthly fixed fee (synthetic)","chargeRedacted":false}
 ✓ … SEC-P34-06 CONTROL: the finance reader sees the charge, a reader without finance.record.read gets it redacted; the finance
     module hides project-level data from the tech lead
 ✓ … DEFECT SEC-P34-06: the tech lead (finance.record.read on one workstream only) does not see the charge …     [expected fail]
 ✓ … SEC-P34-07 CONTROL: the consent register hides the restricted consent from the PM …; its author sees it on the item
SEC-P34-07 observed: consents on the item shown to the PM → [{"id":"01a0f430-f1a8-…","code":"CNS-001","kind":"consent",
  "counterparty":"P34SEC-RESTRICTED-COUNTERPARTY Fictional Landlord","status":"not_requested","dueDate":null}]; in day-1 positions: true
 ✓ … DEFECT SEC-P34-07: the perimeter item detail and the Day-1 positions never show a consent the caller cannot read [expected fail]
 ✓ … SEC-P34-08 CONTROL: creating a TSA above the creator's clearance is refused
SEC-P34-08 observed: relabel by the PM (clearance confidential) → 200; stored classification strictly_confidential
 ✓ … DEFECT SEC-P34-08: PATCH may not raise the classification above the editor's clearance (403, record unchanged) [expected fail]
 ✓ … OBSERVED SEC-P34-11: a PROJECT-scoped contributor instantiates the Day-1 checklist of a site and creates a blocker check …
 ✓ … SEC-P34-11 CONTROL: the workstream lead role cannot manage a check outside its workstream through that role (strict §2.2)
 ✓ … CONTROL: a Project-B user and an unknown id get the same 404 problem body (no existence leak, no stack)
 ✓ … CONTROL: a denied mutation (contributor creates a TSA) is refused 403 and audited with outcome denied
 Test Files  1 passed (1)
      Tests  9 passed | 7 expected fail (16)

$ … npx vitest run test/reviews/p34-sec-jv.spec.ts --reporter=verbose
SEC-P34-01 (CP) observed: verify by the evidence linker → 201 {"id":"01a0f439-…","status":"verified","version":3}
 ✓ … DEFECT SEC-P34-01: whoever recorded the evidence of a CP cannot verify it (403) — its only evidence is their own [expected fail]
 ✓ … SEC-P34-04 CONTROL: through the counterparty route the question is recorded as origin "partner", requester "Counterparty"
SEC-P34-04 observed: external POST /diligence-requests → 201; stored row {"origin":"internal","requester_label":"Mobily Legal
  (spoofed label, synthetic)","due_date":"2026-12-31","classification":"internal","created_by":"0b50241c-…"}
 ✓ … DEFECT SEC-P34-04: the counterparty cannot create a DD request through the internal route (403/404) …        [expected fail]
 ✓ … SEC-P34-09 CONTROL: the workstream-only principal is refused the finding itself (strict §2.2 …)
SEC-P34-09 observed: list → 200, total 1; shown: ["P34SEC-FINDING-CANARY valuation-relevant finding (synthetic)"]
 ✓ … DEFECT SEC-P34-09: the findings list never shows … a finding the same caller is refused                      [expected fail]
 ✓ … SEC-P34-12 CONTROL: the workstream-only reader reads its own task but is refused the agreement (404, project-level register)
SEC-P34-12 observed: prerequisites → 200 ["AGR-001 P34SEC-AGREEMENT-CANARY share purchase agreement (synthetic)"]
 ✓ … DEFECT SEC-P34-12: the prerequisite list never shows (code, title, state) an agreement the caller cannot open [expected fail]
 ✓ … OBSERVED SEC-P34-10: the PM alone marks a pending deliverable not required and the blocker disappears …
 ✓ … SEC-P34-10 CONTROL: a blocking CP cannot be released by a determination (422), and only Legal determines waivability (PM 403)
 ✓ … SEC-P34-13 CONTROL (SEC-P2-02 fix intact): another voting member may neither edit nor submit the paper (403 …not_requester)
SEC-P34-13 observed: evidence link on another member's draft paper → 201 {"id":"01a0f43d-…","status":"active"}
 ✓ … DEFECT SEC-P34-13: another voting member cannot add evidence to the requester's draft paper either …          [expected fail]
 Test Files  1 passed (1)
      Tests  6 passed | 5 expected fail (11)
```
"expected fail" = `it.fails`: the test asserts the **required** behaviour and currently fails on exactly that assertion (the
`observed` line printed just before it shows the actual response). Setup steps run in `beforeAll` hooks with their own
assertions, so a broken setup fails the file instead of silently satisfying an `it.fails`. The owner pool is used only where
no API offers the setup (synthetic accounts, a TSA's status/classification for SEC-P34-02, an approved figure's approval
columns for SEC-P34-03, the project's AI settings) — each use is commented in the spec.

### 1.5 Secret scan and review commit
Before committing, the three new files were scanned with the repository's configuration (copies at their repository paths
under the session scratchpad):
```
$ gitleaks dir <copy> --config scripts/ops/gitleaks.toml --redact=100   (gitleaks 8.30.1)
  INF scanned ~85613 bytes (85.61 KB) … INF no leaks found
```
The `tree` and `history` modes of `scripts/ops/secret-scan.sh` scan committed content; they were run on the review commit —
results in §7.

---

## 2. P3 — carve-out, NewCo, readiness / cutover / TSA

### 2.1 What was verified and holds

| Area | Evidence | Result |
|---|---|---|
| Route permissions / deny by default | Every P3 route has a contract permission (`packages/contracts/src/{carveout,newco,readiness}.ts`); `HubGuard` answers 404 for an out-of-scope `:projectId` and 403 for a missing permission (`platform/hub.guard.ts:153-167`); services re-assert with record attributes. Probe CONTROL: Project-B PM and an unknown id get the identical 404 problem body (`code`, `detail`, no stack). | OK |
| Project-level registers need a project-wide grant | Agreements / consents / perimeter versions / category reviews use `assertProjectWide` (`carveout.support.ts:71-73`, `agreements.service.ts:58-63, 88-90, 340-343, 354-359`); NewCo registers `assertProjectRead` (`newco.support.ts:54-56`). | OK (but see SEC-P34-07, -12, -16 for three paths that bypass it) |
| Lists and counts filtered in SQL | Perimeter items (`perimeter.service.ts:149-167` visibility + `reachSql`), readiness checks / cutover / TSA (`checks.service.ts:94-97`, `cutover.service.ts:92-95`, `tsa.service.ts:139-142`), readiness summary counts (`summary.service.ts:22-74`), agreements / consents (visibility SQL). | OK |
| Reference values of perimeter items | Shown / written only with a project-wide `finance.record.read` (`perimeter.service.ts:142-144, 277-295, 525-527, 623-625`). | OK |
| Separation of duties | Transfer verify not_self vs recorder (`transfers.service.ts:173, 192`) — verifiers (FAP/FIN/LEG) cannot link transfer evidence (needs `carveout.transfer.manage`), so no linker gap; perimeter version approval: sponsor ≠ proposer, G1 decision rule, reliance lock (`perimeter-versions.service.ts:185-…`); go/no-go: not the submitter, authority, refused GO recorded in an autonomous transaction (`cutover.service.ts:401-496`); TSA exit approval separation (`tsa.service.ts:557-558`); readiness determination not by the author (`packages/domain/src/readiness.ts:110-121`). | OK except SEC-P34-01 (evidence linker) |
| No status through generic PATCH | P3 PATCH bodies (`updateSite`, `updatePerimeterItem`, `updateAgreement`, `updateConsent`, `updateLegalEntity`, `updateRequirement`, `updateReadinessCheck`, `updateCutoverPlan`, `updateTsaService`) carry no status/approval field (strict schemas → 400, pinned by `at-10-tsa-expiry.spec.ts` "A generic PATCH never changes the status"). TSA dates change only through the extension commands after approval (`tsa.service.ts:302-304`). | OK |
| Denied mutations audited, problem+json | `ProblemFilter` audits 403/404/409/422 mutations with `outcome denied/rejected` in an autonomous transaction (`platform/errors.ts:124-138`); probe CONTROL: contributor `POST /tsa-services` → 403 + audit row `readiness.createTsaService` / `denied`. 500s carry no SQL or stack (`errors.ts:108-117`). | OK |
| Legal-only regulatory edits (REQ-AGR-004) | create / PATCH / progress need `newco.regulatory.manage` (Legal only; `regulatory.service.ts:139-203, 261-266`; `carveout-rules.spec.ts:117` PM 403). The verification commands (applicability, outcome, conditions) are open to the functional approver. | **SEC-P34-05** |
| TSA charge visible to finance readers only (REQ-TSA-001) | Charge / basis redacted for callers without `finance.record.read` (`tsa.service.ts:207-221`; probe CONTROL: contributor → `charge: null, chargeRedacted: true`); TSA list carries no charge. The check is RBAC-only (no reach). | **SEC-P34-06** |
| Site / perimeter data and workstream reach (§2.2 option B) | Sites, reconciliation and Day-1 positions need the project-level read (`assertRead` without workstream → 404 for a workstream-only reader; `perimeter.service.ts:89-94, 813-816, 873-876`); perimeter items per workstream reach; `projectLevelRead` is limited to the four §2.2.1 permissions (drift test). | OK (Info SEC-P34-16: codes of linked records) |
| Worker / jobs | TSA expiry scan runs as `svc-readiness` with `['readiness.register.read', 'readiness.tsa.manage']` (`readiness.jobs.ts:12, 22-28`); NewCo job `svc-newco` read-only (`newco.jobs.ts:9, 30-50`); carve-out has no job. | OK |
| File handling | No P3 upload route (documents module owns uploads; P2 review §2.4). | n/a |
| RLS / DB guards | Every P3 table with `project_id` gets `hub_project_isolation` (full members only for tables without `room_id`) — `post-migrate.sql:41-80`; legal entity single-owner trigger/RLS (§21); append-only history tables. | OK |

### 2.2 The self-owner claim of create commands (WORK_LOG "for the P3 security review") — decision

Code: `readiness/checks.service.ts:221` (create) and `:264` (checklist from template) pass `ownerUserIds: [ctx.principal.userId]`;
the same appears in `cutover.service.ts:235`, `tsa.service.ts:273`, `perimeter.service.ts:98, 523, 856`,
`perimeter-versions.service.ts:141`, `planning/raid.service.ts:159`, `planning/health.service.ts:337`.

Analysis: `own_workstream` (access-matrix §2.4) holds for "the resource's accountable owner, an assignee, or its **creator**",
so for a create it is satisfied by construction. What bounds a create is the **grant's scope**: a workstream-scoped grant covers
only its workstream (`PolicyService.check`, `policy.service.ts:250-268`; pinned by `readiness-isolation.spec.ts` "Manage only
inside the workstream" and by the probe CONTROL), `workstream_lead` can only be workstream-scoped (`portfolio.service.ts:489`),
and `project_manager` satisfies `W` anyway. So the claim widens nothing for the perimeter, cutover and TSA creates (their
holders are PM and WSL). It matters only for a **project-scoped contributor** with `readiness.check.manage` (and, in P2,
`planning.raid.manage` / `planning.status_update.submit`): it may create checks in any workstream and instantiate a site's whole
Day-1 checklist, becoming creator — hence "owner" — of every created check (probe OBSERVED SEC-P34-11: `from-template` → 201,
`created` = rows with `created_by` = contributor; a blocker check in a workstream where it holds no role → 201; moved to a third
workstream → 200). Sign-off and determination stay with another person (not_self vs owner / creator / latest tester), so no
approval is self-granted.

**Decision: not a vulnerability; Info (SEC-P34-11).** It is the documented semantics. Recommended: state in access-matrix §2.4
that `W` binds updates of existing records and that creates are bound by the grant's scope; decide whether a contributor should
set `blocker` / `signoffRole` at creation (today the author picks which specialist role signs the check off, before any
specialist determination) and whether template instantiation (bulk creation of blocker-capable checks bound to a site / plan)
should be PM / workstream-lead only.

### 2.3 P3 findings (details in §5)

- **SEC-P34-01 (Medium)** — readiness sign-off (and, statically, NewCo incorporation verify and regulatory conditions-satisfied)
  does not treat the person who linked the evidence as "self".
- **SEC-P34-02 (Medium)** — `GET …/ai/detections` lists TSAs (code, name, end date, status) above the caller's clearance and
  outside its readiness reach.
- **SEC-P34-05 (Medium)** — REQ-AGR-004: a functional approver (no legal / regulatory role) makes applicability determinations and
  records authority outcomes, validity and conditions.
- **SEC-P34-07 (Medium)** — consents above the caller's clearance (counterparty, status, due date) are listed inside a readable
  perimeter item, the Day-1 positions and command responses.
- **SEC-P34-06 (Low)** TSA charge by RBAC only (no finance reach); **SEC-P34-08 (Low)** TSA relabel above the editor's clearance;
  **SEC-P34-12 (Low)** agreement titles as prerequisites to workstream-only readers (SEC-P2-01 residual); Info SEC-P34-11, -16.

### 2.4 P3 verdict: **PASS WITH CONDITIONS**
No Critical or High. Conditions for the P3 gate: fix SEC-P34-01 (P3 commands), SEC-P34-02, SEC-P34-05 (or a documented Mobily
decision amending REQ-AGR-004 and the matrix), SEC-P34-07, each with its `DEFECT` probe turning red and renamed; track the Lows.

---

## 3. P4 — JV (partner rooms, DD, signing / closing) and finance

### 3.1 P4 exit criteria (verified with real runs)

| Exit criterion | Verification | Result |
|---|---|---|
| **Partner isolation** — no titles, snippets, counts, activity, search, AI retrieval or export of another partner's room (partner rooms, clean team, external accounts) | Existing `jv/at-03-partner-room-isolation.spec.ts` in the full run: partner B sees only its room / disclosures / DD (A's → 404, counts exclude them); Project-B user 404 on every JV record; external accounts get 403/404 on registers, documents, search, AI; RLS context of B holds no row of A; clean-team findings visible to the clean team only; revoke / lock stop downloads, history kept. `documents/clean-team-room.spec.ts`, `ai/ai-retrieval-acl.spec.ts` RET-02 (room content only with a grant). Static: rooms list = granted rooms or administrators' metadata only (`rooms.service.ts:69-75`); content needs `room` + `clean_team` conditions (`:85-91`); grants only through `assertRoomGrantAllowed` (external: partner room of its own counterparty, materials access, expiry ≤ 90 days, never manage; clean team: Legal + role + attestation — `packages/domain/src/jv.ts:386-416`) and the DB guard (`post-migrate.sql` §23(d)); activity feed hides every room type from non-auditors (`portfolio.service.ts:37-88`); no export route exists (P6). | **Met for reads.** One write-path gap across the boundary: **SEC-P34-04** (a counterparty creates an internal-origin DD request). Info SEC-P34-15 (auditor activity metadata of rooms). |
| **An NDA alone is not sufficient for access** | `at-03…spec.ts` "IT: partner with an executed NDA but no grant cannot list room documents" and "a grant is refused while the partner is only at NDA" (full run); `recordNda` creates no grant (`partners.service.ts:324-350`); withdrawal / unbinding revokes external grants (`jv.support.ts:431-449`). | **Met** |
| **Missing CP blocks closing** — nobody without the authority waives or bypasses; AI cannot | `jv/at-12-closing-blocked-cp.spec.ts` (mark_ready / confirm refused, re-evaluated inside the confirm transaction, refusal logged; the AI / any service identity cannot confirm, verify or waive) and `at-13-cp-non-waivable.spec.ts` (non-waivable refused and logged; only Legal determines waivability; approval only by the specialist-set authority, not the requester) in the full run; probe CONTROL: a determination cannot release a blocking CP (422 `jv.cp.blocking_release_not_allowed`), PM cannot determine (403). Static: `eventBlockers` (`jv.ts:668-688`), confirm = human + pending request by another person + FINAL decision + decision-use lock (`transactions.service.ts:457-521`); waivers via `WaiverService.approve` (human, authority role, not requester, payload hash bound — `gates/waiver.service.ts:203-289`); CPs cannot be deleted or moved (`post-migrate.sql` §23(c), (f)). | **Met for CPs**, with **SEC-P34-01** (a Legal verifier may verify a CP on evidence it linked itself) and Low **SEC-P34-10** (a closing checklist item — not a CP — is set "not required" by one person, removing its blocker). |
| **Financial data only with the finance-domain clearance and reach** (figures, evidence, history, counts, activity) | `finance/finance-isolation.spec.ts` and `reviews/p1-sec-finance-visibility.spec.ts` in the full run (lists, counts, summary, evidence, history, activity follow `FinanceSupport.visibleSql` = finance-domain clearance + reach — `finance.support.ts:78-118`, `record-visibility.ts:89-95`); probe CONTROL: the finance module refuses the project-level figure to a workstream-scoped finance reader (404). | **Met in the finance module; not met in two other channels:** **SEC-P34-03** (AI retrieval / answers — Medium) and **SEC-P34-06** (TSA charge — Low). |

### 3.2 Other P4 checks

| Area | Evidence | Result |
|---|---|---|
| External (counterparty) projection | Session-level routes assert `jv.disclosure.view` / `jv.dd_request.read_external` in the service; only released versions of documents filed in the account's own partner room; download re-authorized per request, integrity re-checked, audited, `nosniff` + `CSP sandbox` + `no-store` + attachment disposition (`rooms.service.ts:518-587`, `jv.controller.ts:219-226`). | OK |
| DD answer release | Review by a person other than the drafter, designated reviewer only, pinned evidence versions, release not by the drafter / uploader, refusals audited (`diligence.service.ts:268-364`). | OK |
| Signing | Only after G5 approved (and not under reassessment) on the decision that approved it; re-checked in the recording transaction (`transactions.service.ts:415-450, 457-475`). | OK |
| Finance approvals | `finance.snapshot.approve` (Finance only) with not_self vs preparer, validation hash bound, approved figures immutable (DB guard `post-migrate.sql` §22). | OK except SEC-P34-01 (benefit verify, static) |
| Classification of new records | Finance: `assertClassificationWritable` with finance-domain clearance (`finance.support.ts:138-143`); JV: `assertClassification` with the plain clearance (`jv.support.ts:84-88`) — Info SEC-P34-14 (no domain clearance in JV). | OK / Info |
| Lists of JV registers | Partners / scenarios / negotiation issues: classification in SQL; DD requests / findings: classification + room in SQL — but no grant-coverage filter for workstream-scoped holders. | **SEC-P34-09** (Low) |
| Worker / service identities | `svc-jv` allowlist `['jv.deal.read', 'jv.closing_checklist.manage', 'jv.cp.manage']` (`jv.jobs.ts:14`) — scans only; human-only commands refuse service principals (`assertHuman`). Finance registers no job and gives no service identity a finance permission (`finance.jobs.ts`). | OK (Info SEC-P34-17: allowlist broader than the scans need) |
| Uploads | No P4 upload route (`jv.submission.upload` is unused). | n/a (Info SEC-P34-17) |
| Program closure demo authority | `confirmClosure` accepts the demo policy only in demo mode on a demo project (`postclose.service.ts:324-325`); `HUB_MODE=demo` is refused in production (`config.ts:162-163`). | OK |

### 3.3 P4 findings (details in §5)

- **SEC-P34-01 (Medium)** — CP verification (reproduced) and benefit verification (static) accept the person who linked the evidence.
- **SEC-P34-03 (Medium)** — AI retrieval and answers include approved figures (amounts) and approved valuations outside the caller's
  finance reach.
- **SEC-P34-04 (Medium)** — an external counterparty account creates DD requests through the internal route, recorded as
  `origin: internal` with a free requester label, due date and classification.
- **SEC-P34-09 (Low)**, **SEC-P34-10 (Low)**, **SEC-P34-13 (Low, P2 residual)**; Info SEC-P34-14, -15, -17, -18.

### 3.4 P4 verdict: **PASS WITH CONDITIONS**
No Critical or High. Conditions for the P4 gate: fix SEC-P34-01 (JV / finance commands), SEC-P34-03 and SEC-P34-04 with their
`DEFECT` probes turning red and renamed; until SEC-P34-03 is fixed, the finance exit criterion is not met for the AI channel and the
gate report must say so. Track the Lows with owners.

---

## 4. P2 closure re-check (gate condition C2)

`git log --follow -- apps/api/test/reviews/p2-sec-probes.spec.ts`: `7da6de5` (reviewer, original) → `4803eb1` (lead: SEC-P2-01/02/03/06
fixes) → `30ded28` (lead: §2.2 option B, SEC-P2-04/05/07/08) → `4077ce6` (lead: setup change only). `git log -S assertPaperAuthor --
apps/api/src/modules/governance/decisions.service.ts` → only `4803eb1` (the function is unchanged since it was introduced).

| Probe | Original (7da6de5) | Now | Still tests the original finding? | Result |
|---|---|---|---|---|
| **SEC-P2-02** | DEFECT: finance PATCHes the PM's paper (200), submits (201), secretary tables it, finance votes → required **403** | Finance PATCH → **403 `governance.decision.not_requester`**, submit → **403**, row version and status unchanged; the requester submits; a member who did **not** shape the paper votes → 201. `4077ce6` only adds `conflictDeclaration: 'no_conflict'` to the vote (REQ-GOV-015 setup), assertion unchanged. | Yes, for the fix option the original report recommended first ("restrict paper edit and submit to the requester … the simplest"). The finding was "someone who shaped the paper votes on it"; with requester = author = submitter that person is always the requester, whom every not_self check already excludes. The test pins both refusals and the unchanged row, and `assertPaperAuthor` fails closed on an unknown requester (`decisions.service.ts:325-330`; applied in `update` :302 and `submit` :336 after role and state). Not weakened. **Residual:** the paper's evidence links (DOM-P2-14, part of the submission) can still be added by any holder of `governance.decision.draft` + `documents.evidence.link` (e.g. a voting finance member) — reproduced by DEFECT SEC-P34-13; probe CONTROL confirms the PATCH / submit refusals still hold at `5bf274b`. | **CONFIRMED WITH RESIDUAL** (SEC-P34-13, Low) |
| **SEC-P2-03** | OBSERVED: sponsor (gate reviewer + approver) is offered `gate_decision` (true); decide → 403 | offered → **false**; decide → 403 (unchanged) | Yes — the only change is the flip of the exact assertion that pinned the defect; the command-side assertion is unchanged. `my-work.service.ts` uses the command's subjects. | **CONFIRMED** |
| **SEC-P2-06** | OBSERVED: hidden document → 422 `documents.disposal_request_invalid`, unknown id → 404 | hidden → **404**, unknown → 404 | Yes — the required behaviour ("404 like a missing document") is asserted with the same setup; the removed `code` assertion belonged to the 422 path. | **CONFIRMED** |
| SEC-P2-01 (brief: prerequisites of decisions / agreements) | DEFECT: prerequisite labels / activity shown to a caller without the read permission | renamed "(fixed, regression)", assertions unchanged | Yes. **Residual:** `RecordVisibility.permitted` checks the type permission RBAC-only (`record-visibility.ts:250-253`), not its reach — a workstream-only reader is shown an agreement's code + title it cannot open (reproduced, DEFECT SEC-P34-12). | **CONFIRMED WITH RESIDUAL** (SEC-P34-12, Low) |
| SEC-P2-05 (brief: evidence link conditions) | OBSERVED: contributor links to a legal-owned G2 criterion (201) | contributor link → 403, no row; the owner role links → 201 | Yes. For the P3/P4 target types the link checks only the RBAC grant of the target permission — documented in access-matrix §6 (documents, after the table) — which is what makes SEC-P34-01 and -13 possible. | **CONFIRMED** |

The full suite (§1.3) runs `p2-sec-probes.spec.ts` at `5bf274b`: see its result there.

---

## 5. Findings

| ID | Severity | Where | Finding | Reproduction | Recommendation |
|---|---|---|---|---|---|
| **SEC-P34-01** | **Medium** | `readiness/checks.service.ts:441-457` (+ `packages/domain/src/readiness.ts:75-104`); `jv/transactions.service.ts:899-918` (+ `packages/domain/src/jv.ts:513-517`); static, same pattern: `newco/legal-entities.service.ts:280-286` (incorporation verify: not_self vs the status recorder only), `newco/regulatory.service.ts:276-283` (conditions satisfied: vs outcome recorder only), `finance/benefits.service.ts:271-273` (vs realization recorder only), `jv/postclose.service.ts:147-157` (obligation verify: vs owner and completion reporter only); link path `documents/evidence.service.ts:189-199` | **Verifications accept the person who recorded the evidence.** Access-matrix §5.1 lists "record owner and the person who recorded the status/**evidence**" as self for `readiness.check.signoff`, `jv.cp.verify`, `newco.incorporation.verify`, `newco.regulatory.verify`, `finance.benefit.verify`. The P3/P4 commands exclude the owner / creator / status recorder / submitter but never the evidence linkers (P2 gate criteria do: "not_self vs every active evidence linker"). The verifier roles hold the link permission for these targets (WSL `readiness.check.manage`; LEG `jv.cp.manage`, `jv.closing_checklist.manage` (obligations), `newco.incorporation.manage`, `newco.regulatory.manage`; FIN `finance.benefit.manage`), so one person can supply the only evidence and then verify it once someone else ran the status command. Compensation: audit trail; `documents.evidence.verify` exists but is not required. | DEFECT SEC-P34-01 (both specs): contributor creates + tests a WS1 check, the workstream lead links its only evidence and signs it off → **201** `passed` (required 403); Legal links the only evidence of a CP, the PM submits it, Legal verifies → **201** `verified` (required 403). | Add the active evidence linkers of the target (`evidence_link.added_by`, status active) to `selfUserIds` / `requesterUserId` subjects of every verification of §5.1 (sign-off, CP verify, obligation verify, incorporation verify, regulatory outcome / conditions, benefit verify), failing closed; or require the evidence to be verified (`documents.evidence.verify`) by someone other than the verifier. |
| **SEC-P34-02** | **Medium** | `modules/ai/ai-knowledge.service.ts:317-336` (`tsaExpiring`: `visibilitySql(ctx, projectId, {})` — no TSA classification, no readiness reach); `:539-545` (citation re-check for `tsa_service`: no classification, `sql\`true\`` reach); exposed by `ai-detections.service.ts:286-306` → `GET …/ai/detections` (`ai-ops.service.ts:155-160`) and by the `list_tsa_expiring` tool / briefings | **AI detections disclose TSAs the caller may not read.** Code, name, end date and status of every live TSA ending within 60 days are listed regardless of the TSA's classification and workstream; the TSA module hides them (404, list). Violates access-matrix §2.5 ("AI retrieval … inside SQL with the same predicates"). | DEFECT SEC-P34-02: a `restricted` active TSA ending in 10 days — PM and contributor GET → 404 (CONTROL); contributor `GET /ai/detections` → 200 with `tsa_expiring` "TSA-001 P34SEC-TSA-CANARY … ends 2026-10-11 … (status active)". | In `tsaExpiring` (and every AI query of a classified P3/P4 table) use `visibilitySql(ctx, pid, { classification: tsaService.classification })` and `reachSql(ctx, 'readiness.register.read', pid, tsaService.workstreamId)`; do the same in `visibleCitationKeys` for `tsa_service`. Add an AI test per P3/P4 record type (classification + reach), like `ai-retrieval-acl.spec.ts`. |
| **SEC-P34-03** | **Medium** | `modules/ai/ai-knowledge.service.ts:380-426` (`approvedFinancials`: RBAC `canInProject('finance.record.read')`, plain classification, **no finance reach**); citation re-check `:559-566`; tool `ai-tools.service.ts:205-225` | **AI answers with approved figures and valuations outside the caller's finance reach** (P4 exit criterion "finance-domain clearance and reach"). A principal whose `finance.record.read` is workstream-scoped (e.g. the demo tech / ops leads: project contributor + workstream lead) gets project-level and other-workstream approved figures (amounts — reproduced) and approved valuation outputs (same query pattern, `:383-404` — static) up to its clearance; the finance module refuses them (404). Compensation: clearance and the permission itself still apply (plain clearance is even stricter than the finance-domain one); AI must be enabled; only approved records. | DEFECT SEC-P34-03: approved project-level figure (9876.0000 SAR, confidential) — tech lead `GET /financial-snapshots/:id` → 404 (CONTROL); `knowledge.approvedFinancials` returns it; `POST /ai/ask` "What is the approved actual amount …?" → 201 and the answer contains the figure. | Reuse the finance module's predicate for every AI finance query: `FinanceSupport.visibleSql` semantics (finance-domain clearance + `reachSql('finance.record.read', …, workstream_id)`; project-wide grant for tables without a workstream, as in `record-visibility.ts:89-95`) in retrieval and in `visibleCitationKeys`. |
| **SEC-P34-04** | **Medium** | `jv/diligence.service.ts:207-214` (`create`), route `jv.createDdRequest` (`access: jv.dd_request.create`, held by `external_partner_limited`); compare `externalCreate` `:400-406` | **A counterparty account writes an internal-origin DD request.** The internal route accepts external accounts (the permission and the room conditions pass for their own room with a contribute grant) and stores `origin: 'internal'`, a free `requesterLabel`, a due date and a classification chosen by the counterparty; the counterparty route hard-codes `origin: 'partner'`, `requesterLabel: 'Counterparty'`, no due date. Internal users then see a question that looks internal (e.g. "Mobily Legal") — integrity / social-engineering risk across the partner boundary. Compensation: the record stays in the counterparty's own room; answers still need review and release by two internal people. | DEFECT SEC-P34-04: external account `POST /diligence-requests` → **201**; stored `{"origin":"internal","requester_label":"Mobily Legal (spoofed label, synthetic)","due_date":"2026-12-31","classification":"internal"}` (required 403/404). CONTROL: the counterparty route records `origin partner / Counterparty`. | Refuse room-only / external principals on the internal DD routes (e.g. `assertListable`-style `isRoomOnly` → 404, or require `account_type = 'internal'`), or derive `origin` / label from the principal's account type. Review the other internal routes whose permission an external role holds (only `jv.dd_request.create` today) and keep an invariant test. |
| **SEC-P34-05** | **Medium** | `newco/regulatory.service.ts:206-221` (applicability), `:269-274` (record outcome with dates, validity, conditions), `:276-283` (conditions satisfied); policy matrix `newco.regulatory.verify` → `functional_approver`, `legal_restricted` (`carveout-rules.spec.ts:135` asserts the approver's assessment succeeds) | **REQ-AGR-004 "regulatory register restricted to Legal/Regulatory roles for edits" is not met for the verification commands.** A functional approver with no legal / regulatory role records applicability determinations (including `not_applicable`, which takes the requirement out of consideration), the authority's grant / refusal with validity and conditions, and conditions satisfied — regulatory determinations the project rules reserve to specialists ("Assessment pending — specialist"). Compensation: not the registrant; evidence required for outcomes; audited. | DEFECT SEC-P34-05: Legal creates a requirement; the approver (roles: `functional_approver` only) → `assess-applicability` `not_applicable` → **201**. | Restrict `newco.regulatory.verify` to Legal/regulatory specialists (drop `functional_approver` in the matrix, or require `legal_restricted` in the service like `assertAssignedSpecialist`), or record a Mobily decision amending REQ-AGR-004 and access-matrix §5.1. |
| **SEC-P34-07** | **Medium** | `carveout/perimeter.service.ts:211-225` (`consentsOf`: no classification, no project-wide reach), used by `detail` `:263`, `day1Positions` `:877`, `setTransferability` `:770`, `setInterimArrangement` `:797`, `reconciliation` `:818` (statuses) | **Consents above the caller's clearance are disclosed inside perimeter items.** Consent code, kind, counterparty, status and due date are returned with a readable item even when the consent is classified above the reader's clearance; the consent register filters them (and requires a project-wide read). | DEFECT SEC-P34-07: a `restricted` consent (created by a Legal member cleared `restricted`) on a `confidential` contract item — PM `GET /consents` hides it (CONTROL); PM `GET /perimeter-items/:id` → consents include "P34SEC-RESTRICTED-COUNTERPARTY Fictional Landlord"; also in `GET /perimeter/day1-contract-positions`. | Filter `consentsOf` with `visibilitySql(ctx, pid, { classification: consent.classification })` (and hide consents from callers without a project-wide `carveout.register.read`, or show only a count-free "restricted" marker); use the filtered list for display, the unfiltered one only for the Day-1 rule. |
| SEC-P34-06 | Low | `readiness/tsa.service.ts:207-221` (`showCharge = canInProject('finance.record.read')`) | TSA charge / charge basis shown by the RBAC grant alone: a principal whose finance read is workstream-scoped sees the charge of project-level and other-workstream TSAs it can read through another role; not the finance-domain clearance either. | DEFECT SEC-P34-06: tech lead (finance read on WS1 only; project contributor) → project-level TSA `charge 4321.0000 SAR`, `chargeBasis` shown; the same principal is refused a project-level budget line (404, CONTROL). | Show the charge only when `FinanceSupport.canRead(ctx, pid, { classification: tsa.classification, workstreamId: tsa.workstreamId })` holds (finance-domain clearance + reach). |
| SEC-P34-08 | Low | `readiness/tsa.service.ts:290-311` (no clearance check on the resulting classification; only declassification is refused) | A TSA manager relabels a TSA above its own clearance (access-matrix §2.4: the resulting classification ≤ the editor's clearance, else 403). The record then disappears for the editor and for every finance / readiness reader below it (a PM can hide a TSA from the whole team). Creating above clearance is refused. `readiness-isolation.spec.ts` relies on this behaviour. | DEFECT SEC-P34-08: PM (confidential) PATCH `classification: strictly_confidential` → **200**, stored `strictly_confidential`. | Apply the create rule on update (`assertClassificationAllowed`-style 403); adapt `readiness-isolation.spec.ts` to raise with a cleared editor. |
| SEC-P34-09 | Low | `jv/diligence.service.ts:454-470` (`listFindings`), `:140-155` (`list`): visibility SQL only, no grant coverage | A workstream-only holder of `jv.dd_request.read` lists project-level DD findings (title, materiality, valuation / document / CP implications) that `GET` refuses (403) — the SEC-P2-08 pattern (list ≠ detail). | DEFECT SEC-P34-09: finding → `GET /diligence-findings/:id` 403 (CONTROL); list → 200, total 1, the finding's title. | Add `policy.grantSql(ctx, 'jv.dd_request.read', pid, { room: t.roomId })` to both lists and counts. |
| SEC-P34-10 | Low | `jv/transactions.service.ts:591-598` (`itemNotRequired`, `jv.closing_checklist.manage`) | One person (PM or Legal) removes a pending / delivered signing or closing deliverable from the blockers by marking it "not required" (reason only; no second person, no authority, no approval record). CPs cannot be bypassed this way. | OBSERVED SEC-P34-10: blocker present → `not-required` 201 → blocker gone; no approval request. | Decide (domain / Legal): require a second person (e.g. `jv.cp.verify` holder, not the requester) or a request / approval for "not required" on deliverables of an event in preparation. |
| SEC-P34-12 | Low | `platform/record-visibility.ts:87, 250-253`; `planning/prerequisites.service.ts:57-66` | SEC-P2-01 residual: the predecessor's read permission is checked RBAC-only, not with its reach, so a workstream-only reader sees the code + title of a project-level agreement (and decision) listed as the prerequisite of its own task; the same predicate drives the `record_dependency` activity rule. | DEFECT SEC-P34-12: workstream-only lead → `GET /agreements/:id` 404 (CONTROL); prerequisites of its task → "AGR-001 P34SEC-AGREEMENT-CANARY …". | In `permitted`, use the permission's coverage (`grantSql` / `permissionReach(...).all` for project-level types such as agreement, decision, regulatory requirement, consent), or give those rules `ws: <perm>, wsCol: null`. |
| SEC-P34-13 | Low | `documents/evidence.service.ts:189-199` (decision target: RBAC grant of `governance.decision.draft` only) | SEC-P2-02 residual: a voting member who is not the requester adds evidence links to the requester's draft paper (the paper's supporting evidence, DOM-P2-14) and may still vote on it. | DEFECT SEC-P34-13: finance → `POST /evidence` on the PM's draft decision → **201** (PATCH / submit → 403, CONTROL). | For `decision` targets in `draft` / `submitted`, require the requester (like `assertPaperAuthor`), or add the evidence linkers to the decision's self ids (review, vote, outcome). |
| SEC-P34-11 | Info | §2.2 | "Creator = owner" of create commands: decided **not a vulnerability** (documented §2.4 semantics; creates bounded by the grant's scope). | OBSERVED SEC-P34-11. | Document (§2.2); decide contributor powers on `blocker` / `signoffRole` / bulk template instantiation. |
| SEC-P34-14 | Info | `jv/jv.support.ts:84-88`; `jv/transactions.service.ts:199-219, 360` | JV applies no domain clearance (§2.3): Finance / Legal cannot classify ownership scenarios or negotiation positions above their base clearance (§2.3 proposes `strictly_confidential`), so they default to `confidential` and are readable by every `jv.deal.read` holder at that clearance (PM, auditor, chair, sponsor). Closings, CPs, checklist items and funds-flow lines carry no classification (the `C` condition of `jv.deal.read` is vacuous for them; funds-flow amounts visible to Legal / chair / auditor). | Static. | Mobily data governance to confirm the JV classifications; if confirmed, apply `financeDomainClearance`-style legal / finance domain clearance in JV and classify funds-flow lines as finance data. |
| SEC-P34-15 | Info | `platform/record-visibility.ts:105` (`partner_room`: classification only); `portfolio.service.ts:640-683` | Auditors (audit.event.read) see `partner_room` events (room opened / viewed / locked with reason, external disclosure views) of rooms — including clean-team rooms — they hold no grant for. Metadata only (content types are room-filtered); auditors are "excluded from rooms without an explicit grant" (§3). | Static. | Decide whether room-level audit metadata is part of the auditor's function; if not, add `r`-style filtering (`id = ANY(granted rooms)`) to the `partner_room` rule for auditors. |
| SEC-P34-16 | Info | `perimeter.service.ts:266-270` (agreement code by classification only), `:414-421` (TSA / readiness codes in impact references without classification), `:744-749` (redaction by reach only); `agreements.service.ts:305-337` (item / agreement codes in consent rows); `checks.service.ts:280-293, 320-321` (template-instantiation counts / uncovered areas over all checks); `ai-knowledge.service.ts:241-245` (pending approval requests: subject type + action, unscoped) | Record codes / counts outside the caller's scope in secondary fields. | Static. | Filter with the same predicates as the owning list when touched. |
| SEC-P34-17 | Info | policy matrix; `jv/jv.jobs.ts:14` | `jv.submission.upload`, `jv.clean_team_output.submit`, `jv.clean_team_output.release` are used by no route (fail-closed; access-matrix §10 invariant 2 wants "used or reserved"); `svc-jv` holds `jv.cp.manage` + `jv.closing_checklist.manage` although the scans only mark lapses / overdue and raise escalations. | Static (`grep`). | Mark the three permissions reserved; narrow the service allowlist when a finer permission exists. |
| SEC-P34-18 | Info | `jv/deals.service.ts:323-337` | The holder of `jv.negotiation.manage` (sponsor / Legal) may clear `requiresApproval` on an open issue and then agree it without a decision (audited). | Static. | Domain decision: freeze `requiresApproval` once set, or require a second person to clear it. |

---

## 6. Verdicts

| Phase / item | Verdict |
|---|---|
| **P3** | **PASS WITH CONDITIONS** — Medium SEC-P34-01 (P3 part), -02, -05, -07 to be fixed before the P3 gate; Low SEC-P34-06, -08, -12; Info -11, -16. The self-owner claim is decided (§2.2). |
| **P4** | **PASS WITH CONDITIONS** — Medium SEC-P34-01 (P4 part), -03, -04 to be fixed before the P4 gate (SEC-P34-03: the finance exit criterion is not met for the AI channel until then); Low SEC-P34-09, -10, -13; Info -14, -15, -17, -18. Partner isolation (reads), "NDA alone is not sufficient" and "missing CP blocks closing" are met with real runs. |
| **P2 closure re-check (C2)** | SEC-P2-02 CONFIRMED WITH RESIDUAL (SEC-P34-13); SEC-P2-03 CONFIRMED; SEC-P2-06 CONFIRMED; SEC-P2-01 CONFIRMED WITH RESIDUAL (SEC-P34-12); SEC-P2-05 CONFIRMED. |

Files added by this review: `docs/reviews/P3-P4-security-review.md`, `apps/api/test/reviews/p34-sec-registers.spec.ts` (16 tests:
7 `DEFECT` expected fails, 1 `OBSERVED`, 8 `CONTROL`), `apps/api/test/reviews/p34-sec-jv.spec.ts` (11 tests: 5 `DEFECT` expected
fails, 1 `OBSERVED`, 5 `CONTROL`). The `DEFECT` tests must not be weakened; they turn red when the finding is fixed.

---

## 7. Review commit

Review commit `0b39873` (this document and the two probe specs, parent `5bf274b`). Secret scans of that commit with the
repository's script:
```
$ GITLEAKS=…/gitleaks-8.30.1 bash scripts/ops/secret-scan.sh tree
  tree: 1075 committed files at HEAD 0b39873 … INF no leaks found  PASS  tree: no findings  SECRET SCAN (tree): PASS
$ GITLEAKS=… bash scripts/ops/secret-scan.sh history
  history: 280 commits reachable from HEAD 0b39873 (whole repository) … INF 195 commits scanned. … INF no leaks found
  PASS  history: no findings  SECRET SCAN (history): PASS
```
This section was filled in by a follow-up documentation commit. Nothing was pushed; no process started by the reviewer is left
running.
