# Handback T-DG0-AN-11: the register reflects the D-022 to D-026 delivery controls (F-DG0-232)

- **Role:** transformation-analyst. **Stage:** DG0 (REVIEWING, between round 12 and the round-13 freeze).
- **Invocation:** run `DG0-T-DG0-AN-11-transformation-analyst-20260928T213955Z-e288d74a`, session `e288d74a-9f63-4c8f-8102-bbf566b3c946`.
- **Assignment:** `docs/delivery/assignments/DG0/T-DG0-AN-11.md`, SHA-256 `b7c4f10b…c49cec4bd`, verified before starting.
- **Base:** HEAD `86b0986cd9bcdce58f6ed3614bff829c9122985e` on `claude/mobily-transformation-platform-kwcc4i`. The working tree was clean for tracked files at start.
- **Finding addressed:** F-DG0-232 (qa-verifier, Low, REQ-DLV-007). I don't close it: only a non-author reviewer can verify the fix.

## 1. Changed files

| File | Purpose |
|---|---|
| `docs/analysis/parts/req-dlv-s14-s21.csv` | Rewrote 7 DLV rows: REQ-DLV-003, 006, 007, 008, 013, 023 and 026. Every other line is byte-identical. The edit replaced whole physical lines through a csv writer. |
| `docs/delivery/requirements.csv` | Regenerated with `python3 -I -B tools/source/merge_register.py`, not edited by hand. The diff is the same 7 rows. `docs/analysis/master-prompt-coverage.csv` is unchanged. |
| `docs/delivery/handbacks/DG0/T-DG0-AN-11-transformation-analyst.md` | This handback. |

None of the 7 rows changed class, increments, final gate or status. All are ENGINEERING. REQ-DLV-008 is P0–P7 → DG7, SPECIFIED; the other six are P0 → DG0, IMPLEMENTED.

## 2. Behaviour delivered, per requirement

- **REQ-DLV-007 (required item 1, F-DG0-232).** Procedure, output, automation, screen/API, acceptance, evidence and notes now describe the real controls:
  - **File-tool write guard** (D-009, D-020, D-023, D-024): `MTH_GUARD_ROOT` with fail-closed behaviour, coverage of every worktree, symlink and case-insensitive matching, and only the temp directory as scratch, never home.
  - **OS Bash sandbox** generated per run by `tools/agents/agent_settings.py` (D-025):
    - `enabled`, `failIfUnavailable`, `allowUnsandboxedCommands: false`;
    - the `COMMON_DENY` list, applied in the repository and every worktree;
    - reviewers and the analyst confined to their own areas;
    - `--setting-sources project`.
  - **Validator binding** (D-025, F-DG0-230): the settings file must match `settings_sha256`, the sandbox must be enforced, and the deny list must name the seven protected paths under `meta.cwd`. This applies to the gate's review and audit records.
  - **Runner configuration scan** (D-024, D-025, D-026): its scope, the zero-length stub exemption, `external_config_changed`, exit 71 for reviewer and analyst runs, and a warning for implementer runs.
  - **Removed:** the claim that the orchestrator's git status check is the compensating control. The notes say explicitly that this claim is withdrawn.
  - **Residuals:** the notes cite `docs/delivery/threat-model.md` without extending it. In the model, new untracked files and configuration changes made outside the sandbox are *detected*, not prevented, and self-hashed evidence, the environment operator and prompt injection are out of scope. The notes add three limits that the code itself states:
    - `deny_except` denies existing paths only, so new files can be created on the path to a confined role's area;
    - the validator checks 7 of the deny paths, and only for gate review and audit records;
    - the zero-length stub exemption has no dedicated automated test.
  - **Acceptance now also cites:**
    - the guard tests `F-DG0-134` ×2, `F-DG0-135` and `F-DG0-136` ×2;
    - all 7 `test_agent_settings.py` tests;
    - the validator tests `D-025: …`, `F-DG0-230: …` and `D-024: …`;
    - the runner metadata tests `test_external_config_changes_are_recorded` and `test_no_change_records_an_empty_list`;
    - the current live probe log (`orchestrator-probes/guard-live-20260928T182513Z/probe.log`).
  - **Evidence adds:** `agent_settings.py`, `test_agent_settings.py`, `run-agent.sh`, `run_meta.py`, `test_run_meta.py`, `rules.mjs`, `validator.test.mjs`, `probe-guard-live.sh`, the probe README and log, `threat-model.md` and `decisions.md`.
