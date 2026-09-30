# P2 security review: governance, planning, gates, documents — and re-verification of the P1 security closures

| Item | Value |
|---|---|
| Reviewer | `security-privacy-reviewer`, independent review in its own context. The reviewer implemented none of the reviewed code. It added one probe spec (`apps/api/test/reviews/p2-sec-probes.spec.ts`) and this document; no implementation file and no existing test was changed. |
| Revision reviewed | **`1b30f4886bb413c009745d55cb2f7c2881537b03`** (`1b30f48`, head of `claude/mobily-transformation-hub` after `git fetch`; "P1 gate report …; merge DOM-P2-16 gate owner/reviewer enforcement"). Frozen for the whole review. Every result below was produced at `1b30f48` (plus the uncommitted probe spec, which only adds a test file), except the final scans in §1.9, which ran at the review commit (this document + the probe spec, parent `1b30f48`). |
| Scope | Part A: `apps/api/src/modules/{governance,planning,gates,documents}`, their web screens, `apps/api/src/platform/{policy.service,record-visibility,helpers}.ts`, `packages/db/sql/post-migrate.sql` for the P2 tables. Part B: the P1 closures SEC-P1S-01/-02/-03/-04/-07 made by the lead in `65b53e9` (conditions of `docs/phases/P1-gate-report.json`). Plus the access-matrix §2.2 design question. |
| Databases | Own databases on the shared cluster `127.0.0.1:5432`: `hub_test_p2sec` (+`_boot`) for the full suite, `hub_test_p2secprobe` (+`_boot`) for the probe spec, all created with `pg-init-roles.sh`. No other database was touched. PostgreSQL was already running (not started by the reviewer). |
| Processes | Only vitest runs, `tsc`, `node` (module-boundary checker), gitleaks. No server, no Docker. One full-suite run was stopped by the reviewer (its own PIDs 21822/21163) because another agent overwrote its log file in the shared scratchpad; it was restarted with a private log directory and completed (§1.2). No external host was contacted. |
| Scratch data | All secret-injection probes ran in a **scratch clone** of the reviewed revision under the session scratchpad (`p2sec-ac401/repo`), committed there only, never pushed, and reset to `1b30f48` afterwards. Values were random, generated at run time, never printed or stored elsewhere, and are not reproduced here; scanner reports used `--redact=100`. |
| **Verdict** | **PASS WITH CONDITIONS.** No Critical or High finding. Two **Medium** findings (SEC-P2-01 record-visibility leak of prerequisite predecessors; SEC-P2-02 decision separation of duties narrower than documented), both reproduced by failing `DEFECT` probes, must be fixed before the P2 gate. Part B: SEC-P1S-01, -03, -04, -07 **CONFIRMED**; SEC-P1S-02 **CONFIRMED WITH A RESIDUAL** (Low SEC-P2-09). §2.2: recommend amending the access matrix to the implemented stricter rule with an explicit, machine-readable exception list (§3). |

Severity scale (as in the P1 reviews): **Critical** isolation/security bypass; **High** a control the gate relies on does not
work or is unverified; **Medium** a control is materially weaker than documented, with compensation elsewhere; **Low**
limited exposure or defence-in-depth gap; **Info** observation / documentation.

---

## 1. Commands run and real results

All commands ran in `transformation-hub/` of the review worktree unless stated otherwise. `$S` is the reviewer's private
scratch directory (`<session scratchpad>/p2sec-ac401`); `GITLEAKS` pointed at the pinned 8.30.1 binary.

### 1.1 Environment
```
$ git fetch origin claude/mobily-transformation-hub; git log --oneline -1 origin/claude/mobily-transformation-hub
  1b30f48 P1 gate report (PASS WITH CONDITIONS at 65b53e9, CI run 32 green); merge DOM-P2-16 …   (worktree already at 1b30f48)
$ pg_isready -h 127.0.0.1 -p 5432                                  → accepting connections
$ HUB_DATABASES="hub_test_p2sec hub_test_p2sec_boot" bash scripts/dev/pg-init-roles.sh
  → roles hub_owner/hub_app and databases ready: hub_test_p2sec hub_test_p2sec_boot
$ pnpm install --frozen-lockfile --prefer-offline                  → Done in 3s
$ pnpm build:packages                                              → domain / contracts / db built
$ $GITLEAKS version                                                → 8.30.1
```

### 1.2 Full API suite at `1b30f48`
```
$ TEST_DATABASE_URL=postgres://hub_app:…@127.0.0.1:5432/hub_test_p2sec \
  TEST_DATABASE_MIGRATION_URL=postgres://hub_owner:…@127.0.0.1:5432/hub_test_p2sec pnpm --filter @hub/api test
 Test Files  80 passed (80)
      Tests  709 passed (709)
   Duration  1009.72s
exit=0
```
80 files = every committed `apps/api/test/**/*.spec.ts` at `1b30f48` (`git ls-files … | wc -l` → 80); the probe spec did not
exist yet when this run started.

### 1.3 Static checks
```
$ (apps/api) npx tsc -p tsconfig.json --noEmit                    → exit 0   (includes test/**, with the probe spec)
$ (apps/api) node scripts/check-module-boundaries.mjs
  module boundary check passed: 32 cross-module imports, 14 module edges, acyclic, only published surfaces   exit=0
```

