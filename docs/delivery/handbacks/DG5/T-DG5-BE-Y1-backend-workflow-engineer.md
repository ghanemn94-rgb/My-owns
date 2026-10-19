# Handback T-DG5-BE-Y1 (backend-workflow-engineer): DG5 round-3 repair, F-DG5-123

- **Stage:** DG5 (P5), FIXING after review round 3 on candidate `sha256:fc93b239…`, under D-174.
- **Invocation:** `DG5-T-DG5-BE-Y1-backend-workflow-engineer-20261019T044539Z-d862aa48`, session `d862aa48-8f92-472f-9e97-07f2acfac931`.
- **Assignment:** `docs/delivery/assignments/DG5/T-DG5-BE-Y1.md`. Its sha256 `21b8e7e7…f3331` was verified at the start.
- **Working tree:** `/home/user/wt/dg5-be-y1`, branch `dg5/be-y1`, starting at `HEAD` `24a803d30c7d92d26ccac428b4c215ec3468caa2`.
- **Time:** started 2026-10-19 04:45:51Z, ended 05:18Z (about 33 minutes).
- **Changes are uncommitted**, for the orchestrator to integrate.
- **Preceding gate:** at the start, `node tools/gates/validate.mjs --historical --stage DG4` printed `PASS gate DG4 (historical)` and exited 0. At the end it did the same (`T-DG5-BE-Y1-evidence/50-validate-historical-DG4.log`).

## 1. Changed files

| File | Purpose |
|---|---|
| `packages/db/src/demo/data/roaming-ids.ts` | Adds three new id blocks: `deliverable` `0x079`, `deliverableCapability` `0x07a` and `deliverableTraceLink` `0x07b` (`:86–95`). No existing block or id is reused. |
| `packages/db/src/demo/data/roaming-portfolio.ts` | Adds the key deliverables of INI-01..03, the two capability changes they deliver, and their trace links (`seedKeyDeliverables`, `:350–425`, called first in `seedApprovedPortfolio`, `:435`). Also adds per-initiative data (`deliverables`, `capability`, `chain`; `:149–169`, `:189–216`, `:239–265`), three synthetic times (`:63–66`), the id helpers (`:293–301`) and the header timeline (`:11–16`). |
| `apps/api/test/integration/environment/demo-gate-history.test.ts` | The regression test: the domain reviewer's reproduction as a product test (`:352–428`). |
| `packages/db/test/integration/demo.test.ts` | The D-174 teardown budget. `afterAll` gets 120 s and a one-line comment citing D-174 (`:28–31`). No assertion or other hook changed. |
| `docs/delivery/handbacks/DG5/T-DG5-BE-Y1-backend-workflow-engineer.md`, `…/T-DG5-BE-Y1-evidence/*` | This handback and its logs. |

- No migration, no contract change (`docs/api/openapi.yaml` and the zod mirrors are untouched), no new dependency.
- Nothing outside my ownership was edited. In particular I did not touch `apps/api/src/architecture.test*.ts` (BE-Y2's files) or `apps/web/**` (FE-Y1's).

## 2. F-DG5-123 (Low; REQ-S18-002; domain-reviewer)

### Cause

- `roaming-portfolio.ts` (BE-X2, D-173) takes INI-01..03 to `funded`, then `launched`, but seeds no `deliverable` row.
- Two product reads then react:
  - **The portfolio warning.** `initiativeWarnings` (`apps/api/src/modules/portfolio/repository.ts:168–192`) reports `initiative.deliverable_count` when an initiative has fewer than 3 or more than 7 deliverables. It did so on each of the three, next to an approved G4.
  - **The orphan report.** `orphanFlagsOf` (`apps/api/src/modules/reporting/traceability.ts:381–386`) exempts drafts. A launched initiative with no outgoing `initiative_deliverable` edge is "Downstream link missing / initiative → deliverable". So the report grew from 2 entries to 5.

### Fix

**Constraint behind the design.** I could not just insert deliverable rows. Under the same orphan rules (`traceability.ts:387–388`), any active deliverable without a `deliverable → capability` trace link is itself an orphan. Nine unlinked deliverables would have replaced 3 orphan entries with 9. So each deliverable is linked to a capability change, and each capability is linked to its chain's KPI.

