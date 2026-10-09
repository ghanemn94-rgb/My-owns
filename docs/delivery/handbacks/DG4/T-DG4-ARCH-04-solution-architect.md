# Handback: T-DG4-ARCH-04 — P4 architecture, slice E (RAID, actions, corrective actions, execution tracking)

- **Role:** solution-architect. **Stage:** P4 / DG4 (BUILDING). **Branch:** `claude/mobily-transformation-platform-regate`, base `HEAD` = `bfa1f984fd4fd370ddd4d0e1909c895665186f10`.
- **Invocation reference:** `{"kind":"claude-code-cli-session","run_id":"DG4-T-DG4-ARCH-04-solution-architect-20261009T033645Z-3e0818da","session_id":"3e0818da-7f94-40e6-a2a5-c45f65f1df53"}`.
- **Assignment:** `docs/delivery/assignments/DG4/T-DG4-ARCH-04.md`, sha256 `d5693ba4f98da5a64ebbfa9e3094ae72a13f6f21527efc38ce53b8b301a31bd2` (verified with `sha256sum` before starting).
- **Time:** `date -u` at the start `Fri Oct  9 03:36:58 UTC 2026`; at the end `Fri Oct  9 04:15:43 UTC 2026` (`T-DG4-ARCH-04-evidence/start-time.txt`, `end-time.txt`). Inside the 2-hour bound. Nothing is left for a continuation task (§6 lists the open points for the orchestrator).
- **Two gate systems.** Nothing here reads or writes DG0–DG7. Slice E contains no business approval: closing a RAID entry or a corrective case is an operational record change. No agent, seed, job or trigger grants a business, Finance or IT approval. All probe data is synthetic.

## 1. Preceding gate

`node tools/gates/validate.mjs --historical --stage DG3` → **exit 0**, `PASS gate DG3 (historical)`, before any change (`validate-historical-DG3.log`) and at the end (`validate-dg3-historical-end.log`).

## 2. Deliverables and changed files

| File | Purpose |
|---|---|
| `docs/architecture/adr/ADR-0031-p4-raid-actions-corrective-execution.md` (new) | RAID T15 on canonical records; Dependency entries = T08 rows (no copy); actions extended; corrective-action cases with the severity and persistence rule, the four event consumers and the producer contract for the two check events; budget/actual/forecast and the working-day slip; the critical path (CPM, no claim with a missing duration); authorization; exact refusal codes and English texts; DB→problem mappings; the S16-018 entity group |
| `packages/db/migrations/0041_p4_raid_actions_corrective.sql` (new) | Code prefixes R/A/I/CA; `raid_entry` (+ guard); `dependency.impact`; view `raid_register`; `corrective_action_rule`; `corrective_case` (one open per source, one per failed check; worker authorship); `corrective_signal` (append-only); `action_item` source links and follow-up date |
| `packages/db/migrations/0042_p4_budget_schedule.sql` (new) | `budget_line` (numeric(20,4), per-row currency, archive), `initiative_schedule` (working-day durations) |
| `packages/db/migrations/0043_p4_raid_permissions.sql` (new) | 4 permissions (3 write, 1 configure), 10 role grants, work-item kinds `corrective_case_follow_up`, `raid_action_due` |
| `packages/db/src/schema.ts` | Kysely types for 6 tables and 1 view; 4 `action_item` and 1 `dependency` columns; `VIEW_NAMES`, `SCHEMA_COLUMNS`, row types |
| `packages/db/test/integration/catalogue.test.ts` | Pins the slice E triggers, versioned tables and grants (no DELETE; signal log INSERT/SELECT; view SELECT) |
| `packages/db/src/seed.test.ts` | Pins `0043` against `P4_RAID_PERMISSIONS` / `P4_RAID_ROLE_PERMISSIONS` (3 new tests) |
| `packages/shared/src/permissions.ts` | `P4_RAID_PERMISSIONS`, `P4_RAID_ROLE_PERMISSIONS` and their role spreads (TL, BO, WL, FIN, TO); no technical-admin or AUD grant |
| `apps/api/src/modules/platform/advisory-locks.ts`, `advisory-locks.test.ts` | Lock class 730236 `correctiveCase` (730237 reserved); the registry test now lists fifteen classes |
| `docs/architecture/adr/ADR-0016-p2-data-model-registers-guards.md` | §6 registry rows 730236–730237 and the "added by" sentence (append only) |
| `docs/api/openapi.yaml` | 31 operations, 5 tags, 13 parameters, schemas, 4 `PermissionCode` values, an info note; `info.version` stays `1.3.0-p4` |
| `apps/api/test/support/p4-pending-arch-04.ts`, `p4-pending-be-d.ts` (11), `p4-pending-be-d2.ts` (11), `p4-pending-be-e.ts` (9) (new); `p4-pending.ts`, `p4-operations.ts` | Contract-test seams (the P3 `p3-pending-*` precedent) |
| `apps/api/test/integration/contract/contract.test.ts` | Operation count pin 405 → **436** (comment names slice E); nothing else |
| `apps/api/test/integration/identity.test.ts` | TO's effective-permission pin gains `corrective_rule.configure` and `raid.edit` (0043), the comment names slice E |
| `docs/architecture/erd.md` | §1g slice E physical model (two diagrams, the S16-018 entity register); §2.8 rows for Risk/Assumption/Issue and ChangeRequest corrected (see §5) |
| `docs/architecture/data-dictionary.md` | "P4 tables, slice E": changes to existing tables, generated table sections (`gen-dictionary.ts`), seeds, functions, validation-rule summary |
| `docs/analysis/permissions-matrix.md` | §13 slice E catalogue and per-entity rights (AUD read-only everywhere; ADM_* none) |
| `docs/architecture/p4-work-split.md` | §E: BE-D, BE-D2 (recommended split), BE-E with exact file ownership, consumed contracts, integration order, requirement → owner table, implementer notes; header line names §E |
| `docs/architecture/README.md` | Index row for ADR-0031 |
| `docs/delivery/handbacks/DG4/T-DG4-ARCH-04-evidence/**` | Probe, generators, logs (§4) |