### 1.4 P2 probe spec (`apps/api/test/reviews/p2-sec-probes.spec.ts`, own database `hub_test_p2secprobe`)
```
$ (apps/api) TEST_DATABASE_URL=…/hub_test_p2secprobe TEST_DATABASE_MIGRATION_URL=…/hub_test_p2secprobe \
  npx vitest run test/reviews/p2-sec-probes.spec.ts --reporter=verbose
 ✓ §2.2 … OBSERVED: can start G1 as its owner, but GET /gates and GET /gates/:id answer 403 (the stricter reach rule)
 ✓ §2.2 … OBSERVED SEC-P2-08: the same principal LISTS and SEARCHES project documents (titles) but GET /documents/:id answers 403
 ✓ SEC-P2-01 … CONTROL: the portfolio administrator holds planning.plan.read but may not read decisions or agreements
 × SEC-P2-01 … DEFECT SEC-P2-01: the prerequisite list never shows a decision / agreement to a caller who cannot read it
   → labels shown to the portfolio administrator: ["DEC-001 Confidential steering decision SECP2 probe (synthetic)",
     "AGR-001 Asset transfer agreement SECP2 probe (synthetic)"]: expected [ …(2) ] to deeply equal []
 × SEC-P2-01 … DEFECT SEC-P2-01: the activity feed lists a prerequisite only when its predecessor is readable (record-visibility rule)
   → record_dependency events listed to the portfolio administrator: expected 2 to be +0
 × SEC-P2-02 … DEFECT SEC-P2-02: a member who rewrote and submitted the paper cannot vote on it
   → {"id":"…","round":1}: expected 201 to be 403
 ✓ SEC-P2-03 … OBSERVED: the sponsor endorsed G0 (as PM) and holds the approver role: offered gate_decision, refused by decide (403)
 ✓ SEC-P2-05 … OBSERVED: a contributor links evidence to a legal-owned G2 criterion (201) but may not submit it (403)
 ✓ SEC-P2-06 … OBSERVED: for a document the caller cannot see, dispose answers 422 (known id) vs 404 (unknown id)
 ✓ … OBSERVED SEC-P2-07: a project-level dependency of A (no local item) is shown to a workstream-only reader of A
 ✓ … CONTROL: the activity feed never lists cross_project_dependency events to non-auditors (404 for the type)
 ✓ … OBSERVED SEC-P2-04: the database accepts a prerequisite predecessor of another project, and an other-item that is not in the other project
 Test Files  1 failed (1)
      Tests  3 failed | 9 passed (12)
```
The three failures are the `DEFECT` tests: each asserts the **required** behaviour and reproduces a Medium finding; they
must not be weakened and will pass once the findings are fixed. `OBSERVED` tests pin the current behaviour of Low/design
items (update them together with the fix). The output above is the last run (`probe-3`), made with the spec exactly as
committed; two earlier runs of the same probes (before the SEC-P2-08 test and the failure messages were added) gave the same
results (11 tests: 3 failed / 8 passed; 12 tests: 3 failed / 9 passed).

### 1.5 SEC-P1S-04 regression spec (P1 review probe, own database)
```
$ npx vitest run test/reviews/p1-sec-finance-visibility.spec.ts --reporter=verbose
 ✓ … for every persona and finance record: evidence list and history visible exactly when the finance module GET is 200
 ✓ … a per-type history feed never lists a finance record that the finance lists hide from the caller
 ✓ … the auditor (clearance-bound, no reach) sees evidence-link events only for finance records it can read
 ✓ … a document's evidence counters count only links to finance records the caller can read
 ✓ … room-only principals (clean team / partner) of the demo project see no finance evidence or history
 ✓ … SEC-P1S-04 (fixed, regression): the evidence counter of a figure / benefit detail counts only evidence the caller can read
 Test Files  1 passed (1)   Tests  6 passed (6)
```
`git show 65b53e9 -- apps/api/test/reviews/p1-sec-finance-visibility.spec.ts`: only the test **name** changed (DEFECT →
"fixed, regression"); its assertions are the reviewer's original ones.

### 1.6 Secret scan of the reviewed revision (the repository's script)
```
$ GITLEAKS=… SECRET_SCAN_REPORT_DIR=$S/reports-base bash scripts/ops/secret-scan.sh tree
  tree: 941 committed files at HEAD 1b30f48 … INF no leaks found … SECRET SCAN (tree): PASS
$ … bash scripts/ops/secret-scan.sh history
  history: 218 commits reachable from HEAD 1b30f48 (whole repository) … INF 152 commits scanned. … no leaks found … SECRET SCAN (history): PASS
```

### 1.7 Planted-secret probe S1 (SEC-P1S-01 / -03), scratch clone, both modes of `secret-scan.sh`
`$S/plant.py` appended, to each file below, four random lines of four kinds — a `generic-api-key` assignment (40
random characters), a connection URL with a random 24-character password (`hub-url-embedded-password`), a GitHub
token shape (`github-pat`) and an AWS access-key-id shape (`aws-access-token`) — and wrote the REDACTED-placeholder URL
used by the P1 QA re-review into six paths. The clone committed the result (`45b9fa6`, scratch only); the clone's own
`scripts/ops/secret-scan.sh tree` and `history` scanned it; `$S/check.py` compared the redacted JSON reports with the
planted positions:
```
tree:    exit=1   SECRET SCAN (tree): FAIL (1)       → [tree]    38 as expected, 0 unexpected, 0 extra findings; report findings total 37
history: exit=1   history: 219 commits … 153 commits scanned  → [history] 38 as expected, 0 unexpected, 0 extra findings; report findings total 37
```
| Group | Paths | Planted | Expected | tree | history |
|---|---|---|---|---|---|
| allow-listed (SEC-P1S-01) | `apps/api/test/p1/oidc-sso.spec.ts`, `apps/api/test/p1/sec-p1r-fixes.spec.ts`, `apps/api/test/documents/storage-contract.spec.ts`, `deploy/docker/api-entrypoint.cjs`, `docs/reviews/P1-qa-rereview.md`, new `docs/reviews/probe-new-review.md` | 4 kinds × 6 files = 24 | detected | 24/24 | 24/24 |
| control (no entry names the path) | new `docs/security/probe-control.md`, new `apps/api/test/p1/probe-control.spec.ts` | 8 | detected | 8/8 | 8/8 |
| REDACTED scope (SEC-P1S-03) | `transformation-hub/docs/reviews/probe-redacted.md` | 1 | **allowed** | allowed | allowed |
| REDACTED scope | `trading_agent/docs/reviews/…md`, `transformation-hub/apps/web/public/docs/reviews/…md`, `docs/reviews/sub/…md`, `docs/reviews/…txt`, `docs/security/…md` | 5 | detected | 5/5 | 5/5 |

"0 extra findings" also shows that the committed synthetic values in the allow-listed files are still accepted (only the
37 planted findings were reported) — the entries are exactly as narrow as intended in **both** the git and the directory
source. The clone was reset (`git reset --hard 1b30f48 && git clean -fd`).

