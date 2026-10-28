# Handback: T-DG6-ARCH-06 (slices I and K: UX, accessibility and bilingual hardening; the DG5 carry-forward)

- **Role:** solution-architect. **Stage:** DG6 (BUILDING), branch `claude/mobily-transformation-platform-dg5-regate2`.
- **Run:** `DG6-T-DG6-ARCH-06-solution-architect-20261028T181139Z-e9c6f48b`, session `e9c6f48b-c62b-4622-abc6-75f363a31134`. Base `HEAD` `f6c9aa8f27bddb38d1df2e49554a6ddb1257def8`. Assignment sha256 `32d054207bb220c6e9b00dbca135e80c2cb2f969fae3bbea09ae04e49d852f45` (verified with `sha256sum` before starting).
- **`date -u`:** start `Wed Oct 28 18:28:53 UTC 2026`; end: see §8.
- **Engineering only.** Nothing here grants, records or implies a G1–G6 business approval, a Finance validation or an IT approval. Branding is configuration, never an approval. Product gate G6 never implies DG7. #0078FF is a provisional brand token, not a verified Mobily colour.
- **Concurrent runs.** BE-H, BE-I and BE-J run in their own worktrees in this wave (their run folders are untracked in this checkout). I did not touch their files. The untracked top-level dotfiles (`.bashrc`, `.gitconfig`, `.mcp.json`, …) and `CLAUDE.local.md` are not mine and were left alone.

## 0. Preceding gate

`node tools/gates/validate.mjs --historical --stage DG5` → `PASS gate DG5 (historical)`, **exit 0** (`T-DG6-ARCH-06-evidence/validate-historical-DG5.log`, last line `EXIT=0`).

- A first run at 18:29 printed the same `PASS` line. It went through `| tail`, which masks the exit code, so I re-ran it with the exit code recorded before relying on it.
- Both runs happened before any write to the tree.

## 1. Deliverables

| # | Deliverable | Status |
| --- | --- | --- |
| 1 | **ADR-0061** `docs/architecture/adr/ADR-0061-p6-ux-hardening-contrast-greyscale-layout-keyboard-axe-localization-explanations.md` | Complete. ADR-0062 stays reserved. |
| 2 | Migration `0113_p6_branding_contrast_reports.sql`; `packages/db/src/schema.ts`; pins in `catalogue.test.ts` and `seed.test.ts`; lock classes 730326–730327 recorded as reserved (`advisory-locks.ts` comment, ADR-0016 §6 row) | Complete. No new permission code, so `permissions.ts` is unchanged (§2). |
| 3 | Probe on a disposable PostgreSQL | 42/42 PASS, exit 0 (§3) |
| 4 | ERD §1y and data dictionary "P6 tables, slice I" (generated from the catalogue) | Complete |
| 5 | Contract: 1 new operation, 1 summary extension, the pending lists, `contract.test.ts` pin 931 → 932; `openapi:lint` | Complete |
| 6 | Permissions matrix §29; `p6-work-split.md` §I/K (I/K.0–I/K.11) | Complete |
| 7 | This handback | Complete |

**Nothing is left for a continuation task.** The orchestrator questions are in §5.

## 2. Behaviour delivered per requirement (design and database; implementation by BE-W, KBE-B, FE-F, FE-F2, FE-G, QA-D)

### REQ-S15-003 (contrast)

- **The runtime rule (ADR-0061 §1).** A branding publish evaluates every **declared** pair of the token source with the version's two colours, re-deriving the derived shades. Any pair below its threshold is refused with 422 `branding.contrast_insufficient`, with one `errors` item per failing pair.
- **The stored report.** A published version records its report in the publish transaction, under the existing lock 730270.
- **The database rule.** A stored pair always passes: `CHECK (ratio >= threshold)` (probes CP01, CP02, CP10, RL06). A report has exactly `pair_count` pairs at COMMIT (CR02–CR06).
- **The rule on real token data (probe RL01–RL04):**
  - the seeds pass all 50 pairs;
  - #FFD700 as primary fails exactly 2 pairs (`brand.primary` as a ui accent and as large text), while every re-derived action, link, focus and navigation pair passes;
  - #6FA8DC as secondary fails the `brand.deep` text pairs.
- **Greyscale (§3).** "Distinguishable in greyscale" is proven by non-colour cues:
  - a component test that the five statuses have distinct icons and labels;
  - a DOM rule that every `status-chip` on the axe screens has an icon and text;
  - screenshots in greyscale as evidence.
