# Handback T-DG0-AN-10: transformation-analyst

- **Stage:** P0 / DG0 (state FIXING). **Task:** T-DG0-AN-10, finding **F-DG0-009** (Low, domain-reviewer, REQ-DLV-032).
- **Invocation:** run `DG0-T-DG0-AN-10-transformation-analyst-20260928T151703Z-d1692fb2`, session `d1692fb2-9688-41ba-8583-411dfdf3a144`.
- **Assignment:** `docs/delivery/assignments/DG0/T-DG0-AN-10.md`. Its sha256 `f8dd6c47…6e583` was verified.
- **Base:** `d2630dee4ba97b5a70f2f44c8065cef5c6c41e00` on `claude/mobily-transformation-platform-kwcc4i`. `git status` was clean apart from this run's own run directory.
- This task does not close F-DG0-009. A non-owner reviewer has to verify the fix.

## 1. Changed files

| File | Purpose |
|---|---|
| `docs/analysis/tools/check_test_refs.py` | The hard-coded `EXPECTED_TITLES` list is gone. Titles are now derived from the test files. T4 now checks the derivation itself, and a new T5 negative control runs every time. |
| `docs/analysis/parts/req-dlv-s14-s21.csv` | Updated seven rows: REQ-DLV-013, -014 (note only), -016, -021, -022, -023 and -026. |
| `docs/delivery/requirements.csv` | Regenerated with `python3 tools/source/merge_register.py`, not hand-edited. `master-prompt-coverage.csv` came out byte-identical. |
| `docs/analysis/README.md` | The row for `check_test_refs.py` now describes the derived titles and the T4/T5 checks. |
| `docs/delivery/handbacks/DG0/T-DG0-AN-10-transformation-analyst.md` | This handback. |

## 2. Behaviour delivered

### F-DG0-009 / REQ-DLV-032: the check no longer goes stale

Declared titles now come from three sources:
- the literal first argument of every `test("…")`, `test('…')` or ``test(`…`)`` call in `tools/gates/tests/*.test.mjs` and `tools/agents/tests/*.test.mjs`;
- every `def test_…` method name in `tools/agents/tests/test_*.py`. A Python test is cited by its method name, for example `'test_write_then_edit_is_replayed_and_bound'`.

The check still fails on real problems:
- **T1** fails when any quoted title cited in the register is not declared.
- **T4** now guards the derivation:
  - every test file yields at least one title;
  - in each JS file, the number of `test(` calls equals the number of literal titles parsed, so a non-literal title can't silently drop out;
  - no title is declared twice.
- **T5** is a built-in negative control. On every run, a synthetic row with a fabricated title and an untraceable self-test must produce T1 and T2 problems.
- T2 now also recognises "runner metadata test(s)".

Negative checks, run on a disposable copy in the session scratchpad:
- A cited validator title renamed in the test file gives `REQ-DLV-022: T1 cites a test title that does not exist …`, exit 1.
- A `test(name, …)` call added to `guard.test.mjs` gives `T4 … 14 test( call(s) but 13 literal title(s) parsed`, exit 1.
- A register citation changed to `'test_does_not_exist'` gives a T1 problem, exit 1.

### Register review against D-016 to D-021

| Behaviour | Row | Change |
|---|---|---|
| Tool-authored output binding (D-021, F-DG0-119) and first-added-blob write-once (D-021, F-DG0-115 residual, F-DG0-118) | REQ-DLV-013 | Acceptance now cites the three round-4 validator tests and the runner metadata tests `test_write_then_edit_is_replayed_and_bound`, `test_failed_calls_and_shell_edits_are_not_bound` and `test_edit_without_a_prior_write_is_not_reconstructible`. Evidence adds `run_meta.py`, `test_run_meta.py` and `run-agent.sh`. |
| Gate file bound to the auditor run (F-DG0-121/211) | REQ-DLV-016 | Cites `'the gate record must be written by the audited release-auditor invocation'` and `'F-DG0-121 / F-DG0-211: the gate file must be what the auditor run wrote'`. |
| Same | REQ-DLV-021 | Stays SPECIFIED (final gate DG7). Cites the same two tests, adds rule, schema and test evidence, and notes that enforcement exists from P0. |
| Manifests recomputed from their source commit (F-DG0-212) | REQ-DLV-022 | Cites `'F-DG0-212: a round manifest must describe its source commit; runs start from a commit containing it'`. |
| Runner metadata module | REQ-DLV-026 | Cites `test_string_messages_and_non_object_lines_are_tolerated` and `test_snapshots_survive_a_failure_for_diagnosis`. Evidence adds `run_meta.py` and `test_run_meta.py`. |
| Pre-freeze check, and the CI step running the Python tests | REQ-DLV-023 | Acceptance names the CI unittest step and `tools/gates/prefreeze.sh`. Evidence adds both files. The note discloses the defect in §4. |
| Pre-freeze check | REQ-DLV-014 | A note points to `prefreeze.sh` for the integrate-and-freeze step. The row stays SPECIFIED. |

