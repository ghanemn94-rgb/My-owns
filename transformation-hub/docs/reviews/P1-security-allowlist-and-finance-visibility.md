# P1 security review: secret-scan allow-list, finance visibility in evidence and history, module boundaries

| Item | Value |
|---|---|
| Reviewer | `security-privacy-reviewer`, independent review in its own context. The reviewer did not write any of the reviewed changes. It added one probe spec (`apps/api/test/reviews/p1-sec-finance-visibility.spec.ts`) and this document; no implementation file and no existing test was changed. |
| Revision reviewed | **`2ac548bd2c54933e41dc7ed5d20cd4a5b2a6f0f7`** (`2ac548b`, `claude/mobily-transformation-hub`, pushed; "P1 gate: close REQ-SRC-002 and REQ-ARC-011; …; scan placeholder allow-list"). The worktree started at `20fe82e` and was fast-forwarded to `2ac548b`, which is also the pushed head (`git rev-parse FETCH_HEAD` = `2ac548b…`). Every result below was produced at `2ac548b`, except the final scan in §1.11, which ran at the review commit (this document + the probe spec, parent `2ac548b`). |
| Changes in scope | (1) `scripts/ops/gitleaks.toml`: `d508929` (the oidc-sso entry extended to `apps/api/test/p1/sec-p1r-fixes.spec.ts`; a new entry for the synthetic S3 secret key in `apps/api/test/documents/storage-contract.spec.ts`) and `2ac548b` (a new entry for the literal `REDACTED` placeholder in `docs/reviews/*.md`). (2) `45cf17f`: `apps/api/src/platform/record-visibility.ts` and the activity allow-list in `apps/api/src/modules/portfolio/portfolio.service.ts`. (3) `2ac548b`: `apps/api/scripts/check-module-boundaries.mjs` in the API lint, and `attachmentDisposition` moved to `apps/api/src/platform/helpers.ts`. |
| Databases | `hub_test_sec4` (and `hub_test_sec4_boot`, created for the suite) on the shared cluster `127.0.0.1:5432`, created with `pg-init-roles.sh`. No other database was used. |
| Processes | Only test runners (vitest) and the scanner. No server was started. A vitest run of another agent's worktree (`agent-a14e…`) was running at the same time and was not touched. No external host was contacted (the pinned gitleaks 8.30.1 binary was already in the scratchpad). |
| Scratch data | All secret-injection probes ran on a scratch copy of the committed tree (`git archive HEAD`) outside the repository, or (one probe) on an uncommitted, immediately restored edit of a tracked file in this worktree (§1.5). The injected values were generated at random at run time, never printed, never committed, and are not reproduced here. The scanner reports were written with `--redact=100`. |
| **Verdict** | **PASS WITH CONDITIONS.** No Critical or High finding. **Allow-list entries: CONFIRMED WITH CONDITIONS** (one Medium: SEC-P1S-01, plus Low SEC-P1S-02/03/05). **Finance visibility change `45cf17f`: CONFIRMED** (no mismatch with the finance module in 168 persona × record checks; one pre-existing Low in the finance module, SEC-P1S-04, outside `45cf17f`). **Module-boundary checker and helper move: CONFIRMED** (no behaviour change in the download headers). See §5. |

Severity scale: **Critical** isolation/security bypass; **High** a control that the gate relies on does not work or is unverified;
**Medium** a control is materially weaker than documented, with compensation elsewhere; **Low** limited exposure or
defence-in-depth gap; **Info** observation / documentation.

---

## 1. Commands run and real results

All commands ran in `transformation-hub/` of the review worktree unless stated otherwise. `$SCRATCH` is the session
scratchpad; `GITLEAKS` pointed at `$SCRATCH/gl/bin-8.30.1/gitleaks` (`gitleaks version` → `8.30.1`).

### 1.1 Environment
```
$ git fetch origin claude/mobily-transformation-hub          (origin was still at 20fe82e at that moment)
$ git merge --ff-only claude/mobily-transformation-hub        (the lead's branch, commit 2ac548b)
  → fast-forward 20fe82e → 2ac548b (12 files changed)
$ git fetch origin claude/mobily-transformation-hub; git rev-parse FETCH_HEAD HEAD   (after the lead pushed)
  → 2ac548bd2c54933e41dc7ed5d20cd4a5b2a6f0f7 (both)
$ pg_isready -h 127.0.0.1 -p 5432                          → accepting connections
$ HUB_DATABASES="hub_test_sec4 hub_test_sec4_boot" bash scripts/dev/pg-init-roles.sh
  → roles hub_owner/hub_app and databases ready: hub_test_sec4 hub_test_sec4_boot
$ pnpm install --offline --frozen-lockfile                   → Done in 5s
$ pnpm build:packages                                        → domain / contracts / db built
```

