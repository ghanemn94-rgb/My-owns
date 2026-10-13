# Handback T-DG5-ARCH-00 (solution-architect): P5 architecture plan

- **Invocation reference:** `{"kind":"claude-code-cli-session","run_id":"DG5-T-DG5-ARCH-00-solution-architect-20261013T214134Z-0ab9ae3d","session_id":"0ab9ae3d-c83a-40b3-b88d-2771d2515046"}`
- **Assignment:** `docs/delivery/assignments/DG5/T-DG5-ARCH-00.md`; its SHA-256 was checked at the start and matched `30f79918fc10bec92b07d4d245227219ef9613df19be7745d31ecb361b59aa57`.
- **Base:** `HEAD` = `5b82f70235f3d900f1fa9e07fb9c9628a0890a3a` on `claude/mobily-transformation-platform-regate`.
- **Time:** started at `date -u` = Tue Oct 13 21:46:06 UTC 2026. The end time is in §3 (check 4).

## 1. Changed files

| File                                                                   | Purpose                                                                                                                                                       |
| ---------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `docs/architecture/p5-plan.md` (new)                                   | The P5 plan: inventory (78 → 11 slices), dependencies and critical path, 26 DG1–DG4 seams, 6 ARCH tasks, 40 implementer/QA tasks in 14 waves, risks and questions. |
| `docs/delivery/handbacks/DG5/T-DG5-ARCH-00-evidence/check-inventory.py` (new) | Checks §1.2 against the register: 78 DG5 ids, each mapped exactly once, and the §1.3 counts match.                                                              |
| `docs/delivery/handbacks/DG5/T-DG5-ARCH-00-solution-architect.md` (new) | This handback.                                                                                                                                                |

I wrote no ADR bodies, migrations, contract operations or code, as the assignment says.

## 2. Plan summary (the deliverable, per section)

1. **Inventory (§1).** There are 11 slices:

   | Slice | Scope                                      | Rows |
   | ----- | ------------------------------------------ | ---- |
   | A     | Studio versioning, publish and migration   | 10   |
   | B     | Forms and the form framework               | 5    |
   | C     | Procedures                                 | 5    |
   | D     | Rule engine and operations                 | 7    |
   | E     | Starter automations, routes and policies   | 6    |
   | F     | Reports, snapshots and exports             | 9    |
   | G     | KPI and formula changes, NPV               | 3    |
   | H     | Launch plan and health check               | 9    |
   | I     | Reader, provenance, navigation, branding   | 10   |
   | J     | Demo                                       | 7    |
   | K     | Acceptance and evidence                    | 7    |
   | Total |                                            | 78   |

   Each requirement has a one-line reason.

2. **Dependencies (§2).**
   - Critical path: A → B → C → D → E → J → K.
   - Port coupling keeps the module graph acyclic: `ConfigResolver` in `methodology`, and `AutomationActionRegistry` wired in `server.ts`.

3. **Seams (§3).** There are 26 rows, each classified as additive or as a reopen candidate. The reopen candidates are:
   - widening the single-version catalogue keys (not recommended);
   - the conditional-approval default (Q2);
   - disabling DG4-guaranteed starters (Q3);
   - replacing the DG3 function `p3_instantiate_transformation` for the PB-093 default weights (Q12).

   There are also two documented text changes:
   - the "planned" UI texts (F-DG4-160);
   - the DG1 branding code comment.

4. **ARCH tasks (§4).**

   | Task    | ADRs          | Migrations | Lock classes  |
   | ------- | ------------- | ---------- | ------------- |
   | ARCH-01 | ADR-0039/0040 | 0062–0067  | 730250–730253 |
   | ARCH-02 | ADR-0041/0042 | 0068–0073  | 730254–730257 |
   | ARCH-03 | ADR-0043/0044 | 0074–0079  | 730258–730262 |
   | ARCH-04 | ADR-0045/0046 | 0080–0084  | 730263–730265 |
   | ARCH-05 | ADR-0047/0048 | 0085–0088  | 730266–730269 |
   | ARCH-06 | ADR-0049/0050 | 0089–0093  | 730270–730272 |

   - `0094`–`0099` are held for orchestrator repairs.
   - The six tasks add about 188 operations in total, so the contract grows to about 840 operations, version 1.4.0-p5.

