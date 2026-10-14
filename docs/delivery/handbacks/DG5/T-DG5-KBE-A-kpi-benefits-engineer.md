# Handback T-DG5-KBE-A (kpi-benefits-engineer): T06 default weights and rubric, instantiation (p5-work-split §A.6)

- **Stage:** P5, gate DG5 (BUILDING). **Task:** T-DG5-KBE-A. **Requirement:** REQ-PB-093 (with BE-B3's publish and 100 % rule; completes with FE-B's screens, p5-work-split §A.9).
- **Assignment:** `docs/delivery/assignments/DG5/T-DG5-KBE-A.md` (sha256 `d312cc77…c478`, checked at start).
- **Invocation:** `DG5-T-DG5-KBE-A-kpi-benefits-engineer-20261014T133239Z-884114c9`, session `884114c9-5e37-45bb-8789-0df61a8acd30`.
- **Base:** branch `dg5/kbe-a` at `81be9e6c969b338016695e383cef33960e87f1e9` (the integrated `HEAD`). Changes are **uncommitted**, as asked.
- **Time:** started `2026-10-14T13:32:55Z`; end time in §9.
- **Two gate systems.** Nothing here reads or writes DG0–DG7 records. A Studio default weight set is configuration: it is not a business approval, and a transformation's weight set stays its own record, approved by its Sponsor (DG3). All seed and test data is synthetic.

## 0. Read this first: the tree needs one orchestrator patch to be green

I found a **contract defect** and three **expected consequences** of migration `0065` in files outside my ownership. Following the D-148 precedent (BE-H2B), I did **not** leave edits in frozen files. The changes are in one verified patch instead:

`docs/delivery/handbacks/DG5/T-DG5-KBE-A-evidence/proposed-orchestrator-patch.diff` (sha256 `24d45ab691c09d1f84aa1a25a0913e9bace4a6acaf0a80621e0ca16721a062fb`; `git apply --check` exit 0 on this tree).

| # | File (owner) | Change | Why |
|---|---|---|---|
| P1 | `docs/api/openapi.yaml` (ARCH-01; ARCH-06 is editing the file now) | `ScoringWeight.weightPercent` pattern: single → double YAML quotes | **Contract defect.** The pattern is single-quoted, so YAML keeps `\\.` as a literal backslash plus any character. `"25.00"` therefore fails the contract, and so does every weight with decimals. The DG3 `WeightSetWeight` pattern is the same text, double-quoted. Without P1, every `getScoringDefaults`/`putScoringDefaultsDraft`/`getTransformationScoringDefaults` response with a decimal weight is refused by the validating client. |
| P2 | `docs/api/openapi.yaml` (ARCH-01) | `WeightSet.approvalBasis` enum + `studio_default` | ADR-0040 §5 adds `approval_basis = 'studio_default'` (D-142 Q12), but the DG3 contract enum was not widened. Without P2, `listWeightSets` of a transformation created after a Studio change violates the contract. |
| P3 | `packages/shared/src/schemas/prioritization.ts` (DG3, frozen) | zod mirror `approvalBasis` + `"studio_default"` | Same as P2. |
| P4 | `apps/web/src/pages/prioritization/WeightSets.tsx`, `apps/web/src/i18n/{en,ar}/prioritization.json` (FE) | a `studio_default` basis label; the intro sentence | **True texts (F-DG4-160).** Without P4, the page would label a Studio default "(approved as a business approval)", which is untrue. The intro "Version 1 is the source default (25/25/20/15/15)" also becomes untrue for transformations created after a Studio change. The Arabic is a provisional translation. |
| P5 | `apps/api/test/integration/contract/contract.test.ts` (pin) | media-type pin `[343, 342, 1]` → `[344, 343, 1]` | My one JSON-body operation (`putScoringDefaultsDraft`); §2 rule 14, the orchestrator reconciles pins. |
| P6 | `apps/api/test/integration/transformations.test.ts` (DG1) | one more `transformation_config_pin.create` in the creation audit list | `0065`: `p3_instantiate_transformation()` now adds the `scoring_defaults` pin with its audit event (ADR-0040 §5 (a)). |
| P7 | `apps/api/test/integration/registers.test.ts` (DG2) | starter-structure pin `2 → 3`, audits `83 → 84` | Same as P6. |

**Evidence that the patch is exactly what is needed:**

- With the patch: the full integration suite gave 2160/2161. Its only failure was the P7 pin, which I added to the patch while the run was going. The five affected files then re-ran green, 167/167.
- Without the patch (the tree as handed back), the same five files give exactly 18 failures, all from P1/P2 and the P5–P7 pins (§3).