### 1.2 Secret scan of the reviewed revision (the repository's own script)
```
$ GITLEAKS=… bash scripts/ops/secret-scan.sh tree
gitleaks 8.30.1 · config scripts/ops/gitleaks.toml
tree: 925 committed files at HEAD 2ac548b
INF no leaks found
PASS  tree: no findings
SECRET SCAN (tree): PASS

$ GITLEAKS=… bash scripts/ops/secret-scan.sh history
history: 202 commits reachable from HEAD 2ac548b (whole repository)
INF 141 commits scanned.
INF no leaks found
PASS  history: no findings
SECRET SCAN (history): PASS
```

### 1.3 Is each reviewed entry needed? (entry removed in a scratch copy of the config; same flags as `secret-scan.sh`)
Probe script `$SCRATCH/probe-allowlist.py necessity`. Output (rule, file, line[, commit]):
```
OK  N0 reviewed config, reviewed tree: PASS, 0 findings
OK  N1 tree without the sec-p1r-fixes path: FAIL, 2 findings
      generic-api-key            apps/api/test/p1/sec-p1r-fixes.spec.ts 354
      hub-url-embedded-password  apps/api/test/p1/sec-p1r-fixes.spec.ts 342
OK  N1b history without the sec-p1r-fixes path: FAIL, 2 findings (both in 8c685f6)
OK  N2 history without the storage-contract S3 entry: FAIL, 1 finding
      generic-api-key            apps/api/test/documents/storage-contract.spec.ts 149 8c685f6
OK  N2b tree without the storage-contract S3 entry: PASS, 0 findings        ← see SEC-P1S-01 (file skipped entirely)
OK  N3 tree without the REDACTED entry: FAIL, 1 finding
      hub-url-embedded-password  docs/reviews/P1-qa-rereview.md 181
OK  N3b history without the REDACTED entry: FAIL, 1 finding (f5a130e)
```
Each of the three reviewed entries suppresses exactly the finding it was written for, and nothing else in the
reviewed tree or history.

Where the values occur (`grep -rn` over the worktree, excluding `node_modules`/`dist`; `git log -S<value> HEAD`):
- synthetic cookie secret and synthetic DB password: `oidc-sso.spec.ts:274,286` and `sec-p1r-fixes.spec.ts:342,354`
  (introduced in `ec36f7a`/`231375f` and `8c685f6`), plus `gitleaks.toml`;
- synthetic S3 secret key (`k8s-secret-ref-…`): `storage-contract.spec.ts:149` (introduced in `8c685f6`), plus
  `gitleaks.toml` and a quotation of the regex in `docs/reviews/P1-qa-rereview.md`;
- `REDACTED`: `docs/reviews/P1-qa-rereview.md:181` (scanner output quoted by the QA re-review), `secret-scan.sh:6`
  (comment), `gitleaks.toml`.
None of them occurs in `deploy/`, Helm values, compose files, CI configuration or application source. In every test
they are passed only to `loadConfig()` in memory, with `*.example.invalid` hosts.

### 1.4 Can an entry hide a real secret? Injection into a scratch copy of the tree (`tree`-mode flags)
Probe scripts `$SCRATCH/probe-allowlist.py inject` and `$SCRATCH/probe-allowlist2.py`. Random, realistic secret-shaped
values were appended to (or written as a new file in) the paths named by the allow-list, with controls in paths that
no entry names:

