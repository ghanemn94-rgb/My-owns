# Handback T-DG0-AN-12: register follow-up to ff838e3 (REQ-DLV-007, REQ-DLV-023)

- **Role:** transformation-analyst. **Stage:** DG0 (REVIEWING, before the round-13 freeze).
- **Invocation:** run `DG0-T-DG0-AN-12-transformation-analyst-20260928T214926Z-c0090b3d`, session `c0090b3d-9668-4675-97b0-b9b6e70e4630`.
- **Assignment:** `docs/delivery/assignments/DG0/T-DG0-AN-12.md`, SHA-256 `31e1d17b264f2cf4a4b9dc238641eb48aaf499d464f7c3c5faf48adc6951157e`. I checked this hash before starting.
- **Base:** HEAD `1932e8b8281e3cf568d19f0620b21e3a715f7fb5` on `claude/mobily-transformation-platform-kwcc4i`. No tracked files were modified at start.

## 1. Changed files

| File | Purpose |
|---|---|
| `docs/analysis/parts/req-dlv-s14-s21.csv` | Rows REQ-DLV-007 and REQ-DLV-023 only. I made exact substring replacements inside those two lines, and each target string was checked to occur exactly once. Every other byte is unchanged. |
| `docs/delivery/requirements.csv` | Regenerated with `python3 -I -B tools/source/merge_register.py`, not edited by hand. `git diff` shows only the same two rows. `docs/analysis/master-prompt-coverage.csv` is unchanged. |
| `docs/delivery/handbacks/DG0/T-DG0-AN-12-transformation-analyst.md` | This handback. |

**Rows changed:** REQ-DLV-007 (acceptance, notes) and REQ-DLV-023 (procedure, acceptance, notes). No other columns changed, including class, increments, final gate, status and evidence. Both rows are still ENGINEERING, P0 → DG0, IMPLEMENTED.

## 2. Behaviour delivered, per requirement

### REQ-DLV-007

**Acceptance.** I added this clause after the D-024 validator test:
> the zero-length stub exemption of the runner's configuration scan is covered in both directions: the runner tests 'D-026: zero-length untracked sandbox stubs are not reported as configuration changes' and 'D-026: configuration with content, a symlink, or a truncated tracked file is still reported (exit 71, no auto-commit)' pass (tools/agents/tests/runner.test.mjs);

Both titles are copied verbatim from `tools/agents/tests/runner.test.mjs` lines 104 and 114.

**Notes.** I removed the residual "The zero-length stub exemption has no dedicated automated test; …". In its place, an AN-12 sentence says:
- the exemption now has two dedicated runner tests, one per direction, added in `ff838e3` (D-026);
- the round-12 orphaned run is still the record of the false positive that motivated the exemption.

All other residuals are unchanged.

### REQ-DLV-023

**Procedure.** I appended that the pre-freeze re-runs `tools/source/merge_register.py` in the sandboxed clone. It requires `docs/delivery/requirements.csv` and `docs/analysis/master-prompt-coverage.csv` to be unchanged by that run. The check is named: 'register equals the merge of docs/analysis/parts (sandboxed)' (D-026).

**Acceptance.** The list of `prefreeze.sh` checks now includes that named check. It says the check fails if either file differs from the merge output.

**Notes.**
- I replaced the incorrect sentence "An analyst cannot run prefreeze.sh inside its own sandbox (nested bubblewrap is unavailable there); the orchestrator runs it." The new AN-12 correction says:
  - nested bubblewrap *is* available inside the agent sandbox (the orchestrator ran `bwrap` and `sandbox.test.mjs` from a sandboxed session);
  - `prefreeze.sh` checks the committed HEAD, so it is run after committing;
  - the new check closes the part-file/register divergence that AN-11 reported.
- The open note is kept unchanged: the CI bubblewrap step has not yet run on a hosted runner, so it is unverified.

## 3. Checks actually run

These ran in my own sandboxed shell (bubblewrap, no network) on 2026-09-28, in `/home/user/My-owns` with the changes above uncommitted.

```
$ python3 -I -B tools/source/merge_register.py
merged 411 requirements {'PB': 93, 'DLV': 41, ... 'S21': 4}; 423 master-prompt coverage rows      exit=0

$ node tools/gates/validate.mjs --register DG0
PASS register rules at DG0                                                                         exit=0

$ python3 -I -B docs/analysis/tools/check_counts.py
MATCH Requirements with an increment in P7 that complete later (0):** none
STAGE-PLAN LISTS ALL MATCH
README COUNTS ALL MATCH                                                                            exit=0

$ python3 -I -B docs/analysis/tools/check_pb_provenance.py
checked 93 REQ-PB rows; 0 problem(s); 10 reviewed R5 false positive(s) accepted                    exit=0

$ python3 -I -B docs/analysis/tools/check_test_refs.py
83 declared test titles derived from 6 test files; 74 quoted test title citation(s) in 411 register rows; 0 problem(s)   exit=0

$ node --test tools/agents/tests/runner.test.mjs
1..3
# tests 3
# pass 3
# fail 0
# skipped 0                                                                                        exit=0
```

The quoted test title citations went from 72 at AN-11 to 74, which accounts for the two new runner titles. The checker reports no T1 problem, so both titles match declared tests exactly.

**Not run:** `tools/gates/prefreeze.sh DG0`. It checks the committed HEAD, and my changes aren't committed (the analyst can't commit). The orchestrator should run it after committing.

## 4. Known gaps and not done

- **REQ-DLV-007 evidence column does not list `tools/agents/tests/runner.test.mjs`.** The assignment limited the change to notes and acceptance, and "change nothing else". The acceptance names the file path, and `check_test_refs.py` T3 confirms it exists. The orchestrator may want to add it to the evidence column in a later assignment.
- **The CI bubblewrap step is still unverified** on a hosted runner. It is recorded as open in the REQ-DLV-023 notes, and the status stays IMPLEMENTED, as at AN-11.
- **Untracked files I didn't create:** the zero-length sandbox stubs in the repository root (D-026) and my run directory.

## 5. Merge instructions

- Commit `docs/analysis/parts/req-dlv-s14-s21.csv`, `docs/delivery/requirements.csv` and this handback together.
- There are no migrations and no ordering constraints. A conflict is possible only if another task edits rows REQ-DLV-007 or REQ-DLV-023.
- After committing, run `tools/gates/prefreeze.sh DG0`. The check 'register equals the merge of docs/analysis/parts (sandboxed)' should pass, because I regenerated the register from the edited part file.
