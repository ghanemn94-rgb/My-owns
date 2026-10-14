# Handback T-DG5-ARCH-02 (solution-architect): P5 architecture, slices B (forms) and C (procedures)

- **Invocation:** `{"kind":"claude-code-cli-session","run_id":"DG5-T-DG5-ARCH-02-solution-architect-20261014T001028Z-4dd2d5e4","session_id":"4dd2d5e4-1a00-4ef1-b35a-a99566ddfa5d"}`.
- **Assignment:** `docs/delivery/assignments/DG5/T-DG5-ARCH-02.md` (sha256 `b7d5de8c28e0689dd15c99f5b00d1a4bd5664a994ef06a71b653135a93aaefa6`, verified).
- **Base:** branch `claude/mobily-transformation-platform-regate`, `HEAD` `7344b25a2b994d32ec105f4068defca2f1422427`. Nothing committed by this task (the orchestrator integrates).
- **Start:** `Wed Oct 14 00:10:39 UTC 2026` (`date -u`; `T-DG5-ARCH-02-evidence/start-time.txt`). **End:** see §8.
- **Two gate systems.** Nothing here reads or writes DG0–DG7. The seeds approve nothing; procedure approval steps are decided only by the human business approver through the canonical approval. No agent grants a business, Finance or IT approval.

## 1. Preceding gate

`node tools/gates/validate.mjs --historical --stage DG4` → `PASS gate DG4 (historical)`, **exit 0** at the start (`T-DG5-ARCH-02-evidence/validate-historical-DG4.log`) and at the end (§8).

## 2. Deliverables

| # | Deliverable | Files | Status |
|---|---|---|---|
| 1 | ADRs | `docs/architecture/adr/ADR-0041-p5-form-schemas-field-types-custom-fields-form-framework.md` (slice B), `docs/architecture/adr/ADR-0042-p5-procedure-definitions-instances-seeded-procedures-coverage.md` (slice C) | Done. Each names entities and fields, state machines, exact refusal codes with English texts (ADR-0041 §10: 33 codes; ADR-0042 §10: 26 codes), authorization (permission, role defaults, AUD read-only, SoD), decimal and Unknown semantics; quotes M0078, M0127–M0155, M0315, M0321 and cites the template blocks B0030…B0129. |
| 2 | Migrations, schema types, permissions, locks | `packages/db/migrations/0068_p5_form_schemas_framework.sql`, `0069_p5_procedures.sql`, `0070_p5_forms_procedures_permissions_coverage.sql`; `packages/db/src/schema.ts` (12 tables); `packages/db/test/integration/catalogue.test.ts`; `packages/db/src/seed.test.ts`; `packages/shared/src/permissions.ts` (`P5_FORMS_PROCEDURES_PERMISSIONS`, 5 codes, role defaults); `apps/api/src/modules/platform/advisory-locks.ts` (730254) and ADR-0016 §6 | Done. `0071`–`0073` left free (§6). |
| 3 | Probe | `T-DG5-ARCH-02-evidence/probe.ts`, `probe-output.txt` | **116/116 PASS, exit 0** (§3). |
| 4 | ERD and data dictionary | `docs/architecture/erd.md` §1m (+ the §2.5 entity table), `docs/architecture/data-dictionary.md` "P5 tables, slices B and C" | Done; the dictionary is generated from the catalogue of a migrated database (`gen-dictionary.ts`). |
| 5 | Contract | `docs/api/openapi.yaml` (34 operations: 18 tag `forms`, 16 tag `procedures`; `info.version` stays `1.4.0-p5`); `apps/api/test/support/p5-pending-arch-02.ts` + `p5-pending-be-d/e/e2/f/f2/g.ts`; `p5-pending.ts` (one import line); `p5-operations.ts` (one block); `contract.test.ts` count 690 → 724 | `pnpm openapi:lint` PASS, 724 operations. |
| 6 | Permissions matrix, work split | `docs/analysis/permissions-matrix.md` §19; `docs/architecture/p5-work-split.md` §B and §C | Done. |

### Design in one paragraph

