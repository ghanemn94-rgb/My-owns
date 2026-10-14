# Handback T-DG5-ARCH-03: P5 architecture, slices D + E (solution-architect)

- **Invocation:** `{"kind":"claude-code-cli-session","run_id":"DG5-T-DG5-ARCH-03-solution-architect-20261014T022755Z-ac9f9cc6","session_id":"ac9f9cc6-3590-4101-ab85-c7910db7de07"}`.
- **Assignment:** `docs/delivery/assignments/DG5/T-DG5-ARCH-03.md` (sha256 `8b9143d5…b288b`, verified at start).
- **Base:** `HEAD` `a8185879df98425573557460959752edc23788da` on `claude/mobily-transformation-platform-regate`; the working tree had only untracked files at the start (top-level shell dotfiles, `CLAUDE.local.md`, `.idea`, `.vscode`, `.mcp.json` and the run folder; none mine, none touched).
- **Time:** `date -u` at start `Wed Oct 14 02:28:06 UTC 2026`; at end `Wed Oct 14 04:30:55 UTC 2026` (about 2 h 3 min; the last 30 minutes were the integration re-runs of §3.4).
- **Gate systems:** nothing here reads or writes DG0–DG7 records. Product gates G1–G6 are business approvals; no agent, seed, job or starter grants a business, Finance or IT approval. Every synthetic record in the probes is labelled synthetic and approves nothing.

## 1. `validate --historical --stage DG4` (before any work)

`node tools/gates/validate.mjs --historical --stage DG4` (Node 24.21.0) → **exit 0**, output `PASS gate DG4 (historical)`. Re-run at the end: exit 0 (§3.6).

## 2. Deliverables and changed files

### 2.1 New files

| File | Purpose |
|---|---|
| `docs/architecture/adr/ADR-0043-p5-automation-engine-rules-executions-failure-queue.md` | Slice D: rule/version model, triggers, conditions, action registry port, human-only boundary, identity and per-action authorization, lifecycle (dry run, review where configured, publish, enable/disable), executions, exactly-once layers, bounded retries, failure queue and repair, jobs view, locks, authorization, exact refusal codes, decimal/Unknown semantics |
| `docs/architecture/adr/ADR-0044-p5-starter-automations-approval-routes-notification-policy.md` | Slice E: the sixteen starters as seeded rules mapped to the DG4 handlers, S12-004 instantiation, conditional approval switch and condition closure/escalation, sequential/parallel routes, notification policy and digests, cut-off packs, dependency slips, exact refusal codes |
| `packages/db/migrations/0074_p5_automation_engine.sql` | 9 tables (`automation_trigger`, `automation_action_type`, `automation_rule`, `automation_rule_version`, `automation_dry_run`, `automation_execution`, `automation_action_result`, `job_run`, `operational_failure`), guards, catalogue seeds, 2 schedules |
| `packages/db/migrations/0075_p5_starters_routes_policies.sql` | 8 tables (`approval_route_step`, `gate_condition_closure`, `gate_condition_escalation`, `notification_policy`, `notification_preference`, `notification_digest`, `meeting_cutoff_pack`, `dependency_slip`), the 16 starters with published v1, 9 triggers, 3 schedules, 6 work-item kinds, delivery columns on `inbox_notification`, `work_item_kind.urgency`, the `agenda_item_cutoff_review` trigger |
| `packages/db/migrations/0076_p5_automation_permissions.sql` | 8 permission codes and 32 role links (= `P5_AUTOMATION_PERMISSIONS`/`_ROLE_PERMISSIONS`) |
| `apps/api/test/support/p5-pending-arch-03.ts` | Slice D+E pending aggregate (frozen) |
| `apps/api/test/support/p5-pending-be-{h,h2,i,i2,j,k,l,l2}.ts` | One pending list per implementer task (11, 6, 6, 3, 1, 5, 5, 2 = 39) |
| `docs/delivery/handbacks/DG5/T-DG5-ARCH-03-evidence/**` | Probe, generators, logs (§3) |

### 2.2 Changed files

