# Handback T-DG4-ARCH-06 — P4 architecture, slices F + G (adoption; sustainment, BAU handover, status model, closure)

- **Role:** solution-architect. **Invocation reference:** `{"kind":"claude-code-cli-session","run_id":"DG4-T-DG4-ARCH-06-solution-architect-20261009T070201Z-5d815b39","session_id":"5d815b39-9676-454e-8d87-2c7c1193a37b"}`.
- **Assignment:** `docs/delivery/assignments/DG4/T-DG4-ARCH-06.md` (sha256 `64392ba187a5cbb1fecfe2d7cb0b1c50e8b5cb486801b1671d2ca09768a1e05c`, verified with `sha256sum` before starting).
- **Base:** branch `claude/mobily-transformation-platform-regate`, `HEAD` = `588fe12875ce9d88c819034ec277aa5c3ab9dae9`. Untracked environment files (`.bashrc`, `.idea`, …) and other runs' `docs/delivery/runs/**` were not touched. `CLAUDE.local.md` (empty, read-only, created 07:35 during this run) was not created by me: I never wrote that path; it appears to be a sandbox placeholder and I left it alone.
- **Time:** start `Fri Oct  9 07:03:14 UTC 2026` (`start-time.txt`; first `date -u` 07:02:16); end `Fri Oct  9 08:03:18 UTC 2026` (`end-time.txt`).
- **Two gate systems.** Nothing here reads or writes DG0–DG7. Accepting a BAU handover is the receiving owner's business decision in the product (category `business_approval`); a transition decision is decided through the canonical P4 approval; closing a transformation needs the product's G6 approval, which never implies DG7. No agent, seed, job or trigger accepts, approves or closes anything. All probe data is synthetic (the probe's approved G6 instance is a synthetic fixture inserted with replication triggers off, probe ST10).

## 1. `validate --historical --stage DG3`

`node tools/gates/validate.mjs --historical --stage DG3` (Node 24.21.0), run first: **`PASS gate DG3 (historical)`, exit 0** (`T-DG4-ARCH-06-evidence/validate-historical-DG3.log`). Re-run at the end: `PASS gate DG3 (historical)`, exit 0 (`validate-dg3-historical-end.log`).

## 2. Changed files

| File | Purpose |
|---|---|
| `docs/architecture/adr/ADR-0033-p4-adoption-stakeholders-interventions-assessments.md` (new) | Slice F design: indicators as KPI templates, T13, champions, interventions and the below-trajectory rule, validated versioned forms, training vs proficiency, involvement and champion constraints; authorization, refusal codes and English texts, Unknown semantics, probes per claim |
| `docs/architecture/adr/ADR-0034-p4-sustainment-bau-handover-closure.md` (new) | Slice G design: four separate statuses and the status-model read, transition decisions, performance areas beyond closure and reopening, BAU handover content and receiving-owner acceptance, controls/checks/reviews and the two scans, CI backlog, lessons and cross-transformation search, the governed closure (incl. the seam-15 text), authorization, refusal codes |
| `packages/db/migrations/0047_p4_adoption.sql` (new) | 12 slice F tables (template seed, groups, champions, metric links, interventions, forms, versions, invitations, training records, assessment records, involvement, champion constraints), 2 helper functions, guards; `record_code_counter` prefixes `SG`, `AI` |
| `packages/db/migrations/0048_p4_sustainment.sql` (new) | 12 slice G tables (areas, cycles, links, controls, checks, handovers, handover evidence, transition decisions, reviews, lessons, CI items, closure records), 3 helper functions, guards; 6 `initiative` columns + trigger; `transformation_closure_guard`; prefixes `PA`, `HO`, `CTL`, `CI`, `LL`, `TD` |
| `packages/db/migrations/0049_p4_adoption_sustainment_permissions.sql` (new) | 21 permission codes, 56 role grants, 7 work-item kinds, approval type `benefit_transition_decision` |
| `packages/db/migrations/0050_p4_sustainment_schedules.sql` (new) | The two job schedules (`sustainment.review_scan`, `sustainment.control_check_scan`), audited `system` |
| `packages/db/src/schema.ts` | Kysely interfaces, `Database` lines, row types and `SCHEMA_COLUMNS` for the 24 tables (generated from the DDL by `gen-schema.py`); the 6 `initiative` columns |
| `packages/db/src/seed.test.ts` | `0049` = `P4_ADOPTION_SUSTAINMENT_*` pins (3 new tests); the union of all blocks includes the new block |
| `packages/db/test/integration/catalogue.test.ts` | Slices F/G trigger pin (new test), versioned-table list, `mth_app` grants (generated from a migrated DB by `gen-catalogue.ts`) |
| `packages/shared/src/permissions.ts` | `P4_ADOPTION_SUSTAINMENT_PERMISSIONS`, `P4_ADOPTION_SUSTAINMENT_ROLE_PERMISSIONS`, role spreads (SP, TL, BO, WL, FIN, TO, KDS, TD, CM, SEC, AUD); header lists `0049` |
| `apps/api/src/modules/platform/advisory-locks.ts`, `advisory-locks.test.ts` | Classes 730242–730244 (730245 reserved); the test pins 21 classes |
| `docs/architecture/adr/ADR-0016-p2-data-model-registers-guards.md` | §6 registry rows 730242–730245 (the ARCH-01…05 precedent) |
| `docs/api/openapi.yaml` | 85 operations, 14 tags, 44 parameters, the slice F/G schemas, 21 `PermissionCode` values, info note; `info.version` stays `1.3.0-p4` |
| `apps/api/test/support/p4-pending-arch-06.ts` (new, frozen aggregate), `p4-pending-be-h.ts` (19), `p4-pending-be-h2.ts` (17), `p4-pending-kbe-f.ts` (5), `p4-pending-be-i.ts` (17), `p4-pending-be-i2.ts` (15), `p4-pending-be-j.ts` (12) (new); `p4-pending.ts` (one import); `p4-operations.ts` (the 85 ids) | Contract seams (S-10) |
| `apps/api/test/integration/contract/contract.test.ts` | Operation-count pin 485 → 570 and its comment (the only pin the pending pattern requires) |
| `apps/api/test/integration/identity.test.ts` | TO's effective-permission pin gains the 7 slice F/G codes TO holds (the ARCH-01/02/04/05 precedent) |
| `apps/worker/test/integration/schedules.test.ts` | The two `0050` rows are reported `unhandled` (no handler yet): pin `[PERIODS]` → `[PERIODS, ...SUSTAINMENT_SCANS]` |
| `docs/architecture/erd.md` | §1i (physical model, slices F and G; entity register); §2.10 table name corrected to the built names |
| `docs/architecture/data-dictionary.md` | "P4 tables, slices F and G" (generated from the migrated catalogue by `gen-dictionary.ts`), the `record_code_counter`/`initiative`/`transformation` changes, seeds, functions, validation summary |
| `docs/analysis/permissions-matrix.md` | §15 catalogue and per-entity rights (AUD read-only everywhere; `lesson.search` is its one read code) |
| `docs/architecture/p4-work-split.md` | §F+G (BE-H, BE-H2, KBE-F, BE-I, BE-I2, BE-J: ownership, contracts, proofs, integration order, requirement → owner, implementer rules); header line names §F+G |
| `docs/delivery/handbacks/DG4/T-DG4-ARCH-06-evidence/*` | Probe, generators, logs (§7) |

## 3. Behaviour delivered per requirement (architecture layer; the API halves are the implementers', p4-work-split §F+G.10)

| Requirement | Delivered here | Remaining (owner) |
|---|---|---|
| REQ-PB-069 | Intervention table with the exactly-once trigger key and the evaluation-match guard (probes AI03–AI05, AI07); the below-trajectory rule, owner, due date and `adoption.check_failed` payload specified (ADR-0033 §4); lock 730242; initiative adoption status column (ST02, ST03) | consumer (KBE-F), service (BE-H), at-risk read (BE-J) |
| REQ-PB-070 | T13 table with closed value lists: 'hostile' refused, four intervention values (SG01, SG03–SG06) | routes (BE-H) |
| REQ-PB-071 | Seven indicators seeded verbatim, two measures for indicator 4, Arabic provisional (S01, S05) | templates route, links, instantiation (KBE-F) |
| REQ-PB-072 | Training and assessment records separate; observation result shape (TR01, TR02, AR01, AR02); Unknown rule specified (ADR-0033 §6) | measures (KBE-F), records routes (BE-H2) |
| REQ-PB-073 | Champions, involvement (append-only), constraints raised only by the champion on a T04 design decision (CC01–CC05, IV01, IV02) | routes (BE-H) |
| REQ-S11-001 | Influence and impact separate (SG07); interventions with owner and due date; work-item kind | routes, My Work item (BE-H) |
| REQ-S11-002 | Versioned forms with validated JSON (FM01–FM06), invitations, responses to the published version only (AR03–AR05) | routes (BE-H2), counting (KBE-F) |
| REQ-S16-020 | All four entities with PK, owner and status (`0047`, ERD §1i.3, ADR-0033 §11) | entity-group API test (BE-H2, with KBE-F) |
| REQ-PB-009 | Delivery stamps on `completed` (ST01); closure record only for a delivery-complete initiative (ST04–ST07); the checks and the label specified (ADR-0034 §2, §7) | services (BE-J) |
| REQ-PB-083 | Handover content, controls and evidence required at submit (HO01–HO03); acceptance only by the receiving owner (HO04, HO05); first review exactly once (RV01, RV02); lock 730243 | routes and acceptance transaction (BE-I) |
| REQ-PB-084 | CI backlog with sources; editable after closure (CI01–CI03, ST11) | routes (BE-I2) |
| REQ-S03-002 | Areas outlive the transformation; reviews, checks and KPI actuals after closure (ST11, ST12); the R2 check (ADR-0034 Context 3) | routes, scans (BE-I, BE-I2) |
| REQ-S03-003 | Four separate statuses (ST02, ST03); `closed` only with a closure record (ST09); G6 required (ST08, ST10) | status model, closure (BE-J) |
| REQ-S11-004 | Reviews unique per subject and due date, only for areas in BAU (RV01–RV04); the scan rule specified and its schedule seeded (`0050`) | scan handler (BE-I2) |
| REQ-S11-005 | Content complete before submit (HO01); receiving owner only (HO04); accepted final (HO06) | routes (BE-I) |
| REQ-S11-006 | The transformation status model and its labels specified (ADR-0034 §2) | read (BE-J) |
| REQ-S11-007 | Transition decisions through the canonical approval; forecast untouched (TD01–TD06); monitoring only for the residual owner (TD04, TD05) | services, monitoring scan (BE-J) |
| REQ-S11-008 | Checks unique per due date, failed needs a note, final (CK01–CK06); lesson full-text search (LL01, LL02); the `control_check.failed` payload | routes, scan, search (BE-I2) |
| REQ-S11-009 | Cycle history append-only; reopening steps the cycle and keeps the prior accepted handover unchanged (RO01–RO07) | reopen route (BE-I) |

None of the 19 rows is complete at this task's end: each needs its implementer half (as for every ARCH task).

## 4. Checks actually run

| Check | Command / environment | Result |
|---|---|---|
| Historical validator (start) | `node tools/gates/validate.mjs --historical --stage DG3` | exit 0, `PASS gate DG3 (historical)` |
| Migration apply + guard probe (final) | `QA_PG_PORT=23746 MTH_PORT_POOL=23747-23749 tests/qa/support/with-pg.sh node --conditions=@mth/source docs/delivery/handbacks/DG4/T-DG4-ARCH-06-evidence/probe.ts` (PostgreSQL 16.13, UTF8, C locale) | exit 0; **104 PASS, 0 FAIL** (`probe-output.txt`): `0001`→`0050`(+`0058`) on a fresh DB (G01) and `0028`→ over a DB populated by `0001`–`0027` with an initiative (G02–G05); missing audit fails at COMMIT (SG02, HO10; deferred cycle row PA01, RO01); a non-stepping version fails (SG08); UPDATE/DELETE on append-only tables fails (IV01, IV02, FM06, HO09, RO04, RO05, ST07); every ADR invariant probed (ADR-0033 and ADR-0034 Verification) |
| Earlier probe runs (disclosed) | same command, ports 23701, 23703, 23705, 23707, 23709 | **Run 1: exit 2** (`probe-run1-output.txt`): a **real migration defect** — `0048` failed with "generation expression is not immutable" (`array_to_string` in the lesson `tsvector` generated column is only STABLE); fixed with the IMMUTABLE helper `p4_lesson_document` (the file was not merged; not a forward-only violation). Before that run I also replaced two CHECKs that contained subqueries (not allowed in a CHECK) with the helpers `p4_text_array_distinct` and `p4_tags_valid`. **Run 2: exit 1, 95/10** (`probe-run2-output.txt`): probe-setup errors only (a KPI version activated without the ratio labels its CHECK requires; an approval without a due date or reason). **Runs 3 and 4: exit 1, 99/6**: probe setup (a ratio actual without numerator/denominator; then `deviation` and `value_status` values outside the `0035` closed sets). **Run 5: exit 0, 104/0**, before `0050` existed. The final run (above) includes `0050` and the final `0049` text |
| Kysely generation, catalogue pins, dictionary | `gen-schema.py`; `gen-catalogue.ts` and `gen-dictionary.ts` on disposable clusters (ports 23711, 23740) | exit 0 each |
| OpenAPI lint | `pnpm openapi:lint` | exit 0, `PASS docs/api/openapi.yaml: OpenAPI 3.1.1, 570 operations` (`openapi-lint.log`) |
| Contract stability | `diff` before/after (`openapi-diff-check.txt`) | 0 lines removed, 3707 added; `info.version` 1.3.0-p4 |
| Typecheck | `pnpm -r typecheck` | exit 0 (run twice: after the contract and pin edits, and after the last source edit, §7.1) |
| Build | `pnpm -r build` | exit 0 (`build.log`) |
| Lint | `pnpm lint` | exit 0 (`lint.log`) |
| Format | `git ls-files -co --exclude-standard -z \| xargs -0 npx prettier --check --ignore-unknown` | a first check on my changed files flagged 3 files (`schedules.test.ts`, `seed.test.ts`, `permissions.ts`; exit 1, not logged separately), fixed with `prettier --write`; final run exit 0 (§7.1) |
| Unit, locale unset | `env -u LANG -u LC_ALL -u LC_CTYPE -u LC_MESSAGES pnpm test` | **exit 0**: 106 files, **2083 passed**; worker 3 files, **259 passed, 2 skipped** (`unit-locale-unset.log`). Pinned-count change: 2080 → 2083 (the three new `0049` seed tests) |
| Unit, `C.UTF-8` | `LANG=C.UTF-8 LC_ALL=C.UTF-8 pnpm test` | **exit 0**: 2083 passed; worker 259 passed, 2 skipped (`unit-c-utf8.log`) |
| Integration, run 1 (disclosed) | `QA_PG_PORT=23715 MTH_PORT_POOL=23716-23749 tests/qa/support/with-pg.sh pnpm test:integration` | **exit 1: 1 failed / 1062 passed of 1063** (`integration-run1.log`): `platform.test.ts` "reports ready when … every shipped migration is applied" got `migrations: "pending"`. Cause: a race I created — the run migrated its database at 07:36 and I added `0050` to the tree at about 07:39, before that test ran; not a product defect. Count change 1062 → 1063 (the new slices F/G catalogue trigger test) |
| Integration, run 2 (disclosed) | `QA_PG_PORT=23720 MTH_PORT_POOL=23721-23739 …` | exit 0, 1063/1063 (`integration-run2.log`); started after `0050`, but I edited a comment in `0049` (the `0050` ownership sentence) while it ran, so I ran it again |
| Integration, final | `QA_PG_PORT=23725 MTH_PORT_POOL=23726-23739 tests/qa/support/with-pg.sh pnpm test:integration` | **exit 0: 89 files, 1063/1063** (`integration.log`) |

## 5. DG1–DG3 artifacts changed, and why (D-089)

1. **`initiative` (DG3 `0020`)**: 6 columns (NULL or default), 4 CHECKs and 1 trigger (`initiative_delivery_complete_guard`), all inert on existing rows (probe G04). Seam 14 "**Additive** (new columns and a closure action; the DG3 transition table is unchanged)": `initiative_status_step` is untouched; the DG3 `Initiative` schema and operations are byte-stable.
2. **`transformation` (DG1 `0002`)**: one BEFORE UPDATE OF status trigger refusing `closed` without a closure record. No API path sets `closed` today (the DG1 PATCH refuses it, `transformations.test.ts`), so no DG1 behaviour changes; probe G05 shows a DG1 status edit still works on an existing row.
3. **`record_code_counter` (DG2)**: the prefix CHECK dropped and re-added with 8 more prefixes (the `0020`/`0037`/`0041` precedent; every prefix stays).
4. **`docs/api/openapi.yaml`**: additive only (0 removed lines); the `PermissionCode` enum gains 21 values (the ARCH-01…05 precedent). Seam 20.
5. **ADR-0016 §6 (DG2)**: registry rows 730242–730245 (the assignment requires it).
6. **`docs/architecture/erd.md` §2.10 (P1 conceptual model)**: the table name `training_assessment_record` is corrected to the built `training_record` and `assessment_record`, labelled as such. Documentation only.
7. **Pins** (`seed.test.ts`, `catalogue.test.ts`, `contract.test.ts`, `advisory-locks.test.ts`, `identity.test.ts`, `apps/worker/test/integration/schedules.test.ts`): extended as the established pattern requires; no assertion weakened. The `schedules.test.ts` change is new for an ARCH task: the two `0050` schedule rows appear in the `unhandled` list it pins.
8. **Seam 15 (D-089, accepted DG1 text change)** is *specified* (ADR-0034 §7, exact new sentence) but **not made** here: `transformations/routes.ts` and the tests that pin the old detail are BE-J's (p4-work-split §FG.6).

No new reopen candidate is raised by slices F and G.

## 6. What the implementers of slices F and G must know (summary; binding text in p4-work-split §F+G.11 and the two ADRs)

1. **Split proposal for the orchestrator:** BE-H (19 operations) → BE-H2 (17; new task) → KBE-F (5 + the consumer); BE-I (17) → BE-I2 (15 + the two scans; new task) → BE-J (12). The BE-F2/BE-D2/KBE-D2 precedent. If BE-H2 or BE-I2 is not scheduled, BE-H or BE-I carries the list as a second half.
2. **No migration number is left** in `0047`–`0050`. `0050` (the schedules) was meant for an implementer, but leaving it free would block ARCH-07's `0051` under S-12 (the D-090 situation), so I wrote it. Implementer schema needs take a repair number (`0058`–`0069`).
3. **Interpretations for the orchestrator to confirm** (recorded in the ADRs):
   - (a) REQ-PB-069 "below trajectory" = an evaluation with `deviation = 'adverse'` and `calculated_rag` ∈ {amber, red}; Unknown/Stale/Not computable never create an intervention; the intervention also emits `adoption.check_failed`, so slice E opens one corrective case for it (REQ-S12-016).
   - (b) REQ-PB-072: indicator 4 is seeded as two measures; the two record-fed measures have values and Unknown but no trajectory/RAG in DG4 (ADR-0033 §13).
   - (c) REQ-PB-009/REQ-S03-003: "validated value" per benefit = at least one Finance-validated measurement; a benefit covered by an approved transition decision is not "pending"; a subject with no benefit cannot be closed (`no_benefit` is refused like `validation_pending`).
   - (d) REQ-S11-005: a delegate cannot accept a handover for the receiving owner in DG4.
   - (e) REQ-S11-004 "on time" = the review for a due date is created at the latest 7 days before it (daily scan), and on the first scan after an outage.
   - (f) REQ-S03-002's screen path `/api/v1/performance-areas` is served transformation-scoped (D-092 (7)); `searchLessons` is the one organization-level path.
4. **R2 (p4-plan §6) answered:** the DG1–DG3 write guards test `archived_at`, not `status = 'closed'`; closure never sets `archived_at` (ADR-0034 Context 3, §7; probes ST11, ST12).

## 7. Known gaps, continuation and merge instructions

- **Not done by this task (by design, assigned in p4-work-split §F+G):** every route, service, refusal text, consumer and scan of slices F and G; the seam-15 text change; the REQ-S16-020 entity-group API test; the screens (FE-E, FE-F). No ARCH deliverable is left for a continuation task: deliverables 1–6 are complete.
- **Not verified here:** the API refusal codes and English texts (no route exists yet), the below-trajectory consumer, the scans and the status-model reads end to end.
- **Merge:** apply `0047`–`0050` with `mth-db migrate` after `0046` (contiguous; probe G00). Expect conflicts only in the p4-plan §5.3 shared files if another ARCH task ran concurrently (none did: KBE-E, BE-D and FE-A touch none of my files). `requirements.csv`, `stages.json`, `findings.json`, reviews and gate records were not touched.

### 7.1 Final results (all on the final tree; logs in the evidence directory)

| Check | Result |
|---|---|
| `node tools/gates/validate.mjs --historical --stage DG3` (end) | exit 0, `PASS gate DG3 (historical)` (`validate-dg3-historical-end.log`) |
| Guard probe (final migrations, `0001`→`0050` + `0058`) | exit 0, **104 PASS, 0 FAIL** (`probe-output.txt`, ports 23746–23749, re-run on the stored `probe.ts` after prettier formatted the evidence scripts); checksums in `migration-sha256.txt` |
| `pnpm -r typecheck` | exit 0 (`typecheck.log`, run after the last source edit) |
| `pnpm -r build` | exit 0 (`build.log`; run before the last edits, which were a comment in `0049`, documents, the `schedules.test.ts` pin and prettier formatting; none is compiled by the build except `permissions.ts`, whose prettier-only change the final typecheck covers) |
| `pnpm lint` | exit 0 (`lint.log`) |
| prettier check over `git ls-files -co --exclude-standard` | exit 0, "All matched files use Prettier code style!" (`format.log`) |
| `pnpm openapi:lint` | exit 0, 570 operations (`openapi-lint.log`) |
| `pnpm test`, locale unset | exit 0: **2083 passed** (106 files); worker **259 passed, 2 skipped** (`unit-locale-unset.log`) |
| `pnpm test`, `LANG=C.UTF-8 LC_ALL=C.UTF-8` | exit 0: **2083 passed**; worker **259 passed, 2 skipped** (`unit-c-utf8.log`) |
| `QA_PG_PORT=23725 MTH_PORT_POOL=23726-23739 tests/qa/support/with-pg.sh pnpm test:integration` | exit 0: **89 files, 1063/1063 passed** (`integration.log`) |
| Integration run 2 (`integration-run2.log`, ports 23720–23739) | exit 0, 1063/1063; disclosed because my comment-only `0049` edit happened while it ran (its database was migrated before the edit) |

**Pinned-count changes:** unit 2080 → 2083 (three `0049` seed tests); integration 1062 → 1063 (the slices F/G catalogue trigger test); contract operations 485 → 570; advisory-lock classes 18 → 21; TO's effective permissions +7; the worker schedule test's `unhandled` list +2. The media-type triple pin of `contract.test.ts` (`[205, 204, 1]`, D-098) is unchanged: it counts routed operations, and none of the 85 is routed.

**End:** `Fri Oct  9 08:03:18 UTC 2026` (`end-time.txt`).