## 3. Behaviour delivered per requirement (architecture level; implementers build the API)

| Requirement | Delivered here | Remaining for the implementers |
|---|---|---|
| REQ-PB-078 | `raid_register` reads the canonical `dependency` row for every Dependency entry (no copy); `dependency.impact`; one decision model kept; the RAID + decision log operation | BE-D: the T08 port, `getRaidDecisionLog`, the A01 test through the API |
| REQ-PB-079 | `raid_entry` with the nine T15 columns, R/A/I codes, status Open by default; Type closed set in table and contract | BE-D: the register routes, 400 `raid.type_invalid` |
| REQ-PB-080 | CHECK `raid_entry_probability_applicable`; dependencies have no probability column | BE-D: the two 422 codes |
| REQ-PB-085 | `corrective_case`, `corrective_action_rule`, `corrective_signal`, the one-open-per-source index, the rule (ADR-0031 §5.4) | BE-D2: the engine, the four consumers, the case routes, the worker tests |
| REQ-S09-007 | `budget_line` (decimal money, own currency); the slip definition and examples; the execution read model contract | BE-E: budget routes, `getInitiativeExecution`, the pure slip function |
| REQ-S09-009 | `initiative_schedule`; the CPM algorithm and the "no claim" rule; the fixture | BE-E: `critical-path.ts`, `getScheduleNetwork`, the duration routes |
| REQ-S12-016 | One case ever per failed check (`corrective_case_one_per_check_key`), owner and follow-up date rules, the producer payload for ARCH-06 | BE-D2: the two check consumers; ARCH-06 emits the events |
| REQ-S16-018 | ERD §1g entity register with keys, owners and statuses; migrations for Risk/Assumption/Issue and the Action extension | BE-D2: the entity-group API test; ChangeRequest is slice H's (ARCH-07, BE-L) |

## 4. Checks actually run (all with Node 24.21.0 from `/opt/nvm/versions/node/v24.21.0/bin`)

