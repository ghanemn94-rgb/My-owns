# Handback T-DG4-ARCH-05 — P4 architecture, slice D (forums, meetings, T16, escalation)

- **Role:** solution-architect. **Invocation reference:** `{"kind":"claude-code-cli-session","run_id":"DG4-T-DG4-ARCH-05-solution-architect-20261009T042843Z-f194b9c5","session_id":"f194b9c5-a0d5-4ba6-bb98-c70525a5d69a"}`.
- **Assignment:** `docs/delivery/assignments/DG4/T-DG4-ARCH-05.md` (sha256 `56cfe0f6…4da2d`, verified with `sha256sum` before starting).
- **Base:** branch `claude/mobily-transformation-platform-regate`, `HEAD` = `ab51be8d114861ee0c22e44118a7e384e80eaa18` (working tree clean apart from the untracked environment files and other runs' `docs/delivery/runs/DG4/*` directories, none of which I touched).
- **Time:** start `Fri Oct  9 04:29:01 UTC 2026`; end `Fri Oct  9 05:22:37 UTC 2026` (`start-time.txt`, `end-time.txt`).
- **Two gate systems.** Nothing here reads or writes DG0–DG7. Recording a T16 Outcome is a product business decision by a person (category `business_approval`), not a G1–G6 gate decision; no agent, seed, job or trigger records one. All probe data is synthetic.

## 1. `validate --historical --stage DG3`

`node tools/gates/validate.mjs --historical --stage DG3` (Node 24.21.0), run first: **`PASS gate DG3 (historical)`, exit 0** (`T-DG4-ARCH-05-evidence/validate-historical-DG3.log`). Re-run at the end: `PASS gate DG3 (historical)`, exit 0 (`validate-dg3-historical-end.log`).

## 2. Changed files

| File | Purpose |
|---|---|
| `docs/architecture/adr/ADR-0032-p4-forums-meetings-t16-escalation.md` (new) | The slice D design: entities, fields, state machines, refusal codes and exact English texts, authorization, Unknown semantics, probes per claim |
| `packages/db/migrations/0044_p4_forums_meetings.sql` (new) | `forum_template` (five B0093 layers verbatim, Arabic provisional), `forum`, `forum_participant`, `meeting_series`, `meeting`, `agenda_item`, `meeting_attendance`, `meeting_output`, `meeting_action_link`, `meeting_minutes`; `p4_instantiate_forums`; `p4_instantiate_transformation` redefined with one added call; backfill |
| `packages/db/migrations/0045_p4_t16_escalation.sql` (new) | 11 nullable T16 columns and their CHECKs/triggers on `decision`; `governance_escalation_rule`, `decision_escalation`, `blocker_status`; view `executive_decision_log` |
| `packages/db/migrations/0046_p4_governance_permissions.sql` (new) | 6 permission codes, 18 role grants, 4 work-item kinds |
| `packages/db/src/schema.ts` | Kysely interfaces (13 tables, 1 view, 11 `decision` columns), `Database`, `VIEW_NAMES`, row types, `SCHEMA_COLUMNS` (generated from the DDL by `gen-schema.py`) |
| `packages/db/src/seed.test.ts` | `0046` = `P4_GOVERNANCE_*` pins; the `PERMISSIONS` union includes the slice D block |
| `packages/db/test/integration/catalogue.test.ts` | Slice D trigger pin, versioned-table list, `mth_app` grants |
| `packages/shared/src/permissions.ts` | `P4_GOVERNANCE_PERMISSIONS`, `P4_GOVERNANCE_ROLE_PERMISSIONS`, role spreads; header comment lists `0043` and `0046` |
| `apps/api/src/modules/platform/advisory-locks.ts`, `advisory-locks.test.ts` | Classes 730238–730240 (730241 reserved); test pins 18 classes |
| `docs/architecture/adr/ADR-0016-p2-data-model-registers-guards.md` | §6 registry rows 730238–730241 (the ARCH-01…04 precedent) |
| `docs/api/openapi.yaml` | 49 operations, 8 tags, 16 parameters, slice D schemas, 6 `PermissionCode` values, info note; `info.version` stays `1.3.0-p4` |
| `apps/api/test/support/p4-pending-arch-05.ts` (new, frozen aggregate), `p4-pending-be-f.ts` (20), `p4-pending-be-g.ts` (11), `p4-pending-be-f2.ts` (18) (new); `p4-pending.ts` (one import); `p4-operations.ts` (the 49 ids) | Contract seams (S-10) |
| `apps/api/test/integration/contract/contract.test.ts` | Operation-count pin 436 → 485 and its comment (the only pin the pending pattern requires) |
| `apps/api/test/integration/identity.test.ts` | TO's effective-permission pin gains the five slice D codes TO holds (§4, the ARCH-01/02/04 precedent) |
| `docs/architecture/erd.md` | §1h (physical model, slice D) and §1h.3 entity register; §2.9 table names corrected to the built names |
| `docs/architecture/data-dictionary.md` | "P4 tables, slice D" (generated from the migrated catalogue by `gen-dictionary.ts`), the `decision` changes, seeds, functions, validation summary |
| `docs/analysis/permissions-matrix.md` | §14 slice D catalogue and per-entity rights (AUD read-only everywhere) |
| `docs/architecture/p4-work-split.md` | §D (BE-F, BE-G, BE-F2 ownership, contracts, integration order, requirement → owner, implementer rules); header line names §D |
| `docs/delivery/handbacks/DG4/T-DG4-ARCH-05-evidence/*` | Probe, generators, logs (§7) |

## 3. Behaviour delivered per requirement (architecture layer; the API halves are the implementers', p4-work-split §D.7)

| Requirement | Delivered here | Remaining (owner) |
|---|---|---|
| REQ-PB-060 | Five layers seeded verbatim (probe S01), copied per transformation by `p4_instantiate_forums` / `p4_instantiate_transformation` and backfilled (G04, G06, G07); series table with the recurrence rule and no-duplicate occurrence index (MS01–MS07, M03) | routes, generation service and job (BE-F) |
| REQ-PB-061 | Outputs table with the B0093 kinds linked to canonical records (O01–O06); Value Review publication needs a benefit evidence or forecast entry (MN02, MN03); decisions are T16 rows | routes; decided outcome → `decision` output (BE-F2, BE-G) |
| REQ-PB-068 | Executive-ask shape and the published-ask link (A03, A04); executive forum takes asks only (A01); contract `publishAgendaItem` with `agenda_item.executive_ask_incomplete` | the seven-element API check (BE-F2) |
| REQ-PB-081 | T16 columns on `decision` with completeness, options, outcome CHECKs (D01–D08); `executive_decision_log` view with the nine columns (V01); overdue rule specified | routes, Outcome service, overdue list (BE-G) |
| REQ-PB-082 | `blocker_status` RAG by cycle (B01–B05); one open ask per blocker (D09, E10); rule table (R01–R04); lock 730239 | consumer and scan (BE-G) |
| REQ-S10-005 | Configurable participants, quorum, cut-off, agenda rules (F03–F06, FP01–FP02); future-only regeneration as a database invariant (M05, M06); rule_version step (MS04, MS05) | regeneration service (BE-F) |
| REQ-S10-011 | Quorum enforced on a decided outcome (A07–A09); published minutes immutable (MN04) and the meeting frozen (MN05, MN06); meeting action links (L01, L02); work-item kinds | routes, My Work items (BE-F2) |
| REQ-S10-012 | `decision_ask_complete` refuses an ask without why now (D01); contract requires the seven fields (400 at `/whyNow`) | route (BE-G) |
| REQ-S12-011 | `decision_escalation` once per SLA due date, only for an open expired ask, levels step by 1, never a decision (E01–E09); lock 730240 | the working-day scan job (BE-G) |
| REQ-S16-019 | All six entities with PK, owner and status in `0044`, ERD §1h.3, ADR-0032 §13 | the entity-group API test (BE-F2) |

None of the ten rows is complete at this task's end: each needs its implementer half (as for every ARCH task).

## 4. Checks actually run

| Check | Command / environment | Result |
|---|---|---|
| Historical validator | `node tools/gates/validate.mjs --historical --stage DG3` | exit 0, `PASS gate DG3 (historical)` |
| Migration apply + guard probe | `QA_PG_PORT=23711 MTH_PORT_POOL=23712-23749 tests/qa/support/with-pg.sh node --conditions=@mth/source docs/delivery/handbacks/DG4/T-DG4-ARCH-05-evidence/probe.ts` (PostgreSQL 16.13, UTF8, C locale) | exit 0; **101 PASS, 0 FAIL** (`probe-output.txt`): `0001`→`0046` on a fresh DB (G01) and `0028`→`0046` over a DB populated by `0001`–`0027` (G02–G05); missing audit fails at COMMIT (F01, MS02, M02, A02, O06, D04, E03, B03); a non-stepping version fails (F02); UPDATE/DELETE on append-only tables fails (O04, O05, L02, E05, B05); every ADR invariant probed (ADR-0032 Verification) |
| Earlier probe runs (disclosed) | same command, ports 23705 and 23707 | **Run 1: exit 1, 98 PASS / 2 FAIL** (`probe-run1-output.txt`): O02 exposed a **real migration defect** — `meeting_output_record_type` was a `CASE` CHECK that evaluated to NULL (and so passed) when `record_type` was NULL for a kind that requires a record; fixed in `0044` by wrapping it in `coalesce(…, false)` (the file was not merged; not a forward-only violation). G04 was a probe-query error (it counted both synthetic transformations). **Run 2: exit 1, 99 PASS / 1 FAIL** (`probe-run2-output.txt`): G04 again, fixed by filtering on the transformation. Run 3 added G07 after `p4_instantiate_transformation` was redefined: 101/0 |
| Data dictionary generation | `QA_PG_PORT=23713 … with-pg.sh node --conditions=@mth/source …/gen-dictionary.ts` | exit 0 (14 sections) |
| OpenAPI lint | `pnpm openapi:lint` | exit 0, `PASS docs/api/openapi.yaml: OpenAPI 3.1.1, 485 operations` (`openapi-lint.log`) |
| Contract stability | `diff` before/after (`openapi-diff-check.txt`) | 0 lines removed, 2142 added; `info.version` 1.3.0-p4 |
| Typecheck | `pnpm -r typecheck` | exit 0 (`typecheck.log`) |
| Build | `pnpm -r build` | exit 0 (`build.log`) |
| Lint | `pnpm lint` | exit 0 (`lint.log`) |
| Format | `git ls-files -co --exclude-standard -z \| xargs -0 npx prettier --check --ignore-unknown` | exit 0 (`format.log`; re-run at the end, §7) |
| Unit, first run (disclosed) | `pnpm test`, locale unset and `C.UTF-8` | **exit 1 both**: 1 failed / 2001 passed (`unit-locale-unset-run1.log`, `unit-c-utf8-run1.log`): `seed.test.ts` "0018 seed equals the P2 part" compares `PERMISSIONS` with the union of all blocks, which lacked the new slice D block; fixed by adding `P4_GOVERNANCE_PERMISSIONS` to that union |
| Unit, final | `env -u LANG -u LC_ALL -u LC_CTYPE -u LC_MESSAGES pnpm test`; `LANG=C.UTF-8 LC_ALL=C.UTF-8 pnpm test` | **exit 0 both**: unit-node/jsdom 101 files, **2002 passed**; worker 3 files, **259 passed, 2 skipped** (`unit-locale-unset.log`, `unit-c-utf8.log`). Pinned-count change: 1999 → 2002 (the three new `0046` seed tests) |
| Integration, first run (disclosed) | `QA_PG_PORT=23720 MTH_PORT_POOL=23721-23749 tests/qa/support/with-pg.sh pnpm test:integration` | **exit 1**: 1 failed / 847 passed of 848 (`integration-run1.log`): `identity.test.ts` "GET /api/v1/me" pins TO's effective permissions, which now include the five slice D codes TO holds; updated the pin (the TO-permission pin update of ARCH-01/02/04, D-093). Every catalogue pin passed on this run |
| Integration, final | `QA_PG_PORT=23722 MTH_PORT_POOL=23723-23749 tests/qa/support/with-pg.sh pnpm test:integration` | **exit 0: 61 files, 848/848 passed** (`integration.log`). Count change: 847 → 848 (the new slice D catalogue trigger test) |
| Final re-runs after the test-pin edit | `pnpm -r typecheck`, `pnpm lint`, the prettier command, `pnpm openapi:lint` | all exit 0 (logs overwritten with these runs). `pnpm -r build` ran once (exit 0) before the two test-only edits (`seed.test.ts`, `identity.test.ts`), which the build does not compile |

## 5. DG1–DG3 artifacts changed, and why (D-089)

1. **`decision` (DG2 `0017`)**: 11 nullable columns, 7 CHECKs, 2 indexes, 2 triggers, all inert on rows with `ask_origin` NULL (every pre-P4 row and every DG3 funding decision; probe G05). Seam 11 "**Additive** (ADR-0015 'P4 adds columns and views, not a new table')". The DG2 `Decision` schema and operations are unchanged; the T16 representation is a new schema on new paths.
2. **`docs/api/openapi.yaml`**: additive only (0 removed lines); the `PermissionCode` enum gains 6 values (the ARCH-01…04 precedent). Seam 20.
3. **ADR-0016 §6 (DG2)**: registry rows for 730238–730241 (the assignment requires it; the ARCH-01…04 precedent).
4. **`docs/architecture/erd.md` §2.9 (P1 conceptual model)**: the table names `attendance` and `minutes` are corrected to the built `meeting_attendance` and `meeting_minutes`, labelled as such. Documentation only.
5. **`packages/db/src/seed.test.ts`, `catalogue.test.ts`, `contract.test.ts`, `advisory-locks.test.ts`, `identity.test.ts`**: pins extended as the established pattern requires (no assertion weakened).
6. **`p4_instantiate_transformation` (DG4 `0030`, not yet approved)**: redefined in `0044` with one added call at its end; the API does not call it yet (`transformations/routes.ts` calls `p3_instantiate_transformation`), so whoever wires P4 instantiation gets the forums with it.

No reopen candidate is raised by slice D.

## 6. What the implementers of slice D must know (summary; binding text in p4-work-split §D.8 and ADR-0032)

1. **Split proposal for the orchestrator:** BE-F (20 operations, W6) → BE-G (11, W7, after BE-F and BE-D) → **BE-F2** (18, W8, after BE-G; new task, the BE-D2/KBE-D2 precedent). If BE-F2 is not scheduled, BE-F carries its list as a second half.
2. **Interpretations for the orchestrator to confirm** (recorded in ADR-0032):
   - (a) REQ-PB-068/REQ-S10-012: an executive ask is validated at creation (`createExecutiveDecision`, all seven fields; 400 at `/whyNow`), and an agenda item's draft brief is validated at publication (422 with each missing element); publishing a brief moves it into a new T16 row.
   - (b) REQ-PB-082: the worker-created ask names its author as the person whose N-th red observation triggered it (`created_by`), with a `system` audit actor on their behalf, because the DG2 `Decision` schema requires `createdBy` (ADR-0032 alternative 6). Its why now / options / recommendation / impact are completed by a person before it can go on an agenda.
   - (c) "Cycle" = one meeting of one forum; a cycle without a red observation ends the run.
   - (d) REQ-PB-060 "configure:TO,ADM": technical admins do not get `forum.configure` (no transformation records; ADR-0006).
   - (e) `executive_decision.decide` is `business_approval`, held by SP, BO and FIN only (ADR-0026 §8 reasoning); a TL/WL/TO chair runs the meeting but records no Outcome.
   - (f) DG3 funding decisions (kind `executive`) appear in the T16 log as `askOrigin: earlier_record` with Unknown for the T16 columns they lack.
3. Migrations `0044`–`0046` use the whole range; ARCH-06's `0047` follows directly (S-12). Slice D implementers have no migration number (repair range `0058`–`0069` on request).
4. `NextForumDateProvider` (ADR-0026 §5) is BE-F's `nextForumDateProvider` in `governance/meetings.ts`, consumed by BE-C inside the same module.

## 7. Known gaps, continuation and merge instructions

- **Not done by this task (by design, assigned in p4-work-split §D):** every route, service, refusal text and job of slice D; the `NextForumDateProvider`; the REQ-S16-019 entity-group API test; the screens (FE-D). No ARCH deliverable is left for a continuation task: deliverables 1–6 are complete.
- **Not verified here:** the API refusal codes and English texts of ADR-0032 §11 (no route exists yet), the generation/regeneration service, the two escalation jobs end to end.
- **Merge:** apply `0044`–`0046` with `mth-db migrate` after `0043` (contiguous; probe G00). Expect conflicts only in the shared files listed in p4-plan §5.3 if another ARCH task ran concurrently (none did: T-DG4-BE-B, KBE-B and KBE-D touch none of my files). `docs/delivery/requirements.csv`, `stages.json`, `findings.json`, reviews and gate records were not touched.
- **Evidence directory** `docs/delivery/handbacks/DG4/T-DG4-ARCH-05-evidence/`: `start-time.txt`, `end-time.txt`, `validate-historical-DG3.log`, `validate-dg3-historical-end.log`, `probe.ts`, `probe-output.txt` (final, 101/0), `probe-run1-output.txt` and `probe-run2-output.txt` (disclosed, §4), `migration-sha256.txt`, `gen-schema.py`, `gen-dictionary.ts`, `openapi-p4-arch05.py`, `openapi-lint.log`, `openapi-diff-check.txt`, `typecheck.log`, `build.log`, `lint.log`, `format.log`, `unit-locale-unset-run1.log`, `unit-c-utf8-run1.log` (disclosed), `unit-locale-unset.log`, `unit-c-utf8.log`, `integration-run1.log` (disclosed), `integration.log`.
