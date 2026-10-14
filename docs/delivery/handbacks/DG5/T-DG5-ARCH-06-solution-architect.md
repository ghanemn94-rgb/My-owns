# Handback T-DG5-ARCH-06 (solution-architect): P5 architecture, slices I + J

- **Invocation:** `{"kind":"claude-code-cli-session","run_id":"DG5-T-DG5-ARCH-06-solution-architect-20261014T133159Z-30f3107f","session_id":"30f3107f-b99f-4a84-9ee2-48b625a4250a"}`.
- **Assignment:** `docs/delivery/assignments/DG5/T-DG5-ARCH-06.md` (sha256 `132f70ff…775568`, verified at the start).
- **Base:** `81be9e6c969b338016695e383cef33960e87f1e9` on `claude/mobily-transformation-platform-regate` (stage DG5 BUILDING; DG4 APPROVED). Working tree clean at the start, apart from untracked sandbox dotfiles at the top level and this run's own `docs/delivery/runs/DG5/…` folder, which I did not touch.
- **`date -u` at the start:** `Wed Oct 14 13:32:14 UTC 2026`. **At the end:** `Wed Oct 14 15:27:31 UTC 2026` (§3.9; about 115 minutes).
- **Evidence folder:** `docs/delivery/handbacks/DG5/T-DG5-ARCH-06-evidence/`.
- **Two gate systems.** Nothing in this task reads or writes DG0–DG7. No approval of any kind was granted. Every demo approval the design seeds is synthetic and approves nothing real.

## 1. Changed files

| File | Purpose |
|---|---|
| `docs/architecture/adr/ADR-0049-p5-playbook-reader-provenance-navigation-branding.md` | New. Slice I design: verbatim blocks, search (en/ar), links, provenance, profiles and question tags, the Studio reader namespaces, the two text rules, branding, navigation, authorization, refusal codes. |
| `docs/architecture/adr/ADR-0050-p5-demo-environment-roaming-dataset-reset-walkthrough.md` | New. Slice J design: isolation, synthetic flag and labels, production refusal, dataset, determinism, counts and checksum, coverage check, reset by re-creating the database, walkthrough, codes. |
| `packages/db/migrations/0089_p5_reader_provenance_branding.sql` | New. The text-rule functions; `guiding_question`, `playbook_block`, `playbook_block_link`, `source_foundation`, `methodology_element_profile` (with seeds); the reader trigger on `methodology_element`; `branding_version`, `branding_setting`. |
| `packages/db/migrations/0090_p5_demo_environment_walkthrough.sql` | New. `deployment_environment`, `demo_seed_record`, `demo_dataset_run`, `walkthrough_step` (12 seeded steps). |
| `packages/db/migrations/0091_p5_reader_branding_demo_permissions.sql` | New. `branding.configure`, `demo.reset` (configure, ADM_TECH). |
| `packages/db/src/schema.ts` | Kysely interfaces and `SCHEMA_COLUMNS` for the 11 new tables. |
| `packages/db/src/seed.test.ts` | The 0091 block (seed equals `P5_READER_DEMO_*`; no approval code; ADM_TECH only). |
| `packages/db/test/integration/catalogue.test.ts` | Trigger, version-column and grant pins for the new tables; `methodology_element_reader_guard` added to the slice A trigger list. |
| `packages/shared/src/permissions.ts` | `P5_READER_DEMO_PERMISSIONS`, `P5_READER_DEMO_ROLE_PERMISSIONS`; merged into `PERMISSIONS` and the ADM_TECH role. |
| `apps/api/src/modules/platform/advisory-locks.ts` (+ `.test.ts`) | `brandingPublish` 730270, `demoReset` 730271 (730272 reserved); distinct-classes and migration-constant pins. |
| `docs/architecture/adr/ADR-0016-p2-data-model-registers-guards.md` | Registry rows 730270–730272 and the allocation sentence. |
| `docs/api/openapi.yaml` | +19 operations, 4 tags, 10 parameters, schemas; `PermissionCode` gains the two codes. Purely additive (`diff` shows 0 removed lines). |
| `apps/api/test/support/p5-pending-arch-06.ts`, `p5-pending-be-{q,q2,r,r2,s,t2}.ts`; `p5-pending.ts` (one import line, frozen after this task per p5-plan §5.3); `p5-operations.ts` (the slice I/J block) | Contract-test seams. |
| `apps/api/test/integration/contract/contract.test.ts` | Operation-count pin 827 → 846 and its comment line. The media-type triple is unchanged (it counts routed operations only). |
| `docs/architecture/erd.md` | §1q (slice I/J diagrams and entity register). |
| `docs/architecture/data-dictionary.md` | "P5 tables, slices I and J", generated from the catalogue, plus the hand-written changes, seeds, functions and validation summary. |
| `docs/analysis/permissions-matrix.md` | §23. |
| `docs/architecture/p5-work-split.md` | §I and §J. |
| `docs/delivery/handbacks/DG5/T-DG5-ARCH-06-evidence/*` | Probe, generators, logs. |

