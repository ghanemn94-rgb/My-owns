# Handback T-DG5-ARCH-R5 (solution-architect): the round-2 repair amendments

- **Stage / gate:** P5, DG5, FIXING after review round 2 (D-172).
- **Invocation reference:** `{"kind":"claude-code-cli-session","run_id":"DG5-T-DG5-ARCH-R5-solution-architect-20261018T164008Z-7a5631db","session_id":"7a5631db-81aa-43a6-89f0-a29ccfc6a5ba"}`.
- **Assignment:** `docs/delivery/assignments/DG5/T-DG5-ARCH-R5.md`. Its sha256 `f08ea122…3ccd0` was verified before starting (`sha256sum` gave `f08ea12282e56054025572831f19a2d201c4c0268d928ffb612c0e3ec2e3ccd0`).
- **Working tree:** `/home/user/wt/dg5-arch-r5`, branch `dg5/arch-r5`, `HEAD` `c184328e30d1891e3c32da34944afb5ec75a9d0b` (holds the merges of T-DG5-BE-X1 `01d7842` and T-DG5-BE-X2 `c007ad5`). All changes are **uncommitted**.
- **Time (`date -u`):** start `Sun Oct 18 16:40:26 UTC 2026`, end `Sun Oct 18 16:51:01 UTC 2026`.
- **Preceding gate:** `node tools/gates/validate.mjs --historical --stage DG4` printed `PASS gate DG4 (historical)` and exited 0, both at the start and at the end.

Product gates G1–G6 are business approvals inside the product. Nothing here grants or implies a business, Finance or IT approval. The demo's decisions are synthetic, and nothing touches DG0–DG7. The playbook and the product are not called an official PMI standard.

## 1. Changed files (all in `docs/architecture/**`, plus this handback)

| File | Purpose |
|---|---|
| `docs/architecture/adr/ADR-0035-p4-phases-g5-g6-exceptions-routing.md` | New dated amendment **E1–E5** (T-DG5-ARCH-R5; F-DG5-122). It sets out G4 readiness over an empty approved portfolio: the fail-closed rule per criterion, the "both parts" rule, live and frozen, and that an exception covers one criterion only. `g4.ts:248` already cites "ADR-0035 amendment by T-DG5-ARCH-R5". |
| `docs/architecture/adr/ADR-0021-p3-portfolio-initiative-lifecycle-g4.md` | §7 is where the G4 criteria and their subject sets are defined. This adds an inline "Amended 2026-10-18" note under "G4 scope", plus a new dated amendment giving the §7 table delta (the added condition and the `g4.no_approved_initiative` item for 7 rows). |
| `docs/architecture/adr/ADR-0050-p5-demo-environment-roaming-dataset-reset-walkthrough.md` | New dated amendment **D11–D15** (T-DG5-ARCH-R5; F-DG5-120): §4 dataset content, D7 corrections, D9, §5 and the disclosed observations, and corrected D7 line references. Inline "Superseded / Corrected / Moot 2026-10-18" markers on each untrue D7/D9 statement and in §4. No text is removed. |
| `docs/architecture/data-dictionary.md` | Corrects the "Demo dataset gate history" paragraph in place (no `gate_exception` row, with a "Corrected 2026-10-18" marker). Adds a new dated section listing the new and updated demo table writes, and where the G4 missing-item codes live. |
| `docs/delivery/handbacks/DG5/T-DG5-ARCH-R5-solution-architect.md` | This handback. |

## 2. Item → amendment → evidence