| # | Where (scratch copy) | Injected (random, never printed) | Result |
|---|---|---|---|
| I1 | `docs/reviews/P1-qa-rereview.md` | postgres URL with a 24-char random password | **0 findings (missed)** |
| I2–I4 | new `docs/reviews/probe-new.md` | random `HUB_COOKIE_SECRET = '…'` (40 chars); AWS access-key-id shape; GitHub PAT shape | **0 findings (missed)** |
| I5 | new `docs/reviews/probe-new.md` | a `…:REDACTED@…` URL and a second URL with a random password on the same line | **0 findings (missed)** |
| I6 | new `docs/reviews/probe-new.md` | the three test-file synthetic values outside their test files | **0 findings (missed)** |
| I7–I9 | `apps/api/test/p1/sec-p1r-fixes.spec.ts` | random cookie secret; random DB-password URL; a `REDACTED` URL | **0 findings (missed)** |
| I10–I12 | `apps/api/test/documents/storage-contract.spec.ts` | random S3 secret key (40 chars); random DB-password URL; random cookie secret | **0 findings (missed)** |
| I14 | `apps/api/test/p1/oidc-sso.spec.ts` | random cookie secret | **0 findings (missed)** |
| C1–C4 | new `docs/security/probe.md` (control) | same kinds as I1–I4 | detected: `hub-url-embedded-password`, `generic-api-key`, `aws-access-token`, `github-pat` |
| C5–C7 | new `apps/api/test/p1/probe-other.spec.ts` (control) | random S3 secret; random cookie secret; the synthetic S3 value outside its file | detected (`generic-api-key` ×3) |
| C8 | new `docs/security/probe.md` (control) | the test-file synthetic DB password and cookie secret | detected (2 findings) |
| D1 | new `docs/reviews/probe.md`, **reviewed config** | postgres URL with a random password | **0 findings (missed)** |
| D2 | same file, **config at `20fe82e`** (no REDACTED entry) | the same value | detected (`hub-url-embedded-password`, plus the known line 181) |

D1/D2 isolate the effect of `2ac548b`: before it, a secret in any `docs/reviews/*.md` failed the tree scan; after it,
the tree scan does not open those files at all.

Cause (gitleaks trace log, `$SCRATCH/why-n2b-2.sh`, full tree, config without the S3 entry):
```
DBG skipping file: global allowlist path=…/transformation-hub/apps/api/test/documents/storage-contract.spec.ts
```
In gitleaks 8.30.1 the **directory** source (`gitleaks dir`, used by `secret-scan.sh tree`, `bundle` and `reports`)
skips every file whose path matches the `paths` of any *global* `[[allowlists]]` entry, ignoring `condition = "AND"`
and the entry's `regexes`. The same file scanned from another path (`$SCRATCH/why/storage-contract.spec.ts`) is
flagged (`generic-api-key 149`). The **git** source (`history`) applies `AND` correctly (N2 above: the S3 value in a
file whose path is also named by the older AND entry is reported).

### 1.5 Git-source check on `docs/reviews` (history-mode detector)
`$SCRATCH/git-mode-probe.py`: a random DB-password URL was appended to the tracked `docs/reviews/P1-qa-rereview.md` in
this worktree (not staged, not committed), scanned, and the file restored byte for byte (`restored: True`,
`git status --short` clean afterwards):
```
[git-precommit-docs-reviews] exit=1 findings=1
    hub-url-embedded-password transformation-hub/docs/reviews/P1-qa-rereview.md 398
[dir-docs-reviews]           exit=0 findings=0
```
The history scan in CI would therefore still catch a committed secret in a review document; the tree scan would not.

### 1.6 Path and value scope of the REDACTED entry (scratch copy, `tree`-mode flags)
```
OK  S1  REDACTED URL in docs/reviews/new.md                          PASS (in scope)
OK  S2  … in docs/security/new.md                                    FAIL (detected)
OK  S3  … in docs/reviews/sub/new.md                                 FAIL
OK  S4  … in docs/reviews/new.txt                                    FAIL
OK  S5  … in docs/reviews/new.md.bak                                 FAIL
OK  S6  … in docs/reviewsX/new.md                                    FAIL
OK  S7  … in xdocs/reviews/new.md                                    FAIL
OK  S8  … in trading_agent/docs/reviews/new.md                       PASS  ← any directory named docs/reviews
OK  S9  … in transformation-hub/apps/web/public/docs/reviews/new.md  PASS  ← idem
    S10–S12 lower-case / suffixed / prefixed placeholder in docs/reviews/new.md: PASS — not informative in tree mode
            (the whole file is skipped, SEC-P1S-01); in git mode the value regex is exact (`^REDACTED$`, case-sensitive).
```

### 1.7 Remediation check: the same entries as rule-scoped allow-lists (`targetRules`)
`$SCRATCH/probe-targetrules.py`: each of the five path-scoped entries given
`targetRules = ["generic-api-key", "hub-url-embedded-password"]`, everything else unchanged:
```
OK  T0  reviewed tree:    PASS, 0 findings
OK  T0b reviewed history: PASS, 0 findings
OK  T1  docs/reviews: random DB-password URL           → detected (hub-url-embedded-password)
OK  T2  docs/reviews: GitHub PAT shape                 → detected (github-pat)
OK  T3  sec-p1r-fixes.spec.ts: random cookie secret    → detected (generic-api-key)
OK  T4  storage-contract.spec.ts: random S3 secret     → detected (generic-api-key)
OK  T5  oidc-sso.spec.ts: random DB-password URL       → detected (hub-url-embedded-password)
OK  T6  docs/reviews: lower-case placeholder            → detected
```

