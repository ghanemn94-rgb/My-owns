# Handback T-DG5-ARCH-R6 (solution-architect): the round-3 repair amendments

- **Stage:** P5, gate DG5, FIXING after review round 3 (D-174).
- **Invocation:** `{"kind":"claude-code-cli-session","run_id":"DG5-T-DG5-ARCH-R6-solution-architect-20261019T061100Z-8638dde3","session_id":"8638dde3-80d9-4fa0-8053-b23634ec102a"}`.
- **Assignment:** `docs/delivery/assignments/DG5/T-DG5-ARCH-R6.md`. Its sha256 `e63c836c…f118ad0` was verified before I started.
- **Working tree:** `/home/user/wt/dg5-arch-r6`, branch `dg5/arch-r6`, `HEAD` `c0f6208fd79e21f9a8ecf81e3f275c9ef50b6c9b`. It holds the merges of T-DG5-BE-Y1 (`de643ca`), T-DG5-BE-Y2 (`fcacfb7`, plus the orchestrator's comment-only `2d0f98c`) and T-DG5-FE-Y1 (`d1a6a88`).
- **Time (`date -u`):** started Mon Oct 19 06:11:14 UTC 2026. The end time is in §3.
- **Changes are uncommitted**, for the orchestrator to integrate.
- **Preceding gate:** `node tools/gates/validate.mjs --historical --stage DG4` printed `PASS gate DG4 (historical)` and exited 0 at the start, and again at the end (§3).

I grant no business, Finance or IT approval. The demo's G1–G4 decisions are synthetic. Product gates G1–G6 stay separate from DG0–DG7.

## 1. Changed files

| File | Purpose |
|---|---|
| `docs/architecture/adr/ADR-0050-p5-demo-environment-roaming-dataset-reset-walkthrough.md` | **Dated in-place notes:**<br>- §4 note (`:85`);<br>- the D7 G3 note (`:322`);<br>- three new rows in the D11 table (`:377–379`);<br>- the D11 "Determinism" bullet extended (`:396`);<br>- corrected references in D11, D12 and D14.<br>**New amendment** "2026-10-19, T-DG5-ARCH-R6" (`:454`ff.):<br>- D16, the key deliverables, capabilities and trace links;<br>- D17, the chains, M0097 and the orphan report;<br>- D18, G3 and the 3 capabilities;<br>- D19, the line-reference table;<br>- D20, what is not changed. |
| `docs/architecture/data-dictionary.md` | In "Demo dataset: the approved portfolio behind G4":<br>- a dated note (`:12387`);<br>- the corrected `roaming-portfolio.ts` references (`:12391`);<br>- rows `capability` ×2, `deliverable` ×9 and `trace_link` ×12 (`:12406–12408`). |
| `docs/delivery/handbacks/DG5/T-DG5-ARCH-R6-solution-architect.md` | This handback. |

Nothing else was written. No source code, contract, migration, review or gate record was touched.

## 2. Item → amendment → evidence

Every value below was read from the merged tree at `c0f6208`. I did not take it from the handbacks.

| # | Item | Amendment (where) | Evidence (`file:line`, merged tree) |
|---|---|---|---|
| 1a | D11: the 06-03 06:00 step, `capability` ×2 (TL, `tom.edit`) | D11 table row `ADR-0050:377`; D16 table `:464`ff. | `packages/db/src/demo/data/roaming-portfolio.ts:353–369` (insert), `:206–214` and `:256–264` (data), `:64` (time); `apps/api/src/modules/transformations/registers.ts:509` (`tom.edit`); `packages/db/migrations/0018_p2_access_instantiation.sql:62` (TL) |
| 1a | D11: the 06:10 step, `deliverable` ×9 (TL, `initiative.edit`; owner WL, `pending`, due on approved milestone dates) | `ADR-0050:378`; D16 | `roaming-portfolio.ts:370–395`; the 3–7 guard `:371–372`; the due-date guard `:377–378`; due dates `:149–165`, `:189–205`, `:239–255`; `apps/api/src/modules/portfolio/deliverables.ts:113`, `:109`; `0024_p3_gates_access_instantiation.sql:81` |
| 1a | D11: the 06:20 step, `trace_link` ×12: 9 `deliverable_capability` and 3 `capability_kpi` (TL, `traceability.link`, no share) | `ADR-0050:379`; D16 | `roaming-portfolio.ts:396–411`, `:412–422`; `apps/api/src/modules/reporting/traceability.ts:625`, `:73`; `0057_p4_dashboards_traceability_permissions.sql:18` |
| 1a | One audit event per write | D16 "One audit event per write" | `packages/db/src/demo/seed.ts:157–158` (`<table>.create`), `:172` (`demo_seed_record`); test `apps/api/test/integration/environment/demo-gate-history.test.ts:411–412` |
| 1a | "Determinism" bullet extended with `0x079`–`0x07b` | `ADR-0050:396`; D16 "Determinism" | `packages/db/src/demo/data/roaming-ids.ts:87–94`; id helpers `roaming-portfolio.ts:294–301` |
| 1b | Stale `roaming-portfolio.ts` references in D11 and D12 | Corrected in place (marked "corrected 2026-10-19, D19"), at `ADR-0050:373`, `:375`ff., `:393`, `:394`, `:396`, `:406`, `:407`; listed in D19 (`:487`ff.) | `roaming-portfolio.ts:429` (`seedApprovedPortfolio`), `:678` (`launchApprovedPortfolio`), `:438`, `:440–489`, `:491–506`, `:508`, `:534–573`, `:576`, `:617`, `:637–651`, `:654–674`, `:678–682`, `:137`/`:177`/`:226`, `:230`, `:289`, `:59`, `:499`, `:45–47` |
| 1b | References BE-Y1 did not list (same cause) | Corrected in place: `ADR-0050:408`, `:421`, `:422`; listed in D19 as "Listed by BE-Y1: no" | `demo-gate-history.test.ts:430` (phase-history test, was `:352`); `roaming-portfolio.ts:505` (was `:294`); `:229–230` (was `:148–149`) |
| 1c | §7 / D7: G3's evidence unchanged; 3 capabilities | D7 note `ADR-0050:322`; D18 (`:483`) | `packages/db/src/demo/data/roaming-gates.ts:353–356` (G3's capability); `roaming-portfolio.ts:297` (INI-01 reuses it) |
| 1d | The three chains: still five nodes; plus deliverable → capability → KPI (M0097); the orphan report holds one entry | §4 note `ADR-0050:85`; D17 (`:476`) | `traceability.ts:385`, `:388`, `:391–392` (orphan rules); test `demo-gate-history.test.ts:420–427`; `docs/source/master-prompt.anchored.md:193` (M0097); `demo-traceability-chains.test.ts` unchanged (`git diff --stat 24a803d c0f6208`) |
| 2 | Data dictionary: `capability` ×2, `deliverable` ×9, `trace_link` ×12 | `data-dictionary.md:12406–12408`; note `:12387` | as items 1a |
| 2 | Data dictionary: stale `:221` / `:467` | `data-dictionary.md:12391` | `roaming-portfolio.ts:429`, `:678`, `:350–423` |
| 3 | ADR-0002 enforcement (BE-Y2, optional) | **Nothing written** (assignment rule). Recorded in D20 (`ADR-0050:516`ff.) and below. | `docs/architecture/adr/ADR-0002-modular-monolith-boundaries.md:43` says only "enforced by an architecture test", and describes no mechanism. |
| 4 | FE-Y1: no ADR or data-dictionary statement | **Nothing to amend.** Confirmed by my own search (below); recorded in D20. | — |