| File | Change |
|---|---|
| `docs/api/openapi.yaml` | +39 operations (724 → 763), 5 new tags, 14 parameters, 51 schemas; `PermissionCode` +8 codes; `TransformationCreate.launchPlan` (optional) — see §5 |
| `docs/architecture/erd.md` | §1n (two diagrams, entity register) |
| `docs/architecture/data-dictionary.md` | "P5 tables, slices D and E" (generated from the catalogue) + DG4 column additions, seeds, functions, validation summary |
| `docs/analysis/permissions-matrix.md` | §20 (codes, per-entity rights, AUD, SoD) |
| `docs/architecture/p5-work-split.md` | §D and §E (8 implementer tasks, file ownership, contracts, migrations 0077–0079 order, integration order, requirement → owner, implementer rules) |
| `docs/architecture/adr/ADR-0016-p2-data-model-registers-guards.md` | §6 lock registry rows 730258–730262 |
| `packages/db/src/schema.ts` | 17 tables (generated), `WorkItemKindTable.urgency`, 5 `InboxNotificationTable` columns, `SCHEMA_COLUMNS` |
| `packages/db/test/integration/catalogue.test.ts` | Mutable-table list (+8), grants (+17), a new trigger pin for the 15 guarded tables |
| `packages/db/src/seed.test.ts` | `0076` equals `P5_AUTOMATION_*`; no approval code; AUD automation.read only; `job.repair` ADM_TECH only |
| `packages/shared/src/permissions.ts` | `P5_AUTOMATION_PERMISSIONS`, `P5_AUTOMATION_ROLE_PERMISSIONS`, aggregate lines per role |
| `apps/api/src/modules/platform/advisory-locks.ts`, `advisory-locks.test.ts` | 730258–730261 (730262 reserved); distinct-classes pin (32 classes) |
| `apps/api/src/modules/reporting/my-work.ts`, `apps/web/src/i18n/{en,ar}/myWork.json` | Sections and en/ar labels of the 6 new work-item kinds (the DG4 completeness test reads every kind) |
| `apps/api/test/integration/identity.test.ts` | TO's pinned permission list +4 (`automation.read`, `automation.review`, `gate_condition.close`, `notification.preferences`) |
| `apps/api/test/support/p5-pending.ts`, `p5-operations.ts` | Aggregate import line; the 39-operation block |
| `apps/api/test/integration/contract/contract.test.ts` | Operation count 724 → 763 with its comment |
| `apps/api/test/integration/reporting/my-work.test.ts`, `apps/worker/test/integration/schedules.test.ts` | DG4 pins: 38 work-item kinds and section sizes; the five new schedules in the unhandled list (§5) |

## 3. Checks actually run

Environment: Node 24.21.0 (`/opt/nvm/versions/node/v24.21.0/bin`), pnpm workspace offline, PostgreSQL 16.13 disposable clusters via `tests/qa/support/with-pg.sh` on ports 23700–23729 (all within 23700–23749). Logs under `docs/delivery/handbacks/DG5/T-DG5-ARCH-03-evidence/`.

### 3.1 Migration apply and guard probe

Command (final run, on the final migration bytes of `migration-sha256.txt`): `QA_PG_PORT=23742 MTH_PORT_POOL=23743-23749 tests/qa/support/with-pg.sh node --conditions=@mth/source docs/delivery/handbacks/DG5/T-DG5-ARCH-03-evidence/probe.ts` → **exit 0, 133/133 PASS** (`probe-output.txt`):

- G01 fresh database: `0001` → `0076` apply (70 files); G03 over a database populated by `0001`–`0061` (synthetic transformation instantiated by the DG3 function, a DG4 work item and notification), `0062` → `0076` apply; G04 the DG4 notification stays `normal`/`delivered`/version 1; G05 only the four escalation kinds are urgent.
- Seeds S01–S06; guards AR01–AR10, AV01–AV24, DR01–DR04, EX01–EX10, AX01–AX06, JR01–JR04, OF01–OF09, RS01–RS11, GC01–GC09, NP01–NP14, MP01–MP08, DS01–DS05, AO (7 append-only tables without UPDATE/DELETE grants). Missing audit fails at COMMIT (AR02, AV24, OF09, GC09, NP13); non-stepping version fails (AR03); UPDATE on history fails (DR04, AX03, JR02, GC04, NP08, DS05, run as the owner so the append-only trigger fires, not only the missing grant).

**Disclosed failing runs (kept as evidence):**
1. `probe-run1-crash-harness-bugs.txt`: the first run reported 6 FAIL and then crashed on a fixture insert (a `work_item` inserted in autocommit fired its deferred audit check), leaving its connections open, so the process hung; it was moved to the background and later stopped by the tool's background time limit (task `bh1fq4f5e`, "killed"). Causes and fixes: AR02's test deleted nothing (mth_app cannot delete audit rows) → rewritten to insert without an audit event; four append-only probes ran as mth_app and hit "permission denied" instead of the trigger → run as the owner (and a separate AO grant check added); **EX10 found a real defect**: `automation_execution_skipped_complete` let `conditions_met = NULL` through → changed to `IS FALSE` in `0074`; the fixture was wrapped in a transaction; the harness now exits explicitly.
2. `probe-run2-3-fail-held-constraint.txt`: 129/132; **a real defect**: `inbox_notification_held_complete` forced `deliver_after` to NULL on `digested` rows → relaxed to `delivery_state <> 'held' OR deliver_after IS NOT NULL` in `0075`; the two following failures were consequences.
3. A third run (132/132, not kept) preceded adding `round_no` to `approval_route_step` (resubmitted approvals need fresh steps) and probe RS11. Two later runs (133/133 each) preceded, respectively, the `0075` header-comment correction and the Arabic shadda fix of §3.3; the kept `probe-output.txt` is the run on the final bytes.

