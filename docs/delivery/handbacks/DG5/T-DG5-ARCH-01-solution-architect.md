# Handback: T-DG5-ARCH-01 (solution-architect) — P5 slice A architecture

- **Invocation:** `{"kind":"claude-code-cli-session","run_id":"DG5-T-DG5-ARCH-01-solution-architect-20261013T220341Z-be2b66ff","session_id":"be2b66ff-95c3-4d6f-b453-d3e80183d697"}`.
- **Assignment:** `docs/delivery/assignments/DG5/T-DG5-ARCH-01.md` (sha256 `42a4fbec68b5850af4322c0d235a5bd9c58fd9ed8ee8751b9640951c257492df`, verified at start).
- **Base:** branch `claude/mobily-transformation-platform-regate`, `HEAD` `b30fa5b923635226ffdf72f2f715d5105f3d0e68`. Nothing committed by this run (the sandbox makes `.git` read-only; the runner commits).
- **Time:** start `Tue Oct 13 22:03:51 UTC 2026`; end `Tue Oct 13 23:59:41 UTC 2026` (§8).
- **Two gate systems.** Nothing here reads or writes DG0–DG7; approving a methodology migration and re-approving a product gate are business approvals inside the product, made by people. No agent approval was granted; all probe data is synthetic and approves nothing.

## 1. Preceding gate

`node tools/gates/validate.mjs --historical --stage DG4` → **exit 0**, `PASS gate DG4 (historical)` (`T-DG5-ARCH-01-evidence/validate-historical-DG4.log`; re-run at the end, §8).

## 2. Deliverables

| # | Deliverable | Files | State |
|---|---|---|---|
| 1 | ADRs | `docs/architecture/adr/ADR-0039-p5-studio-configuration-model-publish-pipeline.md`, `ADR-0040-p5-methodology-migration-reapproval-scoring-defaults.md` | Done. Context / Decision / Alternatives / Consequences / Verification; per requirement: entities and fields, state machines, exact refusal codes and English texts (ADR-0039 §13, ADR-0040 §8), authorization with role defaults, AUD read-only and SoD, decimal and Unknown semantics; sources quoted with M/B anchors |
| 2 | Migrations and schema types | `packages/db/migrations/0062_p5_config_versions.sql`, `0063_p5_pins_methodology_migrations.sql`, `0064_p5_studio_permissions_source_inventory.sql`; `packages/db/src/schema.ts`; `packages/shared/src/permissions.ts` (`P5_STUDIO_PERMISSIONS`, `P5_STUDIO_ROLE_PERMISSIONS`); `packages/db/src/seed.test.ts`; `packages/db/test/integration/catalogue.test.ts`; `apps/api/src/modules/platform/advisory-locks.ts` (+ test); ADR-0016 §6 registry rows 730250–730253 | Done |
| 3 | Probe | `T-DG5-ARCH-01-evidence/probe.ts`, `probe-output.txt` | Done: **76/76 PASS** (§3) |
| 4 | ERD and data dictionary | `docs/architecture/erd.md` §1l (+ §2.2 rows), `docs/architecture/data-dictionary.md` "P5 tables, slice A" (generated from the catalogue by `gen-dictionary.ts`) | Done |
| 5 | Contract | `docs/api/openapi.yaml` (`info.version` `1.4.0-p5`; 38 operations; generator `openapi-p5-arch01.py`); `apps/api/test/support/p5-pending.ts`, `p5-pending-arch-01.ts`, `p5-pending-{be-a,be-b,be-b2,be-b3,be-c,kbe-a}.ts`, `p5-operations.ts`; `p2-pending.ts` (P5 joins the set); `contract.test.ts` (count 652 → 690) | Done; `pnpm openapi:lint` PASS, 690 operations; the only removed line in the diff is `info.version` (`openapi-diff-check.txt`) |
| 6 | Permissions matrix and work split | `docs/analysis/permissions-matrix.md` §18; `docs/architecture/p5-work-split.md` (new: §1, §2 shared rules 1–18, §A) | Done |

