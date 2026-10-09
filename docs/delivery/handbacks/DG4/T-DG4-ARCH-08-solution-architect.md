# Handback: T-DG4-ARCH-08 — P4 architecture, slices J (dashboards and workspaces) and K (traceability and Modular entry)

- **Role:** solution-architect. **Stage:** P4 / DG4 (BUILDING). **Branch:** `claude/mobily-transformation-platform-regate`, base `HEAD` `89df7f7004cb51a5265348631f5310e49719d314` (verified with `git rev-parse HEAD` before any write; `git status` showed only the sandbox stub files and the four W9/W10 run directories).
- **Invocation reference:** `{"kind":"claude-code-cli-session","run_id":"DG4-T-DG4-ARCH-08-solution-architect-20261009T160503Z-9213ca35","session_id":"9213ca35-a609-4737-8e2c-e02d6b15b9a6"}`. Assignment `docs/delivery/assignments/DG4/T-DG4-ARCH-08.md`, sha256 `ae96467b…2738e4` (checked).
- **Time:** start `Fri Oct  9 16:05:15 UTC 2026`, end `Fri Oct  9 17:00:19 UTC 2026` (`T-DG4-ARCH-08-evidence/start-time.txt`, `end-time.txt`). About 55 minutes; within the 2-hour limit, so nothing is left for a continuation task.
- **Two gate systems.** Nothing here reads or writes DG0–DG7 or any `docs/delivery/` record other than this handback and its evidence. No migration, seed, trigger or route of this task approves anything; an inherited approval stays a `gate_dispensation` row and never a gate decision (probe IR11). All probe data is synthetic.

## 1. Preceding gate

`node tools/gates/validate.mjs --historical --stage DG3` → **exit 0**, `PASS gate DG3 (historical)`, at the start (16:05Z, before any write; `validate-historical-DG3.log` records the output) and again at the end (`validate-dg3-historical-end.log`, exit 0).

## 2. Changed files

| File | Purpose |
|---|---|
| `docs/architecture/adr/ADR-0037-p4-dashboards-t10-my-work-overview-header.md` (new) | Slice J design: read models, six dashboards, T10 area RAG and defaults, filters, drill-down and value states, scope, My Work, Executive Overview, workspace header, authorization, refusal codes |
| `docs/architecture/adr/ADR-0038-p4-traceability-orphans-allocation-impact-modular.md` (new) | Slice K design: chain and `traceability_edge`, trace links, allocation rule and lock 730249, traceability view, orphan report, impact, Modular entry (inherited records, gate labels, missing links, §7.4 reopen candidate), one source of truth, portfolios and workstreams, refusal codes |
| `packages/db/migrations/0055_p4_traceability_modular_structure.sql` (new) | `portfolio`, `portfolio_transformation`, `workstream`, `workstream_initiative`, `trace_link`, `inherited_record`; the two allocation columns of `initiative_outcome_contribution`; `trace_allocation_guard`, `inherited_record_guard`; view `traceability_edge`; prefix `WS` |
| `packages/db/migrations/0056_p4_dashboards_t10.sql` (new) | `t10_area_definition` (six areas, B0095 and M0247–M0252 verbatim, provisional Arabic), `dashboard_rag_policy`, view `my_work_draft` |
| `packages/db/migrations/0057_p4_dashboards_traceability_permissions.sql` (new) | 5 permission codes and 11 role grants |
| `packages/db/src/schema.ts` | Kysely interfaces, `Database` lines, row types and `SCHEMA_COLUMNS` for the 8 tables and 2 views; the two new `initiative_outcome_contribution` columns; `VIEW_NAMES` |
| `packages/db/src/seed.test.ts` | `0057` equals `P4_DASHBOARD_TRACE_*`; the combined-permission check |
| `packages/db/test/integration/catalogue.test.ts` | Trigger pins for `0055`–`0056`, versioned tables, `mth_app` grants (incl. the views) |
| `packages/shared/src/permissions.ts` | `P4_DASHBOARD_TRACE_PERMISSIONS`, `P4_DASHBOARD_TRACE_ROLE_PERMISSIONS`; role defaults TL, BO, WL, TO, KDS |
| `apps/api/src/modules/platform/advisory-locks.ts`, `advisory-locks.test.ts` | `traceAllocationSet` 730249 and the migration constant `trace_allocation_lock_class` |
| `docs/architecture/adr/ADR-0016-p2-data-model-registers-guards.md` | §6 registry row 730249 and the provenance sentence (append-only) |
| `docs/api/openapi.yaml` | 38 operations, 5 tags, 29 parameters, the slice J/K schemas, 5 `PermissionCode` values, the optional `BenefitRegisterRow.initiatives[]` member, an `info.description` paragraph; `info.version` stays `1.3.0-p4` |
| `apps/api/test/support/p4-pending-arch-08.ts` (new), `p4-pending-be-m.ts`, `p4-pending-be-m2.ts`, `p4-pending-be-m3.ts`, `p4-pending-kbe-g.ts`, `p4-pending-kbe-g2.ts` (new) | Contract-test seams (10 + 4 + 14 + 6 + 4 = 38) |
| `apps/api/test/support/p4-pending.ts` | One import line for the slice aggregate (the file is now frozen, p4-plan §5.3) |
| `apps/api/test/support/p4-operations.ts` | The T-DG4-ARCH-08 block (38 ids) |
| `apps/api/test/integration/contract/contract.test.ts` | Operation pin 607 → **645** with the provenance comment |
| `apps/api/test/integration/identity.test.ts` | TO's effective permissions +5 codes (sorted) |
| `docs/architecture/erd.md` | §1k (three diagrams and the entity register) |
| `docs/architecture/data-dictionary.md` | "P4 tables, slices J and K" (generated tables, views, seeds, functions, validation summary) |
| `docs/analysis/permissions-matrix.md` | §17 |
| `docs/architecture/p4-work-split.md` | §J+K (tasks BE-M, BE-M2, BE-M3, KBE-G, KBE-G2; ownership; integration order; requirement → owner) and the header sentence naming the section |
| `docs/delivery/handbacks/DG4/T-DG4-ARCH-08-evidence/**` | Logs, probe, generators (provenance) |

