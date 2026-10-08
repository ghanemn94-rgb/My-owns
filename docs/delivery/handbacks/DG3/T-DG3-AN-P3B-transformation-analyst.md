# Handback T-DG3-AN-P3B: register evidence after wave 6 (transformation-analyst)

- **Stage:** DG3 (P3 "Mobilization and portfolio"), BUILDING, before the candidate freezes. This is engineering register work only. I grant no business, Finance or IT approval. Every G1–G4 approval in the cited tests is a synthetic demo record. Product gate G4 (or any G1–G6) never implies any DG0–DG7.
- **Invocation:** `{"kind":"claude-code-cli-session","run_id":"DG3-T-DG3-AN-P3B-transformation-analyst-20261008T052735Z-040487dd","session_id":"040487dd-385d-4a80-8190-3c14433fcf67"}`
- **Assignment:** `docs/delivery/assignments/DG3/T-DG3-AN-P3B.md`. `sha256sum` gave `af8b9cd293c1f44f470ba956b18ef9ab613b460c1ba9e57863cd052d5bcaa618`, which matches the hash I was given. The copy in the worktree has the same hash.
- **Worktree and base:** `/home/user/wt/dg3-an-p3b`, branch `dg3/an-p3b`, `HEAD` `af78f8b8f6cb98e288dee90495ca13fa7105ceb1`. Before writing I checked `git status`: no tracked changes, only untracked harness dotfiles. Nothing is committed.
- **Time:** started `Thu Oct  8 05:27:49 UTC 2026` and ended `Thu Oct  8 05:34:48 UTC 2026` (`date -u`), about 7 minutes. `CLAUDE.local.md`, untracked at the top level, is not mine; it's a harness file.
- **Concurrency (D-004):** I cite nothing from BE-G or FE-F. None of their new files is in this tree.

## 1. Changed files

| File | Purpose |
|---|---|
| `docs/delivery/requirements.csv` | 23 DG3 rows: new entries in `evidence`, and a "DG3 analyst check (T-DG3-AN-P3B, base af78f8b): …" sentence appended to `notes`. No other column and no other row changed (checked by script, §3). |
| `docs/delivery/handbacks/DG3/T-DG3-AN-P3B-transformation-analyst.md` | This handback. |

## 2. Rows changed, evidence added, and the clause each piece asserts

Before citing each file, I opened it and read the assertions, not only the handbacks:

- `apps/web/e2e/p3-journeys.spec.ts`: all 18 tests read in full.
- `apps/api/src/modules/workflows/g4.test.ts`: read in full.
- `apps/api/test/integration/gates/g4.test.ts`: the "refused with the missing items named", "end to end" and "submitter cannot decide" tests.

Journey numbers below are the spec's test prefixes. Each journey runs in chromium-en and chromium-ar on the real stack. "Partial" means the spec asserts only part of the acceptance. The rest remains asserted by the API or unit tests the row already cites, and the note says so.

