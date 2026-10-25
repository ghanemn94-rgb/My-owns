# Assignment T-DG5-ARCH-RG1: the wave-RG1 amendments (solution-architect)

## Stage and base

- **Stage:** P5 "Configuration automation and outputs", gate DG5, **FIXING** after clean re-gate review round 1 (D-184, D-185).
- **Working tree:** a separate git worktree prepared by the orchestrator. It is your `--cwd`, on branch `dg5/arch-rg1`, at the integrated `HEAD`, where both wave-RG1 repairs are merged: T-DG5-FE-RG1 (F-DG5-120, 122, 140, 141) and T-DG5-BE-RG1 (F-DG5-100, 101, 121, 142).
- **Preceding gate:** run `node tools/gates/validate.mjs --historical --stage DG4` first, and report the result. It must exit 0.
- **Concurrency (D-004):** no other task runs. You write only `docs/architecture/**`.
- **Time:** about 45 minutes. Run `date -u` at the start and at the end.

## Task

Amend the architecture documents so that every statement is true for the code after repair wave RG1 (D-185; merges `5474a66` FE-RG1 and `1e6a545` BE-RG1). Read both handbacks first: `docs/delivery/handbacks/DG5/T-DG5-BE-RG1-backend-workflow-engineer.md` §5 and `docs/delivery/handbacks/DG5/T-DG5-FE-RG1-frontend-ux-engineer.md` §5. Verify each claim against the code yourself; do not copy it blindly.

- **ADR-0003 §Migrations:** the runner also refuses a pending file whose id is not above the highest applied id (F-DG5-100).
- **p5-work-split shared rule 16:** the eight P5 gaps (0066, 0067, 0073, 0077, 0078, 0079, 0083, 0084) are retired, never filled; a new id is above the highest shipped id. Note that `p4-work-split.md`'s "fill unused numbers" note is superseded for P5.
- **ADR-0007 / readiness:** `migrations: fail` also covers an out-of-order pending migration.
- **ADR-0046 §4 and its implementation notes:** long negative decimals are unprefixed; correct the `csv.ts` line reference and the mechanism description.
- **ADR-0050 §4/§5 and the data dictionary:** the roaming dataset's launch plan includes its Day-90 test; `day_ninety_test` is also written by the demo seed (synthetic).
- **ADR-0044 §7:** name the screens that now show the dependency-slip impact (Dependencies "Critical dependency slips", the initiative page, the work-item text from `messageParams`).
- **ADR-0049 §1:** rendering of table blocks (previews show cells as text; a one-cell table renders as a wrapping callout); storage stays verbatim.
- **ADR-0042 §4:** My procedures offers launch only with `procedure.launch` (a UI hint; the server check is unchanged).

Write each change as a dated amendment (2026-10-23, D-185), in the style of the existing amendments. Change no code, no contract, no test.

## Rules

- Write only `docs/architecture/**`.
- State only what the merged code and the decisions show.
- G1–G6 stay separate from DG0–DG7. Never call the playbook or the product an official PMI standard.

## Acceptance (real output in the handback)

1. `git ls-files -co --exclude-standard -z -- docs/architecture | xargs -0 npx prettier --check --ignore-unknown` exits 0.
2. `node tools/gates/validate.mjs --historical --stage DG4` exits 0, at the start and at the end.
3. A table: item → amendment → evidence (`file:line`).

## Handback

Write `docs/delivery/handbacks/DG5/T-DG5-ARCH-RG1-solution-architect.md`, and leave your changes **uncommitted** for the orchestrator to integrate.