5. **Waves (§5).**
   - There are 35 implementer tasks:
     - backend-workflow: BE-A…BE-T (20);
     - kpi-benefits: KBE-A…KBE-H (8);
     - frontend-ux: FE-A…FE-G (7).
   - There are 5 QA tasks (QA-A…QA-E) and the analyst run AN-P5.
   - They run in 14 waves of at most 4 concurrent runs.
   - The shared files that need orchestrator merges are listed in §5.3.

6. **Questions and risks (§6).**
   - There are 12 questions. Each quotes its source and gives a recommendation.
   - There are 8 risks. R1 enumerates exactly which DG5 rows cite A-tests that complete after DG5; I counted them from the register.

## 3. Checks actually run

The environment for every check: Node 24.21.0 at `/opt/nvm/versions/node/v24.21.0/bin`, offline, in the run sandbox, working directory `/home/user/My-owns`.

1. `node tools/gates/validate.mjs --historical --stage DG4`, run before any writing: printed `PASS gate DG4 (historical)`, **exit 0**. I re-ran it at the end; the result is below.
2. `python3 docs/delivery/handbacks/DG5/T-DG5-ARCH-00-evidence/check-inventory.py`: **exit 0**. Output tail:

   ```text
   A 10
   B 5
   C 5
   D 7
   E 6
   F 9
   G 3
   H 9
   I 10
   J 7
   K 7
   total 78 register 78 duplicates [] missing [] extra []
   check table matches
   PASS
   ```

3. `git ls-files -co --exclude-standard -z | xargs -0 npx prettier --check --ignore-unknown`: the result is below.
4. End-of-run checks: below.

### End-of-run results

- **Check 3 (prettier acceptance command):** **exit 0** (`PRETTIER_EXIT=0`). Every batch that `xargs` ran printed "All matched files use Prettier code style!". The `npm warn Unknown project config …` lines are npm config warnings, not failures. I had first formatted `p5-plan.md` and this handback with `npx prettier --write` (exit 0).
- **Check 1 re-run (`node tools/gates/validate.mjs --historical --stage DG4`):** printed `PASS gate DG4 (historical)`, `VALIDATE_EXIT=0`.
- **End time:** `date -u` = Tue Oct 13 22:00:37 UTC 2026. Time used: about 15 minutes, well inside the 2-hour limit.
- No command in this task exited non-zero. Two runs went over the 120 s foreground limit and moved to the background, where both finished with exit 0.

After these runs I edited this handback once more, to fill in this section. I then ran `npx prettier --check --ignore-unknown` on my three files: **exit 0**. This sentence was added after that check.

## 4. Known gaps / not done

- **Not verified, by design (plan only):** none of the ADR, migration or operation estimates has been built or tested. The operation counts are estimates.
- **Export libraries (Q8) are a provisioning dependency.** No PDF/DOCX/XLSX/PPTX library is installed, and the runs are offline. `node_modules` holds Playwright 1.56.1 among the candidates; I did not search the pnpm store. Until the orchestrator or the user provisions packages, ARCH-04's licence evidence and BE-M/BE-N's work are BLOCKED.
- **Decisions needed before or during the ARCH tasks:**
  - Q1 (catalogue versioning model) before ARCH-01;
  - Q2 and Q3 before ARCH-03;
  - Q4 (the meaning of "creates" for catalogue entities) before ARCH-01/02;
  - Q5 (which text is verbatim) and Q6 (day numbering) before ARCH-05;
  - Q7 (demo database and compose profile, devops) before ARCH-06;
  - Q9 to Q12 as listed.
- **Pre-existing untracked files.** At the start, `git status` showed untracked files I did not create: top-level dotfiles (`.bashrc`, `.mcp.json`, `.vscode`, `.idea`, …), `CLAUDE.local.md` and `docs/delivery/runs/DG5/`. I left them untouched. The prettier acceptance command also covers untracked files, so its result depends on them (see §3).

## 5. Merge instructions

- There are no migrations, no code and no contract changes; this is documentation only.
- Merge `docs/architecture/p5-plan.md` and the handback directory as they are.
- Next: run T-DG5-ARCH-01 alone (W1). Its assignment should carry the orchestrator's answers to Q1, Q4 and Q12.
