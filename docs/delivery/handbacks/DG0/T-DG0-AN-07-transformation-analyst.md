# Handback T-DG0-AN-07 (transformation-analyst)

- **Stage:** P0 / DG0 (FIXING). **Assignment:** `docs/delivery/assignments/DG0/T-DG0-AN-07.md`. I checked its sha256 (ab8137ca…d3b4) before starting.
- **Invocation reference:** run_id `DG0-T-DG0-AN-07-transformation-analyst-20260928T132449Z-caef5052`, session `caef5052-628f-4a87-8247-7d5d1bd845f9`.
- **Base:** working tree on HEAD `6c676980acb91b91bb535e800e3a530b8f5016d8` with the orchestrator's uncommitted merge (register has 411 rows).

## 1. Changed files
- `docs/analysis/tools/check_counts.py` (new): the AN-06 consistency script, promoted into the repository. The paths are now relative to the script's own location, so it runs from any directory.
  - It checks the stage-plan ID lists, as before. It also checks the README count tables (class, final gate, class × gate, area, status, coverage dispositions and A-citation counts).
  - It exits 1 on any mismatch.
  - `--write` regenerates the stage-plan "completing at" and "increment in … complete later" lines from the register.
- `docs/analysis/stage-plan.md`: I regenerated the P0–P6 "increment in Pn that complete later" lines with `--write`. The new counts are P0 21, P1 80, P2 104, P3 91, P4 78, P5 51 and P6 39; the old counts were 5, 64, 88, 75, 62, 35 and 23. I also rewrote the "Recurring obligations" bullet (see section 2).
- `docs/analysis/README.md`: I added an index row for the tool and a short "AN-07 stage-plan list regeneration" section. The count tables were unchanged, and the script confirms they match.

## 2. Behaviour delivered
- **Cause of the mismatch:** the P0–P6 lists left out the 16 recurring DG7 protocol rows on purpose, because the plan listed them "only once, under P7". Their increments are P0;…;P7, so the register puts them in every list. Every list differed by exactly those 16 rows, which accounts for the difference of 16 in each count.
- **Fix:** I regenerated the lists from the register, so they now include those rows.
- **"Recurring obligations" bullet:** it now says these rows appear in every P0–P6 list, and it names the generator and check commands. The old bullet listed 15 IDs and left out REQ-DLV-039, whose increments are also P0–P7 with gate DG7. It now lists all 16.
- No register rows or part files changed, so no merge re-run was needed.

## 3. Checks actually run (environment: this container, python3, node, cwd `/home/user/My-owns`)

