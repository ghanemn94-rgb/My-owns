# Handback T-DG0-AN-09 (transformation-analyst)

- **Stage:** DG0 (FIXING). **Task:** T-DG0-AN-09, repairing F-DG0-008 and F-DG0-209 (register part).
- **Invocation:** run `DG0-T-DG0-AN-09-transformation-analyst-20260928T142344Z-792a25d0`, session `792a25d0-8c34-4edc-a023-f73d843b4d92`.
- **Assignment:** `docs/delivery/assignments/DG0/T-DG0-AN-09.md`. Its SHA-256 `260e4beb…3447193` was verified before starting.
- **Base:** `265db13585e8177b3ccc1a476823b0654f7dde08` on `claude/mobily-transformation-platform-kwcc4i`.
  - At start, `git status` showed the orchestrator's uncommitted `findings.json` change and untracked round-3 review, run and evidence files.
  - I did not touch any of them.

## 1. Changed files

| File | Purpose |
|---|---|
| `docs/analysis/parts/req-pb.csv` | Changed the `notes` of 18 REQ-PB rows to fix provenance labels (F-DG0-008). No other column changed. |
| `docs/analysis/parts/req-dlv-s14-s21.csv` | Brought 8 REQ-DLV rows in line with the current gate tooling (F-DG0-209). |
| `docs/delivery/requirements.csv` | Regenerated only by `python3 tools/source/merge_register.py`. |
| `docs/analysis/tools/check_pb_provenance.py` | Added rules R5 (phrase overlap), R6 ('additions: none' must account for each cited anchor) and R7 (§ label matches the anchor's section). Added the `REVIEWED_R5` false-positive list. |
| `docs/analysis/tools/check_test_refs.py` | `EXPECTED_TITLES` now includes the 5 test titles added by the round-3 repair. A quoted title may now contain an in-word apostrophe. |
| `docs/analysis/README.md` | Tool descriptions updated, plus a new "AN-09 round-3 register repairs" section. |

`docs/analysis/master-prompt-coverage.csv` and `source-coverage.csv` are unchanged. The merge rewrote the coverage file byte-identically.

## 2. Behaviour delivered

### F-DG0-008 (REQ-PB provenance labels)

**The three reported rows.** Each moved content now sits under "Master-prompt additions" with its anchor.

| Row | Content moved | Interpretations now |
|---|---|---|
| REQ-PB-091 | M0288: the top three improvement actions are required, and reassessments are tracked over time. | Only the enforcement reading: submission with fewer than three actions is rejected. |
| REQ-PB-050 | M0135: linked initiatives, dates and milestones. M0178: overlapping planning horizons, not rigid deadlines, which grounds the acceptance "overlapping horizons are accepted". M0180–M0183 are noted as restating the four waves. | none |
| REQ-PB-078 | M0150: the dependency map (T08) and RAID dependency entries refer to one canonical record. | none |

**Whole-register re-check.**
- **Tool extension:** `check_pb_provenance.py` rule R5. It normalises text (lower case, punctuation removed, stop words dropped, light stemming) and compares each Interpretations clause with the text of every M block in that row's `source_ref`. It flags a clause when any of these holds:
  - it shares 4 or more content words in sequence with a cited block;
  - it shares 4 or more distinct content words with the block;
  - it shares 3 or more distinct content words, and they make up at least half of the clause's distinct content words.

  The last two conditions were needed: the plain 4-word-sequence rule missed REQ-PB-091 (word order differs) and REQ-PB-050 (a short clause).
- **Negative test:** run against the HEAD register, R5 flags all three reported rows. R6 and R7 were checked the same way: a deliberate §9 mislabel is caught.
- **Hand review:** 17 flagged (row, block) pairs in 15 rows.
  - True positives were relabelled.
  - Ten false positives are recorded in `REVIEWED_R5`, each with its exact shared-word set and a rationale. An entry stops matching if the text changes, and unused entries are reported.

**Every row changed (18 REQ-PB rows, `notes` only):**

| Rows | Change |
|---|---|
| REQ-PB-050, -078, -091 | The reported findings (above). |
| REQ-PB-003 | M0095, Modular entry at a selected phase, moved to additions. The mode-change reading stays an interpretation. |
| REQ-PB-072 | M0216, training attendance is distinguished from adoption, moved to additions. |
| REQ-PB-087 | M0261, the Day-90 test kept within the scheduled tasks, moved to additions. The row had said "additions: none". |
| REQ-PB-093 | M0176, the seeded 25/25/20/15/15 weights, moved to additions. |
| REQ-PB-002, -030, -032, -034, -040, -041, -045, -047, -070, -080, -092 | The notes said "Master-prompt additions: none" while `source_ref` cites M blocks. Each now names the block it restates. REQ-PB-070 points M0215's additions to REQ-S11-001/002, and REQ-PB-092 points M0288's action clause to REQ-PB-091. |

No row's scope, class, increments, final gate, `source_ref`, acceptance or status changed.

### F-DG0-209 (register part)

**REQ-DLV-022** now states:
- the algorithm `mth-candidate-v2`, with lines `<sha256>  <git mode>  <path>`;
- that a symlink hashes its target string and gitlinks are refused;
- that `mth-candidate-v1` (`<sha256>  <path>`) is kept only to re-verify the DG0 round-1 and round-2 manifests;
- that `--freeze` writes the write-once manifest `docs/delivery/candidates/<DGx>/<id-prefix>.manifest.json`, and a gate candidate must use v2.

`input_fields` gains "Git mode", and the acceptance now cites the F-DG0-112/206 and F-DG0-208 tests.

**Other DLV rows checked** against `tools/gates/lib/*.mjs`, `run-agent.sh`, `guard-write.mjs`, `write-scopes.json`, D-016 to D-021 and the CI workflow. These were updated:

| Row | Update |
|---|---|
| REQ-DLV-006 | D-019 same-session classifier-outage resume. |
| REQ-DLV-007 | D-020: symlink real path, case-insensitive deny, fixed guard root, full protected list. Cites the F-DG0-105 tests. |
| REQ-DLV-013 | D-016/D-021 provenance and output binding. Cites the F-DG0-201 and F-DG0-115 tests. |
| REQ-DLV-016 | Observations accepted only through specialist plus auditor sidecars. Cites the F-DG0-117 test. |
| REQ-DLV-017 | Findings sidecars, `import-findings.mjs` mirroring, closure only through the reviewer's bound verifications sidecar, no dropping or relabelling. Cites the F-DG0-101 and F-DG0-110/204 tests. |
| REQ-DLV-021 | Committed records are write-once. |
| REQ-DLV-026 | Meta `outputs` and `written_by_tools`, reviewer auto-commit, write-once run records. |

**Checked and unchanged:** DLV-004, -014, -015, -019, -020, -023, -024 and -029 still match the implementation. For example, the CI workflow still runs the node tests, `--pipeline` and `--reconcile`.

No register row or analysis document referred to the removed `docs/delivery/candidates/DG0.manifest.json`. I found it only in the assignment, and I grepped the register, `docs/analysis` and its parts.

## 3. Checks actually run

**Environment:** Linux, Node v22.22.2, Python 3.11.15, repository root `/home/user/My-owns`, working tree based on `265db13` plus my changes. Final run output tail:

```
$ python3 tools/source/merge_register.py
merged 411 requirements {'PB': 93, 'DLV': 41, ...}; 423 master-prompt coverage rows        exit=0
$ python3 docs/analysis/tools/check_counts.py
STAGE-PLAN LISTS ALL MATCH / README COUNTS ALL MATCH                                        exit=0
$ python3 docs/analysis/tools/check_test_refs.py
42 declared test titles, 42 expected; 29 quoted test title citation(s) in 411 register rows; 0 problem(s)   exit=0
$ python3 docs/analysis/tools/check_pb_provenance.py
checked 93 REQ-PB rows; 0 problem(s); 10 reviewed R5 false positive(s) accepted            exit=0
$ node tools/gates/validate.mjs --register DG0
PASS register rules at DG0                                                                  exit=0
```

**Supporting runs:**
- **Baseline before my edits:** `check_test_refs.py` exited 1, because 5 test titles declared since round 2 were missing from `EXPECTED_TITLES`. That is now fixed.
- **Negative test:** the new `check_pb_provenance.py`, run against the HEAD register in a scratch copy, exited 1 with 30 problems. These included R5 flags for REQ-PB-050, -078 and -091.
- **R7 negative:** a §9 mislabel exited 1.

**Counts, unchanged by this task:**
- **Register:** 411 requirements.
  - By class: SOURCE 93, USER 188, ENGINEERING 130.
  - By final gate: DG0 19, DG1 11, DG2 32, DG3 32, DG4 137, DG5 78, DG6 48, DG7 54.
- **Playbook blocks:** all 165 dispositioned (REQUIREMENT 129, CONTEXT 29, NON-REQUIREMENT 7).
- **Master-prompt blocks:** 423 coverage rows.

## 4. Known gaps and not done

- **R5 is a heuristic.** A restatement that uses different words, sharing fewer than 3 content words or under half the clause, would not be flagged. The ten accepted false positives are my own judgement. They need independent review, and I do not review my own work.
- **Code comment outside my write scope.** The comment in `tools/gates/lib/candidate.mjs` says v1 was used for "historical DG0 rounds 1-3". The manifests show v1 for rounds 1–2 (`dea5e75a…`, `d47b51ca…`, no `hash_algorithm`) and v2 for round 3 (`31fd0843…`). D-005 says 1–2, which is correct. The register follows the manifests and D-005. I am reporting the comment for the orchestrator. `decisions.md` D-005 already states the v2 line format consistently, so I needed no change there, and it is outside my scope anyway.
- **F-DG0-209 is not closed by this handback.** It is owned by delivery-orchestrator, and closure needs a reviewer verification.
- **F-DG0-008 likewise** needs verification by domain-reviewer or another qualified non-author.

## 5. Merge instructions

- There are no migrations.
- After integrating, run `python3 tools/source/merge_register.py`. It is idempotent: `requirements.csv` is already regenerated.
- Commit the four files under `docs/analysis/`, plus `docs/delivery/requirements.csv` and this handback.
- This changes the candidate, so a new freeze and review round are needed.
- **Conflicts:** only if another task edited the same rows in `req-pb.csv`, `req-dlv-s14-s21.csv` or the two checker scripts.