## 3. Behaviour delivered per requirement (architect half; none of the 15 rows is complete without its implementer)

| Requirement | Delivered here | Implementer half |
|---|---|---|
| REQ-PB-062 | T10 seed verbatim (probe T01: compared with `docs/source/playbook.md` B0095 and `master-prompt.anchored.md` M0247–M0252; T02: read-only); `T10Area` shape; `getTransformationDashboard` contract | KBE-G (+ FE-G) |
| REQ-PB-063 | Area rules with Unknown precedence; outcomes never read task completion; thresholds table with NULL = documented default (RP01–RP07) | KBE-G |
| REQ-PB-064 | Decisions area = the ADR-0032 overdue rule in the organization's calendar timezone | KBE-G |
| REQ-S03-008 | `getMyWork` contract; six sections; the map of all 30 work-item kinds; `my_work_draft` (MW01) | KBE-G2 |
| REQ-S03-009 | Executive Overview = the executive dashboard (`GET /api/v1/overview`) | KBE-G |
| REQ-S03-011 | `getWorkspaceHeader` with eight elements and explicit Unknown; `WorkflowsReadPort` | KBE-G2 (+ FE-G link) |
| REQ-S13-001 | Six dashboards (ADR-0037 §2), scope rule (§6) | KBE-G, KBE-G2 |
| REQ-S13-002 | Filters, window and as-of date (§4) | KBE-G |
| REQ-S13-003 | `DashboardValue` states, drill-down contract and sum invariant (§5) | KBE-G |
| REQ-PB-005 | Missing-link rules; gate labels; §7.4 reopen candidate | BE-M2 (+ orchestrator) |
| REQ-PB-010 | `traceability_edge` copies nothing (G05, TL17); `initiatives[]` member; rename test specified | BE-M |
| REQ-PB-044 | `trace_link` (TL02–TL17); orphan rules; clickable-node `href` rule | BE-M |
| REQ-S03-001 | `portfolio*`, `workstream*` (PF01–PF08, WS01–WS06) | BE-M3 |
| REQ-S03-005 | `inherited_record` (IR01–IR11); label text verbatim from the row's procedure | BE-M2 |
| REQ-S03-006 | Allocation rule enforced in the database with lock 730249 (TL07–TL12); impact rules | BE-M |

## 4. Checks actually run

Environment: Node 24.21.0 (`/opt/nvm/versions/node/v24.21.0/bin`), offline, disposable PostgreSQL 16.13 (UTF8, C locale) through `tests/qa/support/with-pg.sh` on ports 23700–23749 only. `df -h .` before each full run: 22–23 GB free.