### 1.8 `.gitleaksignore` (pre-existing; `$SCRATCH/probe-ignorefile*.py`)
No `.gitleaksignore` exists in the repository (`find` over the worktree). `secret-scan.sh` does not pass
`--gitleaks-ignore-path`, so gitleaks reads one from its working directory (CI: `transformation-hub/`, the workflow
default) and from the root of the scanned directory:
```
[h0-no-ignorefile]    exit=1 findings=1      (history, config without the REDACTED entry: P1-qa-rereview.md:181)
[h1-ignorefile-in-cwd] exit=0 findings=0     (same, with a .gitleaksignore holding "<commit>:<file>:<rule>:<line>" in the cwd)
G1 tree mode, .gitleaksignore at the scanned root with a repo-relative fingerprint → still detected
G2 tree mode, fingerprint with the absolute temporary path → suppressed (the path is random per run, so not usable)
```

### 1.9 API test suites (own database; `TEST_DATABASE_URL=postgres://hub_app:…@127.0.0.1:5432/hub_test_sec4`, migration URL for `hub_owner` on the same database)
```
$ pnpm --filter @hub/api test                       (at 2ac548b; 78 committed spec files; the review spec did not exist yet)
 Test Files  78 passed (78)
      Tests  692 passed (692)
   Duration  623.11s
exit=0

$ npx vitest run test/finance test/documents test/p1 --reporter=verbose
 ✓ … finance-isolation.spec.ts > … > evidence and history of finance records follow the finance-domain clearance and reach, like the finance lists 9786ms
 Test Files  28 passed (28)
      Tests  293 passed (293)

$ npx tsc -p tsconfig.json --noEmit                 (apps/api, includes test/**)  → exit 0

$ npx vitest run test/reviews/p1-sec-finance-visibility.spec.ts --reporter=verbose
 ✓ for every persona and finance record: evidence list and history visible exactly when the finance module GET is 200  166651ms
 ✓ a per-type history feed never lists a finance record that the finance lists hide from the caller                     46698ms
 ✓ the auditor (clearance-bound, no reach) sees evidence-link events only for finance records it can read                1487ms
 ✓ a document's evidence counters count only links to finance records the caller can read                                1580ms
 ✓ room-only principals (clean team / partner) of the demo project see no finance evidence or history                    166ms
 × DEFECT SEC-P1S-04: the evidence counter of a figure / benefit detail counts only evidence the caller can read          174ms
   - Expected  + Received
     "benefit":  { - "detailCounterActive": 1, + "detailCounterActive": 2, "evidenceListActive": 1 }
     "snapshot": { - "detailCounterActive": 2, + "detailCounterActive": 3, "evidenceListActive": 2 }
 Tests  1 failed | 5 passed (6)
```
The only failure is the `DEFECT SEC-P1S-04` test, which reproduces the finding (it asserts the required behaviour).
A first run of this spec timed out the matrix test at the default 60 s and asserted a 404 where the route guard answers
403 for room-only principals; the spec was corrected (600 s timeout; "refused, and identical to the answer for an
unknown id") before the run above. Nothing else was changed between runs.

### 1.10 Module-boundary checker and helper move
```
$ node apps/api/scripts/check-module-boundaries.mjs
module boundary check passed: 30 cross-module imports, 13 module edges, acyclic, only published surfaces   exit=0

$SCRATCH/boundary-probe*.sh (scratch copies of apps/api/src + the script):
B0 unchanged copy                                                 → passed        exit=0
B1 jv imports documents/documents.controller (the pre-move import) → FAILED (internal to module 'documents')  exit=1
B3 re-export of another module's controller                        → FAILED        exit=1
B6 documents → gates while gates → documents                        → FAILED "module cycle: documents → gates → documents"  exit=1
B2 the same import as B1 with double quotes                         → passed        exit=0   (SEC-P1S-07)
B4 require('../documents/documents.controller')                     → passed        exit=0   (SEC-P1S-07)

$SCRATCH/disposition-compare.cjs (function text extracted from 20fe82e documents.controller.ts and 2ac548b platform/helpers.ts):
function source identical: true
inputs: 15, identical outputs: 15, outputs with CR/LF/NUL/non-ASCII: 0
sample: attachment; filename="evil__Set-Cookie: x=1.txt"; filename*=UTF-8''evil%0D%0ASet-Cookie%3A%20x%3D1.txt
```

### 1.11 Final scan at the review commit (this document and the probe spec; parent `2ac548b`)
Before committing, the staged files were scanned with the git source (`gitleaks git --staged`, reviewed config):
`no leaks found`, exit 0. After committing (history covers `docs/reviews/*.md`; the tree scan does not, SEC-P1S-01):
```
$ GITLEAKS=… bash scripts/ops/secret-scan.sh history
history: 203 commits reachable from HEAD <review commit> (whole repository)
INF no leaks found
SECRET SCAN (history): PASS
$ GITLEAKS=… bash scripts/ops/secret-scan.sh tree
tree: 927 committed files at HEAD <review commit>
SECRET SCAN (tree): PASS
```

---

## 2. Change 1: secret-scan allow-list (`d508929`, `2ac548b`)

| Entry | Synthetic, never usable? | Scope (paths, regex) | Can it hide a real secret? |
|---|---|---|---|
| oidc-sso entry extended to `sec-p1r-fixes.spec.ts` (`d508929`) | Synthetic: the same two made-up values as `oidc-sso.spec.ts`, used only as `loadConfig()` input with `*.example.invalid` hosts. "Never usable" is by convention only: production configuration accepts both values (SEC-P1S-05). | Exact anchored values; two exact file paths (`(?:^|/)…\.spec\.ts$`). Needed (N1/N1b). | **History:** no — only the two exact values in the two files. **Tree/bundle/reports:** yes — the two files are not scanned at all (I7–I9, I14; SEC-P1S-01). |
| S3 secret key in `storage-contract.spec.ts` (`d508929`) | Synthetic (a `k8s-secret-ref-…` string passed to `loadConfig()`; the fake S3 server in the same spec uses the AWS documentation pair). Accepted by production S3 validation (SEC-P1S-05). | Exact value; one exact path. Needed for history only (N2); the tree scan already skipped this file because of the older cookie-secret entry for the same path (N2b). | **History:** no. **Tree:** yes, but the file was already skipped before `d508929` (I10–I12). |
| `REDACTED` in `docs/reviews/*.md` (`2ac548b`) | Not a credential: the scanner's own redaction placeholder, quoted by `P1-qa-rereview.md:181`. | Exact, case-sensitive value (good). Path: **every** `docs/reviews/*.md` in **any** directory (S8/S9), broader than the one file its description names; no rule restriction. Needed (N3/N3b). | **History:** only the literal placeholder, in the password position. A real password is not hidden unless it literally is `REDACTED`. **Tree:** yes — every review document is skipped (D1 vs D2, I1–I6; SEC-P1S-01, SEC-P1S-03). |

**Result: CONFIRMED WITH CONDITIONS.** The three entries are for synthetic values, match exact values, and each is needed.
In the history scan they are as narrow as the policy requires. But in gitleaks 8.30.1, a path-scoped global entry
excludes the whole file from `dir` scans (`tree`, `bundle`, `reports`). `2ac548b` extends that blind spot from four test
files and one entrypoint to every review document in the repository. In CI, the `history` step of the same job still
catches a committed secret in these files (§1.5), so REQ-SEC-012 is not bypassed in CI; the `tree` check and the policy
text ("Anything else fails the scan") are what is wrong. Conditions: SEC-P1S-01 and SEC-P1S-03 before the P1 gate
cites the tree scan as evidence; SEC-P1S-02, SEC-P1S-05 and SEC-P1S-06 may be tracked.

## 3. Change 2: finance visibility in evidence and history (`45cf17f`)

### 3.1 Static comparison with the finance module

| Aspect | `FinanceSupport` (`finance.support.ts`) | `RecordVisibility` after `45cf17f` | Same? |
|---|---|---|---|
| Clearance | `fx()` (`:78-85`): service → unchanged; no project scope → unchanged; else `financeDomainClearance(p.clearance, scope.roles)` | `domainCtx('finance')` (`record-visibility.ts:198-204`): identical code path, same inputs | Yes |
| Room-scoped / workstream-scoped roles | not considered (`scope.roles` holds project-wide roles only; room roles are in `scope.roomRoles`, workstream roles in `scope.workstreamRoles`) | same (`scope.roles`) | Yes. In the policy matrix only `finance_restricted` has `domainClearance.finance`, and it is project-scoped only. |
| Classification predicate | `policy.visibilitySql(fx(ctx), projectId, {classification})` (`:102`) | `policy.visibilitySql(domainCtx, projectId, {classification: x.classification})` (`:187-191`) | Yes; room-only principals → `false` in both (`policy.service.ts:291-292`) |
| Workstream reach, tables with `workstream_id` (snapshot, budget line, benefit) | `reachSql(ctx, 'finance.record.read', …, workstream)` (`:103-104`) | `reachSql(ctx, FIN, …, x.workstream_id)` (`:54`, `:192`) with the **general** `ctx` | Yes; a NULL workstream is outside a workstream-only reach in both (`NULL in (…)`) |
| Tables without a workstream (model, model version, reconciliation, KPI) | `permissionReach(...).all ? true : false` (`:105-107`) | `reachSql(…, 'null::uuid')` → `true` if project-wide, else `NULL in (…)`/`false` | Yes (checked in the schema: no `workstream_id` column on `financial_model`, `financial_model_version`, `kpi`, `intercompany_reconciliation`) |
| Row GET (`canRead`) | `policy.can(fx(ctx), 'finance.record.read', {classification, workstreamId})`; conditions of `finance.record.read` = `['classification']` | equivalent to the SQL above | Yes |
| Model version | GET loads the model and the version, both checked (`models.service.ts:155-161`); versions carry the model's classification (`:271-272`, `:338`) | own classification only | Equivalent while the invariant holds (enforced by the service on create and reclassify) |
| Audit readers (`reach: false`, activity feed) | the auditor role holds `finance.record.read` at org/portfolio/project scope, never workstream | reach not applied; classification still bound (domain clearance of the auditor = its clearance) | Equivalent under the current matrix (only `auditor` has `audit.event.read`) |

Finance types versus rules (all three lists compared at `2ac548b`):
- audit entity types written by the finance module: `financial_snapshot`, `budget_line`, `benefit`, `kpi`,
  `financial_model`, `financial_model_version`, `intercompany_reconciliation` (and `document` for imported models,
  which has its own rule);
- `ACTIVITY_ENTITY_PERMISSION`: all seven, under `finance.record.read`;
- `EVIDENCE_TARGET_TYPES` finance members: `benefit`, `financial_snapshot` (read permission `finance.record.read`);
- `RULES`: all seven now have a finance-domain rule; `benefit` is no longer in `UNRULED_TARGET_TYPES`.
No finance type is missing. (`kpi_observation` is never an audit or evidence entity; `funds_flow_item` belongs to JV and
has no classification, workstream or room column.)

Side effects checked: evidence links, approval requests, AI proposals and record dependencies that target a finance
record now resolve it through the finance rule (domain clearance + reach) — they were checked with the general
clearance and no reach before. For **auditors**, events of `financial_model` and `kpi` records (no rule before) and
evidence-link events on benefits (unruled target before) were listed regardless of classification; they are now
bound by clearance (probe 3 below). The domain clearance is applied only to the finance record's own classification:
evidence documents are still checked with the general clearance (`evidence_link` rule, `:145-149`), so
`finance_restricted` does not gain access to strictly confidential documents.

### 3.2 Probes (`apps/api/test/reviews/p1-sec-finance-visibility.spec.ts`, all passing except the DEFECT test)
Fixture: a new DC project; 21 finance records created by the finance persona across all seven types, three
classifications and two workstreams (the workstream lead holds `workstream_lead` on the first one only); note evidence
on every snapshot and benefit; a confidential document linked to a strictly confidential benefit and a confidential
snapshot.
1. **Equivalence matrix.** For finance, PM, chair, sponsor, auditor, workstream lead, contributor and `pm.b` (another
   project) × 21 records (168 checks): history non-empty ⇔ finance GET 200, and evidence list 200 ⇔ finance GET 200 (hidden → 404).
   0 mismatches. The module's own answers were pinned too: finance and sponsor see all 21; PM and auditor see the
   confidential ones; chair sees all but strictly confidential; the workstream lead sees exactly the three confidential
   records of its workstream; contributor and `pm.b` see none.
2. **Per-type feeds** (`activity?entityType=T`, no id) for PM, chair, auditor, workstream lead and finance: every listed
   entity id is in that caller's finance list for T (versions: of the models it can open). Contributor and `pm.b` → 404
   for every finance type.
3. **Auditor evidence-link events**: listed ⇔ the target record is readable by the auditor.
4. **Document evidence counters**: the confidential document's `evidence.active` is 2 for finance, 1 for PM, chair and
   auditor (the link to the strictly confidential benefit is not counted).
5. **Room-only principals** (`cleanteam`, `partner.alpha`, with active `room_grant` rows in the demo DC project): the
   finance GET and the evidence list are refused with the same status as for an unknown id; activity history of a demo
   benefit and budget line (by id and by type) is empty or refused.

**Result: CONFIRMED.** The finance rules match `FinanceSupport.visibleSql` / `canRead`, and no path found shows a
finance record, its evidence or its history to a caller the finance module refuses (another project, room-only, lower
clearance, workstream-only reader, auditor). The finance module's own evidence counters are a separate, pre-existing
issue (SEC-P1S-04).

## 4. Change 3: module-boundary checker and `attachmentDisposition`

The moved function is byte-identical; both call sites (`documents.controller.ts:63`, `jv.controller.ts:225`) pass it to
`StreamableFile({ disposition })` as before. The ASCII fallback replaces every character outside `0x20–0x7e` (so CR,
LF and NUL) and `"`/`\`; the RFC 5987 value is percent-encoded including `'()*`. No header injection (15 adversarial
names, §1.10). The checker is in `pnpm --filter @hub/api lint`, passes at `2ac548b`, and fails on the pre-move import,
re-exports and cycles. It does not see double-quoted specifiers or `require()` (SEC-P1S-07, Info).
**Result: CONFIRMED** (no behaviour change).