- **REQ-DLV-006 (agent invocation).**
  - Procedure now covers:
    - per-run settings from `agent_settings.py`, with exit 65 when bubblewrap is missing, and `--setting-sources project` (D-025);
    - prompts, including resume prompts, sent as stream-json and replayed by the CLI (D-022);
    - `python3 -I -B` helpers run from `/` (D-026).
  - Acceptance cites the runner test "F-DG0-140: modules planted in the repository root are never imported by the runner's helpers".
  - Evidence adds `agent_settings.py` and `tools/agents/tests/runner.test.mjs`.
- **REQ-DLV-013 (provenance).**
  - Procedure now covers:
    - CLI-replayed prompt binding with run ID, session ID and assignment path and SHA-256 (D-022);
    - an empty `external_config_changed` list (D-024);
    - sandboxed gate records with the deny list rooted at `meta.cwd` (D-025, F-DG0-230).
  - Acceptance cites the validator tests `D-022: …`, `F-DG0-132: …`, `F-DG0-133: …`, `D-024: …`, `D-025: …` and `F-DG0-230: …`.
  - Evidence adds `agent_settings.py` and `threat-model.md`. The notes cite residual 1 (self-hashed evidence).
- **REQ-DLV-023 (validator, CI, pre-freeze).**
  - **Procedure:** the CI bubblewrap and AppArmor step, and `prefreeze.sh` running every candidate-executing check through `tools/gates/sandbox-run.sh` on a fresh clone of the committed HEAD before proving that the working tree equals HEAD (D-026).
  - **Acceptance** cites all 4 `sandbox.test.mjs` titles. It now says CI also runs `--reconcile`, and that unittest discovery covers `agent_settings.py`.
  - **Evidence** adds `sandbox-run.sh`, `sandbox.test.mjs`, `test_agent_settings.py` and `environment.md`.
  - **Also repaired:** the part-file notes cell. At HEAD it was unquoted and spilled into 21 cells, so `merge_register.py` failed with "record 24 has a cell count different from the header". I confirmed this in a clean clone. The committed register had been edited to a shorter note without the part file being fixed. The stale AN-10 "known defect" text (the `node --test` directory arguments) was replaced: the prefreeze glob fix resolved it.
- **REQ-DLV-026 (run evidence).**
  - The procedure now also names:
    - `settings.json` as run evidence, with `settings_sha256` and `bash_sandbox` (D-025);
    - `external_config_changed`, and the exit-71 refusal to auto-commit (D-024);
    - the hook-free auto-commit that checks it committed exactly the run directory plus the tool-authored files (F-DG0-138).
  - Acceptance adds the two `external_config` runner metadata tests. Evidence adds `agent_settings.py`.
- **REQ-DLV-003 (environment record).** Note only: `environment.md` records bubblewrap and socat, the sandboxed orchestrator checks, and the CI step, which is still unverified.
- **REQ-DLV-008 (worktrees, still SPECIFIED).** Note only: the guard (D-023) and the sandbox (D-025) cover worktrees. Agents can't run `git worktree add` because `.git` is denied, so the orchestrator creates worktrees outside the sandbox.

Reviewed and left unchanged, because nothing in them is made stale by D-022 to D-026:
- REQ-DLV-004 (agent definitions and load probes);
- REQ-DLV-016 (gate pass conditions; the sandbox binding is cited in REQ-DLV-013);
- REQ-DLV-019 and REQ-DLV-029 (delivery records, checkpoint).