### 3.2 Static checks (final tree)

| Command | Environment | Result | Log |
|---|---|---|---|
| `pnpm -r typecheck` | Node 24.21.0 | exit 0 | `typecheck.log` |
| `pnpm -r build` | Node 24.21.0 | exit 0 | `build.log` |
| `pnpm lint` | Node 24.21.0 | exit 0 | `lint.log` |
| `git ls-files -co --exclude-standard -z \| xargs -0 npx prettier --check --ignore-unknown` | Node 24.21.0 | exit 0, "All matched files use Prettier code style!" (the untracked top-level files of §4 item 9 are included in that list and pass or are ignored) | `format.log` |
| `pnpm openapi:lint` | Node 24.21.0 | exit 0, `PASS docs/api/openapi.yaml: OpenAPI 3.1.1, 763 operations` | `openapi-lint.log` |

Intermediate failures, disclosed: two typecheck runs failed on my own catalogue-test typing (fixed); the first `openapi:lint` failed on a duplicated schema name (`GateCondition` exists in DG4; mine renamed `TrackedGateCondition`, the file restored from `HEAD` with `git show` and regenerated once).

### 3.3 Unit tests (`pnpm test`)

| Locale | Result | Log |
|---|---|---|
| unset (`env -u LANG -u LC_ALL -u LC_CTYPE -u LANGUAGE`) | exit 0: unit-node 91 files / 1621 tests; unit-web 69 / 1358; unit-formula-nocodegen 3 / 259 + 2 skipped (by design, as in ARCH-01/02) | `unit-locale-unset.log` |
| `C.UTF-8` | exit 0: the same counts | `unit-c-utf8.log` |

**Disclosed failing run:** `unit-locale-unset-run1-1-fail-glossary.log` (exit 1): `src/i18n/glossary.test.ts` "spells the Transformation term consistently (with shadda)" found my new Arabic label `myWork.kind.role_assignment` written «تحول» without the shadda. Fixed to «تحوّل» in `myWork.json` and in the Arabic seed texts of `0074` (1) and `0075` (2); both locales then passed. Pinned count change: unit-node 1618 → 1621 (+3: the new `seed.test.ts` block); unit-web and formula unchanged.

### 3.4 Integration (`QA_PG_PORT=23744 MTH_PORT_POOL=23745-23749 tests/qa/support/with-pg.sh pnpm test:integration`)

Run 3, on the final tree (after every fix in this handback): **exit 0, 210 files, 2032/2032 tests passed** (start 04:11:23 UTC, 1152 s). Log: `integration.log`.

**Disclosed earlier runs:**
- `integration-run1-9-fail.log` (exit 1; 2023/2032): 2 contract failures (three of my GET operations lacked the ADR-0007 §5a 400; fixed in the generator and the contract regenerated), 2 readiness failures that I caused by editing `0075`'s header comment while the suite ran (migration checksum drift against the database migrated at its start; nothing to fix), and 5 pins of DG4 tests my migrations touch: `catalogue.test.ts` 0044–0045 trigger list (+`agenda_item_cutoff_review`), `my-work.test.ts` (32 → 38 kinds and section sizes), `schedules.test.ts` ×2 (the five new schedules are unhandled until their tasks ship). Each updated (§5).
- `integration-run2-pass-before-shadda-fix.log` (exit 0; **2032/2032**): the tree before the Arabic shadda fix of §3.3; the run below is on the final bytes.
- Run 3 overlapped with the two unit runs and the static checks of §3.2–§3.3 (to stay within the time bound); its result is above.

Pinned-count changes for the orchestrator: integration tests 2031 (D-144 merged tree) → 2032 (+1: the new 0074–0075 trigger pin in `catalogue.test.ts`); contract operation count 724 → 763.

### 3.5 Migration and probe evidence