### `python3 docs/analysis/tools/check_counts.py` (final run): exit 0
```
total 411
class {'SOURCE': 93, 'ENGINEERING': 130, 'USER': 188}
final_gate {'DG0': 19, 'DG1': 11, 'DG2': 32, 'DG3': 32, 'DG4': 137, 'DG5': 78, 'DG6': 48, 'DG7': 54}
class x gate SOURCE [0, 0, 24, 21, 36, 12, 0, 0]
class x gate USER [0, 3, 6, 7, 76, 55, 19, 22]
class x gate ENGINEERING [19, 8, 2, 4, 25, 11, 29, 32]
status {'SPECIFIED': 392, 'IMPLEMENTED': 19}
area | SOURCE USER ENG total | DG0..DG7
PB [93, 0, 0] 93 [0, 0, 24, 21, 36, 12, 0, 0]
DLV [0, 0, 41] 41 [17, 2, 1, 1, 1, 1, 1, 17]
S01 [0, 5, 1] 6 [0, 0, 0, 0, 0, 3, 1, 2]
S02 [0, 3, 2] 5 [0, 0, 0, 0, 0, 2, 1, 2]
S03 [0, 11, 0] 11 [0, 0, 0, 0, 9, 2, 0, 0]
S04 [0, 14, 0] 14 [0, 0, 3, 1, 9, 1, 0, 0]
S05 [0, 5, 0] 5 [0, 0, 1, 1, 0, 3, 0, 0]
S06 [0, 9, 1] 10 [0, 0, 0, 0, 0, 10, 0, 0]
S07 [0, 11, 6] 17 [0, 0, 0, 0, 16, 1, 0, 0]
S08 [0, 14, 4] 18 [0, 0, 0, 1, 15, 2, 0, 0]
S09 [0, 8, 2] 10 [0, 0, 0, 6, 3, 1, 0, 0]
S10 [0, 18, 1] 19 [0, 0, 1, 0, 14, 2, 2, 0]
S11 [0, 8, 0] 8 [0, 0, 0, 0, 8, 0, 0, 0]
S12 [0, 18, 4] 22 [0, 0, 0, 0, 7, 12, 3, 0]
S13 [0, 10, 3] 13 [0, 0, 1, 0, 3, 7, 2, 0]
S14 [0, 4, 0] 4 [0, 0, 0, 0, 0, 4, 0, 0]
S15 [0, 14, 0] 14 [0, 3, 0, 0, 1, 1, 9, 0]
S16 [0, 0, 32] 32 [0, 4, 1, 1, 8, 4, 9, 5]
S17 [0, 4, 7] 11 [0, 0, 0, 0, 0, 0, 10, 1]
S18 [0, 4, 0] 4 [0, 0, 0, 0, 0, 4, 0, 0]
S19 [0, 17, 2] 19 [0, 2, 0, 0, 0, 0, 0, 17]
S20 [0, 9, 22] 31 [2, 0, 0, 0, 7, 5, 10, 7]
S21 [0, 2, 2] 4 [0, 0, 0, 0, 0, 1, 0, 3]
A-citations {'A01': 83, 'A02': 27, 'A03': 5, 'A04': 18, 'A05': 31, 'A06': 23, 'A07': 21, 'A08': 41, 'A09': 16, 'A10': 28, 'A11': 29, 'A12': 40, 'A13': 28, 'A14': 9, 'A15': 14, 'A16': 12, 'A17': 11, 'A18': 32, 'A19': 6, 'A20': 20, 'A21': 8, 'A22': 15, 'A23': 29, 'A24': 15, 'A25': 3, 'A26': 7, 'A27': 10, 'A28': 14}
source-coverage.csv 165 {'NON-REQUIREMENT': 7, 'REQUIREMENT': 129, 'CONTEXT': 29}
master-prompt-coverage.csv 423 {'NON-REQUIREMENT': 7, 'REQUIREMENT': 367, 'CONTEXT': 49}
MATCH Requirements completing at DG0 (19):** REQ-DLV-001..004, REQ-DLV-006..007, REQ-DLV-013, RE...
MATCH Requirements with an increment in P0 that complete later (21):** REQ-DLV-005, REQ-DLV-008....
MATCH Requirements completing at DG1 (11):** REQ-DLV-025, REQ-DLV-033; REQ-S15-002, REQ-S15-005....
MATCH Requirements with an increment in P1 that complete later (80):** REQ-PB-001, REQ-PB-003, R...
MATCH Requirements completing at DG2 (32):** REQ-PB-003, REQ-PB-012, REQ-PB-016..018, REQ-PB-023...
MATCH Requirements with an increment in P2 that complete later (104):** REQ-PB-002, REQ-PB-004.....
MATCH Requirements completing at DG3 (32):** REQ-PB-004, REQ-PB-006..007, REQ-PB-019, REQ-PB-022...
MATCH Requirements with an increment in P3 that complete later (91):** REQ-PB-005, REQ-PB-009..0...
MATCH Requirements completing at DG4 (137):** REQ-PB-005, REQ-PB-008..010, REQ-PB-013..015, REQ-...
MATCH Requirements with an increment in P4 that complete later (78):** REQ-PB-077; REQ-DLV-005, ...
MATCH Requirements completing at DG5 (78):** REQ-PB-001..002, REQ-PB-011, REQ-PB-077, REQ-PB-086...
MATCH Requirements with an increment in P5 that complete later (51):** REQ-DLV-005, REQ-DLV-008....
MATCH Requirements completing at DG6 (48):** REQ-DLV-038; REQ-S01-005; REQ-S02-006; REQ-S10-002,...
MATCH Requirements with an increment in P6 that complete later (39):** REQ-DLV-005, REQ-DLV-008....
MATCH Requirements completing at DG7 (54):** REQ-DLV-005, REQ-DLV-008..012, REQ-DLV-014, REQ-DLV...
MATCH Requirements with an increment in P7 that complete later (0):** none
STAGE-PLAN LISTS ALL MATCH
README COUNTS ALL MATCH
```

### `node tools/gates/validate.mjs --register DG0` (final run): exit 0
```
PASS register rules at DG0
```

### Negative tests: exit 1 as expected
I ran these on a disposable copy under the session scratchpad, not the repo:
- Changing "complete later (39)" to "(38)" in the copied `stage-plan.md` printed `STAGE-PLAN LISTS MISMATCH` and exited 1.
- Changing `| SOURCE | 93 |` to `92` in the copied `README.md` printed `README DIFF, expected: | SOURCE | 93 |` / `README COUNTS MISMATCH` and exited 1.

## 4. Known gaps / not done
- In the README check, the area-table and status-table rows are matched as exact strings. A reformatted table (for example, different spacing) would be reported as a mismatch. That is the safe direction, but reviewers should know.
- The script does not check the other analysis documents (acceptance-map "proves" lists, user journeys, permissions). The assignment did not ask for that.

## 5. Merge instructions
- None. Only `docs/analysis/**` and this handback were written. No part files changed, so there is no need to re-run `tools/source/merge_register.py`.
- To regenerate the lists after any future register change, run `python3 docs/analysis/tools/check_counts.py --write`, then run it again without `--write`.
