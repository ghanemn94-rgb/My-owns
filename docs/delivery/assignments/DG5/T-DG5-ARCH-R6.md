# Assignment T-DG5-ARCH-R6: the round-3 repair amendments (solution-architect)

## Stage and base

- **Stage:** P5 "Configuration automation and outputs", gate DG5, **FIXING** after review round 3 (D-174).
- **Working tree:** a separate git worktree prepared by the orchestrator. It is your `--cwd`, on branch `dg5/arch-r6`, at the integrated `HEAD`. All three wave-Y repairs are merged there:
  - T-DG5-BE-Y1 (F-DG5-123);
  - T-DG5-BE-Y2 (F-DG5-102 and F-DG5-145);
  - T-DG5-FE-Y1 (F-DG5-144).
- **Preceding gate:** run `node tools/gates/validate.mjs --historical --stage DG4` first, and report the result. It must exit 0.
- **Concurrency (D-004):** no other task runs. You write only `docs/architecture/**`.
- **Time:** about 45 minutes. Run `date -u` at the start and at the end.

## Task

Read D-174 in `docs/delivery/decisions.md`. Then read the merged code, and §5 "ADR and data-dictionary statements made untrue or incomplete (for T-DG5-ARCH-R6)" of each handback:
- `docs/delivery/handbacks/DG5/T-DG5-BE-Y1-backend-workflow-engineer.md`;
- `docs/delivery/handbacks/DG5/T-DG5-BE-Y2-backend-workflow-engineer.md`;
- `docs/delivery/handbacks/DG5/T-DG5-FE-Y1-frontend-ux-engineer.md`.

Amend each of the following as a **dated amendment** (T-DG5-ARCH-R6), with `file:line` evidence from the merged tree:

1. **ADR-0050 (F-DG5-123, BE-Y1):**
   - **D11 (§4, the approved portfolio).** Add the 2026-06-03 06:00–06:20 steps BE-Y1 lists, with who wrote each, the permission, and one audit event per write:
     - the 2 capability changes (TL, `tom.edit`);
     - the 9 key deliverables of INI-01..03 (TL, `initiative.edit`; owner WL, pending, due on approved milestone dates);
     - the 12 trace links: 9 `deliverable_capability` and 3 `capability_kpi` (TL, `traceability.link`; no allocation share).
     Extend the "Determinism" bullet with the id blocks `0x079`–`0x07b`.
   - **The line references into `packages/db/src/demo/data/roaming-portfolio.ts`** in D11 and D12, which shifted by about 210 lines. Correct each one that BE-Y1 lists, and check it against the merged file.
   - **§7 / D7.** G3's evidence is unchanged. The dataset now holds 3 capabilities.
   - **The three chains (§4).** Each B0147 line still has exactly five nodes. Each initiative now also reaches its KPI through deliverable → capability change → KPI (M0097). The demo's orphan report holds one entry, the fourth diagnosed issue; BE-Y1 discloses this.
2. **The data dictionary** (`docs/architecture/data-dictionary.md`, "Demo dataset: the approved portfolio behind G4"):
   - add `capability` ×2, `deliverable` ×9 and `trace_link` ×12 to the rows the demo writes, with the facts BE-Y1 lists;
   - correct its stale `roaming-portfolio.ts` line references.
3. **ADR-0002 enforcement (BE-Y2; optional completeness).** If ADR-0002 or a later amendment describes how the boundary test enforces the rules, add that:
   - the full-tree walk has its own 150 s budget (D-174);
   - rule 4 takes `ts.transpileModule`'s diagnostics without printing its output, and a guard test pins this equivalence.
   If no ADR text describes the enforcement mechanism, record that in the handback and write nothing.
4. **FE-Y1** names no ADR or data-dictionary statement. Confirm this by your own search (the Diagnose layout, the 409 conflict banner layout, reflow), and record the result.

## Rules

- Write only `docs/architecture/**`.
- State only what the merged code and the decisions show.
- G1–G6 stay separate from DG0–DG7. Never call the playbook or the product an official PMI standard.

## Acceptance (real output in the handback)

1. `git ls-files -co --exclude-standard -z -- docs/architecture | xargs -0 npx prettier --check --ignore-unknown` exits 0.
2. `node tools/gates/validate.mjs --historical --stage DG4` exits 0, at the start and at the end.
3. A table: item → amendment → evidence (`file:line`).

## Handback

Write `docs/delivery/handbacks/DG5/T-DG5-ARCH-R6-solution-architect.md`, and leave your changes **uncommitted** for the orchestrator to integrate.
