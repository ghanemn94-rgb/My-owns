# Handback: T-DG7-ARCH-05 (solution-architect): slices I and H; J tooling recorded

- **Stage:** P7 / DG7 (BUILDING). Branch `claude/mobily-transformation-platform-dg6-regate`, base `7f2d984a077886c703a6db31329b873dbcf8e06f`. The working tree was clean at the start, apart from this run's own `runs/` directory.
- **Invocation:** run `DG7-T-DG7-ARCH-05-solution-architect-20261112T194754Z-d00ce64b`, session `d00ce64b-d81f-4d56-8801-0ed9bca46f15`. The assignment's SHA-256 was verified: `219470d8…6f33faf`.
- **Time:** start `2026-11-12T19:48:04Z`, end of checks `20:14:14Z`, about 27 minutes of wall time.
- **Historical validator at start:** `node tools/gates/validate.mjs --historical --stage DG6` printed `PASS gate DG6 (historical)` and exited **0**. It was re-run at the end with the same result (`T-DG7-ARCH-05-evidence/validate-historical-DG6.log`).

## 1. Changed files

| File | Purpose |
| --- | --- |
| `docs/architecture/adr/ADR-0071-p7-traceability-register-snapshot-about-release-notes-release-blockers-protocol-audit.md` | **New.** Covers the build-time register snapshot (D-243 Q11), the three operations and the `release` guard table G1–G8 (D-251 item 3), About, the release notes (generator spec for DO-J), the release-blocker rule, the J protocol-audit checks recorded (D-249), the residuals, and the absence of any new dependency. |
| `docs/architecture/adr/ADR-0072-p7-handover-documentation-set-language-rule-deployment-guide-role-matrix-known-limitations.md` | **New.** Covers the `docs/handover/` tree, the language rule (D-243 Q7), the seven-topic deployment guide with its anchors, the generated role matrix, the generated known-limitations blocks (including the D-249 disclosure), the automation guide, and the checks T-H1–T-H9. D-247 O3 is covered by T-H1 and O5 by T-H8. |
| `docs/architecture/p7-work-split.md` | **Appended §I, §H and §J only**, with owners, files, seams, exact EN/AR texts, tests T-I1–T-I17, and the guard → test → owner table. It also maps requirement → clause → test → owner, and gives the evidence of each of the 16 J rows. §1, §2 and §A–§G are untouched. |
| `docs/api/openapi.yaml` | Adds the tag `release`, the operations `listRequirements`, `getRequirement` and `getReleaseAbout`, and 10 schemas. The contract now has **965** operations. |
| `apps/api/test/support/p7-pending-arch-05.ts`, `p7-pending-be-h.ts` | **New.** The pending lists: all three operations go to BE-H. |
| `apps/api/test/support/p7-pending.ts` | The aggregate import line for ARCH-05. |
| `apps/api/test/support/p7-operations.ts` | The T-DG7-ARCH-05 block (three ids). |
| `apps/api/test/integration/contract/contract.test.ts` | The count pin goes from 962 to **965**, with its comment line. |
| `apps/api/src/modules/platform/advisory-locks.ts` | Comment only: 730418–730419 are reserved and not allocated. |
| `docs/architecture/adr/ADR-0016-p2-data-model-registers-guards.md` | Adds the §6 row for 730418–730419 and the history sentence. |
| `docs/architecture/erd.md` | Adds §1af (no new entity). |
| `docs/architecture/data-dictionary.md` | Adds the "P7 slices I and H" note, with an h1 heading so the coverage rule's `## <table>` headings are not touched. |
| `docs/analysis/permissions-matrix.md` | Adds §33. |
| `docs/delivery/handbacks/DG7/T-DG7-ARCH-05-evidence/*` | Logs of every check below, plus `permission-code-analysis.txt`. |

**Not changed:**
- No migration: `0153`–`0155` stay free.
- `P7_PERMISSIONS` is unchanged, and so are `schema.ts`, `seed.test.ts` and `catalogue.test.ts`.
- No route or runtime code.