The finding's reproduction now fails as intended:
- `grep -c 'agent_settings\|D-025' docs/delivery/requirements.csv` → `7` (was 0);
- `grep -c 'checks git status after each run\|git status check is the compensating' docs/delivery/requirements.csv` → `0`.

## 3. Checks actually run

Environment: my own sandboxed shell (bubblewrap, no network) in the working tree at `/home/user/My-owns`, with the changes above uncommitted, on 2026-09-28.

```
$ python3 -I -B tools/source/merge_register.py
merged 411 requirements {'PB': 93, 'DLV': 41, 'S01': 6, ... 'S21': 4}; 423 master-prompt coverage rows      (exit 0)

$ node tools/gates/validate.mjs --register DG0
PASS register rules at DG0                                                                               exit=0

$ python3 -I -B docs/analysis/tools/check_counts.py
MATCH Requirements with an increment in P7 that complete later (0):** none
STAGE-PLAN LISTS ALL MATCH
README COUNTS ALL MATCH                                                                                  exit=0

$ python3 -I -B docs/analysis/tools/check_pb_provenance.py
checked 93 REQ-PB rows; 0 problem(s); 10 reviewed R5 false positive(s) accepted                          exit=0

$ python3 -I -B docs/analysis/tools/check_test_refs.py
81 declared test titles derived from 6 test files; 72 quoted test title citation(s) in 411 register rows; 0 problem(s)   exit=0

$ node --test tools/gates/tests/validator.test.mjs
1..44
# tests 44
# pass 44
# fail 0
# skipped 0                                                                                              exit=0
```

My first `check_test_refs.py` run reported one T3 problem: REQ-DLV-006's acceptance named the bare file `run-agent.sh`. I changed it to `tools/agents/run-agent.sh`, re-merged, and re-ran all five checks. The output above is from that final run.

**Not run:**
- `tools/gates/prefreeze.sh`, per the assignment: it needs nested bubblewrap, which isn't available in my sandbox. The orchestrator runs it after committing.
- `tools/gates/tests/sandbox.test.mjs`, `runner.test.mjs` and `test_agent_settings.py`. I cite their titles but didn't execute them. The citations were verified only by `check_test_refs.py`, which confirms that the titles exist.

## 4. Known gaps and not done

- **The CI bubblewrap step has never run on a hosted runner** (D-026, `environment.md`). REQ-DLV-023 stays IMPLEMENTED because the workflow file does contain the step, but its notes state that the CI part is unverified until the first workflow run reports. A reviewer may judge that this needs a status change. That is not the analyst's call to make unilaterally, so I flag it here.
- **The zero-length stub exemption in the config scan has no dedicated automated test.** This is disclosed in the REQ-DLV-007 notes, and it isn't in my scope to add one (`tools/agents/**`).
- **The earlier part-file/register divergence on REQ-DLV-023** means someone edited the register, or edited the part file inconsistently, outside the merge script after AN-10 (in `bcb8c61` or later). It is fixed now, but the orchestrator may want to keep the part files and the register merge-consistent: for example, by having the pre-freeze run the merge in its sandboxed clone and diff the result.
- **Untracked files not created by me:**
  - zero-length root stubs (`.bash_profile`, `.bashrc`, `.gitconfig`, `.gitmodules`, `.idea`, `.mcp.json`, `.profile`, `.ripgreprc`, `.vscode`, `.zprofile`, `.zshrc`, `CLAUDE.local.md`), which are the sandbox's own mount stubs (D-026);
  - the empty `docs/delivery/gates/` directory, present before I started;
  - my run directory.

## 5. Merge instructions

- Commit `docs/analysis/parts/req-dlv-s14-s21.csv`, `docs/delivery/requirements.csv` and this handback together. The register must stay equal to the merge output.
- No migrations and no ordering constraints. The diff touches only rows REQ-DLV-003/006/007/008/013/023/026, so a conflict is possible only if another task edits those rows.
- After committing, run `tools/gates/prefreeze.sh DG0`. It should pass the sandboxed register and `docs/analysis/tools` checks against the committed register. Note that prefreeze does not itself re-run `merge_register.py`.
