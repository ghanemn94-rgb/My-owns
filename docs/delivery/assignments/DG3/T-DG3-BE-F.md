# Assignment T-DG3-BE-F: G4 treats an Unknown schedule as a blocking item (backend-workflow-engineer)

## Stage and working tree

- **Stage:** P3 "Mobilization and portfolio" / gate DG3 (BUILDING).
- **Working tree:** a separate git worktree prepared by the orchestrator. It is your current working directory (`--cwd`), on branch `dg3/be-f`, at the integrated `HEAD`. Every P3 task through wave 5 is merged and verified there: BE-A…BE-E, KBE-A…KBE-C, ARCH-01…04 and FE-A0…FE-E. `node_modules` is installed and the packages are built. Work only in this tree.
- **Concurrency (D-004):** FE-D (e2e journeys under `apps/web/e2e/p3-journeys.spec.ts`) and the transformation-analyst (`docs/delivery/requirements.csv`) run alongside you in their own worktrees. Don't touch their files.
- **Preceding gate:** run `node tools/gates/validate.mjs --historical --stage DG2` first and report the result; it must exit 0.
- **Time:** a small task. Aim for about 30–40 minutes; the hard limit is about 2 hours. Run `date -u` at the start and at the end.
- **Environment:**
  - Node 24.21.0 is at `/opt/nvm/versions/node/v24.21.0/bin`. Run offline.
  - **Your harness ports are 23450–23499 only.**
  - Remove any empty `.claude/.cc-writes` directories inside source folders before you run tests.

## The decision (orchestrator, recorded in D-079 at the freeze)

ARCH-04 left this decision to the orchestrator (`docs/delivery/handbacks/DG3/T-DG3-ARCH-04-solution-architect.md` §4).

**The current behaviour.** `g4.roadmap` lists only *known* late predecessors without a mitigation (`g4.schedule_conflict`). A dependency into an in-scope initiative whose schedule is **Unknown** (`schedule.unknown`) does not block G4. That contradicts the project rule "missing or stale data shows Unknown, never green or 'no conflict'" (CLAUDE.md, ADR-0021 §10 rule 6). It also contradicts how BE-E already treats Unknown capacity, which counts as a G4 conflict.

**The decision.** An unresolved dependency into an in-scope initiative whose schedule flag is `schedule.unknown`, and which has a blank `mitigation`, is a G4 missing item:

- code `g4.schedule_unknown`;
- English label 'Schedule unknown: {dependency code}';
- pointer `/dependencies/{id}`.

It is cleared, like `g4.schedule_conflict`, by recording a mitigation on the dependency, or by resolving the unknown dates.

## Scope

1. **The evaluator.** In `apps/api/src/modules/workflows/g4.ts`, add `g4.schedule_unknown` to the `g4.roadmap` evaluator. Use `portfolio/gate-facts.ts` if it needs to supply the flag. Reuse BE-C's `schedule.ts` facts; do not re-implement the schedule rule.
2. **Tests.**
   - A unit test in `workflows/g4.test.ts`.
   - An integration test in `test/integration/gates/g4.test.ts`: a G4 submission is refused, listing 'Schedule unknown: DEP-nn'. After a mitigation is recorded on the dependency, that item is gone.
   - Keep every existing G4 test green. Update the end-to-end G4 test only if its data now hits the new item; prefer giving it complete dates.
3. **The web label.** Add `g4__schedule_unknown` to `apps/web/src/i18n/{en,ar}/gates.json`, next to `g4__schedule_conflict`: EN 'Schedule unknown', AR 'الجدول الزمني غير معروف' (provisional). If FE-A's G4 view needs a code list to render it, add the code there with minimal lines. That is the only web change.
4. **The record.** Update ADR-0021 §7 (the `g4.roadmap` row) and §11 item 3 to state the new item. Add one line to `docs/architecture/p3-work-split.md` §9.
5. **ADR-0023 §1 correction (FE-E handback §4.1).** ADR-0023 §1 lists "`label_en/ar` overrides" among the editable wave columns. But `0020` has no such columns, and the contract (`RoadmapWaveUpdate`) and the API (`waves.ts`) accept only `plannedStart`, `plannedEnd`, `ownerUserId`, `notes` and `status`.
   - Amend the ADR text to the built model: the verbatim source text is the label; a team-added non-source wave carries its own name; there are no label overrides in P3.
   - Do not add columns.

## Rules (binding)

The work split §2 shared rules and ADR-0021 §10 apply. No route, contract or migration change is expected; if you find you need one, stop and say why in the handback.

## Acceptance (real output in the handback)

1. These all exit 0:
   - `pnpm -r typecheck`
   - `pnpm -r build`
   - `pnpm lint`
   - `pnpm openapi:lint`
   - `git ls-files -co --exclude-standard -z | xargs -0 npx prettier --check --ignore-unknown`
2. `pnpm test` passes with the locale unset and with `C.UTF-8`.
3. `QA_PG_PORT=<23450-23499> MTH_PORT_POOL=<the rest> tests/qa/support/with-pg.sh pnpm test:integration` passes. Report the counts.
4. `node tools/gates/validate.mjs --historical --stage DG2` exits 0.

## Evidence honesty

Report every command with its real exit code. Disclose and explain every non-zero exit, failed suite or hook timeout in the logs you cite. Never report a check as passed that did not run.

## Handback

Write `docs/delivery/handbacks/DG3/T-DG3-BE-F-backend-workflow-engineer.md`, with logs under `docs/delivery/handbacks/DG3/T-DG3-BE-F-evidence/`. Include:
- the files changed;
- the behaviour, quoting the item text;
- the checks with exit codes.