Nothing is left for a continuation task within this assignment's deliverables. §6 lists the decisions the orchestrator should confirm.

### 2.1 What the design is (short)

- **D-142 Q1:** the DG2 catalogue rows stay the stable-identity registry (no DG2 constraint changed). `methodology_version` becomes the header of six configuration kinds (`methodology`, `scoring_defaults`, and `form_schema`, `procedure`, `automation_rule_set`, `health_check_scheme` for ARCH-02…05) with a separate `draft_stage` (editing → preview → review → approved, or discarded), so the DG2 CHECK tying non-draft statuses to `published_at` and the DG2 immutability trigger are kept as they are. Version-scoped attributes are `methodology_element` rows; a `ConfigResolver` port resolves pinned version → element row → catalogue value, so v1-pinned readers are byte-identical by construction.
- **Publish pipeline in the database:** publish needs, for exactly the current content hash, a `pass` preview run, a `pass`/`warn` compatibility run, a `pass`/`warn` source-coverage run (methodology kind) and, when the kind's policy requires it (seeded: all kinds, reviewer TO), an approved review by someone other than the author/requester. Published versions are immutable. Rollback = a new draft (origin `rollback`, reason required) with the restored content, through the same pipeline.
- **Invariants (REQ-S06-006):** phases, gates and TOM dimensions can't be added or removed; stable keys never change; no technical-admin or AUD approver. Template (and other counted-element) removal is recordable in a draft and fails the source-coverage check, which blocks publish (REQ-S02-001's literal acceptance).
- **Source inventory (REQ-S02-001):** 80 seeded `source_element` rows (2/6/6/16/10/5/6/3/1/25), verbatim English labels, provisional Arabic.
- **S12-018:** `revision_proposal` (append-only, exactly once by `dedupe_key`) for Studio drafts submitted for review and for DG3 benefit-formula revisions (through the DG4 material-change port, wrapped at composition; no DG3/DG4 file edited).
- **REQ-S06-008:** `methodology_migration` (draft → submitted → approved → executed, …) with append-only plan items (mapping, new required field, invalidated calculation, re-approval, removed element, unchanged history), the canonical approval (`methodology_migration`, SoD requester excluded, routed to SP by default; only SP holds the business-approval code, see §6 item 2), a pin that moves only through its approved migration with mandatory history, and `gate_reapproval` markers (D-142 Q9).
- **REQ-PB-093:** `scoring-defaults` v1 seeded 25/25/20/15/15 (B0076) with `null` rubric descriptors (the source has none); the 100 % rule is enforced at publish in the API and the database; KBE-A's `0065` implements Q12.

## 3. Migration apply and guard probe (real output)

Command: `QA_PG_PORT=23701 MTH_PORT_POOL=23702-23749 tests/qa/support/with-pg.sh node --conditions=@mth/source docs/delivery/handbacks/DG5/T-DG5-ARCH-01-evidence/probe.ts` → **exit 0**, PostgreSQL 16.13, UTF8/C. Output: `probe-output.txt` (76 PASS lines, `ALL PASS`).

- **G01** fresh database: 0001 → 0064 apply (64 files). **G02/G03** a database migrated to 0061 and populated (a synthetic transformation instantiated by the DG3 function: methodology pin + source-default weight set), then 0062 → 0064 on top. **G04** the existing pin and weight set are byte-identical afterwards; **G05** methodology v1 reads `config_kind = methodology`, `origin = seed`.
- **Guards fire:** missing audit fails at COMMIT (MV02 `methodology_version_audit_required`, ME11, RP03, RV03); a non-stepping version fails (MV05 `methodology_version_version_step`); UPDATE/DELETE on history fails (MV23 check runs, MM05 plan items, MM13 pin history, RV04 proposals — owner-level triggers; the application role additionally has no UPDATE/DELETE, MV23a).
- **Every database invariant ADR-0039/0040 claims:** Studio lifecycle and publish prerequisites (MV01–MV22), element invariants (ME01–ME12), review SoD (RR01–RR03), review policy reviewers (RP01–RP02), exactly-once proposals (RV01–RV02), decimal weights and the 100 % rule (SD01–SD02), pins and migrations (PN01–PN03, MM01–MM14), re-approval markers (GR01), seeds (SE01–SE04).
- One probe expectation accepts either of two constraint names (MM08): the decision guard trigger fires before the CHECK `methodology_migration_decider_not_requester`, which stays as a backstop; this is disclosed in the probe text and in ADR-0040 §1.