- **A defect found during the inventory.** `Scorecard.tsx:230` renders a chip without an icon. FE-F fixes it.

### Other requirements

- **REQ-S15-001 (§4.1):** 1440 × 900. The home page is `/my-work` and the executive page `/executive-overview`. The test checks named regions (decisions, outcomes, next actions) with their top edge above 900 px at `scrollY = 0`, plus the `surface.page` and `nav.background` computed styles, in en and ar.
- **REQ-S15-009 (§4.2):** 360 × 800, in en and ar, on the real stack. The flows are a product-gate decision ("business approval", never DG0–DG7), a P4 approval request, a KPI actual submit and the review accept. Each step is checked for no page-level horizontal scroll and primary actions inside the viewport, and the result is read back through the API. The same flows run at 768 px.
- **REQ-S15-012 (§7.1, §7.2):**
  - the guided walkthrough is completed by keyboard only, with visible focus at each step;
  - axe (existing helper, 0 serious or critical) runs on every P6 route and on the 14 named key flows, in both languages, at 1366 and 390 px;
  - a scope test stops the axe list from drifting.
- **REQ-S15-007 (§6, §7.3):**
  - a catalogue test covers every problem code the API source and the P6 ADR tables can emit, in en and ar;
  - a real API validation error is rendered in each language;
  - Arabic XLSX and CSV exports keep `KPI-001` and `12.5%`.
  - **Finding: the API never reads `Accept-Language`** (Q1, §5).
- **REQ-S15-014 (§8):**
  - The inventory has six calculated values (E1–E6), each listing its formula in words, its inputs (operation → fields) and its period.
  - E1 (weighted score) and E2 (benefit realized value) are the acceptance's values. E4 (NPV/ROI/payback) and E5 (health check) have no words today. E3 (KPI) and E6 (dashboards) already explain themselves.
  - **No API gap was found**, so no `explanations/{kind}/{id}` operation was added.
  - The infrastructure-term scan runs on the rendered text of non-admin screens. The term list is enumerated in the ADR.
- **Slice K (§9):** an exact acceptance text for each of F-DG5-120, 121, 125, 150 and the 145/146/151 budget sweep, for FE-G.

None of the six requirements is complete. Each needs its implementer tasks and QA-D (work split §I/K.10).

## 3. Migration apply and guard probe

- **Command:** `QA_PG_PORT=23700 MTH_PORT_POOL=23701-23749 tests/qa/support/with-pg.sh node --conditions=@mth/source docs/delivery/handbacks/DG6/T-DG6-ARCH-06-evidence/probe.ts`
- **Environment:** PostgreSQL 16.13, UTF8, C locale.
- **Result:** **exit 0, 42/42 PASS** (`probe-output.txt`). Migration sha256 `d0fad871…7a9dc` (`migration-sha256.txt`).

```
migrations shipped: 105 (0001_identity_access.sql .. 0113_p6_branding_contrast_reports.sql)
PASS  G00 slice I migration 0113 present directly above 0112 (D-196); nothing above 0113
PASS  G01 fresh database: 0001..last apply  -- applied 105
PASS  G01b a fresh install has no contrast report, no pair and no branding version (0113 seeds nothing)
PASS  G02 P5 database populated (0001-0097; ... 12 initiatives; 3 users; 1 branding version and its head)
PASS  G03 P6 (0098..last, including slice I 0113) over the P5 database apply  -- applied 16
PASS  G04 the upgrade leaves existing rows as they were (... the branding version and head byte-identical, audit count unchanged); no report is backfilled
PASS  BV01 a new branding version without a contrast report still commits (... that rule ships with BE-W)
PASS  RL01 the provisional seeds (#0078FF, #003B73) pass every declared pair at runtime  -- 50 pairs, 0 failing
PASS  RL02 #FFD700 as primary fails named pairs  -- brand.primary on surface.card (ui) 1.4:1 < 3:1; brand.primary on surface.page (large-text) 1.31:1 < 3:1
PASS  CR01 missing audit fails at COMMIT (branding_contrast_report_audit_required)
PASS  CR02 a report without pairs fails at COMMIT (branding_contrast_report_pairs_complete)
PASS  CR06 a pair added later to a committed report fails at COMMIT
PASS  CP01 a failing pair cannot be stored (white small text on #0078FF, 4.09:1 < 4.5:1; branding_contrast_pair_passes)
PASS  RL05 the real runtime report of the provisional seeds (50 pairs ...) is stored  -- 50 pairs stored; lowest 3.23:1
PASS  AO03 even the owner cannot UPDATE a report (p2_append_only)
PASS  INV01 after every probe: 2 reports (CR05, RL05), their pairs, and no stored pair below its threshold
42/42 PASS
EXIT=0
```

