# Handback T-DG0-AN-14 (transformation-analyst)

- **Stage:** DG0 (P0), state FIXING after round 14.
- **Assignment:** `docs/delivery/assignments/DG0/T-DG0-AN-14.md`. Its sha256 `6b72e3ee…c590e4` was verified before I started.
- **Base:** `5c9683df50d0d9fadf2232f8ad2472f72c35f677` on `claude/mobily-transformation-platform-kwcc4i`.
  - `git status` before writing: no tracked changes under `docs/` or `tools/`.
  - `acceptance-map.md` was identical to HEAD.
- **Invocation reference:** `{"kind":"claude-code-cli-session","run_id":"DG0-T-DG0-AN-14-transformation-analyst-20260928T231628Z-0d1b3482","session_id":"0d1b3482-05f1-4aad-abb0-0147165ed566"}`

## 1. Changed files

| File | Purpose |
|---|---|
| `docs/analysis/acceptance-map.md` | F-DG0-235. REQ-DLV-042 is added in four places: the A18, A23 and A24 "Requirements proved" lists, and the A24 "Gate ordering" line as `REQ-DLV-042 (DG1)`. A new "AN-14 update" paragraph states the map's exact rule and names the check. |
| `docs/analysis/tools/check_acceptance_map.py` (new) | Automated check of the map against the register, in both directions (rules M1–M5 below). `prefreeze.sh` picks it up automatically once committed. |
| `docs/analysis/parts/req-dlv-s14-s21.csv` | REQ-DLV-006, -007, -008 and -023 updated for D-028 (§2). |
| `docs/delivery/requirements.csv` | Regenerated only with `python3 -I -B tools/source/merge_register.py`. Still 412 rows; no counts changed. |
| `docs/analysis/README.md` | Adds an Artefacts row for the new check and an "AN-14 round-14 repairs (D-028)" table. |
| `docs/delivery/handbacks/DG0/T-DG0-AN-14-transformation-analyst.md` | This handback. |

Resulting hashes:
- `check_acceptance_map.py`: `1bd05ad3…713472`
- `acceptance-map.md`: `fe827b05…b69d`
- `requirements.csv`: `1e52e5b7…053ef1`

## 2. Behaviour delivered

### F-DG0-235 (REQ-DLV-032 traceability)

REQ-DLV-042 cites `A18;A23;A24`. It is now listed under all three scenarios. Its final gate, DG1, is later than A24's must-pass gate, DG0, so it also appears in the A24 "Rows adding cases later" line.

### New check `docs/analysis/tools/check_acceptance_map.py`

The map's rule is the one it has followed since AN-04. I checked that rule as it stands and did not loosen it.

- **M1: what counts as a citation.** A row cites `Ann` when its `acceptance` column contains `Ann` as a whole word, using the regex `\bA(0[1-9]|1\d|2[0-8])\b`.
  - This is the same rule as `check_counts.py`, which produces the README "Rows citing" counts, and as QA's independent `acceptance-feasibility.mjs`.
  - A prose range such as "A01-A27 tests pass" is not expanded; its two endpoints count like any other token.
  - While drafting, I first tried expanding such ranges. That produced 102 extra mismatches: REQ-DLV-020, -038 and -039 would be listed under nearly every scenario. It would also have contradicted the README counts and QA's parser, so I dropped it.
- **M2: the "Requirements proved" list.** For each scenario, the list (ranges such as `REQ-PB-001..003` are expanded) must equal the set of citing rows, minus the scenario's own `REQ-S20-###` test row. Both directions are reported:
  - a citing row that the map omits;
  - a listed ID that does not cite the scenario, is not in the register, or is the scenario's own test row.
  - Duplicate listings are also reported.