## 4. Checks run (exact commands, results)

| Check | Command | Result | Log |
|---|---|---|---|
| Historical DG4 | `node tools/gates/validate.mjs --historical --stage DG4` | exit 0 (start) | `validate-historical-DG4.log` |
| Typecheck | `pnpm -r typecheck` | exit 0 | `typecheck.log` |
| Build | `pnpm -r build` | exit 0 | `build.log` |
| Lint | `pnpm lint` | exit 0 | `lint.log` |
| Format | `git ls-files -co --exclude-standard -z \| xargs -0 npx prettier --check --ignore-unknown` | exit 0 | `format.log` |
| OpenAPI | `pnpm openapi:lint` | exit 0, `PASS … OpenAPI 3.1.1, 690 operations` | `openapi-lint.log` |
| Unit, locale unset | `env -u LANG -u LC_ALL -u LC_CTYPE pnpm test` | see §4.1 | `unit-locale-unset.log` |
| Unit, `C.UTF-8` | `LANG=C.UTF-8 LC_ALL=C.UTF-8 pnpm test` | see §4.1 | `unit-c-utf8.log` |
| Integration | `QA_PG_PORT=23720 MTH_PORT_POOL=23721-23749 tests/qa/support/with-pg.sh pnpm test:integration` | see §4.1 | `integration.log` |

### 4.1 Test results and disclosed failures

All runs below are real; every non-zero exit is disclosed with its cause and its fix.

| Run | Command / scope | Result | Log |
|---|---|---|---|
| Unit, locale unset (before two fixes) | `pnpm test` | **exit 1**: 1 failed (`seed.test.ts` 0018 block lacked `P5_STUDIO_PERMISSIONS` in its full-catalogue comparison) and 2 failed (`my-work/message-keys.test.ts`: no kind labels for the new kinds) | `unit-locale-unset-run1-before-fix.log`, `unit-c-utf8-run1-before-fix.log` (the second was started before the fix and shows the same seed failure) |
| Unit, locale unset (final) | `env -u LANG -u LC_ALL -u LC_CTYPE pnpm test` | **exit 0**: unit-node 84 files / 1592 tests passed; unit-web 69 / 1358 passed; unit-formula-nocodegen 3 files / 259 passed, 2 skipped | `unit-locale-unset.log` |
| Unit, `C.UTF-8` (final) | `LANG=C.UTF-8 LC_ALL=C.UTF-8 pnpm test` | **exit 0**: the same counts | `unit-c-utf8.log` |
| Integration run 1 | `QA_PG_PORT=23720 MTH_PORT_POOL=23721-23749 tests/qa/support/with-pg.sh pnpm test:integration` | **exit 1**: 190 files / 389 tests failed — the contract's `PermissionCode` enum lacked the 8 new codes, so every `getMe`/`listRoles` failed contract validation (§6 item 8); fixed in the contract | `integration-run1-before-enum-fix.log` |
| Integration run 2 | same | **exit 1**: 75 files / 338 tests failed — TL held a business-approval code, which stops the DG1 creator-derived assignment (§6 item 2); fixed by making SP the only default approver; plus `identity.test.ts`'s pinned TO permission list, updated | `integration-run2-before-tl-fix.log` |
| Integration run 3 | same | **exit 1**: 1 test failed of 1985 (1984 passed; 208/209 files): `reporting/my-work.test.ts` completeness — the two new work-item kinds had no My Work section; fixed in `reporting/my-work.ts` and the test's pins | `integration-run3-before-mywork-fix.log` |
| Integration run 4 (final, after the My Work fix) | same | **exit 0**: 209/209 files, 1985/1985 tests passed (finished `Wed Oct 14 00:02:48 UTC 2026`) | `integration.log` |
| Typecheck in the final chain | `pnpm -r typecheck` | its log has no exit line (`typecheck-chain-incomplete.log`; cause not determined), so it is **not counted**; re-run separately: **exit 0** | `typecheck.log` |