## 2. Behaviour delivered, per requirement

This task delivers design and contract only. Every runtime behaviour below is **planned for the named implementers and not delivered**.

- **REQ-S02-003:** The contract has `listRequirements` (filters for class, status, area and final gate, cursor pagination, a snapshot identity in every page) and `getRequirement`. The snapshot design guarantees the same row count and ids as the release's `requirements.csv`. Tests T-I1, T-I4 and T-I10 are assigned. `.dockerignore` excludes `docs/delivery`, so the design adds one exception line (ADR-0071 §2.5, BE-H).
- **REQ-S02-005:** The contract has `getReleaseAbout`: open items with their notes, later clauses through the `completes-after-gate:` marker, and `null` as Unknown. The release-notes generator spec is in ADR-0071 §5 (DO-J). The validator's l.217/l.222 rules have no validator test today, so T-I12 is assigned to QA-D.
- **REQ-S21-003:** The release-blocker rule is that the unfinished section equals the rows not IMPLEMENTED, with one source and no second list. The handover secret scan already covers `docs/handover/**` (payload scope), and T-I14/T-H9 are assigned.
- **REQ-S19-011:** The seven-topic anchors and content are specified (ADR-0072 §3, T-H2 for DOC-B). The "no undocumented step" half stays DO-D's `config-trace`.
- **REQ-S19-015:** All seven items are mapped to files or archive paths (ADR-0072 §1), with the language rule and the generated parts. T-H1–T-H9 are assigned.
- **J (16 rows):** p7-work-split §J.1 maps each row to its evidence: a protocol-audit check (C1–C9), the validator, the gate record or a K drill. It also gives each row's D-249 disclosure (H1–H11). No new tool is specified.

## 3. Checks actually run

**Environment:**
- Node 24.21.0 and pnpm, offline.
- A disposable PostgreSQL **16.15** through `tests/qa/support/with-pg.sh` (`QA_PG_PORT=24961`).
- `LC_ALL= LANG=` for the vitest runs.

| Command | Exit | Result (tail) | Log |
| --- | --- | --- | --- |
| `node tools/gates/validate.mjs --historical --stage DG6` (start and end) | 0 | `PASS gate DG6 (historical)` | `validate-historical-DG6.log` |
| `pnpm openapi:lint` | 0 | `PASS docs/api/openapi.yaml: OpenAPI 3.1.1, 965 operations` | `openapi-lint.log` |
| `pnpm -r typecheck` | 0 | every package `Done` | `typecheck.log` |
| `pnpm lint` | 0 | `eslint . --max-warnings=0`, no output | `lint.log` |
| `with-pg.sh npx vitest run --project integration packages/db/test/integration apps/api/test/integration/contract` and the AUD, sensitive-reference, seeded-texts, identity, route-inventory and integrity sweeps (the ARCH-03 acceptance set) | 0 | `Test Files 28 passed (28)`, `Tests 705 passed (705)`; "applied 129 migrations to a fresh database"; response validation "932 of 932 live operations (33 pending excluded)", so 932 + 33 = 965 and the pin holds | `integration-targeted.log` |
| `npx vitest run` over `p7-wiring.test.ts`, the `release` and `platform` modules, `architecture.test.ts`, `seed.test.ts`, `apps/web/src/i18n`, `a20-p6-i18n-catalogue.test.ts` | 0 | `Test Files 35 passed (35)`, `Tests 550 passed (550)` | `unit-targeted.log` |
| `git ls-files -co --exclude-standard -z \| xargs -0 npx prettier --check --ignore-unknown` | 0 | "All matched files use Prettier code style!" for every batch | `prettier-all.log` |
| `npx prettier --check docs/architecture/p7-work-split.md`, after the last edit | 0 | clean | (console) |
| `node tools/release/claims-scan.mjs` | 0 | `claims-scan: PASS (828 files; D 112, U 716; negated 27; allowed 19)` | `claims-scan.log` |
| `node tools/release/secret-scan.mjs --scope payload` | 0 | `secret-scan: PASS (payload; 2938 files; allowed 33; canary (documented) 22)` | `secret-scan-payload.log` |
| `node <scratch>/roles2.mts`, which imports `packages/shared/src/permissions.ts` by Node 24 type stripping | 0 | the role sets behind matrix §33. It is also the measurement that ADR-0072 §4 cites. | `permission-code-analysis.txt` |