### Item 3 in detail (BE-Y2)

ADR-0002 states its rules and says they are "enforced by an architecture test that backend-workflow-engineer writes in P1" (`ADR-0002:43`). Its verification section says "The architecture test itself is delivered by T-DG1-BE" (`:93`). No ADR or amendment describes the following:

- how the test parses files;
- `ts.transpileModule`;
- any test budget.

I searched `docs/architecture/**` for `architecture.test`, `transpileModule`, `AST_TEST_TIMEOUT`, `FULL_MODULE_WALK`, `syntaxErrors`, `scanSource` and "rule 4". The hits are:

- ownership lines in the p2–p5 work splits and plans;
- other ADRs citing ADR-0002's rules;
- ADR-0024's `fuzz.test.ts scanSource`, which is a different test.

So, as the assignment directs, I wrote no enforcement text. Two points for the record:

- **Two different "rule 4"s.** The testkit's "rule 4" (`apps/api/src/architecture.testkit.ts:547`, `syntaxErrors`: a syntax error fails closed) is the testkit's own numbering. It is not ADR-0002's rule 4 ("Only a module's own repository files write to its tables", `ADR-0002:53`). Any future enforcement note should keep the two apart.
- **What the merged code shows, for whoever documents it later:**
  - `FULL_MODULE_WALK_TIMEOUT_MS = 150_000` (`apps/api/src/architecture.test.ts:65`, used at `:214`);
  - the `EMPTY_EMIT` transformer (`architecture.testkit.ts:543`, passed at `:562`);
  - the guard test 'rule 4 reports exactly the diagnostics of a full ts.transpileModule…' (`architecture.test.ts:1083`).