Pinned-count changes: `contract.test.ts` operations 652 → 690 (media-type triple 323/322/1 and rate-limit floor 285 unchanged); `my-work.test.ts` work-item kinds 30 → 32, section sizes assigned 9 → 10, reviews 5 → 6; `catalogue.test.ts` mutable tables + 5, privileges + 10 tables and `methodology_version` SELECT → INSERT,SELECT,UPDATE, guards test + 1; `advisory-locks.test.ts` 24 → 27 classes; `seed.test.ts` + 3 tests (0064 block), migration ids from 0058 allowed up to 0099; `identity.test.ts` TO effective permissions + 3.

## 5. DG1–DG4 artifacts changed, and why (D-142)

| Artifact | Change | Reason |
|---|---|---|
| `methodology_version` (DG2 table; via `0062`) | additive columns, CHECKs, triggers, P2 guards; `mth_app` INSERT/UPDATE | D-142 Q1 and p5-plan §3 row 3 (additive; the DG2 trigger and CHECK unchanged) |
| `transformation_config_pin` (via `0063`) | kind CHECK widened; `last_migration_id`; guard and history triggers | p5-plan §3 row 2 (additive CHECK widening); REQ-S06-008 |
| `approval_type`, `work_item_kind` (via `0063`) | rows `methodology_migration`; `config_review`, `gate_reapproval` | ADR-0026 catalogues, additive rows |
| `packages/db/src/seed.test.ts` | P5 block; ids from 0058 may have gaps up to 0099 (was ≤ 0069) | the D-142-adopted plan numbering (P5 ranges 0062–0093, 0094–0099 orchestrator) |
| `packages/db/test/integration/catalogue.test.ts` | P5 mutable tables, privileges, guards | pins follow the migrations |
| `apps/api/src/modules/platform/advisory-locks.test.ts` | 3 classes; module-literal scan widened to 7302[2-9]x | registry rule (ADR-0016 §6) |
| `apps/api/test/integration/aud-write-deny.test.ts` | excludes `P5_OPERATION_IDS` | the P3/P4 precedent: the P2 sweep stays on P2 scope |
| `apps/api/test/integration/contract/contract.test.ts` | operation count 652 → 690 | the P3/P4 `p*-pending` pattern; the media-type triple (323, 322, 1) and rate-limit floor (285) are unchanged because all 38 are pending |
| `apps/api/test/support/p2-pending.ts` | P5 lists join the pending set | same |
| `apps/api/test/integration/identity.test.ts` | TO's pinned effective permissions + `config_review_policy.configure`, `methodology.read`, `methodology.review` | the seed adds them (0064) |
| `apps/api/src/modules/reporting/my-work.ts`, `apps/api/test/integration/reporting/my-work.test.ts` | `config_review` → Reviews, `gate_reapproval` → Assigned actions; the completeness pin 30 → 32 kinds and the section sizes (assigned 9 → 10, reviews 5 → 6) | the DG4 rule "every work-item kind maps to exactly one section" (ADR-0037 §7); found by integration run 3 (`integration-run3-before-mywork-fix.log`) |
| `apps/web/src/i18n/{en,ar}/myWork.json` | kind labels `config_review`, `gate_reapproval` | the DG4 test "every work_item_kind of the migrations has a kind label" |
| `docs/architecture/adr/ADR-0016-…md` | registry rows 730250–730253 | registry rule |
| `docs/api/openapi.yaml` | `info.version` 1.4.0-p5; 38 operations, their parameters and schemas, 3 tags; the `PermissionCode` enum gains 8 values | assignment; P1–P4 paths byte-stable (the only removed line is `info.version`) |
| `docs/architecture/erd.md`, `data-dictionary.md`, `docs/analysis/permissions-matrix.md` | additive sections; ERD §2.2 rows updated for Phase/GateDefinition/MethodologyVersion | S16-012 and the new tables |