## 5. Findings

| ID | Severity | Where | Finding | Reproduction | Recommendation |
|---|---|---|---|---|---|
| **SEC-P1S-01** | **Medium** | `scripts/ops/gitleaks.toml` (all five path-scoped `[[allowlists]]` entries, including the ones added/extended by `d508929` and `2ac548b`); `scripts/ops/secret-scan.sh` `tree`/`bundle`/`reports` | **Path-scoped allow-list entries exclude whole files from the tree, bundle and report scans.** gitleaks 8.30.1's directory source skips any file matching the `paths` of a global allow-list, ignoring `condition = "AND"` and the exact-value `regexes`. The files named by the entries — now including **every `docs/reviews/*.md`** in any directory, plus `sec-p1r-fixes.spec.ts`, `oidc-sso.spec.ts`, `storage-contract.spec.ts`, `deploy/docker/api-entrypoint.cjs` (same mechanism, not separately probed) — are never opened by `secret-scan.sh tree`. The allow-list policy ("Each entry matches the exact value … Anything else fails the scan") and `docs/deployment/secrets.md` do not hold for three of the four scan modes. Compensating control: the `history` step of the same CI job applies the entries correctly and catches committed secrets in these files. | §1.4 (I1–I14 missed, C1–C8 detected; D1 missed vs D2 detected isolates `2ac548b`); trace line in §1.4; §1.5 (git source detects, dir source misses). | Make the entries rule-scoped: add `targetRules = [...]` to each path-scoped entry (verified in §1.7: reviewed tree and history still PASS, every injected secret detected), or drop `paths` where the value alone is specific enough. Add a regression step (e.g. in `secret-scan.sh` or CI) that plants a random secret into each allow-listed path in a scratch copy and requires FAIL. |
| **SEC-P1S-02** | Low | `scripts/ops/secret-scan.sh` (`scan()`), pre-existing | **A `.gitleaksignore` silently suppresses findings.** The script neutralises inline `gitleaks:allow` but not `.gitleaksignore`, which gitleaks reads from its working directory (CI: `transformation-hub/`; h1) and from the root of the scanned directory (G2). A committed file with `<commit>:<file>:<rule>:<line>` fingerprints would bypass the reviewed allow-list without touching `gitleaks.toml`. None exists today. | §1.8: h0 → 1 finding; h1 (same history scan, `.gitleaksignore` in the cwd) → 0; G2 (tree mode, file at the scanned root) → suppressed. | Refuse to scan when a `.gitleaksignore` exists in the repository (`git ls-files`) or the working directory, and pass `--gitleaks-ignore-path` pointing to an empty temporary directory. |
| **SEC-P1S-03** | Low | `scripts/ops/gitleaks.toml` (REDACTED entry, `2ac548b`) | **The REDACTED entry is broader than its description.** Its path matches `docs/reviews/*.md` under any directory (`trading_agent/docs/reviews/`, `apps/web/public/docs/reviews/`), and it applies to every rule. In history mode the effect is limited to the literal placeholder; in tree mode it widens SEC-P1S-01 to all those files. | §1.6 S8/S9 pass; S2–S7 detected. | Anchor the path to `(?:^|/)transformation-hub/docs/reviews/[^/]+\.md$` and add `targetRules = ["hub-url-embedded-password"]`. Alternatively avoid the entry: quote scanner output with a placeholder the default allow-list already ignores (`***`), as `api-entrypoint.cjs` does. |
| **SEC-P1S-04** | Low | `apps/api/src/modules/finance/benefits.service.ts:111`, `snapshots.service.ts:180` (via `finance.support.ts:285-287` → `activeEvidenceCount`); pre-existing, not in `45cf17f` | **Finance detail views count evidence the caller cannot read** (regression of the SEC-P1R-05 control in the P4 finance module). The `evidence` counter of a benefit or figure detail is the unfiltered rule count, while carve-out, gates, NewCo and JV display `visibleEvidenceCounts`. A PM (confidential) learns that strictly confidential evidence exists on a record. | `DEFECT SEC-P1S-04` (§1.9): after the sponsor links a strictly confidential document to a confidential snapshot and benefit, the PM's snapshot detail shows `active: 3` while its evidence list shows 2; the benefit shows 2 vs 1. | Use `visibleEvidenceCounts` for the `evidence` field of both detail DTOs; keep `activeEvidenceCount` for the verification rule (`benefits.service.ts:259`). |
| **SEC-P1S-05** | Low | `apps/api/src/platform/config.ts:142-176` | **Published synthetic values are accepted by production configuration.** The allow-list justifies three values as "never used by a running system", but `loadConfig()` in production accepts the committed test cookie secret, the test database password and the test S3 secret key (the tests assert exactly that: `oidc-sso.spec.ts:289`, `sec-p1r-fixes.spec.ts:359`, `storage-contract.spec.ts:152`). Only `hub_dev_only` and default/example S3 credentials are refused. | Static; the cited `expect(() => loadConfig(prod)).not.toThrow()` assertions pass in the suite (§1.9). | Refuse the values published in the repository in production (as for `hub_dev_only`), with a test; then "never usable" is enforced rather than a convention. |
| SEC-P1S-06 | Info | `docs/deployment/secrets.md` §Secret scanning | The allow-list list is stale (the `sec-p1r-fixes.spec.ts` path, the S3 test key and the `REDACTED` placeholder are missing), and it states the exact-value / one-file property that SEC-P1S-01 contradicts for dir scans. | Static. | Update together with SEC-P1S-01/03. |
| SEC-P1S-07 | Info | `apps/api/scripts/check-module-boundaries.mjs:56` | The import regex matches only single-quoted `from '…'` / `import('…')`; double-quoted specifiers and `require()` pass. Current code uses single quotes, so today's result is valid. | §1.10 B2, B4. | Accept both quote styles and `require(`; or use the TypeScript AST. |
| SEC-P1S-08 | Info | `apps/api/test/finance/finance-isolation.spec.ts` ("room-only principals (partner / clean team) see nothing") | That test uses `partner.alpha` and `cleanteam` on a new project where they are not members, so it tests outsiders, not room-only principals. The review spec covers room-only principals in the demo DC project (probe 5). | Static. | Rename the test or grant a room in its project. |