Other points:
- No class, gate, increment or status changed, so the counts are unchanged: 411 rows (SOURCE 93, USER 188, ENGINEERING 130) and final gates DG0–DG7 of 19/11/32/32/137/78/48/54.
- Quoted test-title citations went from 29 to 42.
- D-016 (provenance), D-017 (immutability), D-018 (findings), D-019 (resume) and D-020 (guard) were already cited consistently. No change was needed.

## 3. Checks actually run

Environment: Linux, Node v22.22.2, Python 3.11.15, repository working tree at base `d2630de` plus these edits.

| Command | Result |
|---|---|
| `python3 docs/analysis/tools/check_test_refs.py` | exit 0: `52 declared test titles derived from 3 test files; 42 quoted test title citation(s) in 411 register rows; 0 problem(s)` |
| `python3 docs/analysis/tools/check_counts.py` | exit 0: `README COUNTS ALL MATCH` |
| `python3 docs/analysis/tools/check_pb_provenance.py` | exit 0 |
| `node tools/gates/validate.mjs --register DG0` | `PASS register rules at DG0` |
| `node --test tools/gates/tests/*.test.mjs tools/agents/tests/*.test.mjs` | `# tests 47 … # pass 47 # fail 0` |
| `tools/gates/prefreeze.sh DG0` | exit 1. Output below. |

```
PASS  source extraction reproducible :: PASS source extraction reproducible (docx sha256 2584a35282804e639a697478eae75a55a43cfb8c551345dfc7636b9b34548ad2; 165 playbook blocks; 423 master-prompt blocks)
FAIL  gate validator + guard tests
        failureType: 'testCodeFailure'
        exitCode: 1
        signal: ~
        error: 'test failed'
        code: 'ERR_TEST_FAILURE'
        ...
      1..2
      # tests 2
      # suites 0
      # pass 0
      # fail 2
      # cancelled 0
      # skipped 0
      # todo 0
      # duration_ms 74.541345
PASS  runner metadata tests :: OK
PASS  register rules (DG0) :: PASS register rules at DG0
PASS  pipeline state :: PASS pipeline (active stage: DG0 FIXING)
PASS  analysis check check_counts.py :: README COUNTS ALL MATCH
PASS  analysis check check_pb_provenance.py :: checked 93 REQ-PB rows; 0 problem(s); 10 reviewed R5 false positive(s) accepted
PASS  analysis check check_test_refs.py :: 52 declared test titles derived from 3 test files; 42 quoted test title citation(s) in 411 register rows; 0 problem(s)
FAIL  uncommitted candidate changes:
       M docs/analysis/README.md
       M docs/analysis/parts/req-dlv-s14-s21.csv
       M docs/analysis/tools/check_test_refs.py
```

The last line fails as expected, because my edits are not committed yet.

## 4. Known gaps / not done

- **The pre-freeze check does not pass: the `gate validator + guard tests` line FAILs.** This comes from the script, not from my edits:
  - `prefreeze.sh` runs `node --test tools/gates/tests/ tools/agents/tests/`.
  - On Node v22.22.2 the directory arguments are loaded as modules: `Error: Cannot find module '/home/user/My-owns/tools/agents/tests'` (MODULE_NOT_FOUND). That gives 2 "tests", both failed.
  - The same suites pass with file globs (47/47, the CI form).
  - Suggested fix for the orchestrator: `node --test tools/gates/tests/*.test.mjs tools/agents/tests/*.test.mjs`.
  - `tools/gates/**` is outside my write scope, so I did not change it.
  - Until it's fixed, REQ-DLV-023's `prefreeze.sh` clause is unmet. The row's note says so, and the candidate should not be frozen.
- **No decision record names `tools/gates/prefreeze.sh` or `tools/agents/run_meta.py`.**
  - D-021 describes the runner's `tool_authored` behaviour but not the module.
  - `decisions.md` is outside my scope. The orchestrator may want to add a decision or extend D-021.
- `docs/analysis/README.md` still says "Last integration: T-DG0-AN-05". Its counts are unchanged and verified by `check_counts.py`.

## 5. Merge instructions

1. Commit the four changed files together.
2. Fix `prefreeze.sh` (orchestrator scope), then rerun `tools/gates/prefreeze.sh DG0` before freezing.
3. If you edit the register again, edit the part files and run `python3 tools/source/merge_register.py`, then rerun the three analysis checks.

No migrations. No conflicts expected.