## 6. For the orchestrator to confirm (decisions and flags)

1. **Q9 implementation (ADR-0040 §3).** A gate with a `required` re-approval can be resubmitted: the DG2 422 `gate.already_approved` does not apply to that gate, and the instance moves `approved → submitted` with `approved_at` cleared (the DG2 CHECK). History rows stay unchanged. This is how "a G2 submission task is created" can be completed; for every other approved gate the DG2 refusal is unchanged. Please confirm this reading of Q9 (it changes a DG2-approved refusal for that case only).
2. **Who approves a migration (ADR-0040 §4) — a deviation from the row's wording, please confirm.** REQ-S06-008 says "approve-migration: TL or configured business approver". My first design gave TL `methodology_migration.approve`; the first full integration run then failed massively because the DG1 creator-derived assignment (`0008`, ADR-0006: "never a role holding an approval permission") stopped deriving TL's transformation-scope assignment, so a TL granted at business-unit scope lost access to the transformations it created (404/403 across 75 files; logs `integration-run2-before-tl-fix.log`). TL therefore stays approval-free (as in every DG2–DG4 stage) and the default approver is the Sponsor (SP), the DG0 matrix's other "Ap" on that row. Making TL an approver would need a reopen of the DG1 derivation rule.
3. **Migration decision path (ADR-0040 §4).** `approval.decide` holders (SP, BO, FIN) are not the holders of `methodology_migration.approve`, so the migration is decided by `decideMethodologyMigration`; BE-C exports `decideApprovalInTx` and adds an optional `decideThroughSubject` provider flag in `workflows/approvals.ts` (additive; the generic route answers 422 `approval.decide_through_record` for that type only).
4. **BE-B split** into BE-B, BE-B2, BE-B3 (p5-work-split §A.0, §A.8): the waves need placing (each depends only on its predecessor; BE-C and KBE-A follow BE-B3).
5. **Review default.** `config_review_policy` is seeded `review_required = true` (reviewer TO) for every kind, and a missing row reads as required. "Review where configured" is satisfied by the configuration; a team that wants no review switches it off (TO only, so an admin can't remove the review of its own changes).
6. **ADM_METHOD and transformation scope.** ADM_METHOD has no `transformation.read`; pins and migrations are read with `methodology.read` so it can plan migrations.
7. **REQ-S06-004 and REQ-S06-007** complete with slice B (the T13 field, validation, the added field in the diff) and slice E (non-gate routing); stated in ADR-0039 §4 and the requirement → owner table.
8. **The contract's `PermissionCode` enum** gains the eight new codes (appended; no existing value changed), as every P2–P4 architecture task did; without it every `getMe`/`listRoles` response fails contract validation (first integration run, `integration-run1-before-enum-fix.log`).
9. **No dependency** is needed by this slice.

## 7. What the implementers of slice A must know

See `docs/architecture/p5-work-split.md` §A.10 (and §2 shared rules 1–18). In short: versions are global; API checks come first and return the exact ADR codes; recompute `content_sha256` on every content write; never rewrite a business record, submission, snapshot or decision; the formula engine and the seeded rows are untouched; D-142 Q1/Q4/Q9/Q12 are binding; `0065` is KBE-A's, `0066`–`0067` are free.

## 8. End

- `date -u` at the end: `Tue Oct 13 23:59:41 UTC 2026` (`end-time.txt`; start `start-time.txt`); the final integration run (run 4) finished at `Wed Oct 14 00:02:48 UTC 2026`, just past the ~2 h bound: **exit 0, 209/209 files, 1985/1985 tests**.
- `node tools/gates/validate.mjs --historical --stage DG4` at the end: **exit 0**, `PASS gate DG4 (historical)` (`validate-historical-DG4-end.log`).
- Final checks after the last code change: typecheck exit 0, build exit 0, lint exit 0, prettier check exit 0, unit (both locales) exit 0, integration exit 0 (1985 tests), `openapi:lint` exit 0 (690 operations), probe 76/76 PASS.
- **Continuation needed:** none. The orchestrator decisions to confirm are in §6.