| Row | Added | Clause asserted (spec test) | Coverage |
|---|---|---|---|
| REQ-DLV-035 | spec | G4 end to end (6a → 6c):<br>• refused listing 'Owners' and 'Finance validation';<br>• 403/403/409;<br>• the synthetic SP approves, and the phase shows Transform.<br>Also: 3.30 (2a), 95% refused (2a), the cycle named (3b). | full for "G4 approval flow runs end to end" |
| REQ-S04-006 | spec; `workflows/g4.test.ts` | Spec:<br>• 403 `gate.not_approver` for FIN;<br>• 403 `gate.submitter_cannot_decide` for a synthetic TL+SP submitter;<br>• 409 `gate.submission_superseded` (6b, 6c);<br>• the named initiative is in the 'Owners' item (6a).<br>Unit test: 'Funding decision missing: INI-01 <name>' and 'Capacity commitment missing: INI-01 <name>' (the funding/capacity naming clause). | spec: 403/403/409; the funding/capacity naming comes from the unit and integration tests |
| REQ-PB-019 | spec | `g4.owner_missing` 'Owners' plus the initiative's code and name in the G4 refusal (6a); readiness then shows `g4.owners` incomplete | full |
| REQ-PB-004 | spec | Launch refused with `initiative.direction_not_approved`, 'North Star, outcomes and target state not yet approved'; succeeds after G2 and G3 (1d) | full (the 422 status itself is checked at API level) |
| REQ-PB-006 | spec | 'Outcome before activity' refusal; accepted once linked with a KPI (1c) | full |
| REQ-PB-007 | spec | Draft submit before G1 refused with `initiative.g1_not_approved`; readiness lists all five missing areas (1a) | full |
| REQ-PB-022 | spec | Pre-G1 submit refused (1a); G1 approved with the three confirmations (1b) | partial: no browser test of a G1 approval refused without the confirmations |
| REQ-PB-048 | spec | 5,4,3,2,1 shows 3.30 (2a) | partial: score 6 and 'incomplete' are not in the browser |
| REQ-PB-049 | spec | 95% refused with nothing sent; v2 (risk 10, strategic fit 15) proposed and approved; history shows 'weight version 2' (2a, 2b) | partial: the v1 reference of older scores is not in the browser |
| REQ-S09-001 | spec | 57.5 with the conversion label; the ranked row still shows 3.30 (2a) | full |
| REQ-S09-003 | spec | 'Selected - unfunded' (2b); Funded only after the funding decision (5b) | partial: no browser test of an unfunded launch being refused |
| REQ-S09-005 | spec | Override without a reason refused, nothing sent; history cause 'weight version 2' (2a, 2b) | full |
| REQ-PB-050 | spec | The four B0079 wave names, verbatim; four horizons (3a) | partial: horizon values and overlap are not in the browser |
| REQ-S09-006 | spec | Timeline, table and board show the same moved date; stale move gets 409 with the conflict banner (3a) | full |
| REQ-S09-008 | spec | C→A refused naming `INI-c → INI-a → INI-b → INI-c`; A→B flagged `schedule.needed_by_conflict` (3b) | full |
| REQ-PB-053 | spec | Ten section fieldsets filled and saved; one class shown per line; exact SAR decimal totals (4b) | partial: no browser test of a two-class line being refused |
| REQ-PB-054 | spec | Initiative-level case for one initiative; rolled up once into the transformation case (4b) | partial: no browser test of the roll-up changing after an edit |
| REQ-PB-055 | spec | FIN validates baselines and formula v1; the author is not offered validation and gets 403 (4c); G4 refused listing 'Finance validation' (6a) | partial: in the browser the trigger is a **Stale case baseline**, not an unvalidated formula (that case is in `gates/g4.test.ts` and `workflows/g4.test.ts`) |
| REQ-PB-057 | spec | Revenue example previews exactly 100000 SAR; cost example exactly 500000 SAR (4a) | full |
| REQ-S05-005 | spec | One class per line; totals count each distinct line once (4b) | partial: no browser test of a two-class line being refused |
| REQ-S08-007 | spec | Monthly ARPU × annual population refused with `formula.period_mismatch`, no version saved; 100000 SAR (4a) | full |
| REQ-PB-059 | spec | `capacity.over_allocated`, 'short by 1.5 FTE' (5a); G4 lists the initiative without an owner (6a) | full |
| REQ-S09-004 | spec | Capacity conflict indicator (5a) | partial: the journey's schedule flag is `needed_by_conflict`, not `before_predecessor` |

**BE-F's G4 tests.**

- `apps/api/test/integration/gates/g4.test.ts` was already in the evidence of REQ-PB-019, REQ-S04-006 and REQ-DLV-035. After BE-F's `g4.schedule_unknown` change it still asserts 'Owners: INI-nn <name>', 'Funding decision missing', 'Capacity commitment missing', 'Roadmap: …', 403/403/409 and the end-to-end flow to Transform.
- `apps/api/src/modules/workflows/g4.test.ts` was already cited on REQ-PB-019. I added it to REQ-S04-006.

## 3. Checks actually run

Environment: worktree above, offline sandbox, the `node` on PATH, `python3 -I` for the CSV scripts (kept in `$TMPDIR`, not in the repo).