| Check | Command | Result |
|---|---|---|
| Historical DG3 gate (start, end) | `node tools/gates/validate.mjs --historical --stage DG3` | exit 0, `PASS gate DG3 (historical)` (both) |
| Migration apply + guard probe (final) | `QA_PG_PORT=23742 MTH_PORT_POOL=23743-23749 tests/qa/support/with-pg.sh node --conditions=@mth/source docs/delivery/handbacks/DG4/T-DG4-ARCH-08-evidence/probe.ts` | exit 0; **59 PASS, 0 FAIL** (`probe-output.txt`). G00: ids contiguous to `0057` (repair `0058`); G01: fresh `0001`→`0058` (58 files); G02–G06: `0001`–`0027` populated with a DG3 contribution, then `0028`→ on top; the contribution keeps NULL shares and version 1, appears in `traceability_edge`, and a DG3-style edit still commits. Missing audit fails at COMMIT: PF02, WS05, TL14, IR10, RP05. Non-stepping version fails: PF03, WS06, TL15, RP06. Never deleted / read-only: TL16 (no DELETE grant on `trace_link`), T02 (no UPDATE on the T10 seed). Every ADR invariant probed: allocation (TL07–TL12), link shape and scope (TL03–TL06, TL13), inherited-record guards (IR01–IR11), memberships (PF05–PF08, WS01–WS04), seed verbatim (T01), thresholds (RP01–RP07), drafts view (MW01). Migration checksums: `migration-sha256.txt` |
| Earlier probe runs (disclosed) | same command, ports 23708 and 23710 | **Run 1: exit 1** (`probe-run1-output.txt`): a TypeScript syntax error in the probe itself (a helper truncated when the harness was copied); no migration ran. **Run 2: exit 1, 57/2** (`probe-run2-output.txt`): TL16 and T02 failed only because the probe's `RESET ROLE` ran inside an aborted transaction and masked the expected `permission denied`; fixed with `SET LOCAL ROLE`. No migration defect in either run. The final run above is on the final migrations; after run 2 only a probe description (MW01) changed |
| Quick applies during design | `with-pg.sh node … $TMPDIR/apply.ts` / `drafts.ts` (ports 23700–23706) | Applied all migrations; used to list the work-item kinds and the tables with a `draft` status. One helper invocation failed with a TypeScript syntax error of my ad-hoc script (no database effect); not evidence |
| Typecheck | `pnpm -r typecheck` | exit 0 (`typecheck.log`); a first run failed on two TS2367 comparisons in my new seed test, fixed before every other check |
| Build | `pnpm -r build` | exit 0 (`build.log`) |
| Lint | `pnpm lint` | exit 0 (`lint.log`) |
| Format | `git ls-files -co --exclude-standard -z \| xargs -0 npx prettier --check --ignore-unknown` | exit 0 (`format.log`). An earlier invocation that filtered out the sandbox stub files also exited 0 |
| OpenAPI lint | `pnpm openapi:lint` | exit 0, `PASS docs/api/openapi.yaml: OpenAPI 3.1.1, 645 operations` (`openapi-lint.log`) |
| Contract byte-stability | `diff` of `openapi.yaml` before/after the generator | **0 lines removed**, 1917 added; 607 → 645 operations (`openapi-diff-check.txt`) |
| Unit, locale unset | `(unset LANG LC_ALL LC_CTYPE; pnpm test)` | exit 0: **2293 passed** (120 files) + **259 passed / 2 skipped** (formula no-codegen) (`unit-locale-unset.log`). +3 against D-105 (2290): the three new `0057` seed tests |
| Unit, `C.UTF-8` | `LANG=C.UTF-8 LC_ALL=C.UTF-8 pnpm test` | exit 0: 2293 + 259/2 skipped (`unit-c-utf8.log`) |
| Integration | `QA_PG_PORT=23720 MTH_PORT_POOL=23721-23749 tests/qa/support/with-pg.sh pnpm test:integration` | exit 0: **132 files, 1414/1414 passed** (`integration.log`), first run, no failure. It ran in the background while the build, the `C.UTF-8` unit run and the final probe ran on separate clusters/ports |

**Pinned-count changes:** `contract.test.ts` operations 607 → 645 (+38). Media-type pin unchanged (no new route). `identity.test.ts` TO effective permissions 50 → 55. Advisory-lock registry 23 → 24 classes. `VIEW_NAMES` 8 → 10.

## 5. DG1–DG3 artifacts changed, and why (D-089)