### Item 4 in detail (FE-Y1)

I ran `grep -rniE "workstreams|\.workstream|minmax|grid-template|\.conflict\b|conflict banner|409 banner|reflow|horizontal scroll|200 ?%|390 ?px|app\.css|table-wrap|TableScrollRegion"` and then `grep -rniE "scroll|min-content|page width|viewport"` over `docs/architecture`.

- **The second search** had no hits.
- **The first search's hits** are all about content, data or behaviour, not layout:
  - workstream entities and APIs (ERD, ADR-0037, ADR-0038, ADR-0021, ADR-0019, ADR-0026, ADR-0035, the data dictionary);
  - `p2-work-split.md:111`, the Diagnose screen's contents ("findings by the six workstreams…"), which is unchanged;
  - ADR-0041's 409 conflict behaviour ("theirs vs yours", re-apply; `:117`, `:166`), which FE-Y1 left unchanged.
- **Result:** no ADR or data-dictionary statement describes the Diagnose layout, the conflict banner's layout or reflow. FE-Y1's own §5 is confirmed.

## 3. Checks actually run

All were run in `/home/user/wt/dg5-arch-r6`, offline.

| # | Command | Exit | Output |
|---|---|---|---|
| 1 | `node tools/gates/validate.mjs --historical --stage DG4` (start, 06:11Z) | 0 | `PASS gate DG4 (historical)` |
| 2 | `git ls-files -co --exclude-standard -z -- docs/architecture \| xargs -0 npx prettier --check --ignore-unknown` (after the edits) | 0 | `Checking formatting...` / `All matched files use Prettier code style!` |
| 3 | `node tools/gates/validate.mjs --historical --stage DG4` (end) | 0 | `PASS gate DG4 (historical)` |
| 4 | `date -u` (end) | 0 | §6 |

**Note on check 2.** `.prettierignore` lists `docs/` ("Delivery records, sources and gate tooling are byte-sensitive … never reformatted"). So Prettier skips every file under `docs/architecture`, and this check confirms only that no file there is checked and fails. It does not show that these Markdown tables are Prettier-formatted. They follow the unpadded table style the ADR already uses.

**Not run.** No product test, because no code changed. Every `file:line` was checked by reading the merged file (`sed -n`, `grep -n`), and every old reference was checked against `git show 24a803d:<file>`.

## 4. Known gaps and disclosures

- **"The orphan report holds one entry" rests on BE-Y1's disclosure** (handback §2, side effect 1). The test asserts that no initiative, deliverable or capability is an orphan, and that no launched initiative is listed (`demo-gate-history.test.ts:420–427`). It does not pin the number of diagnostic-finding entries, and I did not run the demo stack. D17 says so.
- **Counts, checksums and determinism.** The record-count deltas (+2, +9, +12 and +23), the new checksum and the seed-twice/reset-twice equality come from BE-Y1's handback and runs. I did not re-run them. The deltas follow from the code by construction: 2 + 9 + 12 `ctx.insert` calls, each writing one audit event and one `demo_seed_record` row.
- **D15's historical column.** D15 records references "as merged (`c184328`)", and I left it unchanged. Its `:352` (phase history) is now `:430`. D19 notes this, and the in-place correction is made in D12.
- **BE-Y1 cited one range differently.** It gave the new id blocks as `roaming-ids.ts:86–95`. In the merged file the doc comment is at `:87–91` and the blocks at `:92–94`. I cite `:87–94`.
- **Untracked files.** The dotfiles at the worktree root (`.bashrc`, `.idea`, …) were present before I started. They are not mine, and I did not touch them.

## 5. Merge instructions

- Apply the two `docs/architecture/**` files and this handback.
- No migration, no contract change, no ordering constraint.
- No conflict is expected: no other task writes `docs/architecture/**` (D-004).

## 6. End time

`date -u` at the end: Mon Oct 19 06:21:15 UTC 2026 (about 10 minutes). The final DG4 historical validation (exit 0) and the Prettier check (exit 0) were re-run just before it. `CLAUDE.local.md`, untracked at the worktree root, is not mine.