**Forms (ADR-0041):** form schemas are the Studio kind `form_schema`, key `forms` (v1 seeded, no element rows = the DG4 forms). Two element types: `form` (a registered record type; never added or removed) and `form_field` (`<recordType>.<fieldKey>`: `source` = a protected source column of the new `form_source_field` registry — never removed, type fixed; `admin` = an extension field of one of the eleven types). `form_record_type` registers the 33 native forms (15 templates, 3 source deliverables, the 12 M0149 extension types with the badge, 3 product records) with their typed table and write permission. Extension values live in the side table `form_custom_value`, validated against the transformation's pinned version (API first, database as the last line: keys, JSON shapes, decimal strings, fractions for percentages, currency amount + code, calculated never stored). The common framework (drafts, history from the audit trail, comments, attachments, export, bulk edit, recoverable conflict) is one set of operations under `/transformations/{id}/form-records/{recordType}/…`; DG2–DG4 register routes are unchanged. **Procedures (ADR-0042):** kind `procedure`, key `procedures`; typed version-scoped `procedure_definition` (every M0152 part) and `procedure_step_definition` (ordered by ordinal, parallel by shared ordinal + group, conditional on an input, task or approval); instances pin the exact definition row, steps are copied at launch, the database enforces ordering, required inputs, evidence, approved canonical approval for approval steps, completion with linked outputs, and exactly-once automation launches; outputs are real records produced by adapters through the owning modules' services and linked append-only. Ten M0153 procedures seeded (names from M0153, everything else marked product defaults). The coverage view maps all 80 source elements to forms/procedures (114 links).

## 3. Migration apply and guard probe (real output)

Command (disposable cluster, my port range):

```text
QA_PG_PORT=23704 MTH_PORT_POOL=23705-23709 tests/qa/support/with-pg.sh \
  node --conditions=@mth/source docs/delivery/handbacks/DG5/T-DG5-ARCH-02-evidence/probe.ts
```

Result: **exit 0**, `ALL PROBES PASS`, 116 `PASS` lines, 0 `FAIL` (PostgreSQL 16.13, UTF8, C). Excerpt (full output in `probe-output.txt`):

```text
PASS  G01 fresh database: 0001..last apply  -- applied 67: 0064…, 0068…, 0069…, 0070…
PASS  G03 P5 over the P4 database: 0062..last apply  -- applied 6: 0062…, 0063…, 0064…, 0068…, 0069…, 0070…
PASS  G04 the existing pin is byte-identical after 0062..last (no form_schema/procedure pin is back-filled)
PASS  G05 slice B/C seeds present over the P4 database (33 record types, 111 source columns, 10 procedures, 114 coverage links)
PASS  FE04 deleting the T03 source column 'gap' is refused (REQ-S05-002)  -- 23514 methodology_element_source_field_protected …
PASS  FE14 an element write without its audit event fails at COMMIT
PASS  CV03 decimal number '12.5', percentage stored as the fraction '0.12' (entered as 12%) and currency {amount '1500000.10', SAR} commit
PASS  CV05 a JSON float for a number field is refused (decimal strings only)
PASS  CV13 an update without its audit event fails at COMMIT
PASS  CV14 an update whose version does not step by 1 is refused
PASS  FC04 UPDATE of a comment is refused by the append-only trigger, even for the owner (mth_app has no UPDATE grant)
PASS  PD03 a definition without a trigger is refused (REQ-S06-001)
PASS  PI07 activating step 2 while step 1 is open is refused (ordered steps)
PASS  PI21 an approval step cannot be completed without an approved canonical approval
PASS  PI26 a replay with the same launch key is refused (exactly once)
PASS  CO01 every one of the 80 source elements has at least one linked form or procedure
PASS  PM01 five slice B/C codes, none a business approval; AUD and the technical admins hold procedure.read only
```