| Check | Command | Exit | Result |
|---|---|---|---|
| CSV round-trip before the edit | `python3 -I $TMPDIR/s/rt.py docs/delivery/requirements.csv` | 0 | `LF trailing-newline True`, `physical lines 414 records 413`, `roundtrip mismatches 0` |
| Register update | `python3 -I $TMPDIR/s/upd.py docs/delivery/requirements.csv` | 0 | `changed 23` |
| CSV round-trip after the edit | same `rt.py` | 0 | `physical lines 414 records 413`, `roundtrip mismatches 0` |
| Column count, scope of change, cited files exist | `python3 -I $TMPDIR/s/chk.py docs/delivery/requirements.csv` | 0 | `header columns 19 ; distinct row column counts [19] ; records 413 (old 413 )`, `rows changed 23`, `columns changed ['evidence', 'notes']`; old evidence kept in order, old notes kept as a prefix; no `MISSING FILE` lines |
| Register DG3 | `node tools/gates/validate.mjs --register DG3` | 0 | `PASS register rules at DG3` |
| Register DG2 | `node tools/gates/validate.mjs --register DG2` | 0 | `PASS register rules at DG2` |
| Preceding gate | `node tools/gates/validate.mjs --historical --stage DG2` | 0 | `PASS gate DG2 (historical)` |
| Diff scope | `git diff --stat` | 0 | `docs/delivery/requirements.csv \| 46 +++---` (23 insertions, 23 deletions); this handback is a new untracked file |

I ran no product tests. This task changes only the register, and the spec's run evidence is FE-D's (see O-B1).

## 4. Known gaps and observations (stated plainly)

- **REQ-PB-056 left unchanged (deviation from the assignment's list "REQ-PB-053–057").**
  - REQ-PB-056's acceptance: all six T09 columns persist; Confidence outside H/M/L is rejected; an undefined variable is rejected.
  - `p3-journeys.spec.ts` asserts none of these. Journey 4a covers the examples and the period mismatch only.
  - Citing the spec would break the "check that it asserts the acceptance clause" rule, so I didn't add it.
- **`workflows/g4.test.ts` not added to REQ-DLV-035 (deviation).**
  - That row's G4 clause is "G4 approval flow runs end to end".
  - The unit test checks the eight evaluators in memory. It doesn't run the flow.
  - The end-to-end clause is asserted by `gates/g4.test.ts` (already cited) and now by the journey spec.
- **O-B1, the FE-D run log doesn't match the committed spec's line numbers.**
  - The test titles in `T-DG3-FE-D-evidence/e2e-p3-journeys-c-utf8.log` match the committed file exactly (diffed).
  - The line numbers don't: for example, the log has `1a` at `:146` and `7.` at `:1399`. The committed file has `1a` at line 186 and only 1259 lines.
  - So the logged run was on a different layout of the file, probably before a reformat. I can't tie it to the committed content, so I didn't cite FE-D's e2e logs.
  - The QA re-run of `apps/web/e2e` on the frozen candidate is the run evidence that counts for the 23 rows. The orchestrator may want FE-D, or QA, to confirm.
- **O-B2, run currency for the G4 rows (follows from AN-P3 O-3).**
  - The rows still cite the pre-BE-F `T-DG3-ARCH-04-evidence/integration.log`.
  - `git diff --stat ca396d5 HEAD -- apps/api packages` is empty, so BE-F's own logs (`T-DG3-BE-F-evidence/test-integration.log`: `gates/g4.test.ts (5 tests)` passed, 788/788; `test-c-utf8.log`: `workflows/g4.test.ts (5 tests)`, 1523/1523) match the current API.
  - I didn't add them to `evidence`, because the assignment named only the test files. BE-G's concurrent `apps/api/**` test work will change the tree again before the freeze anyway.
- **FE-D's own §5 observation 1.** With several in-scope initiatives without owners, the G4 refusal message joins items in one line. That's a backend or UI observation, not a register matter. It doesn't affect the cited clauses, which involve one initiative.
- All other rows and columns are unchanged. No status changed: all 23 rows were and remain `IMPLEMENTED` with `final_gate` DG3.

## 5. Merge instructions

- Only `docs/delivery/requirements.csv` (23 lines, each a full row rewrite with the same 19 columns) and this new handback.
- There are no migrations and no code.
- Possible conflict: any concurrent edit to the same 23 rows. BE-G and FE-F don't write the register.