| Check | Command | Result |
|---|---|---|
| Preceding gate | `node tools/gates/validate.mjs --historical --stage DG3` | exit 0, `PASS gate DG3 (historical)` (start and end) |
| Migration apply + guard probe | `QA_PG_PORT=23740 MTH_PORT_POOL=23741-23749 tests/qa/support/with-pg.sh node --conditions=@mth/source docs/delivery/handbacks/DG4/T-DG4-ARCH-04-evidence/probe.ts` | exit 0; **96 PASS, 0 FAIL** (`probe-output.txt`). An earlier run of the same probe (port 23720) exited 2 before completion: the probe's own KPI helper used an invalid `unit_kind` (`percent`) and R07 expected only one of the two closed-set constraints; both were probe-script errors, fixed, and the rerun (also 96/0) preceded the final run above |
| Typecheck | `pnpm -r typecheck` | exit 0 (`typecheck.log`) |
| Build | `pnpm -r build` | exit 0 (`build.log`) |
| Lint | `pnpm lint` | exit 0, `--max-warnings=0` (`lint.log`) |
| Format | `git ls-files -co --exclude-standard -z \| xargs -0 npx prettier --check --ignore-unknown` | exit 0, "All matched files use Prettier code style!" (`format.log`) |
| Contract lint | `pnpm openapi:lint` | exit 0, `PASS docs/api/openapi.yaml: OpenAPI 3.1.1, 436 operations` (`openapi-lint.log`) |
| Contract additivity | `diff` of HEAD's `openapi.yaml` with the result | 0 lines removed, 1403 added; 405 → 436 operations (`openapi-diff-check.txt`; git's default diff mis-aligns the insertion, patience shows 1403 insertions, 0 deletions) |
| Unit tests, locale unset | `env -u LANG -u LC_ALL -u LC_CTYPE pnpm test` | exit 0; 89 files / **1716** tests, and the formula project 3 files / 259 passed + 2 skipped (`unit-locale-unset.log`) |
| Unit tests, C.UTF-8 | `LANG=C.UTF-8 LC_ALL=C.UTF-8 pnpm test` | exit 0; the same counts (`unit-c-utf8.log`) |
| Integration | `QA_PG_PORT=23710 MTH_PORT_POOL=23711-23719 tests/qa/support/with-pg.sh pnpm test:integration` | exit 0; 61 files, **847/847** (`integration.log`). **The first run failed and is disclosed** (`integration-run1.log`, exit 1, 4 failed / 843 passed): (a) `identity.test.ts` pins TO's effective permissions, which now include `corrective_rule.configure` and `raid.edit` (0043), so the pin was updated (the precedent of ARCH-01 and ARCH-02, whose 0031 and 0036 are already named in that comment); (b) three `migrate.test.ts` cases copy every entry of `packages/db/migrations/`, and found an empty `.claude/.cc-writes` directory that the shell sandbox had created there because some of my commands ran with that directory as their working directory (it is not a project file). I removed the empty sandbox directories from the four directories I had used as working directories, and the second run passed in full |

**Pinned-count changes:** `contract.test.ts` operations 405 → 436; `identity.test.ts` TO permissions + 2; `advisory-locks.test.ts` fourteen → fifteen classes; `seed.test.ts` + 3 tests (the 0043 block); `catalogue.test.ts` + 1 test (slice E triggers) and the version and privilege lists extended. This task adds 3 unit tests (the `seed.test.ts` 0043 block) and 1 integration test (`catalogue.test.ts`); I did not run the suites on the unchanged `HEAD`, so the totals above are not compared with a measured baseline (ARCH-03 reported 1663 unit tests; the difference includes work integrated after ARCH-03).

## 5. DG1–DG3 artifacts changed, and why (D-089)

All changes are additive (p4-plan §3 seams 12, 13 and 20, classified additive by D-089):

1. **`dependency` (DG2 `0017`, DG3 `0022`)**: one new nullable column `impact` (T15 Impact). Existing rows unchanged (probe G04); the T08 and DG2 representations and routes are unchanged. Seam 12, "New columns and a RAID view are additive".
2. **`action_item` (DG2 `0017`)**: four new nullable columns, a CHECK that limits a row to one source (always true for existing rows, which have at most the workshop source) and a trigger that fixes the new links. `created_by` stays NOT NULL. The DG2 action operations and the `ActionItem` schema are unchanged. Seam 13, "new nullable source columns; existing statuses kept".
3. **`record_code_counter` prefix CHECK**: widened with R, A, I, CA (the 0020/0037 precedent).
4. **`docs/api/openapi.yaml`**: additions only (0 lines removed). Seam 20.
5. **`docs/architecture/erd.md` §2.8** (the P1 conceptual table): the row "Risk, Assumption, Issue | `risk`, `assumption`, `issue`" was a P1 plan; it now names the built `raid_entry` typed table. The ChangeRequest row notes that slice H has not built it yet. Documentation only.
6. **ADR-0016 §6**: two registry rows appended (the P4 block rule).

