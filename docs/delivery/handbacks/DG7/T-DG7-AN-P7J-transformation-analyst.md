# Handback T-DG7-AN-P7J (transformation-analyst): register clauses citing old-branch findings (F-DG7-1022)

- **Stage:** DG7 (BUILDING). Branch actually checked out: `claude/mobily-transformation-platform-dg7-regate`. The assignment names `claude/mobily-transformation-platform-dg6-regate` as the working branch, but that is the old branch (head `1612f85fc`, D-281). I worked on the checked-out re-gate branch, which is the one the assignment's task text means ("the DG7 gate on this branch").
- **Base:** at the start `git rev-parse HEAD` was `faa1154ca9d15e160bf39f5a2a0df575ec1bf133`. During my run the orchestrator committed `90cbc1c3b350ce51a8944d136a7aca34ec214c1e` (D-283, round-2 outcome and the repair assignments). `git diff --quiet faa1154ca 90cbc1c3b -- docs/delivery/requirements.csv` returned 0, so the register I edited is the same at both. My register notes name base `90cbc1c3b`.
- **Assignment:** `docs/delivery/assignments/DG7/T-DG7-AN-P7J.md`, sha256 `e7ff529d…6cb0` (checked with `sha256sum`).
- **Invocation:** run `DG7-T-DG7-AN-P7J-transformation-analyst-20261117T164920Z-2bb73fae`, session `2bb73fae-5e79-45c3-a9f6-7d3b458d3e89`.
- **Finding:** F-DG7-1022 (Low, not mandatory, REOPENED by qa-verifier in round 2). I do not close it. Only the reporter or another non-author reviewer can verify it.
- **Time:** `date -u` start 16:49:30Z, end recorded in §3.
- **Two gate systems.** This is a records-only change. It grants and implies no DG7 approval and no G1–G6, Finance or IT approval.

**Inputs read:**
- the qa-verifier round-2 verification note for F-DG7-1022;
- D-281, D-282, D-283 and D-270 in `decisions.md`;
- `p7-work-split.md` §1–§2;
- `tools/release/release-notes.mjs` (`laterClauseOf`: the clause is the text after `completes-after-gate:` to the end of the line);
- `docs/handover/known-limitations.md` (DG7 rows for C2, C3 and C5);
- the old branch's `findings.json` through `git show 1612f85fc:docs/delivery/findings.json` (read-only).

I read p7-plan and the ADRs only as far as the release-notes generator and register (ADR-0071 via the generator). The task is a register wording change, so I did not read the rest of D-243 onward in full.

## 1. Files changed

| File | Purpose |
| --- | --- |
| `docs/delivery/requirements.csv` | Only the `notes` column of 25 rows changes. No status, acceptance, evidence or other column changes, and the row order is the same. Before: sha256 `edf229cf…93c0`. After: `6c3604f1…d7f6`. Row count 412. |
| `docs/delivery/handbacks/DG7/T-DG7-AN-P7J-transformation-analyst.md` | This handback. |
| `docs/delivery/handbacks/DG7/T-DG7-AN-P7J-evidence/*` | Logs (listed in §3), the per-row old/new text (`07-changed-rows.txt`) and the script that made the edit (`p7j.py`, run with `python3 -I`; it asserts each old later clause exactly before replacing it). |

I did **not** change `docs/handover/release-notes.md`. It is generated, and `docs/handover/**` is outside the analyst write scope. See §4.

## 2. Behaviour delivered, per requirement (the 25 changed rows)

Three changes are applied to every row whose notes cite an `F-DG7-9xx` id:

**(a) Each cited id is qualified where it is cited.**
- In the row's earlier text, the first `F-DG7-9xx` occurrence is followed by `[old-branch record: branch claude/mobily-transformation-platform-dg6-regate at 1612f85fc, D-281/D-282]`. Later occurrences are followed by `[old-branch record]`.
- Bare numeric lists are rewritten with full ids and qualified:
  - REQ-DLV-014: "every round-1 finding (913, 914, 953-956)".
  - REQ-DLV-018: "Each of 913, 914 and 953-956".
- The scan (`01-citation-scan.log`) finds 53 occurrences in the history text, 0 of them unqualified.

**(b) A dated note is added to each row.** The note reads "DG7 analyst note (T-DG7-AN-P7J, base 90cbc1c3b, 2026-11-17; F-DG7-1022, D-281, D-282)". It is placed before the `completes-after-gate:` marker, or at the end of the row if there is no marker. It says:
- the row's cited ids are old-branch records;
- their records are at `1612f85fc`, and there each is CLOSED_VERIFIED (I checked all 15 ids with `git show`);
- this branch's `findings.json` holds none of them, `validate --stage DG7` here cannot show them, and they are not findings of this gate;
- they are historical citations, not conditions of the row.

Where the row cites reviewer evidence under `test-evidence/DG7/qa/round-N/`, the note says those paths refer to `1612f85fc` (D-281), and that a directory of the same name on this branch holds different records. No other row in the register cites such paths.