**The assignment's guard classes:**

- **Missing audit fails at COMMIT:** CR01.
- **A non-stepping version fails:** not applicable. Neither new table has a `version` column, because both are append-only and immutable. The deferred count check (CR02–CR06) is their COMMIT-time invariant.
- **UPDATE/DELETE on history fails:** AO01–AO06.
- **Every invariant ADR-0061 §2 claims:** CR07–CR11, CP01–CP10, INV01–INV02.

**Earlier probe runs, kept as evidence:**

- `probe-output-run1-script-error.txt` (exit 1): a duplicated `let failures` declaration in the probe script, copied from the ARCH-05 harness. The script did not compile, so no probe ran.
- `probe-output-run2-trigger-defect.txt` (29/42, exit 1): **a real defect in my unmerged `0113`.** The shared trigger function read `NEW.report_id` inside a `CASE`, and PL/pgSQL raised `42703 record "new" has no field "report_id"` when the trigger fired on the report table. CR02–CR07, RL05 and the AO03–AO05/INV01 cascades failed. I fixed it before any merge (`to_jsonb(NEW)` field access), and adjusted the CP05 expectation (a use outside the set is refused first by `threshold_for_use`, which also excludes it). Run 3 is the committed result.

**Dictionary generator:** `gen-dictionary.ts` (the ARCH-05 generator with the slice I table list) → `dictionary-section.md`, `schema-types.ts.txt`, exit 0. The generated types are identical to the `schema.ts` block apart from two doc comments I added.

## 4. Checks run (Node 24.21.0)