| # | Item (assignment) | Amendment | Evidence (`file:line`, merged tree `c184328`) |
|---|---|---|---|
| 1a | Every criterion over the approved portfolio fails closed when it is empty, and the missing item names the cause | ADR-0035 **E2** (the rule, the code/label/pointer table, per-criterion table); ADR-0021 inline note at `:161` and the §7 amendment table | `apps/api/src/modules/workflows/g4.ts:255–259` (`NO_APPROVED_INITIATIVE`, `emptyPortfolio`); `:301`, `:342`, `:355`, `:362`, `:378`, `:398`, `:413`, `:428`; scope statuses `apps/api/src/modules/portfolio/gate-facts.ts:28`, `:67`; labels `apps/web/src/i18n/en/gates.json:121`, `apps/web/src/i18n/ar/gates.json:121` |
| 1b | Complete only if the transformation-level part **and** the per-initiative parts hold | ADR-0035 E2 "Complete needs both parts"; ADR-0021 amendment rows 2–3 | `g4.ts:294–301` (business cases), `:326–343` (Finance validation; out-of-portfolio cases excluded at `:327`, `:332`); unit `apps/api/src/modules/workflows/g4.test.ts:189` |
| 1c | Not loaded and Initiative cards unchanged | ADR-0035 E2 "What does not change" | `g4.ts:292–293`, `:319–325`, `:351–352`, `:376–377`, `:395`, `:410`, `:426–427` (NOT_LOADED); `:267–268` (`g4.portfolio_empty`) |
| 1d | Same for the live readiness and the frozen snapshot | ADR-0035 **E3** | one evaluator registry `apps/api/src/modules/workflows/criteria.ts:258–260`; live `gates.ts:426`, `:435–451`; frozen `gates.ts:913–915`, refusal `:916–940`, frozen row `:1076`; test `apps/api/test/integration/workflows/g4-empty-portfolio.test.ts:169` (live), `:196` (frozen) |
| 1e | An exception still covers one criterion only | ADR-0035 **E4** | `apps/api/src/modules/workflows/gate-exceptions.ts:207–223` (coverage by `criterion_key`); `g4-empty-portfolio.test.ts:196` (one exception per incomplete criterion) |
| 2a | The demo's G4 rests on a real approved portfolio of INI-01..03, with no exception | ADR-0050 **D11** (dataset rows table), **D12** row 1 | `packages/db/src/demo/data/roaming-portfolio.ts:221` (`seedApprovedPortfolio`), `:227`, `:229–278`, `:280–295`, `:297`ff., `:323–362`, `:365`ff., `:406`ff., `:426–440`, `:443–463`, `:467–471`; `roaming-gates.ts:485–490`, `:516–533` (`gate_exception_id: null`), `:627–709` (`g4SnapshotOf`), `:687–688` (throws unless INI-01..03) |
| 2b | Correct every statement BE-X2 lists as untrue (handback §6) | ADR-0050 **D12** table (6 rows), **D13**, §4 inline note, D7/D9 inline markers | D7 "G4 … two accepted exceptions … 2028-08-31" → `roaming-gates.ts:14–18`, `:516–533`; module order → `:723–736`, `:731`, `:734`; "exception reasons carry the label" → moot, `roaming-portfolio.ts:53`, `:288`; "every G-decision and exception" → `roaming-portfolio.ts:39–41`; test description → `apps/api/test/integration/environment/demo-gate-history.test.ts:93–100`, `:174`, `:184–200`, `:202–215`; GD-04 → `roaming-gates.ts:106–120`, test `:346–348`; D9 "6 of 8 … covered" → `apps/web/src/pages/gates/GatesPage.tsx:120–121`, `apps/web/src/i18n/en/gates.json:39` |
| 2c | §4 dataset content (BE-X2 §6 last ADR-0050 bullet) | ADR-0050 **D11** | `business-cases.ts:280`, `:559–560`, `:337`, `:590`; `roaming.ts:734`; ranks `roaming-portfolio.ts:105`, `:125`, `:145`; ids `roaming-ids.ts:72–73`, `:78–86`; totals `demo-gate-history.test.ts:328–343` |
| 2d | Observation: the seed emits no outbox events | ADR-0050 **D14** bullet 2 | `roaming-portfolio.ts` has no outbox write (grep `outbox` gives no match); D7's own statement at `roaming-gates.ts:24–26` |
| 2e | Observation: `portfolio_selection.create` differs from the API's `select` | ADR-0050 **D14** bullet 3; data dictionary table row | `packages/db/src/demo/seed.ts:158` (`${table}.create`); `apps/api/src/modules/portfolio/selections.ts:117` (`portfolio_selection.select`); `initiative.select` in both: `roaming-portfolio.ts:294`, `selections.ts:133`, `kpis.ts:165` |
| 2f | Observation: INI-01 carries a `before_predecessor` warning | ADR-0050 **D14** bullet 4 | `roaming-portfolio.ts:148–149` (DEP-01, INI-03 finish 2026-09-28); `apps/api/src/modules/portfolio/schedule.ts:7`, `:20` |
| 2g | §5 | ADR-0050 **D14** bullet 1 (coverage unchanged) and the G5 readiness observation | `docs/delivery/handbacks/DG5/T-DG5-BE-X2-evidence/30-e2e-demo.log:95` (`coverage  complete`, BE-X2's run) |
| 2h | (in addition) stale D7 line references | ADR-0050 **D15** table | each "as merged" value checked with `sed -n` on `roaming-gates.ts`, `roaming-ids.ts` and the test file |
| 3a | Data dictionary: no `gate_exception` row | `data-dictionary.md` "Demo dataset gate history" paragraph corrected in place (`:12381`) | `roaming-gates.ts:516–533` |
| 3b | Data dictionary: the new table writes | new section "Demo dataset: the approved portfolio behind G4 …" (rows table and updated rows) | `roaming-portfolio.ts` as in 2a; `business-cases.ts:559–560`, `:590` |
| 3c | Data dictionary: new G4 missing-item code(s), if it lists codes | **It does not list G4 codes** (grep of `docs/architecture/data-dictionary.md` and `erd.md` for `g4.portfolio_empty`, `g4.owner_missing` and `g4.funding_missing` has no hits). The new section says where the codes are defined, and that `g4.no_approved_initiative` is a value of the existing free-text `Warning.code` stored in `gate_submission_criterion.detail` | `apps/api/src/modules/workflows/gates.ts:1074` (`detail: JSON.stringify({ missing: … })`) |

## 3. Checks actually run

Environment: the worktree above, Node (the repository's), offline sandbox.

| Check | Command | Result |
|---|---|---|
| Preceding gate (start) | `node tools/gates/validate.mjs --historical --stage DG4` | `PASS gate DG4 (historical)`, exit 0 |
| Prettier (acceptance 1) | `git ls-files -co --exclude-standard -z -- docs/architecture \| xargs -0 npx prettier --check --ignore-unknown` | `Checking formatting...` / `All matched files use Prettier code style!`, exit 0 (prettier 3.8.1) |
| Preceding gate (end) | `node tools/gates/validate.mjs --historical --stage DG4` | `PASS gate DG4 (historical)`, exit 0 |
| Line-reference verification | `sed -n '<n>p'` on every cited file and line (g4.ts, gates.ts, criteria.ts, gate-exceptions.ts, roaming-gates.ts, roaming-portfolio.ts, roaming-ids.ts, business-cases.ts, kpis.ts, seed.ts, selections.ts, schedule.ts, GatesPage.tsx, gates.json, demo-gate-history.test.ts, g4-empty-portfolio.test.ts, gates/g4.test.ts) | Every reference checked. The off-by-a-few ones were corrected before the final prettier run. |

Not run, because this task is documentation-only and does not need them: typecheck, lint, unit, integration and e2e suites. I did not re-run any product test. Test results quoted in the amendments come from the BE-X1 and BE-X2 handbacks, which are cited as such.

## 4. Known gaps / not done

- **The ADR text is checked against the code only.** I did not render the demo G4 page. D13 states the expected readiness text ("8 of 8 mandatory outputs complete") as the code's expected output, as BE-X2 also did not render it (BE-X2 §8 item 5).
- **The G5 readiness on the demo is not re-checked** (BE-X2 §8 item 1). It is recorded as an observation in D14, not resolved.
- **The before_predecessor dates come from BE-X2's handback.** INI-01's planned start of 2026-07-03 is BE-X2's figure. In the code it is `ctx.date(-60)` from the synthetic clock (`roaming.ts:736`), and I did not evaluate it at runtime.
- **No contract change was needed.** No gate approval was reopened.

## 5. Merge instructions

- Documentation only: no migration, no code, no contract.
- **Conflicts:** none expected. T-DG5-FE-X1 writes web and e2e files only. ADR-0035, ADR-0021 and ADR-0050 gain sections only at their ends, plus small inline notes. The data dictionary changes one paragraph and adds one section at its end.
- In round 3, the domain reviewer re-verifies F-DG5-120 and F-DG5-122. I close no finding.