No DG1–DG3 behaviour, guard, contract operation or text changes. No reopen candidate arises from slice E.

## 6. Open points for the orchestrator (decisions needed or worth confirming)

1. **BE-D2 split (recommended, not decided).** Slice E has 22 `raid` operations plus four worker consumers; p4-plan §5.1 gives `raid/**` to one task. p4-work-split §E.2 proposes BE-D2 (corrective cases) after BE-D, the KBE-D2 precedent (D-092 (2)). If not scheduled, BE-D owns it as a second half. BE-D2 appends its exercises to `p4-exercises-be-d.ts` after BE-D, so `contract.test.ts` needs no new seam line.
2. **REQ-S12-016 "recovery action" = the corrective case** (ADR-0031 §6). The worker cannot create an `action_item` without a fabricated author or a DG2 contract change (`createdBy` is required). The case carries the owner and follow-up date and is shown on "Risks and Actions > Corrective actions". Please confirm this reading of "one owned action" for the reviewers (D-089 R4 style).
3. **KPI default rule: red for 2 consecutive periods.** The sources fix no default; the acceptance texts configure a two-cycle rule. An Unknown period ends a run (ADR-0031 §5.4, alternative 5).
4. **Producer payload for ARCH-06.** ADR-0031 §5.4 fixes the `adoption.check_failed` / `control_check.failed` payload; ARCH-06 should adopt it (or raise a change before BE-D2 merges).
5. **Critical-path nodes are initiatives** (the canonical dependency graph connects initiatives only). REQ-S09-009 lists "Tasks/milestones"; ADR-0031 alternative 6 records why milestones are not nodes in DG4.
6. **REQ-S16-018 completes only with slice H** (ChangeRequest, BE-L), as the p4-plan §1.2 row already says.
7. **The `RaidDependencyPort` lines** in `workflows/t08-dependencies.ts` (one export) and `server.ts` (one wiring line) are given to BE-D; p4-plan §5.1 described BE-D's T08 access as "read side only". The port reuses the T08 service; no T08 route or text changes.

## 7. What the implementers of slice E must know

p4-work-split §E.8 lists ten rules; the most important: one canonical record per thing (never a RAID copy of a dependency); Probability n/a except for a Risk; cases are opened or updated under lock 730236, never duplicated, never reopened; Unknown is never on track (it ends a persistence run and never closes a case); worker rows have no human author and never touch `action_item`; decimal money with the row's own currency; working days only from the business calendar; no critical path while a duration is missing; AUD 403 and ADM-only 404 tested on every operation; DG2 action and T08 operations stay byte-stable. Exact codes and English texts: ADR-0031 §11.

## 8. Merge instructions

- Migrations `0041`–`0043` follow `0040`; all three numbers are used, so ARCH-05's `0044` follows directly (S-12). Run with `mth-db migrate` as usual; the probe applied them on an empty database and over a P3-populated one.
- Expect no conflict with BE-B or KBE-A (separate worktrees; they do not touch these files). The shared files edited here (`openapi.yaml`, `erd.md`, `data-dictionary.md`, `p4-work-split.md`, `permissions-matrix.md`, `permissions.ts`, `schema.ts`, `seed.test.ts`, `catalogue.test.ts`, `advisory-locks.ts`, `contract.test.ts` pin, `p4-pending.ts`, `p4-operations.ts`) are ARCH-owned by p4-plan §5.3, except the `contract.test.ts` pin, which the assignment allows.

## 9. Evidence files (`docs/delivery/handbacks/DG4/T-DG4-ARCH-04-evidence/`)

`start-time.txt`, `end-time.txt`, `validate-historical-DG3.log`, `validate-dg3-historical-end.log`, `probe.ts`, `probe-output.txt`, `migration-sha256.txt`, `gen-dictionary.ts`, `openapi-p4-arch04.py`, `openapi-lint.log`, `openapi-diff-check.txt`, `typecheck.log`, `build.log`, `lint.log`, `format.log`, `unit-locale-unset.log`, `unit-c-utf8.log`, `integration-run1.log` (first run, 4 failures, disclosed in §4), `integration.log`.