Where an older note says an id "stays OPEN until" a reviewer verifies it (REQ-S16-024 F-DG7-913, REQ-S17-004 F-DG7-914, REQ-S20-026 F-DG7-954), the note says that this is old-branch history, verified closed there.

**(c) Later clauses.**
- **Rewritten (4).** These now name only what the DG7 gate on this branch can show (old and new text in `07-changed-rows.txt`):
  - **REQ-DLV-012:** no longer counts "F-DG7-960's FE-C3 and F-DG7-920's DO-D8 handback". It names the seven DG7 C3 hits that `protocol-audit.mjs --stage DG7` reports on this branch by handback: the five D-270 handbacks T-DG7-AN-P7B, ARCH-R2, ARCH-R5, BE-R5 and DO-A2, plus T-DG7-FE-C3 and T-DG7-DO-D8. I confirmed these seven with a run at head `90cbc1c3b`: C3 HIT 7, the same seven files, matching known-limitations "C3 DG7 7".
  - **REQ-DLV-014:** no longer says "each DG7 finding (round 2: 915, 935, 960-963)". It now reads: every DG7 finding in this branch's `findings.json` (the re-gate rounds' findings, F-DG7-1001 onward) fixed and verified by a non-owner before approval, or, for a Low non-mandatory finding, accepted as an observation by a specialist and the release-auditor under the protocol. This is shown by `validate.mjs --stage DG7` at the gate on this branch. See open question 1.
  - **REQ-DLV-011** (cites F-DG7-935 in its notes): the clause said "the D-270 C2 hits". On this branch C2 reports 25 hits: 24 assignment-missing-elements, plus the ARCH-R6 assignment-hash mismatch, which D-282 discloses as F-DG7-1001. The clause now names both.
  - **REQ-DLV-018:** "the findings of the later DG7 rounds" now reads "this branch's DG7 findings (the re-gate rounds' findings, F-DG7-1001 onward)". protocol-audit C7 counts exactly those (its own scope note says so).
- **Unchanged (14).** These cite no old-branch id and name a condition shown on this branch, at the DG7 gate or by the seal after it where they say so: REQ-DLV-005, 008, 024, 028, 030, 031, 039, 040, REQ-S02-005, S19-015, S20-031, S21-002, S21-003 and S21-004.
  - REQ-DLV-024's "D-270 C5 hit": C5 reports 1 DG7 hit here.
  - REQ-S02-005's "23 later clauses": the generator still reports 23.
- **No later clause (7):** REQ-S01-006, S16-024, S17-004, S19-017, S20-018, S20-022 and S20-026.

The register now has no later clause citing an `F-DG7-9xx` id (`01-citation-scan.log`, last line).

**Changed rows (25):**

| Rows | Later clause |
| --- | --- |
| REQ-DLV-011, REQ-DLV-012, REQ-DLV-014, REQ-DLV-018 | rewritten |
| REQ-DLV-005, 008, 024, 028, 030, 031, 039, 040; REQ-S02-005, S19-015, S20-031, S21-002, S21-003, S21-004 | unchanged |
| REQ-S01-006, S16-024, S17-004, S19-017, S20-018, S20-022, S20-026 | none |

Status column for all 25 rows: IMPLEMENTED before and after. Acceptance: byte-identical (checked per row in `07-changed-rows.txt`).

## 3. Checks actually run

Environment for all checks:
- Node 24.21.0;
- `MTH_PNPM_OFFLINE=1`;
- analyst sandbox, in which `node_modules/`, `test-results/` and HOME are read-only;
- repository root at `90cbc1c3b` plus the uncommitted work of this run and of the concurrent DO-D12 and SA-ADR72 runs.

| # | Command | Result | Log |
| --- | --- | --- | --- |
| 1 | Citation scan (python, in log header) | 25 rows; 53 occurrences in history text, 0 unqualified; 0 later clauses with an old id | `01-citation-scan.log` |
| 2 | `node tools/release/release-notes.mjs --csv <register> --out $TMPDIR/… --write` (before and after), then `diff` | exit 0, "0 unfinished item(s), 23 later clause(s)". The diff is exactly the four rewritten later clauses plus the register path/SHA lines. | `02-release-notes-diff.txt` |
| 4 | `node tools/release/release-notes.mjs --csv docs/delivery/requirements.csv --out docs/handover/release-notes.md --check` | **exit 1**, "out of date (run with --write)". Expected: the shipped release notes must be regenerated (§4). | `04-release-notes-check.log` |
| 5 | `node tools/gates/validate.mjs --historical --stage DG6` | **exit 0**, `PASS gate DG6 (historical)` | `05-validate-historical-DG6.log` |
| 6 | `node --test tools/release/tests/*.test.mjs licenses/tests/*.test.mjs` | **exit 1**: 479 tests, 475 pass, 2 fail, 2 skipped. Neither failure comes from the register (see below). | `06-release-tool-tests.log` |
| 9 | `node --test tools/release/tests/release-notes.test.mjs tools/release/tests/check-handover.test.mjs` | **exit 0**, 65/65 | `09-release-notes-and-handover-tests.log` |
| 10 | `pnpm -r typecheck`; `pnpm lint`; `pnpm openapi:lint` | **exit 0** each | `10-*.log` |
| 11 | `git ls-files -co --exclude-standard -z \| xargs -0 npx prettier --check --ignore-unknown` | **exit 0** | `11-prettier-check.log` |
| 12 | `pnpm test`, as written | **exit 1, BLOCKED**: vitest cannot write `node_modules/.vite-temp/` (EROFS, analyst sandbox), and no test ran. I then ran the script's three commands with `--configLoader runner`. Results are below. | `12-pnpm-test.log` |