## 1. Changed files (all mine, p5-work-split §A.6)

| File | Purpose |
|---|---|
| `packages/db/migrations/0065_p5_scoring_defaults_instantiation.sql` (new) | D-142 Q12 reopen (ADR-0040 §5). Widens `scoring_weight_set_approval_basis_check` with `studio_default`. Extends `scoring_weight_set_approval_complete` so that a `studio_default` set has no approver. Redefines `p3_instantiate_transformation()`: (a) it pins `scoring_defaults` to the newest published `scoring-defaults` version, with a `transformation_config_pin.create` audit event (an existing pin is kept); (b) it creates weight set v1 from the pinned version's weights. While those equal B0076 it runs the DG3 statements verbatim (`source_default`, the DG3 rationale and the DG3 audit JSON). Otherwise the basis is `studio_default`, with the rationale "Studio default weights (scoring defaults v{n}): strategic fit {w}%, …". No backfill: existing transformations get no pin, so they resolve to v1. |
| `apps/api/src/modules/methodology/scoring-defaults.ts` (was a stub) | The three routes, the `ScoringDefaults` presenter (decimal weights, exact decimal total, null descriptors kept) and the draft write. |
| `apps/api/src/modules/methodology/providers/scoring-defaults-kind.ts` (new) | The `scoring_defaults` kind provider: `preview` (T06 samples scored through the DG3 `weightedScore`, unchanged); `affectedRecords` (an exact 0 `scoring_weight_set` records per pinned transformation, since a defaults change rewrites no record, ADR-0040 §5); `migrationItems` (none, ADR-0040 §2). |
| `packages/shared/src/schemas/scoring-defaults.ts` (was a stub) | Zod mirrors `scoringWeight`, `scoringRubricLevel`, `scoringRubric`, `scoringDefaultsPut`, `scoringDefaults` and `scoringDefaultsQuery`, plus `SCORING_DEFAULT_CRITERIA`. |
| `packages/shared/src/schemas/scoring-defaults.test.ts` (new) | 12 unit tests with worked fixtures (decimal weight grammar, rubric shape, 2–6 distinct criteria, a 95 % draft accepted, and the source vs PB-093 weighted scores 3.3000 / 3.3500). |
| `apps/api/test/integration/methodology/scoring-defaults.test.ts` (new) | 14 integration tests on the suite's **own scratch database**: it publishes `scoring-defaults` versions, which would change the starting weights of parallel suites on the shared run database. |
| `packages/db/test/integration/catalogue.test.ts` | One added test: the `0065` lines (both CHECKs and the function definition). |
| `apps/api/test/integration/contract/p5-exercises-kbe-a.ts` | Exercises of the three operations through the validating client (success and every reachable declared refusal), plus the zod mirrors. |
| `apps/api/test/support/p5-pending-kbe-a.ts` | Pending list `3 → 0`. |
| `apps/api/src/modules/methodology/methodology.test.ts` (shared slice A module test) | Appended my route rows to the Studio route-access pin (see the † note in §3). |
| `docs/delivery/handbacks/DG5/T-DG5-KBE-A-*` | This handback, its logs and the proposed patch. |

`packages/db/src/schema.ts` is unchanged: `0065` adds no column or table.

## 2. Behaviour delivered: REQ-PB-093

**Acceptance (requirements.csv, quoted):** "A methodology admin edits the default weight set and the 1-5 rubric descriptors in a Studio draft; publishing applies the 100% rule and creates an immutable version, which becomes the starting weight set and rubric of transformations created afterwards; existing transformations keep their pinned weight set and rubric until a deliberate migration". **A-test column:** "A06;A07: an admin changes the default Feasibility rubric text and the default weights to 30/20/20/15/15 in the UI and publishes without a code change; a transformation created afterwards starts with the new default; an existing transformation keeps its weight set and rubric version; publishing defaults that total 95% is rejected".

`scoring-defaults.test.ts` proves each clause through the API that the Studio UI calls:

- **Admin edits weights and rubric in a draft:** `createConfigDraft` from v1, then `PUT …/scoring-defaults` with 30/20/20/15/15 and the five Feasibility descriptors (en and ar) gives 200. The weights are normalized to two decimals, `weightTotal` is `"100.00"`, and the other rubrics are unchanged (null).
- **Publishes without a code change:** preview (a T06 sample scores `3.3500` with the draft's weights through the DG3 engine), then compatibility, the TO review approval and `publishConfigVersion` give `published`. The audit trail has `methodology_version.publish`, and `getScoringDefaults` now returns v2 as the newest.
- **A transformation created afterwards starts with the new default:** `POST /transformations` creates weight set v1 with 30/20/20/15/15, `approval_basis = 'studio_default'`, `approved_by` null and the rationale "Studio default weights (scoring defaults v2): strategic fit 30%, financial value 20%, customer impact 20%, feasibility 15%, time-to-value 15%." Its audit `changes` hold the decimal weights, its `scoring_defaults` pin names v2, and `getTransformationScoringDefaults` returns v2 with the new Feasibility rubric. The DG3 `listWeightSets` shows version 1 with basis `studio_default` (needs P2/P3).
- **An existing transformation keeps its weight set and rubric version:** a transformation created before the publish keeps 25/25/20/15/15, `source_default`, the DG3 rationale and weight-set version 1. Its pin still names v1, and it reads rubric v1 with null descriptors. A bare transformation with no pin resolves to v1, never to the latest.
- **Publishing 95 % is rejected:** a draft with 30/20/20/15/10 can be saved (`weightTotal` `"95.00"`, exact) and approved, but `publishConfigVersion` returns **422 `config_version.weights_total`** "Default weights must total exactly 100% over 2 to 6 criteria." The draft stays a draft, and the newest published version is unchanged. 105 % gives the same result. The publish check is BE-B3's (`publish.ts`), backed by the `0062` guard.
- **D-142 Q12 regression (byte-identical to DG3):** the DG3 body of `p3_instantiate_transformation()`, read from `0025` at test time, is installed as `dg3_reference_p3_instantiate_transformation`. It runs beside the new function on two fresh transformations. The waves, the weight set, the weights and every audit event (excluding ids, the transformation id and timestamps) are equal. They are also asserted against the literal B0076 values, so two equally wrong outputs cannot pass. The only addition is the `scoring_defaults` pin with its audit event. A second call creates nothing. A later published version whose weights equal the source again gives `source_default` with the DG3 rationale.
- **The mutation rules (shared rule 4):**
  - AUD, TO and BO get 403, and nothing is written.
  - A missing `If-Match` gives 428, and a stale one gives 409.
  - A published version gives 409 `config_version.not_editable`. A version of another kind gives 404.
  - Authorization is re-checked at commit time (a grant revoked mid-request gives 403, nothing written).
  - One audit event per element row written, plus one `methodology_version.scoring_defaults_put`. A body that changes nothing writes nothing.
  - A criterion left out is recorded as removed. Risk/compliance (B0077) can be added. 15 + 25 + 20 + 12.5 + 10.25 totals exactly `"82.75"`.
  - Lock `configDraft` (730250). No remote I/O.
- **400 `validation.weight_percent`** for `0`, `0.00`, `100.01`, `12.345`, `-5`, `1e2`, `abc` and `""`. Also 400 for one or seven criteria, duplicates (`validation.unique_items`), an unknown criterion, a rubric without five ordered levels, and an empty descriptor.

**Not delivered by this task:** the phrase "in the UI" is FE-B's Studio scoring screen (p5-work-split §A.9, "Completes with FE-B screens"). The `p5.scoringDefaults` placeholder text ("being built") stays true until then.

## 3. Checks actually run (Node 24.21.0, offline, ports 23850–23899)

Load average was 10–16 during the runs (W6 tasks in parallel).

| Check | Tree | Exit | Result / log |
|---|---|---|---|
| `node tools/gates/validate.mjs --historical --stage DG4` (start) | base | 0 | `PASS gate DG4 (historical)`; `validate-historical-DG4-start.log` |
| `pnpm -r typecheck` | final | 0 | `typecheck.log` |
| `pnpm -r build` | final | 0 | `build.log` |
| `pnpm lint` | final | 0 | `lint.log` (`--max-warnings=0`) |
| `git ls-files -co --exclude-standard -z \| xargs -0 npx prettier --check --ignore-unknown` | final | 0 | `prettier.log` |
| `pnpm openapi:lint` | final | 0 | `PASS … 827 operations`; `openapi-lint.log` (no contract change in my files) |
| `pnpm test`, locale unset | final† | 1 | unit-node 1841/1843 (2 failed: `architecture.test.ts` timed out at 30 s under load ~21, F-DG4-148 class; `methodology.test.ts` route pin, fixed afterwards, see below); unit-web 1385/1385; unit-formula-nocodegen 259 + 2 skipped by design. `unit-locale-unset.log` |
| `LANG=C.UTF-8 LC_ALL=C.UTF-8 pnpm test` | final | 1 | unit-node 1842/1843 (1 failed: `architecture.test.ts` timed out at 30 s under load ~20; `methodology.test.ts` passed with the fix); unit-web 1385/1385; unit-formula-nocodegen 259 + 2 skipped. `unit-c-utf8.log` |
| re-run of `architecture.test.ts` + `methodology.test.ts`, locale unset and C.UTF-8 | final | 0, 0 | 143/143 each. `unit-rerun-two-files-locale-unset.log`, `unit-rerun-two-files-c-utf8.log` |
| `QA_PG_PORT=23852 MTH_PORT_POOL=23853-23899 tests/qa/support/with-pg.sh pnpm test:integration` | **with patch** | 1 | 220 files, **2160 passed, 1 failed** (2161; 2115 s). The failure is `registers.test.ts` › starter structure (the P7 pin, added to the patch afterwards). `integration-full-with-patch.log` |
| the same harness, five affected files (registers, catalogue, scoring-defaults, contract, transformations) | **with patch** | 0 | **167/167**. `integration-targeted-with-patch.log` |
| the same five files | **final (without patch)** | 1 | 149 passed, **18 failed**. Contract › KBE-A exercises (P1), media-type pin (P5) and coverage (follows from the exercises); all 14 `scoring-defaults.test.ts` (the shared `call` helper validates every response against the contract: P1, P2); registers starter structure (P7); transformations audit trail (P6). `integration-targeted-without-patch.log` |
| `node tools/gates/validate.mjs --historical --stage DG4` (end) | final | 0 | `PASS gate DG4 (historical)`; `validate-historical-DG4-end.log` |

† **`methodology.test.ts`:** the slice A module test pins the Studio route table, and my PUT is one more row. Like BE-B and BE-B3 before me, I appended my rows to it (the PUT row, plus two `access.get` checks for the GETs). This additive edit to a shared slice A test file is the one file I changed outside §A.6's list. BE-C, running in parallel, will add rows next to mine. The locale-unset full run started before this fix.

**Unit counts:** unit-node is 1843 = 1831 (D-148) + 12 (`scoring-defaults.test.ts` in `@mth/shared`).

**Pinned-count change:** media-type `[343, 342, 1]` → `[344, 343, 1]` (+1 JSON body). The integration total is +15: 14 in `scoring-defaults.test.ts` and 1 catalogue test. The full run above collected 2161 = 2147 + 14, because the catalogue test was added after collection; it passed in the targeted run.

**Disclosed intermediate failures (mine, fixed):**

- The first runs of `scoring-defaults.test.ts` failed for these reasons:
  - P1, before I found it;
  - a wrong import depth;
  - rows ordered by UUIDv7 `id`, which is not monotonic within one millisecond (now the criterion order and audit `seq`);
  - `z.record` over an enum, which requires every key in Zod 4 (now `z.partialRecord`);
  - a T06 sample in the 95 % case, which the DG3 engine correctly refuses (that case now previews without samples);
  - an audit-count expectation that ignored the inherited rubric (now a rubric that changes).
- Two scripted test edits aborted on their own guards and changed nothing; one run in between was wasted.
- The `git checkout` I first used to revert frozen files failed, because git metadata is read-only in this sandbox. I reverted with `git apply -R` of the patch instead, then confirmed with `git apply --check`.

## 4. Operations routed (delta to my pending list)

`P5_PENDING_KBE_A`: `["putScoringDefaultsDraft", "getScoringDefaults", "getTransformationScoringDefaults"]` → `[]`. Each is exercised in `p5-exercises-kbe-a.ts`:

- **`putScoringDefaultsDraft`:** 200 (ETag), 400 ×2, 401, 403, 404, 409 stale, 409 not editable, 428. Its declared 422 is not reachable for a draft write: the 100 % rule is a publish rule, exercised by BE-B3 and by my suite.
- **`getScoringDefaults`:** 200 ×2, 400, 401, 403, 404 ×2.
- **`getTransformationScoringDefaults`:** 200, 400, 401, 404 ×2.

`config.consumes`: the PUT declares `application/json`; the GETs declare none.

## 5. For the orchestrator: contract, schema, dependency

1. **Apply the patch in §0** (P1–P7), or an equivalent. P1/P2 touch `openapi.yaml`, which ARCH-06 is editing now; the hunks are two lines far from its slices.
2. **Contract inconsistency, not patched:** `studio.ts` (BE-A) lets a `scoring_rubric` level descriptor hold up to 2000 characters through the generic `putConfigElement`, but the `ScoringRubricLevel` contract says `maxLength: 500`. A descriptor of more than 500 characters written through `putConfigElement` would make `getScoringDefaults` violate the contract. **Proposal:** limit `rubricLevel` descriptors in `studio.ts` to 500. I did not truncate in my presenter (shared rule 1 allows truncation only through `truncateText`).
3. **Data dictionary:** two lines of `docs/architecture/data-dictionary.md` (the `scoring_weight_set.approval_basis` CHECK and `scoring_weight_set_approval_complete`) are stale after `0065`. The file is regenerated by the architect's script.
4. **No new dependency. No new problem code.** I used ADR-0039 §13's `config_version.not_editable` and `config_version.weights_total` (BE-B3's publish), and `validation.weight_percent` and `validation.unique_items`. Preview report codes reuse `preview.not_available`, `preview.sample_invalid` and the DG3 `prioritization.*` codes.
5. **New audit action:** `methodology_version.scoring_defaults_put` (`changes`: `content_sha256`, `draft_stage` when it moves, and `weights`/`rubrics` from → to).
6. **Return value:** `p3_instantiate_transformation()` now returns DG3's count + 1 when it creates the pin, like the methodology pin counted by `p2_…`. No caller reads the value: the API ignores it, and so do the `0024` backfill and the `p4_` wrapper's sum. The DG3 rows themselves are byte-identical (§2).