**What is written.** All rows are written in Mobilize on 2026-06-03, after the G3 approval (06-02). They are written before INI-01..03 are submitted for prioritization (06-03 07:00), while the cards are still drafts. They are all written by the demo Transformation Lead (TL), whose role holds every permission involved (`0018`, `0024`, `0057`). They go through the product's tables and database guards. Each insert writes exactly one audit event (`<table>.create`, `ctx.insert`) and registers its row in `demo_seed_record`.

| Time (UTC) | Rows | Product path, permission | Where |
|---|---|---|---|
| 06:00 | `capability` ×2: "Proactive roaming service assurance (synthetic)" (journeys_processes, TOM gap 2, level 2→4, build) and "Partner cost and usage analytics (synthetic)" (partners_sourcing, TOM gap 3, level 1→3, partner). Both are owned by WL. INI-01 uses G3's existing "Digital roaming activation (synthetic)" on TOM gap 1. | capability heatmap register (`transformations/registers.ts:505`), `tom.edit` | `roaming-portfolio.ts:353–369` |
| 06:10 | `deliverable` ×9: three per initiative, ordinals 1–3. Each has owner WL, `acceptance_status` `pending` and status `active`. Each is due on the approved milestone date it feeds. | `deliverables.ts createDeliverable`, `initiative.edit` | `:370–395` |
| 06:20 | `trace_link` ×9 `deliverable_capability`, and ×3 `capability_kpi` (capability → its chain's outcome KPI). No allocation share is recorded, so no value is attributed. | `traceability.ts createTraceLink`, `traceability.link` | `:396–424` |

**The rules on each record:**

- **Count.** 3 per initiative, inside T05's 3–7 (B0072; ADR-0021 §2). The seed throws if a list is outside 3–7 (`:371–372`).
- **Labels.** English, then Arabic, each marked synthetic. The title reads `<en> (synthetic) / <ar> (اصطناعي)`. The description names the initiative's B0147 line in English, then repeats the synthetic label in Arabic.
  - INI-01 (activation): "Redesigned roaming pass catalogue", "One-tap pass activation journey in the app", "Attach-rate and activation tracking report".
  - INI-02 (complaints): "Roaming QoS monitoring for the top destinations", "Proactive travel and usage notifications", "Care playbook for roaming complaints".
  - INI-03 (partner): "Partner cost analytics baseline", "Partner usage feed for digital activation", "Partner steering and renegotiation shortlist".
- **Dates.** Each due date equals one of the initiative's approved milestone dates:
  - INI-01: 09-30, 11-30, 11-30;
  - INI-02: 10-15, 12-15, 12-15;
  - INI-03: 09-15, 09-28, 09-28.

  All are inside the planned window and after the synthetic clock (2026-09-01), so none reads overdue. The seed throws otherwise (`:376–377`).
- **Acceptance.** None is submitted or accepted. Acceptance is the owner's later business decision (`deliverable.accept`), and the demo's timeline does not need one.

### Regression test

The test is `demo-gate-history.test.ts:357`, "F-DG5-123: the launched portfolio INI-01..03 carries 3-7 key deliverables: no count warning, no orphan".

- **Setup:** the real seed and the real API (`MTH_ENV=demo`), signed in as `roaming.user.tl`.
- **Reads:** only the product's own operations: `listInitiatives`, `getInitiative`, `listDeliverables`, `listMilestones`, `getGate G4` and `getOrphanReport`.
- **What it asserts, for each of INI-01..03:**
  - the initiative is launched;
  - no `initiative.deliverable_count` warning appears, on the portfolio list or on the initiative;
  - it has 3 to 7 active deliverables, and `countWarning` is null;
  - ordinals run 1..n;
  - each deliverable was created by TL, is owned by the workstream lead, is `pending`, and was never submitted;
  - each was created before the G4 submission, and is due within the planned window, no later than the last approved milestone and after the clock;
  - each title has en and ar with the synthetic marks;
  - each deliverable has exactly one audit event, `deliverable.create`.
- **The reviewer's final assertion is kept** (`:424–427`): the orphan report lists no launched initiative. Just before it (`:420–423`), the test also asserts that no initiative, deliverable or capability is an orphan.
- The per-initiative checks use `expect.soft`, so the failing-before run shows every failure, including the final assertion.

**Failing before the seed change** (`T-DG5-BE-Y1-evidence/01-repro-failing-before.log`; exit 1, 1 failed and 3 passed). The test was written first and run against the unchanged round-3 seed:

```
→ INI-01 on the portfolio list: expected [ 'initiative.deliverable_count' ] to not include 'initiative.deliverable_count'
→ INI-01 on the initiative: expected [ 'initiative.deliverable_count' ] to not include 'initiative.deliverable_count'
→ INI-01: 0 key deliverables: expected false to be true // Object.is equality
→ INI-01: expected { …(2) } to be null
  … (the same four for INI-02 and INI-03)
→ the orphan report lists no launched initiative: expected [ 'INI-01', 'INI-02', 'INI-03' ] to deeply equal []
      Tests  1 failed | 3 passed (4)
```

The failing-before log predates one tightening: the "no initiative, deliverable or capability is an orphan" assertion (`:420–423`) was added after it. The final assertion is the same in both versions.

**Passing after** (`02-repro-passing-after.log`, final test text): exit 0, `Tests 4 passed (4)`. The full integration run in §3 passes it too.

### What stays unchanged

All of the following pass in the §3 runs:

- **G4.** Still approved, with 8 of 8 mandatory criteria `complete`, `missing: []`, no gate exception, and the frozen snapshot naming INI-01..03 (`demo-gate-history.test.ts:174`). G4's evaluator and snapshot read no deliverable or capability.
- **Totals.** The business-case totals are unchanged: 7,128,000 / 1,584,000 / 1,920,000 / 3,660,000 (3 lines) / 1,170,000 SAR. No value-bearing row was added, and the trace links carry no share.
- **The B0147 chains.** The three chains still read as one line of exactly five nodes (`demo-roaming.test.ts`, `demo-traceability-chains.test.ts`). The new edges are of other kinds (`initiative_deliverable`, `deliverable_capability`, `capability_kpi`), next to the lines.
- **Gate history.** G1–G3 history is unchanged, and G5 and G6 are still not submitted. The coverage conditions (ADR-0050 §5) read no deliverable or capability, and are all complete.
- **Determinism.** Seed, reset and reset give identical counts and checksums (`demo.test.ts`, `demo-roaming.test.ts`, `demo-numbers.test.ts`).
- **The 12-step walkthrough** passes (`walkthrough.test.ts`, the e2e walkthroughs).

### Disclosed side effects

These are by design. The reviewers should judge them.

1. **The orphan report on the demo goes from round 2's 2 entries to 1, not back to 2.**
   - G3's capability "Digital roaming activation (synthetic)" was listed as "Both links missing". It is now linked: INI-01's deliverables feed it, and it moves INI-01's KPI.
   - The only entry left is the fourth diagnosed issue, "Fragmented roaming propositions and an inconsistent digital activation journey" (Downstream link missing, Diagnosed issue → Target-state gap). It is not a B0147 line.
   - The test pins this at `:420–423`.
   - Avoiding the change would have meant leaving G3's capability unlinked, next to INI-01's activation deliverables, or adding new orphan capabilities. Either would contradict M0348's "link the examples".
2. **The traceability graph gains nodes and edges.** It adds 9 deliverable nodes and 2 capability nodes. It adds 9 `initiative_deliverable` edges (from `deliverable.initiative_id`), 9 `deliverable_capability` edges and 3 `capability_kpi` edges. The screen still shows the whole graph, which is far below the 2,000-node cap.
3. **Other screens now show the new records:**
   - the capability heatmap and the TOM report list 3 capabilities instead of 1;
   - the roadmap's Deliverables tab and the initiative execution read show the 9 deliverables, all pending;
   - downstream impact now has deliverable and capability nodes to show.
4. **Record counts and the checksum change by design.**
   - By construction: `capability` +2, `deliverable` +9, `trace_link` +12, and `demo_seed_record` and `audit_event` +23 each.
   - The new checksum on the demo stack is `0a7fdc3f…2737e4` (`40-e2e-demo.log`). Two seeds or resets still give identical values.
   - No test pins a literal count or checksum, so **no pin changed** in `tests/qa/integration/{a02-a21-complete-lifecycle,a15-demo-transformation-outputs,a22-operational-readiness}.test.ts` or in any other demo test.

## 3. Checks

Every command ran on Node 24.21.0, offline, in this worktree, one at a time (D-164). Ports were 23050–23099. Logs are in `docs/delivery/handbacks/DG5/T-DG5-BE-Y1-evidence/`.

| # | Command | Exit | Result |
|---|---|---|---|
| 1 | `node tools/gates/validate.mjs --historical --stage DG4` (start and end) | 0 / 0 | `PASS gate DG4 (historical)` (`50-…`) |
| 2 | `pnpm -r typecheck` | 0 | all packages Done (`10-…`) |
| 3 | `pnpm -r build` | 0 | (`11-…`) |
| 4 | `pnpm lint` | 0 | eslint `--max-warnings=0`, no output (`12-…`) |
| 5 | `git ls-files -co --exclude-standard -z \| xargs -0 npx prettier --check --ignore-unknown` | 0 | "All matched files use Prettier code style!" (`13-…`). Run before this handback was written; the handback was then checked on its own (§3 note). |
| 6 | `pnpm openapi:lint` | 0 | `PASS docs/api/openapi.yaml: OpenAPI 3.1.1, 846 operations` (`14-…`) |
| 7 | `npx vitest run --configLoader runner --project unit-node packages/db/src/demo`, locale unset | 0 | 3 files, 20/20 (`20-…`) |
| 8 | the same with `LC_ALL=LANG=C.UTF-8` | 0 | 3 files, 20/20 (`21-…`) |
| 9 | `QA_PG_PORT=23050 MTH_PORT_POOL=23051-23099 tests/qa/support/with-pg.sh npx vitest run --configLoader runner --project integration apps/api/test/integration/environment/demo-gate-history.test.ts`, before the seed change | **1** | expected: the reproduction fails, 1 failed and 3 passed (`01-…`; §2) |
| 10 | the same, after the fix | 0 | 4/4 (`02-…`) |
| 11 | `QA_PG_PORT=23050 MTH_PORT_POOL=23051-23099 tests/qa/support/with-pg.sh npx vitest run --configLoader runner --project integration packages/db/test/integration apps/api/test/integration/environment apps/api/test/integration/portfolio apps/api/test/integration/reporting/table-totals-demo.test.ts tests/qa/integration/a02-a21-complete-lifecycle.test.ts tests/qa/integration/a15-demo-transformation-outputs.test.ts tests/qa/integration/a22-operational-readiness.test.ts` | 0 | **40 files, 467/467 passed**, none skipped, 433.5 s (`30-…`). `packages/db/test/integration/demo.test.ts` passed 9/9 in 71.0 s, with its teardown inside the new budget. |
| 12 | `PLAYWRIGHT_BROWSERS_PATH=/opt/pw-browsers QA_EVIDENCE_DIR=… E2E_SCREENSHOT_DIR=… E2E_PG_PORT=23060 E2E_API_PORT=23061 MTH_PORT_POOL=23062-23099 e2e/support/with-demo-stack.sh npx playwright test e2e/a02-guided-walkthrough.spec.ts e2e/a02-demo-users-walkthrough.spec.ts e2e/a02-demo-labels.spec.ts e2e/a21-no-ai-operation.spec.ts --workers=1 --reporter=list` | 0 | **12/12 passed** (6 en and 6 ar), 3.7 min; demo seed coverage `complete` (`40-…`) |

**Notes on the checks:**

- **Unit projects.** Only `packages/db/src/demo/**` (unit-node) is reached by the change. No API source or web file changed.
- **E2E screenshots.** The 13 MB of screenshots the e2e specs wrote under `QA_EVIDENCE_DIR` were removed after the run, to save the shared disk. Their sha256 list is kept in `41-e2e-screenshots-sha256.txt`.
- **The handback's own format.** This handback was written after check 5, and it is checked separately with `npx prettier --check` (§7).
- **No flaky test, timeout or retry** occurred in any run above.
- **Not run (D-164):** `pnpm test`, `pnpm test:integration` and the full e2e suite. They are left to the orchestrator's merged-tree verification, and are not reported as passed.

## 4. Contract, schema or dependency needs

None. No new operation, response shape, migration or dependency.

## 5. ADR and data-dictionary statements made untrue or incomplete (for T-DG5-ARCH-R6)

- **ADR-0050, amendment D11 (§4, the approved portfolio).** The step table has no row for the 06-03 06:00–06:20 steps: 2 capabilities (TL, `tom.edit`), 9 deliverables (TL, `initiative.edit`) and 12 trace links (TL, `traceability.link`), written by `seedKeyDeliverables`. The "Determinism" bullet lists blocks `0x070`–`0x078`, and should also list `0x079`–`0x07b`.
- **ADR-0050, D11 and D12 line references into `roaming-portfolio.ts`.** These all shifted by about 210 lines: `seedApprovedPortfolio :221` (now `:429`), `launchApprovedPortfolio :467` (now `:678`), `:105/:125/:145/:149`, `:179`, `:227`, `:229–278`, `:280–295`, `:288`, `:297`, `:323–362`, `:365`, `:406`, `:426–440`, `:443–463`, `:467–471`, `:39–41` and `:53`. The `roaming-ids.ts:78–86` reference still holds, and the new blocks are at `:86–95`.
- **ADR-0050 §7, D7 ("G3: a capability gap and an active future-state journey").** Still true for G3's evidence. The dataset now holds 3 capabilities: G3's, plus the two recorded in Mobilize.
- **ADR-0050, the three chains (§4 and D-168 text).** Still true: each B0147 line has exactly five nodes. It is now incomplete: each initiative also reaches its KPI through deliverable → capability change → KPI (M0097's longer chain). The demo's orphan report holds one entry, the fourth diagnosed issue.
- **Data dictionary, "Demo dataset: the approved portfolio behind G4" (`docs/architecture/data-dictionary.md:12383`ff.).**
  - The "New rows the demo writes" table needs `capability` ×2, `deliverable` ×9 and `trace_link` ×12, with the facts in §2.
  - Its `roaming-portfolio.ts :221` / `:467` references are stale, as above.

## 6. User-facing texts

| Text | Before | After | What I did |
|---|---|---|---|
| The portfolio warning 'Key deliverables: the card should list 3 to 7.' (ar 'المخرجات الرئيسية: يُستحسن أن تذكر البطاقة من 3 إلى 7.') on INI-01..03 | Shown next to an approved G4, against the page's own "they block only at G4" | Not shown: each initiative has 3 deliverables | The data now matches the copy. The copy is unchanged and true. |
| Orphan report "Downstream link missing / Initiative → Deliverable" on INI-01..03 | 3 entries | None | Fixed by the data. |
| Orphan report "Both links missing" on "Digital roaming activation (synthetic)" | Listed | Not listed (linked both ways) | Disclosed (§2, side effect 1). |

The new seeded texts are synthetic demo data, in en and ar. I changed no product string, and no string of mine became untrue.

## 7. What remains

- **Nothing in this task's scope.**
- The orchestrator's merged-tree verification (D-164): `pnpm test`, `pnpm test:integration` and the full e2e suite.
- The ADR and data-dictionary amendments in §5 (T-DG5-ARCH-R6).
- In round 4, the domain reviewer re-verifies F-DG5-123. I do not close my own finding.
- **Concurrency.** D-174's text gives the `demo.test.ts` teardown budget to BE-Y2. This assignment (ownership of `packages/db/test/integration/demo*.test.ts`) gives it to me, and BE-Y2's assignment lists my files as not theirs. I made the change. If BE-Y2 also touched it, expect a one-hunk conflict at `demo.test.ts:28–31`.

## 8. Merge instructions

- Apply the four changed files. No migration, no ordering constraint, and no regeneration step.
- The `packages/db` build output (`dist/`) must be rebuilt (`pnpm -r build`) before a demo stack seeds from `dist`.
- **Expected conflicts:** none with BE-Y2 (`apps/api/src/architecture.*`) or FE-Y1 (`apps/web/**`), apart from the possible `demo.test.ts` overlap noted in §7.