## 2. Behaviour delivered, per requirement (architecture level; the implementers route the operations)

| Requirement | Delivered here | Left to (p5-work-split) |
|---|---|---|
| REQ-PB-001 | `source_foundation` (B0156 verbatim); the claim rule in SQL with CHECKs on branding and the reader namespaces; provenance operation in the contract; ADR-0049 §5, §7 | BE-Q2, BE-R2 (scan), BE-N/BE-R (report footer), FE-G |
| REQ-PB-002 | 56 profiles (50 custom extensions per B0158–B0162 by CHECKed kind → source mapping, 6 foundation-inspired); override namespace guarded | BE-Q2, FE-G |
| REQ-PB-011 | `guiding_question` (B0016 verbatim); exactly one tag per template (CHECK) | BE-Q2, FE-G |
| REQ-PB-077 | B0124 as the `realizeNote`; passes the claim rule (probe PB05) | BE-Q2, FE-G |
| REQ-S01-002 | `branding_version.product_name_en/ar`; version 0 = "Mobily Transformation Hub" | BE-R, FE-G |
| REQ-S02-004 | `playbook_block_link` + Studio `block.<ref>` link edits; both directions in the contract | BE-Q (0092 seed), BE-Q2, FE-G |
| REQ-S03-007 | `GET /me/navigation` contract and the 14-area visibility table (ADR-0049 §9; WL holds none of the Administration codes, checked against `ROLES`) | BE-R2, FE-G |
| REQ-S03-010 | `playbook_block` with stored `english`/`arabic` tsvectors and GIN indexes; search contract | BE-Q, BE-Q2, FE-G |
| REQ-S15-004 | Immutable branding versions, head row, lock 730270, render-time read port design | BE-R, BE-N line, FE-G |
| REQ-S21-001 | The engineering-gate rule in SQL; the synthetic approval label (ADR-0050 §2) | BE-R2 (scan), BE-S, FE-G |
| REQ-PB-088 | Production path writes no demo row (probe G04, EN07); dataset design (North Star verbatim) | BE-S, BE-T |
| REQ-PB-089 | Environment flag + `demo_seed_record`; label rules for screens and exports | BE-S, FE-G |
| REQ-PB-090 | Chain design (B0147) | BE-T |
| REQ-S18-001 | Separate database, marker, determinism rule, counts and checksum rule, reset by re-create, lock 730271 | BE-S |
| REQ-S18-002 | `demo_dataset_run.coverage`; the condition list | BE-S, BE-T, KBE-H |
| REQ-S18-003 | Marker semantics, refusals (exit 3), the zero-demo query (probe EN07) | BE-S |
| REQ-S18-004 | `walkthrough_step` (M0349 verbatim) and the completion rules | BE-T2, FE-G, QA-E |

## 3. Checks actually run

All commands ran from `/home/user/My-owns` with Node 24.21.0 (`/opt/nvm/versions/node/v24.21.0/bin`), offline, in this run's sandbox. Ports used: 23700, 23701, 23710, 23720 (from 23700–23749). Load during the runs: about 11–14 (other W6 agents running).

### 3.1 `node tools/gates/validate.mjs --historical --stage DG4`

Exit **0** at the start (`PASS gate DG4 (historical)`), and at the end (§3.9).