### 1.8 `.gitleaksignore` probes (SEC-P1S-02) and module-boundary probes (SEC-P1S-07), scratch clone / scratch copies
```
S2a  untracked transformation-hub/.gitleaksignore, history → exit=1  "FAIL …/transformation-hub/.gitleaksignore exists: fingerprint suppressions are not allowed …"
S2b  untracked <repo>/.gitleaksignore, tree              → exit=1  "FAIL …/.gitleaksignore exists: …"
S2c  secret committed in docs/security/probe-fp.md; its fingerprint committed in transformation-hub/scripts/ops/.gitleaksignore
     git ls-files --error-unmatch .gitleaksignore '*/.gitleaksignore'  → "pathspec '.gitleaksignore' did not match" exit=1  (script check does not fire)
     git ls-files --error-unmatch '*/.gitleaksignore'                  → exit=0
     cwd=transformation-hub (CI working directory): history → exit=1  SECRET SCAN (history): FAIL (1)      (nested file not read)
     cwd=transformation-hub/scripts/ops:            history → exit=0  "no leaks found" SECRET SCAN (history): PASS   ← suppressed
S2d  secret committed in docs/test-evidence/probe-report.md (scanned by the CI `reports` step)
     reports docs/test-evidence (cwd transformation-hub) → exit=1, fingerprint "docs/test-evidence/probe-report.md:hub-url-embedded-password:1"
     + committed docs/test-evidence/.gitleaksignore with that line
     reports docs/test-evidence (cwd transformation-hub, as in CI) → exit=0 "no leaks found" SECRET SCAN (reports): PASS   ← suppressed
```
In S2d the same commit is still reported by the `history` and `tree` steps of the same CI job (the ignore file only
affects the scan whose root contains it). `$S/boundary_probe.py` (scratch copies of `apps/api/{scripts,src}`, one
injected import in `modules/jv/jv.controller.ts` each):
```
OK  B0 unchanged copy                                   want=pass got=pass  (32 cross-module imports, 14 module edges)
OK  B1 single-quoted import of documents/documents.controller   want=fail got=fail
OK  B2 double-quoted import (P1 miss)                   want=fail got=fail
OK  B4 require() (P1 miss)                              want=fail got=fail
OK  B5 re-export with double quotes                     want=fail got=fail
OK  B7 multi-line import                                want=fail got=fail
OK  B8 type-only import                                 want=fail got=fail
OK  B9 explicit .js extension                           want=fail got=fail
OK  B10 side-effect import                              want=fail got=fail
GAP B11 dynamic import with a template literal          want=fail got=pass   (no such import exists in apps/api/src: grep "import(`" → 0)
```

### 1.9 Review commit (this document + the probe spec)
See §7 (secret scans of the review commit).

---

## 2. Part A — P2 modules

### 2.1 Authorization on P2 routes

Every route is declared in `packages/contracts` with a permission; `HubGuard` (`platform/hub.guard.ts:153-167`) refuses an
out-of-scope `:projectId` with 404 and a missing project permission with 403 before the handler; services then apply
`PolicyService.assert/assertApproval/assertGranted` with the record's classification (and workstream, room, requester,
authority). The P1 QA sweep (487 project routes, anonymous/admin/auditor) still applies to the P2 routes, and the full suite
(§1.2) passes. The review focused on the new and changed P2 routes:

| Route family | Permission / scope / attributes | SoD and fail-closed inputs (I-R3) | Result |
|---|---|---|---|
| External approval `POST …/decisions/:id/record-external-approval` (`decisions.service.ts:530-580`) | `record_external_approval` + decision classification; decision must be `recommended`; evidence link loaded **in project**, must target this decision, be active and verified (`governance.ts:503-519`) | not_self vs the requester (`:537`), vs the recommendation recorder (`assertApprovalAllowed`), vs the evidence **verifier** (`:557`); null requester/verifier → 403 `policy.sod_subject_unknown` | OK (tests `p2-governance-authority.spec.ts:410-434`). Info I-2: the link is loaded without the recorder's document visibility and may be a note-only link. |
| Matrix `approve` / `verify-approval` (`committees.service.ts:340-470`) | approve: `authority_matrix.approve`, committee classification, approval document visible to the approver (`approvalDocument`, `:494-500`); verify: `documents.evidence.verify` (route + `assertGranted`) | approve not_self vs drafter; verify not_self vs approver, drafter **and** uploader of the version bound at approval (null uploader → fail closed); verifier must be able to read the document; concurrency bound to `approvedBy/approvedAt` | OK (tests `p2-governance-authority.spec.ts:359-399`). Info I-5: `approvalDocumentId` is shown to every committee reader (id only). |
| Decision paper, submit, review, vote, outcome (`decisions.service.ts:193-450`) | `decision.draft` / `submit` / `review` / `vote` / `record_outcome` + decision classification; vote also needs an active voting seat, presence and quorum | not_self **only vs `requesterUserId`** (the creator). Any holder of `decision.draft`/`submit` may edit and submit anyone's draft; neither editor nor submitter is a self id | **SEC-P2-02 (Medium)** |
| Cross-project dependencies (`cross-project.service.ts`) | create: `dependency.manage` on the local item's workstream; other end: full member of the other project + `readScope` + `assertReadable(item.workstream)`; list/close: both ends readable, filtered before paging (`total` = visible) | no approval | OK for the other end (existing tests + probe CONTROL). **SEC-P2-07 (Low)**: without a local item, the dependent side is not reach-checked. Audit only in the dependent project; not in the activity allow-list (404 for the type, probe CONTROL). |
| Prerequisites (`prerequisites.service.ts`) | create/remove: `dependency.manage` on the successor's workstream; predecessor loaded in project (404) and `canSeePrerequisite`; list: successor reach, then `canSeePrerequisite` | rule (`assertNonePending`) counts every prerequisite; refusal gives a count only | **SEC-P2-01 (Medium)**: `canSeePrerequisite` ignores the predecessor type's read permission. |
| Gate owner commands `start`, `mark-ready`, `back-to-assessment`, `link-decision` (`gates.service.ts:188-295`, `assertGateOwner` `:939-949`) | `gates.assessment.submit` with `ownerRoles:[gate.ownerRole]` (own_workstream): owner role (project-wide, or a workstream-scoped grant evaluated on that workstream) or `project_manager`; 403 `gates.not_gate_owner` otherwise; human actor only | mark-ready: endorsement current (422) and submitter ≠ endorsing reviewer (403; unknown → `policy.sod_subject_unknown`) | OK (`dom-p2-16-gate-roles.spec.ts`). |
| Gate review `POST …/assessment/review` (`:215-240`, `assertDesignatedGateReviewer` `:957-968`) | `gates.assessment.review` + the gate's `reviewerRole` (403 `gates.not_designated_gate_reviewer`); role → state (in assessment; endorse needs criteria complete, 422) → SoD | not_self vs the **starter** via `separationSubject` (null starter → 403 `policy.sod_subject_unknown`); records `reviewBasis` = SHA-256 of `gateReviewBasis` (criterion definition versions, criterion-assessment row versions, every evidence link id/status/version, every waiver id/status/version of the gate's criteria; `gates.evaluation.ts:161-171`, domain `gates.ts:646-660`, order-independent, unit-tested) | OK. Endorsement is bound to the hash: mark-ready compares the stored basis with the current one (`assertGateEndorsedForSubmission`, `gates.ts:682-716`); a stale / returned / missing endorsement is 422. Info I-4: `decide` does not re-check that the endorsement is still current after mark-ready (criterion commands are frozen, but documents can still add evidence links). |
| Gate `decide` (`:302-376`) | `gates.assessment.decide`, `withinAuthority` = holds the gate's `approverRole` project-wide; human actor; FINAL governance decision of the right type/committee | not_self vs submitter **and** gate reviewer (`separationSubject`, either null → fail closed) | OK. **SEC-P2-03 (Low)**: My Work offers the item to the reviewer. |
| Criterion review, N/A, waivability, waivers | designated `reviewerRole` (403 `gates.not_designated_reviewer`); waivability by the designated specialist; waiver approval by the target's authority role | criterion `met` not_self vs every active evidence linker (`NO_HUMAN_REQUESTER` only when no evidence exists); N/A vs proposer; waiver vs requester | OK. |
| Gate reads `GET /gates`, `/gates/:id`, `/waivers` | `gates.gate.read` + project classification, **no workstream** → a workstream-only principal gets 403 | — | Design question §3 (probe OBSERVED). |
| Evidence link/verify/conflict/supersede (`evidence.service.ts`) | target readable (`loadTarget`: read permission + record visibility + full member, else 404); document visible with `documents.evidence.link`; target **write** permission checked RBAC-only (`canInProject`, `:176`) | verify not_self vs linker **and** version uploader; integrity (SHA-256) re-checked on accept | OK. **SEC-P2-05 (Low)**: the target permission's `W` / owner-role condition is not applied on the link path. |
| Documents upload/download/classify/declassify/move/hold/retention/disposal | §2.4 below | declassify not_self vs owner/creator; dispose not_self vs requester, owner and creator + authority | OK except **SEC-P2-06 (Low)** (disposal answers before authorization) and **SEC-P2-08 (Low)** (list/search vs GET reach). |

### 2.2 Record visibility in SQL (`platform/record-visibility.ts`)

- `record_dependency` (`:153-159`): visible when the successor is visible (`e.target(successor)` — rule of `task`/`milestone`
  with workstream reach **and** `planning.plan.read` through `readPermission`) and when the predecessor is visible. For
  `decision` / `agreement` the predecessor is resolved with `RULES[t]` directly (`pred()`), i.e. **classification only**:
  the type-level read permission (`governance.decision.read`, `carveout.register.read`) that `targetSql` applies through
  `permitted()` (`:229-244`) is skipped. `approval_request` / `evidence_link` predecessors use their own rules, which resolve
  their targets through `e.target` (permission applied). `gate` → `true` (no record rule; `gates.gate.read` is the
  activity type permission). The same shortcut exists in `PrerequisiteService.canSeePrerequisite`, which calls
  `RecordVisibility.exists(type, id)` (`prerequisites.service.ts:58-62`) — `exists` never applies `readPermission`.
  Reproduced: the portfolio administrator (org-expanded `portfolio_admin`: `planning.plan.read` project-wide, no
  `governance.decision.read`, no `carveout.register.read`; its GET of the decision and the agreement answers 403) receives
  both prerequisites of a task with `predecessorLabel` = the decision's code + title and the agreement's code + title, and
  their `satisfied` state; the activity feed lists both `record_dependency` events (probe `DEFECT SEC-P2-01`, §1.4).
  **SEC-P2-01 (Medium).**
- `cross_project_dependency` is audit-only as intended: not in `ACTIVITY_ENTITY_PERMISSION` (`portfolio.service.ts:46-47`),
  so `?entityType=cross_project_dependency` answers 404 and unfiltered feeds omit it for non-auditors (existing test + probe
  CONTROL). For audit readers (`reach: false`, no `readPermission`) the type has no rule, so auditors of the dependent
  project see the events (action, entity id, reason) — consistent with "audit.event.read only". The feed never returns
  `before`/`after` payloads (`portfolio.service.ts:668-683`), so the other project's id is not disclosed by the feed. No AI,
  report or notification code reads either table (`grep`).
- Evidence targets: `evidence_link` visible only with its document **and** its target (target through `targetSql` with
  `EVIDENCE_TARGET_READ_PERMISSION`); counters (`visibleEvidenceCounts`) and the document detail counter use the same
  predicate. Gate criteria use the displayed counters (`gates.service.ts:159-163`); the evaluation counts every link (rules).
- My Work (`my-work.service.ts`): only full members; every item uses the command's policy inputs, and titles are shown only
  after the record-level check (decisions by classification, evidence by `vis.exists('evidence_link')`, waivers by
  `visible('waiver')`). One inconsistency: `gate_decision` passes only `submittedBy` as not_self subject (`:167`) while the
  command uses submitter **and** gate reviewer (`gates.service.ts:313`) → the reviewer who also holds the approver role is
  offered a decision the command refuses (probe OBSERVED, **SEC-P2-03 Low**, no data exposure: the reviewer can read the gate).

### 2.3 Database guards for the new tables (`packages/db/sql/post-migrate.sql`)

Queried on the migrated test database (`hub_owner`):
```
cross_project_dependency | relrowsecurity=t | hub_project_isolation: (project_id = ANY (app_full_project_ids()))
record_dependency        | relrowsecurity=t | hub_project_isolation: (project_id = ANY (app_full_project_ids()))
gate_assessment / decision / authority_matrix_version: same policy; evidence_link: full projects OR (project AND room granted)
triggers:  record_dependency: hub_same_project_successor, hub_scope_immutable
           cross_project_dependency: hub_same_project_local_item, hub_scope_immutable