Probe groups: G00–G05 (apply fresh and over `0001`–`0061` populated by a DG3-instantiated transformation), FS01–FS05 (registries; 71 `column` storage references checked against `information_schema`), FE01–FE16 (form element guards), CV00–CV15 (custom values: pinned version, keys, shapes, record reference, P2 guards), FD01–FD07 (drafts), FC01–FC07 (comments), FA01–FA06 (attachments), PS01–PS03, PD01–PD15 (definitions), PI01–PI28 (instances, steps, links), CO01–CO03 (coverage), PM01 (permissions). Every new mutable table is probed for the missing-audit COMMIT failure and the non-stepping version (form_custom_value CV13/CV14, form_draft FD07, methodology_element FE14, procedure_definition PD13/PD14, procedure_instance PI19/PI27, procedure_step_instance PI18; form_record_attachment and procedure_step_definition share the same `p2_attach_guards` call, and the catalogue test pins every `_audit_required` trigger); both append-only tables are probed for UPDATE and DELETE (FC04/FC05, PI16/PI17). Migration hashes: `migration-sha256.txt`.

Intermediate probe runs during development (not evidence, disclosed): run 1 exit 2 (a probe fixture error, then four guard-ordering findings: G04 compared whole pin rows, FE09/FE10 a NULL-valued CASE let a missing setting pass — **fixed in `0068` with `coalesce(…, false)`**, the fixtures ran outside a transaction); run 2 exit 1 (FC04/PI16 were refused by privileges before the trigger; the probes now prove the trigger as the owner). The final run above is on the final migrations.

## 4. Checks actually run

| Check | Command | Environment | Result |
|---|---|---|---|
| Historical gate | `node tools/gates/validate.mjs --historical --stage DG4` | Node 22.22.2 | exit 0 (start); end: §8 |
| Typecheck | `pnpm -r typecheck` | as above | exit 0 (`typecheck.log`); re-run after the CM fix: §8 |
| Build | `pnpm -r build` | as above | exit 0 (`build.log`); re-run after the CM fix: §8 |
| Lint | `pnpm lint` | as above | exit 0 (`lint.log`); re-run: §8 |
| Format | `git ls-files -co --exclude-standard -z \| xargs -0 npx prettier --check --ignore-unknown` | as above | exit 0 (`format.log`); re-run: §8 |
| OpenAPI | `pnpm openapi:lint` | as above | exit 0, `PASS … OpenAPI 3.1.1, 724 operations` (`openapi-lint.log`) |
| Contract diff | `diff` of `openapi.yaml` before/after the generator | — | 1 line removed (the slice A `ConfigElementType` enum line, widened with `form, form_field`), 1551 added; every P1–P4 path byte-stable (`openapi-diff-check.txt`) |
| Unit, locale unset | `env -u LANG -u LC_ALL -u LC_CTYPE pnpm test` | — | run 1 **exit 1** (`unit-locale-unset-run1-before-cm-fix.log`): 1 failed / 1594 passed in node (+1358 web, 259 + 2 skipped other) — the failure is the new `0070` seed test, which caught a real defect of mine (below); final run: §8 |
| Unit, C.UTF-8 | `LANG=C.UTF-8 LC_ALL=C.UTF-8 pnpm test` | — | run 1 **exit 1**, same single failure (`unit-c-utf8-run1-before-cm-fix.log`); final run: §8 |
| Integration | `QA_PG_PORT=23710 MTH_PORT_POOL=23711-23749 tests/qa/support/with-pg.sh pnpm test:integration` | PostgreSQL 16.13 | §8 |