## 6. User-facing texts my work made untrue

- `prioritization.weights.basis` would show "(approved as a business approval)" for a Studio default, and `prioritization.weights.intro` says "Version 1 is the source default (25/25/20/15/15)". Both are FE-owned, so I did not edit them. P4 in the patch has the en text and a provisional ar translation.
- `nav.json` `p5.scoringDefaults` ("The default T06 weight set and rubric that new transformations start with.") is now true. The `p5.notAvailable*` placeholder stays true until FE-B ships the screen.

## 7. Design points for the reviewers

- **PUT semantics:** the `weights` list is the full set (a criterion left out is removed). A listed rubric's five levels are replaced, and an unlisted rubric is unchanged. Weights are normalized to two decimals (`"30"` → `"30.00"`). Element rows keep their seed attributes (`sourceLabelEn`, `sourceRef`, labels).
- **Element order:** ordinal, then the T06 criterion order. A new criterion gets its canonical ordinal (risk/compliance = 6). The `0065` rationale uses the same order.
- **Preview hook:** a sample `{kind: "record", recordType: "t06_score", input: {scores}}`. A missing score gives Incomplete, never 0. A draft that does not total 100 % fails the sample with the DG3 code, and any other sample kind fails with `preview.not_available`.
- **Scratch database:** my suite publishes the global `scoring-defaults` key, so it runs on its own scratch database (the `bu-hierarchy-guard` pattern). The contract exercises use a fresh synthetic key (`seedStudioBase`) and publish nothing.
- **Migration order:** `0065` applies after `0064` on a fresh database. On a database already at `0087` it is applied as a pending file (the runner applies pending files in lexical order). It depends only on `0021`, `0024`/`0025`, `0062` and `0063`.

## 8. Merge instructions

- Run the migrations (`0065` is new). No conflicts are expected in my files.
- Apply the §0 patch: P1/P2 against ARCH-06's `openapi.yaml`, and P5 against other W6 pin increments (sum them).
- `BE-C` consumes my provider's `migrationItems` (it returns none). That is additive.

## 9. What remains

- The orchestrator's decision on the §0 patch. Without it, `contract.test.ts`, `scoring-defaults.test.ts`, `transformations.test.ts` and `registers.test.ts` fail as listed in §3.
- FE-B's Studio scoring screen (the "in the UI" part of the A-test), and the data-dictionary regeneration (§5.3).
- §5.2 (the 500 vs 2000 descriptor limit) for BE-A's `studio.ts`.
- A full `pnpm test` in both locales after the `methodology.test.ts` fix (only the two affected files were re-run; after the fix, `eslint --max-warnings=0` on the file and the `apps/api` typecheck exited 0 at 15:25Z).
- End time: 2026-10-14T15:24:29Z (about 1 h 55 min; the time limit was reached, so `pnpm test` was not re-run in full after the `methodology.test.ts` fix, only the two affected files in both locales).