### 3.2 Migration apply and guard probe

`QA_PG_PORT=23701 MTH_PORT_POOL=23702-23749 tests/qa/support/with-pg.sh node --conditions=@mth/source docs/delivery/handbacks/DG5/T-DG5-ARCH-06-evidence/probe.ts`, on PostgreSQL 16.13.

- **Fresh database:** `0001`→`0091` apply (G01).
- **P4-populated database:** `0001`–`0061` with a synthetic transformation instantiated by the DG3 function, then `0062`→`0091` on top (G02, G03). The upgrade writes no environment row, no demo record and no branding version, and the DG4 transformation stays at version 1 (G04).
- **Every new guard fires:**
  - missing audit fails at COMMIT (BR07 `branding_version_audit_required`, BR08 `branding_setting_audit_required`);
  - a non-stepping version fails (BR06 `branding_setting_version_step`; BR03/BR04 `branding_version_step`; DM08 `demo_dataset_run_step`);
  - UPDATE/DELETE/TRUNCATE on the histories and catalogues fails, as the owner too (BR10, BR11, PB06, PB08, PB09, PL04, MP05, EN03, DM06, DM11);
  - plus every invariant ADR-0049/0050 claims (probe list in the ADRs' Verification sections).

**Disclosure of a failing intermediate run:** the first run reported 93/95. Two probes were wrong, not the guards:
- BR06 changed the head to a non-latest number, so the earlier `branding_setting_current_latest` guard fired first;
- BR21 inserted a second head that could not pass the CHECKs before the unique key.

I corrected both probes. BR21 became "another organization numbers its own versions from 1", plus BR22, a catalogue check of the unique key and the composite FK. The run is kept as `probe-run1-2-fail-BR06-BR21-probe-errors.txt`. Later in the task I strengthened the Arabic claim rule in `0089` (unmerged, my own file): it adds `رسمي… من PMI` and lets an Arabic negation be followed by one word, so the shipped disclaimer "ليس معيارًا رسميًا من PMI" passes and the bare claim "هذا معيار رسمي من PMI" is caught. I then re-ran the probe. **Final run: 96/96 PASS, exit 0** (`probe-output.txt`; the migration hashes are in `migration-sha256.txt`). T01 has nine claims, and T02 includes the shipped `common.methodBody` texts in en and ar.

### 3.3 `pnpm -r typecheck` → exit 0 (`typecheck.log`)

### 3.4 `pnpm -r build` → exit 0 (`build.log`)

### 3.5 `pnpm lint` → exit 0 (`lint.log`)

### 3.6 `git ls-files -co --exclude-standard -z | xargs -0 npx prettier --check --ignore-unknown` → exit 0 (`format.log`)

### 3.7 `pnpm openapi:lint` → exit 0, "OpenAPI 3.1.1, 846 operations" (`openapi-lint.log`)

### 3.8 Tests

**Integration**, on a disposable PostgreSQL 16.13:

| Run | Command / scope | Result |
|---|---|---|
| Run 1 | `QA_PG_PORT=23710 MTH_PORT_POOL=23711-23749 tests/qa/support/with-pg.sh pnpm test:integration`, on the tree before the Arabic claim fix | exit 0, **219 files, 2148/2148** (`integration-run1-before-arabic-claim-fix.log`) |
| Run 2 (final) | `QA_PG_PORT=23730 MTH_PORT_POOL=23731-23749 …`, on the final migrations | exit 0, **219 files, 2148/2148** (`integration.log`) |

Pinned-count change: 2147 → 2148, the new catalogue test "0089-0090: the P5 slice I/J guards are attached".

**Unit (`pnpm test`):**

| Run | Command | Result |
|---|---|---|
| Locale unset, run 1 | `env -u LANG -u LC_ALL -u LC_CTYPE -u LANGUAGE pnpm test` | **exit 1**: unit-node 1832/1834, unit-web 1385/1385, third project 259 + 2 skipped by design (`unit-locale-unset-run1-2-fail-seed-pin-and-architecture-timeout.log`) |
| C.UTF-8 | `LANG=C.UTF-8 LC_ALL=C.UTF-8 pnpm test` | **exit 1**: unit-node 1834/1834 (it already loaded the seed fix), unit-web 1384/1385, third project 259 + 2 skipped (`unit-c-utf8.log`) |
| Targeted rerun | `npx vitest run --project unit-node packages/db/src/seed.test.ts apps/api/src/architecture.test.ts` | exit 0, 2 files, 191/191 (`unit-targeted-rerun.log`) |
| unit-node, locale unset, full | `env -u … npx vitest run --project unit-node` | exit 0, **100 files, 1834/1834** (`unit-locale-unset-unit-node-rerun.log`) |
| raid test, C.UTF-8 | `LANG=C.UTF-8 LC_ALL=C.UTF-8 npx vitest run src/pages/raid/raid.test.tsx` (in `apps/web`) | exit 0, 18/18 (`unit-c-utf8-raid-rerun.log`) |

Causes of the failures:
- **Locale unset, run 1:**
  - (a) `packages/db/src/seed.test.ts` › "0018 seed equals the P2 part … permission rows" failed. It spreads every permission group and compares the result with `PERMISSIONS`, and I had not added `P5_READER_DEMO_PERMISSIONS` there. This was my omission, and I fixed it (one line);
  - (b) `apps/api/src/architecture.test.ts` › "every import respects dependsOn …" timed out at 30 s under a load of about 18–22, with other W6 agents running. This is the F-DG4-148 class (D-146), and the test passes in the reruns.
- **C.UTF-8:** `apps/web/src/pages/raid/raid.test.tsx` › "action register …" failed to find a link under a load of about 20–24. This is the same F-DG4-148 class named in D-146; my task changed no web file, and the file passes 18/18 alone.

Per project, then, every project passes in both locales: unit-node in the full reruns, unit-web and the third project in the locale-unset run and in C.UTF-8 apart from the raid file, which passes alone. **A complete `pnpm test` exiting 0 in one invocation per locale was not obtained within the time bound.** I report that plainly rather than as passed; the orchestrator's merged-tree verification at low load is the place to confirm it.

**Contract counts:**
- operations 827 → **846**;
- media-type triple unchanged at `[343, 342, 1]`, because no new route is registered and the one new request body (`putBrandingSettings`, JSON) counts when BE-R routes it: +1 JSON;
- pending: +19 (`p5-pending-be-q` 4, `be-q2` 4, `be-r` 6, `be-r2` 1, `be-s` 3, `be-t2` 1).

**Lint after the last edits:** `npx eslint --max-warnings=0` on `packages/db/src/seed.test.ts` plus the two evidence scripts exits 1 only because of "File ignored because of a matching ignore pattern" warnings for the evidence scripts, which are outside the lint scope; `seed.test.ts` itself is clean (`lint-final-changed-files.log`). The full `pnpm lint` (§3.5) ran before that one-line edit. The final `pnpm -r typecheck` after it exits 0 (`typecheck-final.log`), and prettier on the edited file passes.

### 3.9 End

- `node tools/gates/validate.mjs --historical --stage DG4` → exit 0, `PASS gate DG4 (historical)` (`validate-dg4-historical-end.log`; the start log is `validate-dg4-historical-start.log`).
- `date -u` at the end: see the header.

## 4. Known gaps / not done

- No operation is routed (by design: the routes are the implementers'). The 19 operations are pending in `p5-pending-be-{q,q2,r,r2,s,t2}.ts`.
- `0092` (the 165 verbatim blocks with provisional Arabic, and the links) and `0093` (the roaming source element → `working`) are left to BE-Q and BE-T, as p5-plan §4 provides. The search acceptance ("value pools" → Diagnose blocks) is therefore shown on probe fixtures (PB03/PB04), not on the seeded text.
- The compose `demo` profile (a demo database service, `MTH_ENV=demo`, `MTH_DEMO_ADMIN_DATABASE_URL` with CREATEDB, the demo IdP issuer) is a devops change to request through the orchestrator (D-142 Q7).
- All Arabic texts seeded here (4 questions, 3 foundations, 3 profile labels, 12 walkthrough steps) are provisional translations needing review by a Mobily Arabic editor.

## 5. DG1–DG4 artifacts changed, and why (D-142)

- `apps/api/src/modules/platform/advisory-locks.ts` and its test (the registry, DG1+): two new classes and the reserved number. Additive, as every P5 ARCH task did (p5-plan §4 lock blocks).
- `docs/architecture/adr/ADR-0016-…md` registry table: three rows and the allocation sentence. Additive.
- `apps/api/test/integration/contract/contract.test.ts`: the operation-count pin 827 → 846 (the p*-pending pattern; D-142 / p5-plan §5.3).
- `packages/shared/src/permissions.ts` (`PERMISSIONS` and the ADM_TECH role gain two configure codes), `packages/db/src/schema.ts`, `packages/db/src/seed.test.ts`, `packages/db/test/integration/catalogue.test.ts`: appended blocks (p5-plan §5.3). The catalogue test's slice A trigger list gains `methodology_element_reader_guard` (DG5 code, not yet approved; the 0068/0086 precedent).
- `docs/api/openapi.yaml`: P1–P4 paths byte-stable; the only change to an existing component is the additive `PermissionCode` enum extension, the precedent of every P5 ARCH task. `getBrandingTokens` (DG1) is unchanged in the contract. Its data source changes when BE-R implements ADR-0049 §8, and its shape stays (p5-plan §3 row 17).
- No DG1–DG4 migration, table, constraint, function, route or user-facing text was changed.

## 6. What the orchestrator should decide or know

1. **Task splits** (the BE-B/BE-H precedent): BE-Q → BE-Q (0092 + blocks + links) and BE-Q2 (search, provenance, profiles, Studio attributes); BE-R → BE-R (branding) and BE-R2 (navigation + scans); a new BE-T2 (walkthrough, after BE-T). Please place them in the waves. BE-Q must follow BE-C (`methodology/routes.ts`); BE-R and BE-R2 follow BE-N.
2. **Reset by re-creating the demo database** (ADR-0050 §6). This avoids disabling the append-only audit protections. It needs a CREATEDB role for the demo deployment only (`MTH_DEMO_ADMIN_DATABASE_URL`) and session lock 730271 on the maintenance database. The in-app reset acknowledges its job before the drop.
3. **`MTH_ENV`** becomes a configuration key (D-142 Q7 named it). Its default is `production` when `NODE_ENV=production`, so a demo deployment must set `MTH_ENV=demo` explicitly.
4. **Administration visibility** (ADR-0049 §9): TO (Studio review) and AUD (read-only, through the DG1 `ADMIN_PERMISSIONS` rule) see it; WL does not, as REQ-S03-007 requires.
5. **The text scans** may flag existing DG1–DG4 strings when BE-R2 runs them. My pre-scan of `apps/web/src/i18n/**` found none: the only PMI mention is the disclaimer `common.methodBody`, which passes in en and ar (probe T02), and the only "DG" hits are code comments in `i18n/index.ts`, outside the scan's scope. Any hit BE-R2 finds needs an orchestrator decision on the text.

## 7. What the implementers of slices I and J must know

See p5-work-split §I.7 and §J.8. In short:
- the verbatim text is generated from the source file, never retyped;
- versions add guidance, links and overrides only through Studio;
- the two text rules are one rule in SQL and TypeScript, and they scan problem texts too;
- branding is read at render time, and "approved colours" is a recorded reference, never an approval by the platform;
- navigation is omitted server-side;
- demo data lives only in its own database, is deterministic (fixed ids, synthetic clock) and is reset by re-creating the database;
- every demo screen, record, export and approval carries the synthetic label in en and ar;
- no demo credential is in the repository.

## 8. Merge instructions

- Apply after W6's other tasks in any order: no file here is owned by BE-C, KBE-A or BE-F.
- The migrations `0089`–`0091` are new. `0092`/`0093` stay free for BE-Q/BE-T.
- Expected conflicts:
  - in `contract.test.ts`, only if another task changes the operation count (none is expected);
  - in `packages/db/src/schema.ts`, `seed.test.ts`, `catalogue.test.ts` and `permissions.ts`, only if KBE-A or BE-F append blocks there too. Resolve by keeping both sides.