| Command | Exit | Result | Log (`T-DG6-ARCH-06-evidence/`) |
| --- | --- | --- | --- |
| `node tools/gates/validate.mjs --historical --stage DG5` | 0 | PASS gate DG5 (historical) | `validate-historical-DG5.log` |
| `pnpm -r typecheck` | 0 | all packages | `check-typecheck.log` |
| `pnpm lint` | 0 | `eslint . --max-warnings=0` | `check-lint.log` |
| `pnpm -r build` | 0 | all packages (vite's existing >500 kB chunk warning) | `check-build.log` |
| `pnpm openapi:lint` | 0 | `PASS docs/api/openapi.yaml: OpenAPI 3.1.1, 932 operations` | (console) |
| prettier on changed and new files (`git ls-files -mo --exclude-standard` without dotfiles and run folders) | 0 | "All matched files use Prettier code style!" | (console) |
| `git ls-files -co --exclude-standard -z \| xargs -0 npx prettier --check --ignore-unknown` (the assignment's literal, repository-wide form) | 0 | every batch "All matched files use Prettier code style!" | `check-prettier-repo.log` |
| probe (§3) | 0 | 42/42 | `probe-output.txt` |
| unit tests, integration | see §8 | see §8 | `test-*.log` |

**Disclosure (ordering):** after the unit runs had started, I changed only description text in `docs/api/openapi.yaml` (the `BrandingContrastReport` description) and in ADR-0061 §5, then re-ran `pnpm openapi:lint` (exit 0, 932 operations). No schema shape, operation or path changed.

**Disclosure:** the background command that ran typecheck, lint and build exited 1. Its final `tail -2 a b c` was a usage error ("tail: option used in invalid context -- 2"). Each check had already written its own `EXIT=0` line, quoted above.

## 5. Questions for the orchestrator

1. **`Accept-Language` on API errors** (REQ-S15-007 `screen_api`).
   - The API never reads it (no file under `apps/api/src` names it), and every problem `detail` is English.
   - ADR-0061 §7.3 keeps translation in the web, from the stable `code`, which the acceptance text "a validation error returned by the API is shown in the selected language" needs.
   - If the register's `screen_api` must be read as "the API's `detail` is translated", that is a contract-wide behaviour change over every DG1–DG5 problem and needs its own task.
2. **Task changes against the p6-plan rows:**
   - **BE-W** (new, backend-workflow): the API refusal, the stored report and the route. The plan had FE-F "request the API refusal line through the handback", but a server-side refusal plus a stored report is a backend task.
   - **FE-F2** (new): the plan's FE-F row (layout, 360 px, keyboard, panels, contrast UI, catalogue test) is above 75 minutes, so it is split into FE-F and FE-F2.
   - **KBE-B redefined:** the inventory found no missing explanation input. KBE-B now builds the decimal view models the panels display.
   - Size impact: +2 runs.
3. **One operation beyond the plan's estimate.** The plan estimated `explanations/{kind}/{id}` at 0–2 operations, and that came to 0. I added `getBrandingVersionContrast` for §3 row 18 instead, so that a stored report can be read and a version published before P6 can be shown as failing. Net contract delta: +1 (931 → 932).
4. **Versions published before P6 that fail the rule** are only warned about on Branding Settings ("The current colours fail the contrast rules; publish corrected colours."). The tokens keep being served unchanged, so nothing approved at DG5 is withdrawn. If the orchestrator wants a failing current version to fall back to the seeds at read time, that is a further DG5 behaviour change.

## 6. DG1–DG5 artifacts changed, and why

Each change is additive except where marked.

- `docs/api/openapi.yaml`:
  - **`putBrandingSettings` summary** gains `.contrast_insufficient`, with one sentence on the `errors` items. This is the D-195 accepted reopen of p6-plan §3 row 18. Request and response shapes are unchanged.
  - **New** path `/api/v1/admin/branding/versions/{versionNo}/contrast` and schema `BrandingContrastReport`.
  - Every other P1–P5 path is byte-stable.
- `docs/architecture/adr/ADR-0016-p2-data-model-registers-guards.md` §6: one registry row "730326–730327 reserved for the T-DG6-ARCH-06 block".
- `apps/api/src/modules/platform/advisory-locks.ts`: a comment only (the reserved block). No class was added, so the distinct-classes test is unaffected.
- `apps/api/test/integration/contract/contract.test.ts`: the operation-count pin 931 → 932, with its comment line.
- `apps/api/test/support/p6-pending.ts`: the `P6_PENDING_ARCH_06` import. This aggregate is now frozen (p6-plan §5.3).
- `packages/db/src/schema.ts`: two interfaces, a `Database` block and their `SCHEMA_COLUMNS` entries.
- `packages/db/src/seed.test.ts`: the free-id example 0113 → 0114.
- `packages/db/test/integration/catalogue.test.ts`: a new "0113" trigger pin.
- `docs/architecture/erd.md` §1y, `data-dictionary.md` (slice I), `docs/analysis/permissions-matrix.md` §29, `docs/architecture/p6-work-split.md` §I/K: new sections only.

## 7. What the implementers of this slice must know

This repeats work split §I/K.11 in short:

1. Only declared pairs decide at runtime; prohibited pairs never refuse a publish.
2. The contrast check runs before the transaction, and the report is stored inside it under lock 730270.
3. Existing branding is never rewritten or backfilled.
4. Codes, English texts and the field-error message format are ADR-0061 §6 verbatim. The Arabic is provisional.
5. The web computes no business number. Panels show the server's decimals through KBE-B's view models, and Unknown, incomplete and n/a are never shown as 0 or green.
6. No infrastructure term appears on a non-admin screen.
7. Every new spec states a measured budget, and FE-G's sweep comes first.
8. Labels say "business approval", never DG0–DG7.
9. **BE-W's requirement migration** takes the next id above the highest shipped file at merge time (rule 18). `0114` is free at this `HEAD`, but BE-H, BE-I or BE-J may ship first.

## 8. Unit and integration tests, and the end of the run

The machine was shared with three concurrent implementer runs (BE-H, BE-I, BE-J). `uptime` showed a load average of 23.6 at 19:28 and 32.2 at 20:02.

| Command | Exit | Result | Log (`T-DG6-ARCH-06-evidence/`) |
| --- | --- | --- | --- |
| `env -u LANG -u LC_ALL -u LC_CTYPE -u LANGUAGE pnpm test` | **1** | unit-node: 158 files and 2467 tests **all passed**, plus **1 vitest harness error** `[vitest-worker]: Timeout calling "onTaskUpdate"` (an RPC timeout inside vitest, reported as an unhandled error, not a test failure); unit-web 96 files, 1768 passed; formula 259 passed, 2 skipped | `test-locale-unset.log` |
| `LANG=C.UTF-8 LC_ALL=C.UTF-8 pnpm test` | **0** | unit-node 158 files, 2467 passed, no error; unit-web 96 files, 1768 passed; formula 259 passed, 2 skipped | `test-c-utf8.log` |
| `QA_PG_PORT=23720 MTH_PORT_POOL=23721-23729 tests/qa/support/with-pg.sh pnpm exec vitest run --project integration packages/db/test/integration/catalogue.test.ts apps/api/test/integration/contract/`, run 1 | **1** | 245 passed, **1 failed:** `mth_app privileges are exactly the data dictionary's`. That is my missed pin (the two new tables, `INSERT,SELECT`). Fixed in `catalogue.test.ts`. | `test-integration-targeted-run1-privilege-pin.log` |
| the same command, run 2 (after the pin fix) | **1** | the catalogue file **passes**; 245 passed, **1 failed:** `contract.test.ts:1072` "every operation: an undeclared request media type …" **timed out at 30 000 ms** (30031 ms) | `test-integration-targeted.log` |
| `QA_PG_PORT=23740 … vitest run --project integration apps/api/test/integration/contract/response-validation.test.ts` | **1** | 108 passed; **1 failed:** the same test timed out (30028 ms) | `test-integration-response-validation-rerun.log` |
| `QA_PG_PORT=23730 MTH_PORT_POOL=23731-23749 tests/qa/support/with-pg.sh pnpm test:integration` (full) | **not finished** | Started 19:33. It was still running when I wrote this, with 385 passed and 0 failed lines logged by 20:08. It started **before** the privilege-pin fix, so its catalogue result cannot reflect the final tree. I could not stop it: no stop tool is available, and the sandbox hides the process. **The full integration result on the final tree is not provided by this task.** | `test-integration.log` (partial) |
| `pnpm --filter @mth/db typecheck` and `npx eslint --max-warnings=0 packages/db/test/integration/catalogue.test.ts`, after the pin fix | 0, 0 | — | `check-typecheck-db-after-pin.log`, `check-lint-catalogue-after-pin.log` |

**About the 30 s timeout.** The same test passed in my other runs in 21.3 s and 28.3 s (targeted run 1) and in 19.7 s and 25.8 s (the partial full run). It times out only above about 30 s under the heavier load. It iterates every operation, and my change adds one pending operation, which the test sends a single request to. This is the F-DG5-145/146 class: a test on the default 30 s budget whose loaded worst case is near the limit. `contract.test.ts` belongs to the orchestrator's pins (p6-plan §5.3), so I did not change its budget. **Proposal:** an explicit budget of at least 2x the loaded worst case, i.e. at least 60 s, set by the orchestrator or BE-A.

**What remains for the orchestrator (not a continuation task):**

1. The full `pnpm test:integration` on the merged tree, with the locale unset and with `C.UTF-8` (the ARCH-05B precedent: the orchestrator's merged-tree verification supplies it).
2. A clean unit-node run with the locale unset, if the vitest RPC timeout recurs at lower load.
3. The budget of `contract.test.ts:1072`.
4. The §5 questions.

### Changed and new files

- **New:**
  - `packages/db/migrations/0113_p6_branding_contrast_reports.sql`;
  - `docs/architecture/adr/ADR-0061-p6-ux-hardening-contrast-greyscale-layout-keyboard-axe-localization-explanations.md`;
  - `apps/api/test/support/p6-pending-arch-06.ts` (the aggregate);
  - `apps/api/test/support/p6-pending-be-w.ts` (`getBrandingVersionContrast`);
  - this handback and `T-DG6-ARCH-06-evidence/**`: the probe and its three outputs, the generator and its outputs, the check and test logs, the migration hash.
- **Modified:** as listed in §6, plus `packages/db/test/integration/catalogue.test.ts`, which now also carries the privilege-map entries.

### Merge instructions

- Merge this tree as one change. `0113` is the next migration id above `0112`. If BE-H, BE-I or BE-J ship a migration first, renumber `0113` to the next free id at merge (D-196 item 2) and update these to match:
  - the probe's G00 and SLICE;
  - the catalogue pin titles;
  - the seed-test example;
  - the ADR, ERD and dictionary references.
- No conflict is expected with BE-H, BE-I or BE-J. Their files are slice C/J; I touched none of them. Overlap on shared files is limited to `docs/api/openapi.yaml` (a different area), the `contract.test.ts` count (+1 from me), `schema.ts` and `catalogue.test.ts`, the last two append-only blocks.
- After merge: `pnpm openapi:lint` (932 operations unless other operations merged), and the contract test count reconciled from every handback (D-079).

`date -u` at the end: `Wed Oct 28 20:09:24 UTC 2026`.
