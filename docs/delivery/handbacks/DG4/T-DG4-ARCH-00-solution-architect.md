# Handback T-DG4-ARCH-00 (solution-architect): P4 architecture plan

- **Stage:** DG4 (P4 "Execution value and sustainment"), BUILDING. **Base:** `015728e` on `claude/mobily-transformation-platform-regate` (`git rev-parse HEAD` at start).
- **Invocation reference:** `{"kind":"claude-code-cli-session","run_id":"DG4-T-DG4-ARCH-00-solution-architect-20261009T004526Z-8a69dff6","session_id":"8a69dff6-cc09-4bf1-883b-98aa01fa524d"}`.
- **Assignment:** `docs/delivery/assignments/DG4/T-DG4-ARCH-00.md`, SHA-256 `b866bb6a…19c9b3` (verified with `sha256sum` before reading).
- **Time:** started 2026-10-09T00:48:05Z (`date -u`), checks ended 2026-10-09T01:01:12Z, about 13 minutes in total (§3a). Well inside the 2-hour bound; nothing was cut for time.
- **Engineering only.** This plan grants no business, Finance or IT approval. Product G1–G6 and engineering DG0–DG7 stay separate; product G6 never implies DG7.

## 1. Changed files

| File | Purpose |
|---|---|
| `docs/architecture/p4-plan.md` (new) | The deliverable: inventory (137 rows → 12 slices, with check table), dependency graph and critical path, the 22 DG1–DG3 seams with additive/reopen classification, 8 architecture tasks (ADR-0025…0038, migrations 0028–0057, lock classes 730224–730249, ≈ 273 operations), 30 implementer tasks in 11 waves with file ownership and shared-file merge rules, open questions and risks. |
| `docs/delivery/handbacks/DG4/T-DG4-ARCH-00-evidence/check-inventory.py` (new) | Mechanical check of the acceptance criterion: §1.2 ids = register DG4 ids, no duplicates, one known slice each, §1.3 counts match, total 137, and every non-L row listed exactly once in its own slice's §4 task row. |
| `docs/delivery/handbacks/DG4/T-DG4-ARCH-00-evidence/check-inventory.out` (new) | Output of that check on the final plan. |
| `docs/delivery/handbacks/DG4/T-DG4-ARCH-00-solution-architect.md` (new) | This handback. |

No ADR, migration, contract, source or test file was changed (the assignment asks for the plan only).

## 2. Summary of the plan (what each requirement gets)

Every one of the 137 DG4 requirements is mapped to exactly one slice in `p4-plan.md` §1.2, each with a one-line reason. Per slice:

| Slice | Rows |
|---|---|
| A KPI engine | 16 |
| B Benefits and Finance validation | 24 |
| C Decision rights, RACI, approvals, delegation | 15 |
| D Forums, meetings, T16, escalation | 10 |
| E RAID, actions, corrective actions, execution tracking | 8 |
| F Adoption | 8 |
| G Sustainment, BAU, CI, status model and closure | 11 |
| H Phases, G5/G6, exceptions, change control | 18 |
| I Foundation: calendar, time, jobs, tasks, inbox | 4 |
| J Dashboards and workspaces | 9 |
| K Traceability and modular entry | 6 |
| L Acceptance tests and P4 evidence | 8 |
| **Total** | **137** |