**The defect the seed test caught (disclosed):** when adding the `P5_FORMS_PROCEDURES_ROLE_PERMISSIONS` spreads to `ROLES`, CM's spread landed in SEC's block (CM's permission array was a one-liner). The TypeScript role model then gave SEC `form_record.comment`/`procedure.act` and CM nothing new, unlike the `0070` seed. Fixed in `packages/shared/src/permissions.ts`; a both-directions check now reports 0 missing and 0 extra. The integration run (§8) started after the fix.

**Process note (disclosed):** while restarting the suites I ran `pkill -f vitest; pkill -f "pnpm test"` in my own shell; it ended that shell command (exit 143). Each shell command runs in its own PID namespace here (`ps aux` shows only the command's own processes), so it could not reach other agents' processes, and the background chain I had started continued unaffected.

## 5. DG1–DG4 (and slice A) artifacts changed, and why (D-142)

| File | Change | Reason |
|---|---|---|
| `apps/api/src/modules/platform/advisory-locks.ts`, `advisory-locks.test.ts`, ADR-0016 §6 | + `procedureInstanceStep` 730254; 730255–730257 reserved; test 27 → 28 classes | p5-plan §4 lock block of this task |
| `apps/api/test/integration/contract/contract.test.ts` | operation count 690 → 724 (comment line added) | the `p*-pending-*` pattern; media-type triple and rate-limit floor unchanged by me (no route added) |
| `apps/api/test/integration/identity.test.ts` | TO's pinned effective permissions + `form_record.comment`, `procedure.act`, `procedure.launch`, `procedure.manage`, `procedure.read` | the `0070` seed grants them (the ARCH-01 precedent) |
| `apps/api/test/support/p5-pending.ts`, `p5-operations.ts` | one import line; one block of 34 ids | p5-plan §5.3 |
| `packages/db/test/integration/catalogue.test.ts` | + slice B/C guard test, + 7 mutable tables, + 12 privilege entries | pins for the new tables |
| `packages/db/src/seed.test.ts` | + `0070` block (3 tests), aggregate + `P5_FORMS_PROCEDURES_PERMISSIONS` | seed equals `permissions.ts` |
| `docs/api/openapi.yaml` | 34 operations, 2 tags, parameters and schemas; `PermissionCode` + 5 values; slice A `ConfigElementType` + `form`, `form_field` | additive; P1–P4 paths byte-stable (D-142) |
| `methodology_element` (slice A, DG5 not yet approved) via `0068` | element-type CHECK widened; 3 CHECKs added; `methodology_element_guard()` redefined with every slice A rule kept verbatim | ADR-0039 §2 left the `form_schema` kind's element types to this task |
| ADR-0014 §4 (wording) | amended by ADR-0041 §4: a side table `form_custom_value` instead of `custom_field_values` columns | additive; avoids reopening DG2–DG4 frozen-column/immutability triggers (documented reason) |

No DG2–DG4 table, route, request, response, trigger or text changes. No dependency added (D-142 Q8). The formula engine is untouched.

## 6. What the implementers of slices B and C must know

The full list is `docs/architecture/p5-work-split.md` §C.6; the essentials:

1. **Tasks and order:** KBE-B (validators) → BE-D (provider, schema reads, custom values, forms pin initializer) → BE-E (history, comments, attachments) → BE-E2 (export, bulk, drafts) → BE-F (definitions, procedures provider) → BE-F2 (instances, steps, my procedures) → BE-G (output adapters, coverage, entity-group and seeded-procedures tests); then FE-C and FE-D. BE-E/E2 and BE-F/F2 are splits of the plan's BE-E and BE-F (the p4 `-2` precedent).
2. **Migrations `0071`–`0073`:** taken only on a shown need, in this order: `0071` BE-F2 (expected: work-item kind `procedure_step`), `0072` BE-G, `0073` BE-E2.
3. **Needed from BE-A (slice A wiring, running concurrently):** module stubs `forms` and `procedures` with `forms/routes.ts`, `forms/index.ts`, `procedures/routes.ts`, `procedures/index.ts` and their `server.ts`/`modules.ts` registration and `SECTION16_MODULES` lines; the worker stub `apps/worker/src/handlers/procedures.ts` (+ queue registration); the stub files and barrel lines `packages/shared/src/schemas/{forms,forms-framework,procedures}.ts`; a `TransformationInitializer` port in the DG1 create transaction (BE-D registers the forms pin initializer); the `ConfigKindProvider` registry in `methodology/kinds.ts` (BE-D registers `form_schema`, BE-F `procedure`); `platform/db-errors.ts` mappings for the `0068`–`0070` constraint names (or BE-D/BE-F own those lines — orchestrator's choice); `contract.test.ts` imports of `p5-exercises-be-d/e/e2/f/f2/g.ts`.
4. **Exact codes** are ADR-0041 §10 and ADR-0042 §10; a needed code that is not there goes in the handback with its proposed text.
5. **Reopen guard:** bulk edits and output adapters call existing services; if one is not exported, request it — never re-implement or change a DG2–DG4 rule.

## 7. Known gaps / not done

- **Implementation is not part of this task.** All 34 operations are pending (`p5-pending-be-*.ts`); no route, UI or worker code is written.
- **Not probed at the database:** the T04/T16 `decision.kind` discriminator of `p5_form_record_ref_guard` (no decision fixture in the probe), and the `procedure_instance_completion` success path with linked outputs (the probe proves the refusal, PI13; the success path needs the adapters, BE-G). Both are listed for the implementers' tests.
- **Open points for the orchestrator:** (a) the forms pin for new transformations is set by an API initializer in the DG1 create transaction (ADR-0041 §4), additive but a new line in a DG1 code path; (b) `0068` redefines slice A's `methodology_element_guard()` (DG5, not yet approved) — the ARCH-01 integration tests must stay green, which §8's integration run checks.
- **Environment:** untracked files not created by me exist at the repository top level (`.bash_profile`, `.bashrc`, `.gitconfig`, `.gitmodules`, `.idea`, `.mcp.json`, `.profile`, `.ripgreprc`, `.vscode`, `.zprofile`, `.zshrc`, `CLAUDE.local.md`) and BE-A's run folder; I did not touch them. The prettier check includes them and passed.

## 8. Final checks and end time

All on the final tree (after the CM fix of §4 and the removal of the empty harness folders below). Logs in `T-DG5-ARCH-02-evidence/`.

| Check | Command | Result | Log |
|---|---|---|---|
| Unit, locale unset | `env -u LANG -u LC_ALL -u LC_CTYPE pnpm test` | **exit 0**: node 1595/1595, web 1358/1358, other 259 passed + 2 skipped (by design, as at ARCH-01) | `unit-locale-unset.log` |
| Unit, C.UTF-8 | `LANG=C.UTF-8 LC_ALL=C.UTF-8 pnpm test` | **exit 0**: 1595/1595, 1358/1358, 259 + 2 skipped | `unit-c-utf8.log` |
| Integration | `QA_PG_PORT=23712 MTH_PORT_POOL=23713-23749 tests/qa/support/with-pg.sh pnpm test:integration` | **exit 0**: 209/209 files, **1986/1986** tests (ARCH-01: 1985; +1 = the new catalogue guard test) | `integration.log` |
| Typecheck | `pnpm -r typecheck` | exit 0 | `typecheck-final.log` |
| Build | `pnpm -r build` | exit 0 | `build-final.log` |
| Lint | `pnpm lint` | exit 0 | `lint-final.log` |
| OpenAPI | `pnpm openapi:lint` | exit 0, 724 operations | `openapi-lint-final.log` |
| Format | `git ls-files -co --exclude-standard -z \| xargs -0 npx prettier --check --ignore-unknown` | exit 0 | `format-final.log` |
| Historical gate | `node tools/gates/validate.mjs --historical --stage DG4` | exit 0, `PASS gate DG4 (historical)` | `validate-historical-DG4-end.log` |

**Integration run 1 (disclosed, `integration-run1-stray-claude-dir.log`): exit 1**, 3 failed / 1983 passed, all three in `packages/db/test/integration/migrate.test.ts` with `Recursive option not enabled, cannot copy a directory: …/packages/db/migrations/.claude/`. Cause: an empty harness write-tracking folder (`.claude/.cc-writes`) that the agent harness created at 00:12 when my shell's working directory was `packages/db/migrations`; git does not track it, but the test copies that folder non-recursively. I removed that empty folder (and the equally empty ones in the ARCH-01 and ARCH-02 evidence folders that my working directory had caused); `migrate.test.ts` then passed 7/7 (`integration-migrate-rerun.log`, exit 0) and the full rerun above passed. The same kind of empty folder exists, pre-existing and untracked, under many `docs/delivery/**` folders; I left those alone. **Implementers: do not `cd` into `packages/db/migrations` in an agent shell.**

**Pinned-count changes:** `contract.test.ts` operations 690 → 724 (the media-type triple and the rate-limit floor are unchanged: no route was added); `advisory-locks.test.ts` 27 → 28 classes; `catalogue.test.ts` mutable tables + 7, privileges + 12 tables, guard tests + 1; `seed.test.ts` + 3 tests (0070 block); `identity.test.ts` TO effective permissions + 5.

**End:** see the last line of `T-DG5-ARCH-02-evidence/end-time.txt` (`date -u` at the end of the run).