The two failures in check 6:
- **T-A5** (build from archive in a network namespace): `pnpm install` failed with EROFS creating a symlink in the pnpm store under the read-only HOME (`/root/.local/share/pnpm/store`).
- **T-M2 (end)**: the repository's `git status` changed during the 30-minute rehearsal. The changes were my own evidence files written meanwhile and the concurrent DO-D12/SA-ADR72 edits (ADR-0066). Both are environment effects of this run, not product defects. I did not rerun them where they could pass.

Integration tests with `tests/qa/support/with-pg.sh` were not run. I touched no integration test, and no product code changed (the register snapshot is built from the CSV at build time; nothing in the repository embeds it).

Check 12, the script's three vitest commands with `--configLoader runner` (combined **exit 1**):
- **unit-node:** 3042 tests, 3040 pass, 2 fail.
  - `tests/qa/unit/a20-p6-token-contrast.test.ts` fails with EROFS writing `test-results/qa-a20/contrast-pairs.txt`, which is read-only in this sandbox. This is an environment failure.
  - `tests/qa/unit/a13-child-ready-race.test.ts` timed out under load. I reran it alone as check 13 (`pnpm exec vitest run --project unit-node --configLoader runner tests/qa/unit/a13-child-ready-race.test.ts`): **exit 0**, 6/6 (`13-a13-rerun.log`).
- **unit-web:** 2199/2199 pass.
- **unit-formula-nocodegen:** 259 pass, 2 skipped.

End time: `date -u` 17:31:30Z, about 42 minutes in total.

## 4. Known gaps / not done

1. **The release notes are not regenerated.** `docs/handover/release-notes.md` is generated from the register, and the analyst write scope excludes `docs/handover/**`. `release-notes --check` therefore exits 1 until someone with that scope (the orchestrator or devops) runs:

   ```
   node tools/release/release-notes.mjs --csv docs/delivery/requirements.csv --out docs/handover/release-notes.md --write
   ```

   The expected diff is in `02-release-notes-diff.txt` (four later-clause lines, plus the register SHA in the English and Arabic identity lines). After that, release-notes.md l.35–37 no longer cites F-DG7-9xx ids. This was the second place the finding named.
2. **No handover file qualifies the old-branch ids yet.** The qa note observes that D-282 ships only in the archive's `source/`. After regeneration, the release notes' later clauses cite no old-branch id. Whether `known-limitations.md` also needs a line is for the orchestrator. It is outside my scope.
3. `pnpm test`, as written, is BLOCKED in this sandbox. The `--configLoader runner` equivalent has two unit-node failures:
   - A20 contrast, EROFS writing `test-results/qa-a20/`;
   - A13 READY race, a timeout under load (the known flake recorded in REQ-S20-031).

   Check 6 has two environment failures (T-A5 and T-M2). None of these is from this change, but none is a pass either.
4. The proposed ids `F-DG7-qa-C-1` and `F-DG7-qa-C-2` (REQ-S20-018 and one other row) are old-branch proposals too. They are not F-DG7-9xx ids, and I left them unqualified apart from the row note.

## 5. Open questions and merge instructions

**Open questions:**
1. REQ-DLV-014's clause now admits an ACCEPTED_OBSERVATION (Low, non-mandatory, two sidecars) as well as fixed-and-verified. That is what the validator accepts at a gate, and F-DG7-1022 itself may be decided that way. The acceptance text ("every finding raised has a fix revision plus an independent verification by a non-owner") is unchanged. The domain reviewer or release-auditor should confirm that this reading is acceptable. If not, the clause should drop the parenthesis.
2. The assignment names `…dg6-regate` as the working branch. I took it to be a slip for the checked-out `…dg7-regate`.

**Merge instructions:**
- No migrations.
- Commit `docs/delivery/requirements.csv` together with a regenerated `docs/handover/release-notes.md` (command in §4.1). Otherwise `release-notes --check` and the handover check that compares it fail.
- No conflicts expected: the D-283 commit did not touch the register.