Observations (no finding): `RecordVisibility` rules match on `id` only, not on `project_id`. This is pre-existing for
every type; the callers pin the project (`audit_event.project_id` filter; `loadInProject` in `EvidenceService.loadTarget`)
and RLS limits rows to the caller's projects, so no cross-project path was found. The auditor branch (`reach: false`)
is equivalent to the finance module only because the auditor role always carries `finance.record.read` project-wide;
a future role with `audit.event.read` but not `finance.record.read` would see finance events by classification alone.

## 6. Verdicts

| Change | Verdict |
|---|---|
| Allow-list entries (`d508929`: sec-p1r-fixes path, S3 test key; `2ac548b`: `REDACTED` placeholder) | **CONFIRMED WITH CONDITIONS**: values synthetic, exact, each needed; condition: fix SEC-P1S-01 (rule-scoped entries or no path scoping, with a planted-secret regression check) and SEC-P1S-03 before the tree scan is cited as P1 evidence. |
| Finance visibility in evidence and history (`45cf17f`) | **CONFIRMED** (SEC-P1S-04 is a pre-existing finance-module Low, tracked separately). |
| Module-boundary checker and `attachmentDisposition` move (`2ac548b`) | **CONFIRMED** (no behaviour change; SEC-P1S-07 Info). |
| **Overall** | **PASS WITH CONDITIONS**: no Critical or High; 1 Medium (SEC-P1S-01) open with a verified fix; 4 Low; 3 Info. |

Files added by this review: `docs/reviews/P1-security-allowlist-and-finance-visibility.md`,
`apps/api/test/reviews/p1-sec-finance-visibility.spec.ts` (5 passing probes + 1 failing `DEFECT SEC-P1S-04` test,
which fails until the finding is fixed and must not be weakened).