**Guard probe:** none ran, because there is no migration and so nothing to probe. The migrations suite and `catalogue.test.ts` ran inside the integration set above.

## 4. Open questions (for the orchestrator)

- **O1: the role set of the register and About.**
  - What the sources say: REQ-S02-003 says "view:ADM,AUD,TO". The assignment says to prefer existing codes, as ARCH-04 did with D-250 O1.
  - What I chose: `operations.read`, held by ADM_TECH, TO, KDS, TD and AUD.
  - Side effects: KDS and TD can also read; ADM_ACCESS and ADM_METHOD cannot. No existing code matches the set exactly (`permission-code-analysis.txt`). The nearest, `automation.read` (TO, AUD, ADM_TECH, ADM_METHOD), means something unrelated.
  - Alternative: a dedicated `requirement_register.read` needs a seed migration. Shipping `0153` now would push every implementer migration merged after it (BE-G from `0147`, BE-C/BE-F) above `0153`, per D-245 O9 and D-248 O8.
  - **Decision needed:** accept the reading (ADM = ADM_TECH, the §26 REQ-S17-002/003 precedent), or schedule the code in a repair-range migration.
- **O2: a test for the validator's register rules.** `rules.mjs` l.217 ("BLOCKED without the missing dependency in notes") and l.222 ("IMPLEMENTED … without evidence") have no test that names them. I assigned T-I12 to QA-D under `tests/qa/integration/`, importing `checkRegister` read-only. The orchestrator may prefer to add it to `tools/gates/tests/` itself.
- **O3: the `.dockerignore` exception** (`!docs/delivery/requirements.csv`) is an additive change to a DG1-approved packaging file. The image half can only be proven on the orchestrator's host build (D-243 Q1); otherwise it stays a disclosed BLOCKED item (ADR-0071 Residual 2). Please confirm, or name a different owner than BE-H.
- **O4: the `completes-after-gate:` marker.** AN-P7 must write it into the six D-243 Q19 rows (REQ-DLV-021, DLV-010, S20-023, DLV-039, DLV-041, S20-028), because About and the release notes depend on it (ADR-0071 §5.3). Please add it to the AN-P7 assignment.
- **O5: two additions to DOC-B's file set.** It now also owns `tools/release/known-limitations.mjs`, `check-handover.mjs`, `external-dependencies.json` and `arabic-review.json`, and DOC-C owns `tools/release/role-matrix.mjs`. The plan's §5.1 rows did not name these tools. Please confirm.
- **O6: problem key and nav entries.** FE-A must add the `problems.json` key `release.register_snapshot_unavailable` and the two nav entries (§I.1 "Requests to FE-A").

## 5. Known gaps and what was not done

- **Runtime work not done (by design):** no route, generator, screen, guide or tool was implemented. They belong to BE-H, FE-C, DO-J, DOC-A/B/C and QA-D.
- **Guard probe:** no migration-guard probe ran, because there is no migration.
- **Arabic texts:** all Arabic texts in §I.3 and §H.3 are provisional. No qualified Arabic reviewer has checked them.
- **`.dockerignore` negation:** the negation semantics are taken from Docker's documented behaviour. No image build ran here, because there is no Docker daemon in the sandbox.

## 6. Merge instructions

- No migrations. `0153`–`0155` stay free for later slice I/H needs, which take the next free id above the highest shipped one.
- The shared contract files changed in this wave only by this run: `openapi.yaml`, the `p7-operations.ts` block, the aggregate `p7-pending.ts` and the `contract.test.ts` pin (965). If another wave's merge also moves the pin, add the counts.
- BE-H starts after this merge (W7). FE-A's keys (O6) should land before FE-C.