`migration-sha256.txt` (the three files as probed); `probe-output.txt` 133/133 on those bytes (run after the shadda fix); `apply-check.ts` (development aid); `gen-schema.py`, `schema-dg4-columns.py`, `openapi-p5-arch03.py`, `gen-dictionary.ts` (+ `dictionary-section.md`).

### 3.6 `validate --historical --stage DG4`

Start: `PASS gate DG4 (historical)`, exit 0 (`validate-historical-DG4-start.log`). End: `PASS gate DG4 (historical)`, exit 0 (`validate-historical-DG4-end.log`).

### 3.7 Time

Start `Wed Oct 14 02:28:06 UTC 2026`; end `Wed Oct 14 04:30:55 UTC 2026` (`end-time.txt`).

## 4. Known gaps and items for the orchestrator

1. **No code beyond the contract seams.** As the assignment scopes it, nothing is routed: the 39 operations are pending in the eight `p5-pending-be-*.ts` lists, and the worker engine, wrapper, digests, scans and the delivery function are implementer work (p5-work-split §D/§E).
2. **Request-trigger starters (5, 14, 15) record an execution only for committed requests** (ADR-0044 §1). A refused request (for example M0228's missing-evidence refusal) rolls back and is recorded only by the DG4 failed-mutation audit. This is the one enumerated exception to "one execution row per evaluation"; if reviewers read REQ-S12-001 as requiring a row for refusals too, recording one needs a write outside the rolled-back transaction (a design change to raise first).
3. **`automation_rule_effective_check` runs when the rule row is written.** A version published without updating its rule row would not be caught at COMMIT by that trigger, though the exclusion `automation_rule_version_one_published` still holds. The publish order in ADR-0043 §4 always writes the rule row; BE-H2's tests must prove it.
4. **`job_run` has no retention rule** (ADR-0043 Consequences). It grows by about 320 rows a day with the 14 schedules; a purge rule is a later decision.
5. **The `automation_rule_set` configuration kind stays declared and unused** (ADR-0043 §1, alternative 1); its review-policy row is reused for rule versions. If the orchestrator wants rules as Studio elements instead, that is a redesign of slice D.
6. **Sixteen starters: the DG4 handlers for starters 5, 14 and 15 are synchronous API paths**, so BE-J edits named lines in `workflows/gates.ts`, `sustainment/handovers.ts` and `methodology/revision-impact.ts` (sequenced after BE-C and BE-B2 in p5-work-split §E.1).
7. **Plan splits.** BE-H, BE-I and BE-L of p5-plan §5.1 are split into BE-H/BE-H2, BE-I/BE-I2 and BE-L/BE-L2 (p5-work-split §D.0); the orchestrator places the three new tasks in waves (each needs only its predecessor).
8. **Pinned counts for the orchestrator (D-079 precedent):** contract operation count 724 → **763**; the media-type triple and rate-limit floor are unchanged by this task (no operation is routed). Lock classes 28 → **32**. TO's permission pin 63 → **67**.
9. **Untracked top-level files** (`.bash_profile`, `.bashrc`, `.gitconfig`, `.gitmodules`, `.idea`, `.mcp.json`, `.profile`, `.ripgreprc`, `.vscode`, `.zprofile`, `.zshrc`, `CLAUDE.local.md`) were present before this task and are not mine; the prettier check over `git ls-files -co --exclude-standard` includes some of them (§3.6).

## 5. DG1–DG4 artifacts changed, and why (D-142)

| Artifact | Change | Reason |
|---|---|---|
| `inbox_notification` (DG4, `0028`) | 5 defaulted columns, 4 CHECKs, 1 index, 1 BEFORE UPDATE trigger (`0075`) | REQ-S12-025; p5-plan §3 row 12 classifies it additive ("urgent = false, deliver now" defaults). Probe G04: a DG4 row keeps `normal`/`delivered`/version 1 |
| `work_item_kind` (DG4) | `urgency` column (default `normal`); 3 DG4 kinds set `urgent` | REQ-S12-025 urgent escalation policy; the three are escalation/overdue kinds (G05). No DG4 behaviour reads the column until BE-L ships |
| `agenda_item` (DG4, `0044`) | BEFORE UPDATE OF status trigger `agenda_item_cutoff_review` | REQ-S12-015 "not published without review"; p5-plan §3 row 13 (additive). It refuses only items listed in an unreviewed cut-off pack; no DG4 item is in a pack (MP04) |
| `docs/api/openapi.yaml` `TransformationCreate` (DG1) | optional `launchPlan` member | REQ-S12-004 "optional 90-day plan flag; start date"; p5-plan §3 row 15 and row 25 name it as an accepted extension, adopted by D-142. DG1 requests without it are unchanged; the API accepts it only when BE-J ships |
| `docs/api/openapi.yaml` `PermissionCode` | +8 codes | The enum mirrors `permissions.ts` (the ARCH-01/02 precedent, D-143 (8)) |
| `apps/api/src/modules/platform/advisory-locks.ts` (+ test), ADR-0016 §6 | 730258–730261, 730262 reserved | p5-plan §4 block of ARCH-03 |
| `apps/api/src/modules/reporting/my-work.ts`, `apps/web/src/i18n/{en,ar}/myWork.json` | 6 kinds mapped and labelled | The DG4 completeness test fails on an unmapped `work_item_kind` row (ADR-0037 §7); the ARCH-01 precedent (D-143) |
| `apps/api/test/integration/identity.test.ts` | TO's pinned permission list +4 | Role defaults of `0076`; the ARCH-02 precedent |
| `apps/api/test/integration/contract/contract.test.ts` | count pin 724 → 763 | Contract-first operations (the P3/P4 `p*-pending-*` pattern) |
| `packages/db/src/schema.ts`, `catalogue.test.ts`, `seed.test.ts` | new tables, DG4 columns, pins | Shared files ARCH tasks append to (p5-plan §5.3) |
| `packages/db/test/integration/catalogue.test.ts` (0044–0045 trigger pin, DG4) | + `agenda_item_cutoff_review` | The new trigger on `agenda_item` (row above); found by integration run 1 (§3.5) |
| `apps/api/test/integration/reporting/my-work.test.ts` (DG4) | 32 → 38 kinds; section sizes 10/6/8/5/3 → 13/8/9/5/3 | The six kinds of `0075`, each mapped (ADR-0037 §7 completeness); found by integration run 1 |
| `apps/worker/test/integration/schedules.test.ts` (DG4) | the unhandled-schedule list gains the five schedules of `0074`/`0075` | They have no handler until BE-H2, BE-K and BE-L/BE-L2 register them (the DG4 pattern for not-yet-handled rows); found by integration run 1 |

No DG1–DG4 route, response, refusal text, guard or handler changed. The scoped reopen D-142 Q2 is described in ADR-0044 §3: it changes a DG4 outcome only after an administrator publishes a methodology version with the G5 switch off.

## 6. Merge instructions

- Migrations `0074`, `0075`, `0076` in order, after `0070`; `0077`–`0079` stay free for BE-J, BE-K and BE-L/BE-L2 in that order (p5-work-split §E.5). No data migration; the starters and catalogues are seeded.
- Conflicts to expect: `docs/api/openapi.yaml`, `erd.md`, `data-dictionary.md`, `permissions-matrix.md`, `p5-work-split.md`, `permissions.ts`, `schema.ts`, `catalogue.test.ts`, `seed.test.ts`, `contract.test.ts`, `p5-pending.ts`, `p5-operations.ts` (shared ARCH files; this task ran alone on them, p5-plan §5.3). W3's BE-B, KBE-B and FE-A do not touch them per D-144; FE-A edits `i18n/{en,ar}/{nav,problems}.json`, not `myWork.json`.
- The generators in the evidence folder (`gen-schema.py`, `schema-dg4-columns.py`, `openapi-p5-arch03.py`, `gen-dictionary.ts`) are one-shot: re-running them on a tree that already has the block duplicates it (the OpenAPI one asserts on its seams, the schema ones do not).

## 7. What the implementers of slices D and E must know

The binding list is p5-work-split §E.8. In short:

1. Human decisions stay human: no rule, starter, job or service identity approves, decides an investment or attests a value. The database refuses it on versions and results.
2. Starters are wrapped, never rewritten: keep every DG4 queue, consumer, `runOnce` key, lock class and output, and prove byte-identical outputs per starter.
3. Exactly once has three layers: `(version, trigger key)` UNIQUE under lock 730258; one `done` result per action key; the effect's own dedupe key. Retries reuse the original keys.
4. Do no remote I/O inside a transaction: `boss.send` for a retry runs after COMMIT.
5. Authorization failures go straight to the failure queue with `automation.action_forbidden` and are not retried.
6. The exact refusal codes and English texts are in ADR-0043 §9 and ADR-0044 §10. A database guard reached by the API is a programming error.
7. Unknown is never 0: next run, last success, due dates and forecast finishes are `null` with a reason.
8. DG4 behaviour is the default: no policy → deliver at once; G5 switch `true` for v1; DG4 approvals have no route rows.
9. D-142 Q2, Q3 and Q11 and plan row 15 are binding.