FKs:       hub_opfk_* (org_id, project_id) → project; hub_ufk_* (org_id, created_by/closed_by) → app_user;
           hub_xpfk_cross_project_dependency_other (org_id, other_project_id) → project(org_id, id)
```
RLS (runtime role without BYPASSRLS; room-only principals excluded by `app_full_project_ids`), immutable scope, the
successor / local-item same-project triggers and the same-organization FK are in place and tested
(`cross-project-and-prerequisites.spec.ts` "DB: …"). Two references are service-validated only (**SEC-P2-04, Low**,
reproduced with the owner pool inside a rolled-back transaction): `record_dependency.(predecessor_type, predecessor_id)` —
the trigger list covers only the successor (`post-migrate.sql:529-533`, "the predecessor is validated by the service") —
accepts an agreement of **another** project; `cross_project_dependency.(other_item_type, other_item_id)` is not bound to
`other_project_id` and accepts a task of the dependent project itself. Today every write goes through
`loadInProject(...)`, so no API path was found that produces such a row.

### 2.4 Documents
- **Upload** (`documents.service.ts:338-437`): `documents.document.upload` on the visible document (room + clean team via
  `loadDoc`), legal hold refuses new versions, size limit (413), empty file 422, filename required and sanitised, SHA-256,
  signature scan first (quarantine area, never current/downloadable/indexed, security event), magic-byte allow-list,
  server-generated storage key. Scan status: `pending`/`quarantined`/`rejected` never usable; `not_scanned` only with
  `allowUnscanned` (default **off** when `NODE_ENV=production`, `config.ts:220`).
- **Download** (`documents.controller.ts:57-64`, `openDownload` `:470-491`): `documents.document.download` (audited read),
  unusable scan status refused and audited, integrity re-check (C-40), `X-Content-Type-Options: nosniff`,
  `Content-Security-Policy: sandbox; default-src 'none'`, `Cache-Control: no-store`, `attachmentDisposition` (P1-verified:
  no header injection).
- **Rooms**: list/search filter by classification and room in SQL (`visibleDocsWhere`); `moveRoom` needs
  `documents.document.classify` on a visible document, refuses clean-team material, and needs visibility of the destination
  room; external accounts hold no `documents.*` permission (they only reach released disclosures through the JV module).
  Evidence links carry the document's room (trigger) and are hidden with it.
- **Legal hold / retention / disposal**: `documents.legal_hold.manage` (Legal) for hold and retention; disposal is a
  two-person flow (request with `documents.document.archive`, dispose by another person with `documents.document.dispose`
  and matrix authority), hold/retention re-checked and audited on refusal, the request is bound to the document version.
  **SEC-P2-06 (Low)**: `dispose` loads the document without visibility and validates the request (422
  `documents.disposal_request_invalid`) **before** `policy.assert` (`:621-641`), so a Legal user learns that a hidden
  (e.g. `restricted`, or room-bound) document id exists (422) vs an unknown id (404) (probe OBSERVED).
- **SEC-P2-08 (Low)**: `list`/`search` apply classification/room but **no workstream reach**, whereas `GET /documents/:id`
  and download call `policy.assert` without a workstream (strict rule) — a workstream-only principal lists and searches the
  titles of all project documents but is refused each one (403) (probe OBSERVED). Resolved by the §3 decision.

### 2.5 DOM-P2-16 gate review — summary
Owner/PM convention, designated reviewer, reviewer ≠ starter, submitter ≠ endorsing reviewer, decider ∉ {submitter,
reviewer}, fail-closed on unknown starter/submitter/reviewer, AI/service identities refused (`gates.human_only`), and the
endorsement bound to the criterion-state hash are implemented server-side and covered by `dom-p2-16-gate-roles.spec.ts`
(12 tests in the green suite). Web: the review panel and buttons are hints only; every rule is enforced by the API.

---

## 3. Design question: access-matrix §2.2 (workstream-scoped reads and project-level records)

**Facts at `1b30f48`.** §2.2 says a workstream-scoped `read/search/view` grant also covers project-level records
(`workstream_id IS NULL`, not room-bound). The platform implements the stricter rule in `PolicyService.check`
(`policy.service.ts:213-227`: a workstream grant applies only when `res.workstreamId` is one of its workstreams) and in
`permissionReach`/`reachSql` (`:103-115`: `col in (…)`, so `NULL` is excluded), used by ~30 call sites in planning,
finance, carve-out, NewCo, readiness, the record-visibility rules and AI retrieval; finance tests pin the stricter rule
(`finance-isolation.spec.ts:159-171`: project-level budget line 404, reconciliations total 0). But the code is not uniform:
RBAC-only paths follow the lenient reading — `listProjects` (`canInProject`), document list/search (SEC-P2-08), cross-project
list without a local item (SEC-P2-07), `canSeePrerequisite` for gates, My Work gate items — while `policy.assert` paths
without a workstream answer **403** (gates, documents GET, governance) and SQL-reach paths answer **404** (finance).
A workstream-only `workstream_lead` (the owner of G1/G4/G5/G6 and designated reviewer of several criteria) can start G1
and receives its evaluation in the command response, yet `GET /gates` and `GET /gates/:id` answer 403 (probe OBSERVED).
Read permissions a workstream-only lead holds (policy matrix): `portfolio.project.read`, `governance.{committee,meeting,decision}.read`,
`planning.plan.read`, `gates.gate.read`, `carveout.register.read`, `newco.register.read`, `readiness.register.read`,
`finance.record.read`, `jv.room.read`, `jv.dd_request.read`, `documents.document.read`, `reports.snapshot.read`,
`imports.batch.read`, `ai.proposal.read` (contributors, which can also be workstream-scoped, hold most of these).

| Option | What changes | Risk |
|---|---|---|
| A. Align the code to §2.2 as written | Every read path treats `workstream_id IS NULL` (and workstream-less tables) as covered for workstream-scoped read grants: `check`, `permissionReach`/`reachSql` (`col in (…) or col is null`, `true` for tables without a workstream), `RecordVisibility`, activity feed, evidence counters, AI retrieval; rewrite the finance tests that pin 404 | **High disclosure and regression risk.** Workstream leads (clearance confidential, finance domain clearance unchanged) would newly read project-level finance records (models, KPIs, reconciliations, project-level budget lines/snapshots/benefits), all committees/meetings/decisions, project-level perimeter items, the NewCo register, project-level readiness checks, and the AI retrieval corpus of those records. ~30 SQL predicates in 10+ modules must change consistently (lists vs totals vs record GET). Contrary to least privilege and to the WSL row of §3 ("anything outside assigned workstream(s)"). **Not recommended.** |
| **B. Amend §2.2 to the implemented stricter rule, with an explicit, machine-readable exception list (recommended)** | Keep the strict rule everywhere; add a short list of read permissions that also cover the project's project-level records **of that type** for a workstream-scoped holder, because the role needs them to do its own job; align the lenient RBAC-only paths | **Low.** Behaviour of finance, governance, carve-out, NewCo, readiness, JV and AI retrieval stays as tested. The exceptions are registers the workstream role already acts on (gate owner/reviewer commands; evidence documents of its tasks). Residual: workstream leads see gate definitions/criteria/waiver texts and project-level documents up to their clearance (classification, room and clean-team still enforced) — today they already see document titles through list/search. Needs Mobily data-governance confirmation (add to Q-list). |
| C. Strict rule, no exceptions; give gate owners project-scoped roles | Only documentation; operationally assign `workstream_lead` project-wide when it owns a gate | Over-grants (a project-scoped WSL gets **all** workstreams); documents stay unusable for workstream-only members (no document carries a workstream). Not recommended. |
| D. Put a workstream on gates / criteria / documents | Data-model change (criteria and documents per workstream) | Large change for P2; does not remove the need to decide §2.2 for other types. Possible later. |

**Recommendation: Option B.** Exact changes:
1. `docs/security/access-matrix.md` §2.2, row `workstream` → "Resources with that `workstream_id`. A workstream-scoped
   grant does **not** cover project-level records (`workstream_id IS NULL`, or record types without a workstream) nor other
   workstreams, **except** the read permissions listed in §2.2.1, which also cover the project's records of that type that
   are not room-bound; classification, room and clean-team conditions still apply. Mutating permissions cover only the
   assigned workstream." New §2.2.1 "Project-level read exceptions": `gates.gate.read` (the gate register: definitions,
   criteria, cycles, waivers — owner and reviewer roles can be workstream-scoped), `documents.document.read` and
   `documents.document.download` (documents carry no workstream; evidence of the role's own tasks), `portfolio.project.read`
   (project header, status dimensions). §3 WSL "Deliberately excluded" → "anything outside the assigned workstream(s),
   except the project-level reads of §2.2.1". §11 JSON: `"projectLevelRead": true` on those three/four permissions.
2. `packages/domain/src/policy/policy-matrix.json` (+ type): the same `projectLevelRead` flag; a domain test that only
   `read`/`download` permissions carry it and that none of them is `finance.*`, `governance.*`, `jv.*`, `ai.*`.
3. `PolicyService.check`: when `!projectWide && wsGrants?.size && !res.workstreamId && !res.roomId &&
   POLICY_MATRIX.permissions[permission].projectLevelRead`, treat the grant as applicable (conditions still evaluated).
   `permissionReach`/`reachSql`: for flagged permissions return `(col in (…) or col is null)` (no current table needs it,
   but it keeps the rule general).
4. Align the lenient paths with the documented rule: SEC-P2-07 (a cross-project dependency without a local item needs a
   project-wide `planning.plan.read` reach in the dependent project); SEC-P2-08 is resolved by the exception (list/search and
   GET agree); `canSeePrerequisite('gate')` and My Work gate items are then consistent.
5. Tests: workstream-only WSL → `GET /gates`, `/gates/:id`, `GET /documents/:id` (internal) 200; a `restricted` / room
   document still 404; finance project-level records still 404 (existing test unchanged); `GET /decisions` still 403;
   AI retrieval ACL tests unchanged. Update `threat-model.md` / control matrix if they quote §2.2.

---

## 4. Part B — re-verification of the P1 closures (`65b53e9`)

| ID (P1) | Lead's closure | Re-verification | Result |
|---|---|---|---|
| SEC-P1S-01 (Medium) | `targetRules` on every path-scoped `[[allowlists]]` entry | Static: all five path-scoped entries carry `targetRules` (`gitleaks.toml:57-100`; the two value-only entries have no `paths`). Dynamic (§1.7): in every allow-listed file (and a new `docs/reviews` file) random secrets of all four kinds are **detected in both `tree` and `history`** (24/24 + 24/24), controls 8/8, synthetic values still accepted (0 extra findings), baseline PASS (§1.6). The directory source no longer skips whole files. | **CONFIRMED** |
| SEC-P1S-02 (Low) | `secret-scan.sh` refuses to run while a `.gitleaksignore` exists | Refused for a file in the project directory and at the repository root (S2a/S2b, exit 1). Not refused for a **committed nested** file: `git ls-files --error-unmatch .gitleaksignore '*/.gitleaksignore'` exits 1 unless **both** pathspecs match (`secret-scan.sh:53`). gitleaks honours `.gitleaksignore` from the **cwd** and from the **scanned directory root**: a committed `scripts/ops/.gitleaksignore` suppresses a committed secret when the script runs from that directory (S2c, PASS), and a committed `docs/test-evidence/.gitleaksignore` suppresses it in the CI `reports` step run from `transformation-hub/` (S2d, PASS). The `history`/`tree` steps of the same job still catch committed secrets. `--gitleaks-ignore-path` is still not set. | **CONFIRMED WITH RESIDUAL** → SEC-P2-09 (Low) |
| SEC-P1S-03 (Low) | REDACTED entry anchored to `transformation-hub/docs/reviews/*.md`, limited to `hub-url-embedded-password` | Static: `paths = ['(?:^|/)transformation-hub/docs/reviews/[^/]+\.md$']`, `targetRules = ["hub-url-embedded-password"]`. Dynamic (§1.7): allowed only in `transformation-hub/docs/reviews/*.md`; `trading_agent/docs/reviews`, `apps/web/public/docs/reviews`, a sub-directory, `.txt`, `docs/security` detected in both modes; other rules in `docs/reviews` files detected. | **CONFIRMED** |
| SEC-P1S-04 (Low) | finance figure/benefit detail counters use `visibleEvidenceCounts` | `benefits.service.ts:111`, `snapshots.service.ts:180` → `FinanceSupport.evidenceShown` (`finance.support.ts:294-296`); `activeEvidenceCount` kept for the verification rule (`benefits.service.ts:259`). Regression test passes, assertions unchanged (§1.5). Remaining `activeEvidenceCount` / `s.evidence` uses in readiness, JV and NewCo are rule inputs, not displayed counters. | **CONFIRMED** |
| SEC-P1S-07 (Info) | checker regex covers double quotes and `require()` | §1.8: B2 and B4 now fail as required; re-exports, multi-line, type-only, `.js`, side-effect imports fail; template-literal dynamic import passes (none in the code). | **CONFIRMED** (Info residual I-1) |

---

## 5. Findings

| ID | Severity | Where | Finding | Reproduction | Recommendation |
|---|---|---|---|---|---|
| **SEC-P2-01** | **Medium** | `apps/api/src/platform/record-visibility.ts:153-159` (`record_dependency` rule, `pred()`), `:207-211` (`exists` ignores `readPermission`); `apps/api/src/modules/planning/prerequisites.service.ts:58-62, 123-140` | **Prerequisites disclose decisions and agreements to callers without their read permission.** The predecessor of a prerequisite is checked for classification only; the type-level read permission (`governance.decision.read`, `carveout.register.read`) is skipped both in the prerequisite list (label = code + title, satisfied state) and in the `record_dependency` activity rule. Today this reaches the portfolio administrator (all projects of the org, `planning.plan.read`, no decision/agreement read); any future role with the same shape inherits it. | Probe `DEFECT SEC-P2-01` (2 tests, §1.4): PFA's GET of the decision / agreement → 403, but `GET …/prerequisites?successorId=` returns both items with their labels and `GET …/activity?entityType=record_dependency` lists 2 events. | In `canSeePrerequisite`, require `canInProject(EVIDENCE_TARGET_READ_PERMISSION[type])` for `decision`/`agreement` (or resolve them through `targetSql`, which applies `permitted`); in the `record_dependency` rule, resolve `decision`/`agreement` predecessors through `e.target('<type>', predecessor_id)` instead of `RULES[t]` (keep the direct rule for the polymorphic `approval_request`/`evidence_link`, whose own rules apply `permitted` to their targets). Keep the DEFECT tests. |
| **SEC-P2-02** | **Medium** | `apps/api/src/modules/governance/decisions.service.ts:221-238` (any holder of `decision.draft`/`submit` edits and submits any visible draft), `:245, :257, :299, :417, :537, :588, :596, :609` (not_self subject = `requesterUserId` only) | **Decision separation of duties is narrower than documented.** Access-matrix §5.1 lists "requester, submitter, paper author" as self ids for `decision.review`, `vote`, `record_outcome`, `record_external_approval`; `decision-workflow.md` §1 step 3 says the paper is written by the requester. The submitter is not recorded and co-editors are not tracked, so a committee member can rewrite another member's paper, submit it and vote on it (the secretariat likewise could edit a paper and then start its review). Compensation: quorum/majority need other voters; the audit trail records the editor and submitter. | Probe `DEFECT SEC-P2-02` (§1.4): PM drafts; the finance member PATCHes the recommendation (200), submits (201); the secretary tables it; the finance member's vote → **201** (required 403). | Either restrict paper edit and submit to the requester (`own_workstream`-style check with `ownerUserIds: [requesterUserId]`, the simplest), or record `submittedBy` and the paper editors (distinct `changedBy` of the decision's `record_version` rows) and include them as self ids in every decision approval command and in the vote eligibility / tally integrity rules. Update §5.1 or the workflow document to whichever is chosen. |
| SEC-P2-03 | Low | `apps/api/src/modules/planning/my-work.service.ts:163-169` | My Work offers `gate_decision` to the gate reviewer who holds the approver role; the command refuses it (not_self vs submitter **and** reviewer). No data exposure (the reviewer can read the gate); violates "the inbox never offers an item the command would refuse". | Probe OBSERVED SEC-P2-03: sponsor (also PM) endorses G0, secretary marks ready → sponsor's My Work lists `gate_decision`; decide → 403. | Use `separationSubject(me, [a.submittedBy, a.reviewedBy])` as in `gates.service.ts:313`; add the assertion to the DOM-P2-16 spec. |
| SEC-P2-04 | Low | `packages/db/sql/post-migrate.sql:529-535, 728-739` | Defence in depth: the database does not bind `record_dependency.predecessor_*` to the project, nor `cross_project_dependency.other_item_*` to `other_project_id`. Service validation (`loadInProject`) is the only guard. | Probe OBSERVED SEC-P2-04 (owner pool, rolled back): both inserts accepted. | Add a trigger for the predecessor (map `gate`→`gate_definition`, add `approval_request`, `evidence_link` to the allow-list) and a trigger checking `(other_item_type, other_item_id)` exists in `other_project_id` (invoker rights; the service already requires membership of both). |
| SEC-P2-05 | Low | `apps/api/src/modules/documents/evidence.service.ts:174-178` | The link path checks the target's write permission RBAC-only; its ABAC conditions (`gates.evidence.attach` C,W with the criterion's owner role; `planning.task.update_progress` W) are not applied. Any contributor can add evidence to any readable criterion/task — e.g. to a legal-owned G2 criterion — and thereby also stale a gate endorsement. SoD is not bypassed (linkers are not_self subjects). The gate test kit relies on this (contributor links for PM-reviewed criteria). | Probe OBSERVED SEC-P2-05: contributor links to a G2 criterion (201); submit-evidence on it → 403. | Decide and document: either apply the target's conditions (`ownerRoles`, `ownerUserIds`) on link, or state in access-matrix §6 that linking evidence needs only the RBAC grant and that `W` applies to the submit command. |
| SEC-P2-06 | Low | `apps/api/src/modules/documents/documents.service.ts:621-641` | `dispose` validates the approval request (422) before authorizing the caller on the document, so a holder of `documents.document.dispose` can tell a hidden document id (422) from an unknown one (404). | Probe OBSERVED SEC-P2-06: Legal (clearance confidential) → restricted document id: 422 `documents.disposal_request_invalid`; unknown id: 404. | Call `policy.assertGranted('documents.document.dispose', attrs)` (404 when not visible) before loading/validating the request; keep the subject-specific assert after the state checks. |
| SEC-P2-07 | Low | `apps/api/src/modules/planning/cross-project.service.ts:151-160` | A cross-project dependency without a local item (project-level) is listed to a workstream-only reader of the dependent project (description, other item), unlike other project-level planning data (schedule 403). | Probe OBSERVED SEC-P2-07. | Per §3: require a project-wide `planning.plan.read` reach in the dependent project when `localItemId` is null (list and close). |
| SEC-P2-08 | Low | `apps/api/src/modules/documents/documents.service.ts:102-108, 190-261` vs `:94-99` | Document list/search apply no workstream reach while GET/download use the strict rule: a workstream-only principal sees all project document titles (classification/room enforced) but opening any document is 403. | Probe OBSERVED SEC-P2-08. | Resolved by §3 option B (`documents.document.read`/`download` in the exception list); if §3 is decided otherwise, make list/search and GET agree. |
| SEC-P2-09 | Low | `scripts/ops/secret-scan.sh:49-55` (residual of SEC-P1S-02) | Committed nested `.gitleaksignore` files are not refused (`--error-unmatch` with two pathspecs), and gitleaks reads them from the working directory and from the scanned root: the CI `reports` step (scanning `docs/test-evidence`) honours `docs/test-evidence/.gitleaksignore`. Compensation: `history` and `tree` of the same job still fail on committed secrets. | §1.8 S2c (PASS from `scripts/ops`), S2d (PASS in the CI configuration). | Refuse when `git ls-files` lists any path matching `(^|/)\.gitleaksignore$` (e.g. `git ls-files | grep -qE '(^|/)\.gitleaksignore$'`), refuse when `find <dir> -name .gitleaksignore` finds one in a `bundle`/`reports` directory, and pass `--gitleaks-ignore-path` pointing to an empty temporary directory. Add the S2c/S2d cases to a regression script. |
| I-1 | Info | `apps/api/scripts/check-module-boundaries.mjs:57` | Template-literal dynamic imports are not matched (none exist). | §1.8 B11. | Optional: also match `` import(`…`) ``. |
| I-2 | Info | `decisions.service.ts:554` | The external-approval evidence link is loaded in project without the recorder's document visibility and may be a note-only link; nothing is disclosed (only the id is stored/returned). | Static. | Governance choice: optionally require that the recorder can read the linked document and that the link carries a document. |
| I-3 | Info | `governance/meetings.service.ts:98, 122-130` | Meeting detail lists conflict declarations (decision id, free-text description) also for decisions the caller cannot see (agenda codes are hidden by `visibleCode`). | Static. | Filter `conflicts` by the decision's visibility like the agenda. |
| I-4 | Info | `gates.service.ts:302-326` | `decide` does not re-check that the endorsement is still current after mark-ready; the documents module can add evidence links to criteria of a ready gate (criterion commands are frozen, and substantive changes — conflicting, rejected, superseded evidence — make the evaluation not ready). The decision snapshot records the endorsed basis. | Static. | Optional: refuse `decide` (422) when `reviewBasis` ≠ current basis, or refuse evidence links on criteria of a gate that is ready for decision. |
| I-5 | Info | `governance/committees.service.ts:571-586` | `matrixDto` returns `approvalDocumentId`/`VersionId` to every committee reader regardless of the document's visibility (ids only). | Static. | Optional: null them when the caller cannot see the document. |
| I-6 | Info | `docs/security/access-matrix.md:5` | The header still says "Draft for P0 review. Designed only: nothing in this document is implemented or tested yet." | Static. | Update the status line when §2.2 is amended. |

Observations (no finding): the gate owner convention lets a project manager act as owner of every gate (including
legal-owned G2), as documented in access-matrix §2.4 and business-gates.md §2.4; the starter of a cycle may also be its
approver (only submitter and reviewer are excluded by the documented rule).

---

## 6. Verdict

| Area | Verdict |
|---|---|
| Authorization on P2 routes (permission, scope, classification/room, reach, SoD, fail-closed) | **PASS WITH CONDITIONS** — SEC-P2-02 (Medium) open; SEC-P2-03/-05/-06 Low. The new routes (external approval, matrix verify-approval, cross-project dependencies, prerequisites, DOM-P2-16 gate review) enforce their documented SoD server-side and fail closed. |
| Record visibility in SQL for P2 types | **PASS WITH CONDITIONS** — SEC-P2-01 (Medium) open; `cross_project_dependency` audit-only confirmed. |
| Database guards (triggers, composite FKs, RLS) | **PASS** with Low SEC-P2-04 (defence in depth). |
| Documents (upload, scan, download headers, rooms, legal hold, disposal) | **PASS** with Low SEC-P2-06 / SEC-P2-08. |
| §2.2 design question | **Recommendation §3: option B** (amend §2.2 to the strict rule with an explicit `projectLevelRead` exception list: `gates.gate.read`, `documents.document.read`, `documents.document.download`, `portfolio.project.read`). |
| Part B — P1 closures | SEC-P1S-01, -03, -04, -07 **CONFIRMED**; SEC-P1S-02 **CONFIRMED WITH RESIDUAL** (SEC-P2-09 Low). The P1 gate condition "independent re-verification of the closures" is met for the security items. |
| **Overall** | **PASS WITH CONDITIONS**: no Critical or High; 2 Medium (SEC-P2-01, SEC-P2-02) to be fixed before the P2 gate, with the `DEFECT` probes turning green; §2.2 decided and applied (SEC-P2-07/-08 aligned with it); Lows SEC-P2-03/-04/-05/-06/-09 tracked with owners. |

Files added by this review: `docs/reviews/P2-security-review.md`, `apps/api/test/reviews/p2-sec-probes.spec.ts` (12 tests:
3 `DEFECT` tests that fail until SEC-P2-01/-02 are fixed and must not be weakened, 7 `OBSERVED`, 2 `CONTROL`).

---

## 7. Review commit

The scans of the review commit are recorded in the follow-up commit that fills in this section.
