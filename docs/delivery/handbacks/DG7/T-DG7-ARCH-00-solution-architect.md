# Handback: T-DG7-ARCH-00 (solution-architect): P7 architecture plan

- **Stage:** P7 "Independent transfer and release", DG7 (BUILDING).
- **Invocation reference:** `{"kind":"claude-code-cli-session","run_id":"DG7-T-DG7-ARCH-00-solution-architect-20261112T120300Z-fc7f0be7","session_id":"fc7f0be7-f94b-40b0-8d50-20e9947fb7a0"}`.
- **Assignment:** `docs/delivery/assignments/DG7/T-DG7-ARCH-00.md`. Its SHA-256 `839b30e4086f6d7e0800d51bdc727eb1e355f3a6f01f9c692faa9d30764dcee3` was verified with `sha256sum` before starting.
- **Base:** `944aaf810a1b790b091f52df9319560ab8232493` on `claude/mobily-transformation-platform-dg6-regate`. At the start, `git status --short` showed only `?? docs/delivery/runs/DG7/` (this run's own record).
- **Time:** `date -u` gave `Thu Nov 12 12:03:17 UTC 2026` at the start and `Thu Nov 12 12:16:16 UTC 2026` before this handback was written. The final reading is in §3. That is well inside the 2-hour limit.

## 1. Changed files

| File                                                                         | Purpose                                                                                                                                                       |
| ---------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `docs/architecture/p7-plan.md` (new)                                         | The P7 plan, in the six sections the assignment orders: inventory (with the check table), dependencies, DG1–DG6 seams, architecture tasks (with the A28 two-step in §4.1), implementer waves, and risks and open questions. |
| `docs/delivery/handbacks/DG7/T-DG7-ARCH-00-evidence/check-inventory.py` (new) | Checks that §1.2 maps exactly the register's 54 DG7 ids, once each, and that the per-slice counts equal the §1.3 table (total 54).                             |
| `docs/delivery/handbacks/DG7/T-DG7-ARCH-00-evidence/check-inventory.log` (new) | The script's output.                                                                                                                                         |
| `docs/delivery/handbacks/DG7/T-DG7-ARCH-00-solution-architect.md` (new)       | This handback.                                                                                                                                               |

No ADR, migration, contract, code, register, `stages.json`, `findings.json`, review or gate record was touched. `docs/architecture/p6-plan.md` is unchanged.

## 2. Behaviour delivered (plan summary)

This task delivers a plan only. No requirement changes status. The plan covers the following:

- **Inventory.** All 54 DG7 requirements are mapped, one slice each, across 13 slices plus N, the DG6 carry-forward. Every row has a P1–P6 status with the evidence I found in the tree: Met 0, Partly 41, New 13.

  | Slice                                                   | Rows |
  | ------------------------------------------------------- | ---- |
  | A Archive and offline build                             | 5    |
  | B Clean deployment, offline runtime and the A18 transfer | 8    |
  | C Data migration                                        | 2    |
  | D Configuration bundle                                  | 1    |
  | E Backup, restore, upgrades and retention               | 4    |
  | F Schema, API and connector handover                    | 3    |
  | G Security evidence and secrets                         | 2    |
  | H Guides                                                | 2    |
  | I Traceability                                          | 3    |
  | J Gate protocol                                         | 16   |
  | K A26/A27 drills and test levels                        | 3    |
  | L Final verification                                    | 2    |
  | M A28 sealing                                           | 3    |
  | **Total**                                               | **54** |

  Notable findings from reading the tree:
  - REQ-S02-003 (in-app register) and REQ-S19-008 (configuration transfer) list P5 increments, but nothing was delivered in P5.
  - `/readyz` does not report storage or worker status.
  - No repository secret scan, data-dictionary coverage check, backup or restore tooling, retention, migration manifest or sealing tool exists.
  - The validator does not check run concurrency, assignment elements, handback sections or progress-update elements.
- **Dependencies.** The critical path is ARCH-02 → BE-A → BE-C (export) → BE-D (import) → BE-E (evidence bytes) → DOC-B → DO-D (transfer drill) → DO-E → QA-C → freeze → DG7 → sealing.
- **Seams.** Seventeen seams are named. These are reopen candidates:
  - readiness gating (DG1);
  - verbatim audit-history import (DG1/ADR-0004);
  - the first purge class of retention (ADR-0003);
  - a purge touching snapshot or total sources (DG4/DG5).

  Everything else is additive. Configuration-bundle imports land as drafts through the existing ADR-0039/0040 publish pipeline, so running transformations keep their pins.
- **Architecture tasks.** ARCH-01 to ARCH-06 use ADR-0062 to ADR-0073, with ADR-0074 reserved, and these ranges:
  - migrations `0131`–`0157` in disjoint ranges, with `0158`–`0163` held by the orchestrator;
  - lock blocks 730400–730421, with 730428–730439 held by the orchestrator;
  - about 30–34 new operations, taking the contract to about 962–966 (`1.6.0-p7`).

  No new runtime dependency is expected.
- **A28 two-step (§4.1).** The seal and verify tools are built and reviewed inside the payload, and rehearsed on a scratch clone with a synthetic gate record. After approval the orchestrator runs them. Their outputs go to META-excluded `test-evidence/DG7/seal/` and to a git-ignored `dist/release/`, so the payload hash stays equal to the DG7 candidate id. The archive checksum is recorded separately. A sealing failure blocks delivery, and a payload change requires new reviews.
- **Implementer waves.** 25 implementer runs, 4 QA runs, the analyst run and two orchestrator drills, over 12 waves of at most 4 concurrent runs. File ownership does not overlap, and the shared files that need orchestrator merges are listed in §5.3.
- **Open questions.** Q1–Q20 quote the sources. The ones that most need a decision:
  - Q1: container drills cannot run in the agent sandbox, where Docker is unreachable;
  - Q2: the archive's "separate demo-data directory";
  - Q3: retention defaults;
  - Q4: verbatim audit import;
  - Q9: register evidence paths that implementers cannot write;
  - Q19: rows whose acceptance completes only with the DG7 gate or the post-approval seal.

## 3. Checks actually run

| Command                                                                                          | Environment                                                         | Result                                                                                   |
| ------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------- | ---------------------------------------------------------------------------------------- |
| `node tools/gates/validate.mjs --historical --stage DG6` (at start, before writing anything)    | Node 24.21.0 (`/opt/nvm/versions/node/v24.21.0/bin`), agent sandbox, offline | `PASS gate DG6 (historical)`, **exit 0**                                                  |
| `python3 docs/delivery/handbacks/DG7/T-DG7-ARCH-00-evidence/check-inventory.py`                  | same                                                                | first run: PASS, exit 0, but it exposed wrong status totals in my text (38/16), which I corrected to 41/13; re-run: `register DG7 rows: 54; mapped rows: 54; unique: 54`, per-slice sum 54, `PASS`, **exit 0** (log file) |
| Prettier check and final `validate`                                                              | same                                                                | see §3.1 (run after this file was written)                                               |

### 3.1 Final checks

These were run after this handback's first version and after `npx prettier --write` on my four files (exit 0):

- `git ls-files -co --exclude-standard -z | xargs -0 npx prettier --check --ignore-unknown`: **exit 0**.
  - Every xargs batch printed `All matched files use Prettier code style!`.
  - The only other lines were npm warnings about unknown project config keys (`strict-peer-dependencies`, `auto-install-peers`, `link-workspace-packages`).
- `node tools/gates/validate.mjs --historical --stage DG6`: `PASS gate DG6 (historical)`, **exit 0**.
- `check-inventory.py` after the format: `PASS`, exit 0.
- `date -u` at the end: `Thu Nov 12 12:19:50 UTC 2026`. About 17 minutes were used in total.

This edit changes only this handback, which Prettier does not need to re-check for content. No plan file changed after the check.

## 4. Known gaps / not done

- **The assignment contradicts itself on the file name.** The deliverable heading names `docs/architecture/p6-plan.md`, but its acceptance and D-242 name `p7-plan.md`. I wrote `p7-plan.md` and left the approved `p6-plan.md` untouched. The orchestrator should confirm.
- **Plan only, as assigned.** It has no ADR bodies, migrations, contract operations or `p7-work-split.md`. Those belong to ARCH-01 to ARCH-06.
- **Statuses are read from the tree, not by running the suites.** I did not run A01–A22 or the drills. Each "Partly" row's "what exists" names the files I read. QA re-runs them on the DG7 candidate.
- **The operation estimates (≈ 30–34) are estimates.** Each ARCH task pins its own count.
- **Q1–Q20 need decisions** from the orchestrator or the user, especially Q1 and Q19, before the affected tasks start.

## 5. Merge instructions

- Commit `docs/architecture/p7-plan.md` and the handback with its evidence directory. Nothing needs to run: there are no migrations and no contract change.
- Before ARCH-01 starts, the orchestrator decides Q1, Q2, Q7 and Q19, or confirms the recommendations, and records the decision (the D-195 precedent).
- Before ARCH-02, ARCH-03 and ARCH-04 start, it decides Q3, Q4, Q5 and Q6, or confirms the recommendations.
- No conflicts are expected. No shared file was edited.