Changes to the suggested slicing, with reasons (plan §1.1): governance split into C (decision rights/approvals), D (forums/T16) and E (RAID/actions, the master prompt's "Risks and Actions" area, M0108), because together they hold 33 rows; adoption (F) separated from BAU/closure (G); the scheduler slice (I) became a foundation slice, and each starter automation is mapped to the slice that owns its domain rule.

- **Critical path:** I → A → B → G → H → J → L. In waves: ARCH-01 → BE-A → KBE-A → KBE-B → KBE-C → KBE-E → BE-J → KBE-G → FE-G.
- **Architecture tasks:** ARCH-01 (I + C), ARCH-02 (A), ARCH-03 (B), ARCH-04 (E), ARCH-05 (D), ARCH-06 (F + G), ARCH-07 (H), ARCH-08 (J + K). They run sequentially because they share the contract, ERD, dictionary, schema and permission files, and each one overlaps with implementer waves (W1–W8).
- **Implementers:** BE-A…BE-M, KBE-A…KBE-G, FE-A…FE-G, QA-A…QA-C, plus AN-P4, in 11 waves of at most 4 concurrent runs. ARCH runs are counted as one of the 4.

### Seams that need an orchestrator decision (plan §3, §6)

The plan classifies 22 seams. These are the **reopen candidates** (a DG1–DG3-approved behaviour, guard, contract or text would change):

1. **§3 row 3 / Q2:** gate-submission exceptions (S04-012) need the DG2 CHECK `gate_submission_criterion_mandatory_complete` (`0017`) to allow "covered by an accepted unexpired waiver", and the `gate_dispensation` gate list (`0020`) to be widened.
2. **§3 row 6 / Q1:** making the KPI aggregation rule required on create (S07-001) would break the DG2 `createKpiDefinition` contract. The plan recommends requiring it at activation instead.
3. **§3 row 9 / Q3:** letting the P3 approvals accept delegation (S10-010) reverses the DG3 "decided in person" rule (ADR-0021 §6).
4. **§3 row 15:** the DG1 closure-refusal text "…which is not available in this release." becomes untrue once closure exists, so it must change.
5. **§3 rows 5 and 7 (conditional):** they become reopens only if the formula engine source or the trajectory jsonb has to change. The plan recommends the additive forms.

**Documentation defect found (R1).** ADR-0015 §2 (DG2-approved) says the gate engine writes `gate.submitted` and `gate.decided` outbox events. As built, it writes none. `enqueueOutboxEvent` has one caller, in `transformations/routes.ts`, and no migration inserts into `outbox_event`. P4 needs those events (S12-009/010), so ARCH-07 adds them along with a correction note. The orchestrator should decide how the ADR-0015 correction is recorded.

## 3. Checks actually run

Environment: Linux sandbox, Node 24.21.0 (`/opt/nvm/versions/node/v24.21.0/bin`), offline, run from `/home/user/My-owns`.

| # | Command | Exit | Result |
|---|---|---|---|
| 1 | `date -u` (start) | 0 | `Fri Oct  9 00:48:05 UTC 2026` |
| 2 | `node tools/gates/validate.mjs --historical --stage DG3` | **0** | `PASS gate DG3 (historical)` |
| 3 | `sha256sum docs/delivery/assignments/DG4/T-DG4-ARCH-00.md` | 0 | `b866bb6a5e502aeb8b5d5a042c99929dd2f22516a385144da806f86a8019c9b3`, which matches the assignment reference |
| 4 | `python3 -I docs/delivery/handbacks/DG4/T-DG4-ARCH-00-evidence/check-inventory.py` | first run **1**, final **0** | The first run failed because of a bug in the script itself: the range notation `S07-001…013` was counted twice. The regex was fixed, and the plan was not changed for it. Final output (`check-inventory.out`): per-slice counts as in §2; `total: 137 (register DG4 rows: 137); §4 covers 129 non-L rows of 129`; `PASS`. |
| 5 | `npx prettier --write docs/architecture/p4-plan.md` | 0 | Formatted. npm printed three "Unknown project config" warnings (`strict-peer-dependencies`, `auto-install-peers`, `link-workspace-packages`), which are not errors. |
| 6 | `git ls-files -co --exclude-standard -z \| xargs -0 npx prettier --check --ignore-unknown` | see §3a | see §3a |
| 7 | `node tools/gates/validate.mjs --historical --stage DG3` (end) | see §3a | see §3a |
| 8 | `date -u` (end) | see §3a | see §3a |

### 3a. Final checks

These checks ran after the plan and this handback were complete. Only the text of this §3a and the time line in the header were edited afterwards: plain Markdown, re-checked by row 6b.

| # | Command | Exit | Result |
|---|---|---|---|
| 6 | `git ls-files -co --exclude-standard -z \| xargs -0 npx prettier --check --ignore-unknown` | **0** | Prettier printed "All matched files use Prettier code style!" for each of the 8 xargs batches, and 0 `[warn]`/`[error]` lines. The sweep includes the pre-existing untracked dotfiles. |
| 7 | `node tools/gates/validate.mjs --historical --stage DG3` | **0** | `PASS gate DG3 (historical)` |
| 4b | `python3 -I …/check-inventory.py` (re-run on the formatted plan) | **0** | `PASS` |
| 8 | `date -u` (end) | 0 | `Fri Oct  9 01:01:12 UTC 2026`, about 13 minutes after the start |
| 6b | `npx prettier --check docs/delivery/handbacks/DG4/T-DG4-ARCH-00-solution-architect.md` after this edit | see the final message of the run | Run after this edit. Its exit code is reported in the run's final message, not here, because this file cannot record a result that comes after its own last edit. |

`git status --short` at the end shows, besides the pre-existing untracked dotfiles, `.zshrc` and `CLAUDE.local.md` (also not mine), `docs/architecture/p4-plan.md`, `docs/delivery/handbacks/DG4/` (mine), and `docs/delivery/runs/DG4/` (the runner's).

## 4. Known gaps and what is not done

- **By design (assignment scope):** no ADR bodies, migrations, contract operations, permission rows, ERD or dictionary changes, and no `p4-work-split.md`. Each architecture task in plan §4 produces these.
- **Estimates only:** the operation counts (≈ 273) and the per-task sizes are planning estimates, not contract counts.
- **Not verified in this run:** whether any DG2/DG3 guard refuses writes on a `closed` transformation (plan R2). ARCH-06 must check this.
- **Proposed only:** the permission names in plan §3 row 8 are examples. ARCH tasks fix the real names.
- **Open questions Q1–Q10 (plan §6):** each needs an orchestrator or user decision. Q1, Q2 and Q3 are reopen decisions. The plan states a recommendation for each but decides none of them.
- **Untracked files in the working tree that are not mine:** at the start, `git status` already listed `.bash_profile`, `.bashrc`, `.gitconfig`, `.gitmodules`, `.idea`, `.mcp.json`, `.profile`, `.ripgreprc`, `.vscode` and `.zprofile`. I did not create or edit any of them, and the prettier sweep in check 6 includes them (§3a).

## 5. Merge instructions

- There are no migrations, contract changes or code changes, so nothing needs to run.
- This change adds four new files and causes no conflicts.
- `docs/architecture/README.md` has no row for `p4-plan.md`, because the assignment named only the plan and this handback. The orchestrator may add an index row when merging.
- Next step: run `T-DG4-ARCH-01` (I + C), after the decisions on Q1–Q3 and R1 that affect it. Q3 (delegation) affects ARCH-01 directly. Q1 affects ARCH-02, and Q2 and R1 affect ARCH-07.