1. **`initiative_outcome_contribution` (DG3 `0020`)**: two nullable columns, two CHECKs and one trigger added by `0055` (ADR-0038 §3). Additive: existing rows keep NULL (probe G04), the DG3 routes and their contract are unchanged and never write the columns, and a DG3-style edit still commits (G06). The share is set only by the new P4 operation `setOutcomeContributionAllocation`. This is the "link-allocation lines in `portfolio/links.ts`" that p4-plan §5.1 assigns to BE-M.
2. **`record_code_counter` prefix CHECK**: widened with `WS` (the pattern every P4 range has used).
3. **ADR-0016 §6**: one appended registry row (730249) and the provenance sentence; no existing row changed.
4. **`docs/api/openapi.yaml`**: P1–P3 paths byte-stable (0 lines removed). The one change inside an existing P4 schema is the optional `BenefitRegisterRow.initiatives[]` member (slice B, a DG4 contract, not DG-approved yet; ADR-0038 §8) — for the orchestrator to confirm, interpretation (d) below.
5. No DG1–DG3 route, guard, text or migration is edited. **ADR-0038 §7.4 is a reopen candidate that this task does not implement** (see §6).

## 6. For the orchestrator (decisions needed) and what the implementers must know

**Decisions needed:**

- **(e) Reopen candidate, ADR-0038 §7.4.** REQ-PB-005 and REQ-S03-005 accept "G3 submission is rejected by the API until [the baseline and outcome links] are supplied or an authorized waiver exists". As built it is not: for a Modular entry at Design, `sequenceProblem` skips G2 and the five G3 criteria (`0011`) test neither baselines nor outcome links. p4-plan §1.2's "the G3 refusal itself is DG2's (A03)" is therefore not true of the code (the F-DG3-100 lesson). Recommended: a Modular-only precondition in `submitGate` (422 `gate.modular_links_missing`, unless an accepted unexpired `gate_dispensation` waiver for the gate exists), End-to-End responses byte-identical. If rejected, the literal clause is unmet in DG4 and must be recorded.
- **(a)–(d), (f) interpretations** (p4-work-split JK.10 item 8): the T10 default thresholds; the T10 override = the slice A KPI override; one read model each for executive dashboard/Executive Overview and personal dashboard/My Work; "scorecard" = the T10 Portfolio area and the `initiatives[]` member; the BE-M2/BE-M3/KBE-G2 split.
- **`apps/api/test/support/p4-pending.ts`** is now frozen (p4-plan §5.3), with all eight ARCH imports.

**Implementers (full list in p4-work-split JK.10):**

1. Read models store nothing; scope = the readable transformation set, 404 outside it; unreadable reached records are counted, never listed.
2. `reporting` may not import `workflows`: use the views named in ADR-0037 §1, the `dashboard-facts.ts` exports, and `WorkflowsReadPort` (KBE-G2 wires it in `server.ts`).
3. The 100 % rule: lock 730249 first, the `0055` trigger second (`trace_allocation_total` → 422 `trace_link.allocation_exceeds_total`).
4. Unknown precedence red > amber > unknown/not_computable > stale > green; the Outcomes rule never reads task completion.
5. The workspace header is served by `reporting/workspace-header.ts`; KBE-G2 removes the empty `transformations/workspace-header.ts` stub, its export line and its `server.ts` import and call (ADR-0037 §11).
6. My Work's kind map must cover every `work_item_kind`; a completeness test reads the migrated table.
7. Inherited is never approved; the label text is "Inherited - recorded, not granted in platform".

## 7. Known gaps / not done

- No route, service, web screen or worker code: those are BE-M, BE-M2, BE-M3, KBE-G, KBE-G2 and FE-G (p4-work-split §J+K). All 38 operations are in the pending lists.
- ADR-0038 §7.4 waits for the orchestrator (above).
- I did not run the e2e suite (not in this task's acceptance list; no web code changed).

## 8. Merge instructions

- Apply `0055`–`0057` with `mth-db migrate` after `0054`. They sort before `0058` (repair range, merged); a database that already applied `0058` takes `0055`–`0057` as pending migrations (the runner applies pending files in lexical order); `0058` does not depend on them, and the probe applied `0001`→`0058` in order on a fresh database and `0028`→`0058` on a P3 database.
- Shared files touched (p4-plan §5.3): `openapi.yaml`, `erd.md`, `data-dictionary.md`, `p4-work-split.md`, `permissions-matrix.md`, `permissions.ts`, `schema.ts`, `seed.test.ts`, `catalogue.test.ts`, `contract.test.ts` (pin), `p4-pending.ts`, `p4-operations.ts`, `advisory-locks.ts`/`.test.ts`, ADR-0016. BE-J, BE-K and BE-L ran concurrently in their own worktrees and, per the assignment, touch none of these; if one of them changes `schema.ts`, `catalogue.test.ts` or `contract.test.ts`, expect a textual conflict at the end of those lists, resolved by union (and the operation pin is the sum).
- `requirements.csv`, `stages.json`, `findings.json`, reviews and gate records were not touched.