- **M3: the "Gate ordering" table.** For each scenario, the line must list exactly the M2 rows whose `final_gate` is later than the scenario's "Must pass at" gate. Each must carry its register final gate as the annotation. A scenario with no such row has no line.
- **M4: structure.** Every A01–A28 appears exactly once in the main table, and its test row exists in the register.
- **M5: built-in negative controls.** These run every time:
  - a synthetic register row citing A24 must be reported as missing from the map;
  - a copy of the map with the first ID removed from the A01 list (the cell is rebuilt, so the control does not depend on the row's layout) must be reported.

  If either control is not detected, the check fails.
- **Other behaviour.**
  - `--map FILE` checks another copy of the map.
  - It exits 1 and prints every mismatch.

### REQ-DLV-006 (agent invocation)

- **Procedure** now says:
  - `agent_settings.py` takes the run's stage (`ROLE REPO_ROOT CWD STAGE`) and refuses a missing or invalid stage;
  - every run gets `/var/tmp/mth-run.XXXXXX` (mode 700), exported as `TMPDIR` and `MTH_RUN_TMP` and removed at the end;
  - if `/var/tmp` is unwritable, the runner stops before starting the agent.
- **Acceptance** cites the runner test "F-DG0-144: every run gets its own private TMPDIR, exported to the agent and removed when the run ends".
- **Notes** add D-028 and an AN-14 entry.

### REQ-DLV-007 (write controls)

- **Title:** "each reviewer writes only its own review records and evidence".
- **Procedure (1), file tools.** The guard now:
  - fails closed on paths whose real path cannot be determined, or that resolve through `/proc`, `/sys` or `/dev` (F-DG0-143);
  - treats only the run's private `MTH_RUN_TMP` as scratch (the OS temp directory only without the runner), never the shared `/tmp` and never home;
  - gives each reviewer file-tool scope over only `docs/delivery/reviews/*/round-*/<role>.*` and `docs/delivery/test-evidence/*/<key>/**` (F-DG0-144).
- **Procedure (2), shell.**
  - `agent_settings.py` takes the stage and confines each reviewer to `docs/delivery/test-evidence/<stage>/<key>`.
  - It denies the other reviewers' evidence directories even before they exist.
  - The analyst and implementers may write no evidence.
  - The only writable scratch is the private `TMPDIR`: `/tmp` and `/var/tmp` are read-only.
- **Acceptance** adds these tests, cited verbatim:
  - guard tests:
    - "F-DG0-144: a reviewer may not write another reviewer's record, sidecars or evidence"
    - "F-DG0-144: only the run's own private temporary directory is scratch, never the shared /tmp"
    - "F-DG0-143: writes that resolve through /proc, /sys or /dev, or whose real path cannot be determined, are blocked"
  - settings tests:
    - `test_each_reviewer_writes_only_its_own_evidence_directory`
    - `test_roles_without_evidence_cannot_write_any`
    - `test_a_stage_is_required`
- **Removed claims.** "The current live probe" became "the live probe"; see §4.
- **Notes.**
  - The residual "denies existing paths only" now records the D-028 exception: other reviewers' evidence directories are denied even before they exist.
  - An AN-14 entry is added.

### REQ-DLV-008 (SPECIFIED, DG7)

- **Procedure and notes** record that concurrent agents are now isolated mechanically (D-028):
  - **scratch:** a private `TMPDIR` per run;
  - **records:** each reviewer writes only its own review files;
  - **evidence:** each reviewer writes only its own evidence directory; the analyst and implementers write none.
- **Status** stays SPECIFIED, because the per-stage assignment and ownership obligation runs to DG7.

### Other stale statements D-028 made obsolete

- **REQ-DLV-023:** "no agent sharing $TMPDIR" became "no other process, including another agent", with an AN-14 note.
- **REQ-DLV-007:** the stale "only the OS temp directory as scratch" is fixed (above).
- **Searched and needed no change:**
  - I searched the register and all analysis docs for "temp directory", "/tmp", "TMPDIR", "scratch", `reviews/**`, `test-evidence/**` and reviewer-write phrasing.
  - No other register row or analysis doc says reviewers write `docs/delivery/reviews/**` or `docs/delivery/test-evidence/**` broadly.
  - The REQ-S20 rows name `docs/delivery/test-evidence/` only as the location of evidence, which is still correct.

## 3. Checks actually run

**Environment:** this run's Bash sandbox, cwd `/home/user/My-owns`, node v22.22.2, Python 3.11.15. All checks ran on the working tree with my changes, which are not committed.

**New check fails on the pre-fix map.** I copied the pre-fix map with `git show HEAD:docs/analysis/acceptance-map.md > "$TMPDIR/acceptance-map.prefix.md"`; HEAD's map was identical to the working map before my edit. Then I ran `python3 -I -B docs/analysis/tools/check_acceptance_map.py --map "$TMPDIR/acceptance-map.prefix.md"`:
```
MISMATCH M2 A18: register row cites A18 but the map omits it: REQ-DLV-042
MISMATCH M2 A23: register row cites A23 but the map omits it: REQ-DLV-042
MISMATCH M2 A24: register row cites A24 but the map omits it: REQ-DLV-042
MISMATCH M3 A24: gate-ordering table omits REQ-DLV-042 (DG1)
checked 28 scenarios against 412 register rows in /var/tmp/mth-run.WxcEmK/claude-0/acceptance-map.prefix.md
ACCEPTANCE MAP MISMATCH (4 problem(s))
exit=1
```
These are exactly the four places F-DG0-235 names.

**Reverse direction and annotations (extra).** I made a scratch copy under `$TMPDIR` that adds an unknown ID and a non-citing ID to A25, mis-annotates REQ-DLV-042 as `(DG2)` and adds REQ-DLV-007 to the A24 gate line. Result: exit 1, with 4 mismatches, each correctly worded:
- "map lists REQ-DLV-099, which is not in the register"
- "map lists REQ-PB-001, which does not cite A25 in its acceptance column"
- "REQ-DLV-042 annotated (DG2), register final_gate is DG1"
- "gate-ordering table lists REQ-DLV-007, which is not a citing row with a final gate after DG0"

**After the fix:** `for f in docs/analysis/tools/*.py; do python3 -I -B "$f"; done`
```
== check_acceptance_map.py  exit=0
checked 28 scenarios against 412 register rows in docs/analysis/acceptance-map.md
ACCEPTANCE MAP MATCHES THE REGISTER
== check_counts.py  exit=0
STAGE-PLAN LISTS ALL MATCH
README COUNTS ALL MATCH
== check_pb_provenance.py  exit=0
checked 93 REQ-PB rows; 0 problem(s); 10 reviewed R5 false positive(s) accepted
== check_test_refs.py  exit=0
93 declared test titles derived from 6 test files; 84 quoted test title citation(s) in 412 register rows; 0 problem(s)
```
There were 77 citations before; the 7 new ones are the 3 guard, 3 settings and 1 runner test titles, all resolved exactly.

**Register merge:** `python3 -I -B tools/source/merge_register.py` exited 0:
```
merged 412 requirements {'PB': 93, 'DLV': 42, ...}; 423 master-prompt coverage rows
```

**Validator:** `node tools/gates/validate.mjs --register DG0` exited 0:
```
PASS register rules at DG0
```

**Agent node tests:** `node --test tools/agents/tests/guard.test.mjs tools/agents/tests/runner.test.mjs` exited 0:
```
# tests 26
# pass 26
# fail 0
```

**Agent Python tests:** `python3 -I -B -m unittest discover -s tools/agents/tests -p 'test_*.py'` exited 0:
```
Ran 17 tests in 0.167s
OK
```

**Not run:** `tools/gates/prefreeze.sh` itself. It runs against the committed HEAD, and I don't commit. The orchestrator should run it after integration to confirm the new script is picked up by the `ls-tree … docs/analysis/tools/*.py` loop.

## 4. Known gaps / not done

- **No live-probe evidence for D-028.** No committed live-probe evidence of the D-028 controls exists. The newest, `orchestrator-probes/guard-live-20260928T223938Z`, predates `5c4a12b`. So REQ-DLV-007 cites no new probe, and its notes say so. The older probe `guard-live-20260928T182513Z` is still cited, but no longer as "current". Once the orchestrator records a post-D-028 live probe (part B: another run's private `TMPDIR` is unwritable), its log should be added to REQ-DLV-007's acceptance and evidence.
- **Citation rule observation, not changed.** Four rows mention scenario IDs in their acceptance prose beyond their leading `Axx;…:` list:
  - REQ-DLV-020 (A28, via "A01-A28");
  - REQ-DLV-038 (A01, via "A01-A22");
  - REQ-DLV-039 (A01 and A27, via "A01-A27");
  - REQ-S06-003 (A02).

  Under the established whole-word rule they count as citations, and the map, the README counts and QA's script all agree on this. Switching to a "leading prefix only" rule would be a deliberate redefinition that touches the README counts. I left it for a decision rather than changing it inside this repair.
- **Finding closure.** I don't close F-DG0-235, F-DG0-143 or F-DG0-144. Closure is for the originating reviewers' verification sidecars.
- **Untracked paths I did not create.** `docs/delivery/gates` and the run directory `docs/delivery/runs/DG0/DG0-T-DG0-AN-14-…/` were not created by me: the first is not mine, the second is the runner's. I didn't touch either.

## 5. Merge instructions

- Commit these files together:
  - `docs/analysis/acceptance-map.md`
  - `docs/analysis/tools/check_acceptance_map.py`
  - `docs/analysis/parts/req-dlv-s14-s21.csv`
  - `docs/analysis/README.md`
  - `docs/delivery/requirements.csv`
  - this handback
- There are no migrations.
- `requirements.csv` equals the merge output of the part files, so the prefreeze "register equals the merge" check should pass. If another task edits `req-dlv-s14-s21.csv` concurrently, re-run the merge after rebasing rather than hand-resolving `requirements.csv`.
- Any later register change to an `acceptance` column's scenario citations now requires a matching `acceptance-map.md` update, or `check_acceptance_map.py` (and therefore `prefreeze.sh`) fails.
