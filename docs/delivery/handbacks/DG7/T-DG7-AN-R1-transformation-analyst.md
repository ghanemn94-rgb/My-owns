# Handback T-DG7-AN-R1 (transformation-analyst): register rewording of ADR-0064 A2.8

- **Stage:** P7, gate DG7 (BUILDING). Repair round 3 (D-260, direction 1).
- **Invocation reference:** `{"kind":"claude-code-cli-session","run_id":"DG7-T-DG7-AN-R1-transformation-analyst-20261113T160035Z-7a3c789c","session_id":"7a3c789c-adf8-429a-afac-3762deb6bd35"}`
- **Assignment:** `docs/delivery/assignments/DG7/T-DG7-AN-R1.md`. Its SHA-256 `e562ad828917b3de61757af312dad4c519e389c9d955398a665fd5c6e86526fb` was verified with `sha256sum` before starting.
- **Base:** `HEAD` = `2207781fa2379b169b663a28b9e503943d2cbf56` on `claude/mobily-transformation-platform-dg6-regate`. Before writing, `git status --short` showed only this run's own `docs/delivery/runs/DG7/…-7a3c789c/` directory.
- **Time:** started 2026-11-13 16:00:45 UTC. Last check finished at 16:09:05 UTC (`date -u`).
- **Two gate systems:** nothing here grants or implies a G1–G6, Finance or IT approval. This task makes no DG7 decision.

## 1. Changed files

| File | Purpose |
| --- | --- |
| `docs/delivery/requirements.csv` | Exactly the two replacements of ADR-0064 Amendment 2 §A2.8, decision 1. No other byte changed. |
| `docs/delivery/handbacks/DG7/T-DG7-AN-R1-transformation-analyst.md` | This handback. |
| `docs/delivery/handbacks/DG7/T-DG7-AN-R1-evidence/*` | Logs and diffs for the checks below. |

No other file was written. Specifically, `docs/analysis/parts/**` was not changed (see §4, gap 1).

## 2. Behaviour delivered

| Row | Column | Before | After |
| --- | --- | --- | --- |
| REQ-DLV-006 (line 100) | `procedure` | `the runner creates /var/tmp/mth-run.XXXXXX (mode 700)` | `the runner creates mth-run.XXXXXX under /var/tmp (mode 700)` |
| REQ-DLV-023 (line 117) | `notes` | `the agent-writable $TMPDIR (/tmp/claude-0)` | `the agent-writable $TMPDIR (claude-0 under /tmp)` |

- **Placement checked.** Before editing, I parsed the CSV with an RFC 4180 parser. Each old text occurs exactly once in the file, and in the column A2.8 names.
- **Meaning unchanged.** The edit only reorders words so that no absolute build-host path remains. Requirement status, classification, increments, final gate, evidence and every other field are untouched.
- **Effect.** ADR-0062 §8 rule R2 no longer hits the register snapshot. T-R16 (A2.8 decision 2) now passes, which removes blocker (1) of D-260 for the A18 drill's asset scan. Whether archives built from the new HEAD now pass `build-from-archive` was **not** run here; that belongs to DO-D4 or the reviewers.

## 3. Checks actually run

Environment for all checks: Node v24.21.0 (`/opt/nvm/versions/node/v24.21.0/bin`), offline, inside the agent's bubblewrap sandbox, cwd `/home/user/My-owns`.

| # | Command | Exit | Result / evidence |
| --- | --- | --- | --- |
| 1 | `node tools/gates/validate.mjs --historical --stage DG6` (start, 16:01 UTC) | 0 | `PASS gate DG6 (historical)`. My first invocation piped into `tail`, so the `EXIT=0` it printed was `tail`'s. The validator's own exit status is captured in #9. |
| 2 | `node --test apps/api/scripts/register-snapshot.test.mjs` (**before** the edit) | **1** | Expected failure. The assertion's actual value was `['REQ-DLV-006 procedure R2', 'REQ-DLV-023 notes R2']`. `T-DG7-AN-R1-evidence/t-r16-before.log` |
| 3 | The two replacements, made with the Edit tool | n/a | Exact `old_string`, unique in the file. |
| 4 | `git diff --stat -- .` | 0 | `docs/delivery/requirements.csv \| 4 ++--`, `1 file changed, 2 insertions(+), 2 deletions(-)`. This is the only tracked change. |
| 5 | Byte proof: take `git show HEAD:docs/delivery/requirements.csv`, apply the two replacements in memory, compare with the working file (node script) | 0 | `IDENTICAL: working register == HEAD register with exactly the two A2.8 replacements applied`. Each old text occurs once in HEAD. SHA-256 before `f08ff839…341827`, after `5397e2be…604ad5e`. Size 879129 → 879141 bytes (+12, which is +6 per replacement). `T-DG7-AN-R1-evidence/byte-proof.log` |
| 6 | `git diff docs/delivery/requirements.csv` and `git diff --word-diff=plain -U0 …` | 0 | Two changed lines, 100 and 117. The word diff shows only `[-/var/tmp/mth-run.XXXXXX-]{+mth-run.XXXXXX under /var/tmp+}` and `[-(/tmp/claude-0)-]{+(claude-0 under /tmp)+}`. `T-DG7-AN-R1-evidence/register.diff`, `register-word-diff.txt` |
| 7 | `node --test apps/api/scripts/register-snapshot.test.mjs` (T-R16, **after** the edit) | **0** | `tests 23, pass 23, fail 0`, including `✔ T-R16: the register snapshot passes the T1 asset scan (A2.8)`. `T-DG7-AN-R1-evidence/t-r16-after.log` |
| 8a | `node_modules/.bin/prettier --check docs/delivery/requirements.csv` | 0 | `All matched files use Prettier code style!` **Caveat:** `prettier --file-info docs/delivery/requirements.csv` returns `{ "ignored": true, "inferredParser": null }`. Prettier skips the register, so this check says nothing about the CSV's content. `prettier-register.log` |
| 8b | `node_modules/.bin/prettier --check .` (repository-wide, before this handback existed) | 0 | `All matched files use Prettier code style!` `prettier-repo.log` |
| 8c | `node_modules/.bin/prettier --check docs/delivery/handbacks/DG7/T-DG7-AN-R1-transformation-analyst.md` (this file) | see §3a | |
| 9 | `node tools/gates/validate.mjs --historical --stage DG6` (end; exit status captured with `echo $?` directly, no pipe) | see §3a | `T-DG7-AN-R1-evidence/validate-dg6-historical-end.log` |

### 3a. End-of-run results

- **Check 9:** `node tools/gates/validate.mjs --historical --stage DG6`, run after the register edit. **Exit 0**, output `PASS gate DG6 (historical)` and `validate EXIT=0`. The exit status was captured directly. `T-DG7-AN-R1-evidence/validate-dg6-historical-end.log`
- **Check 8c and the final repository-wide prettier run:** the exit codes are recorded in `T-DG7-AN-R1-evidence/prettier-final.log`. They were run after this section was written, so its last edit is covered. The orchestrator can see the result in that log. I report it in my final message, and I do not pre-state it here.

## 4. Known gaps and questions

1. **Pre-existing: the register no longer equals the merge of `docs/analysis/parts`.** This is not caused by this task.
   - **The invariant.** REQ-DLV-023's own procedure and D-026 describe the pre-freeze check "register equals the merge of docs/analysis/parts (sandboxed)" (`tools/gates/prefreeze.sh` l.29–30). It re-runs `tools/source/merge_register.py` and fails if `requirements.csv` differs.
   - **The measurement.** In a scratch copy (deleted afterwards), the merge of the current part files exits 0 but reproduces only 82 of the 412 rows of the **HEAD** register. 330 rows differ, and the first differing ones are REQ-DLV-033… and REQ-PB-001…. Register edits since DG5 (for example T-DG5-AN-P5A/B/C and the D-238 carry) changed `requirements.csv` without the part files. `T-DG7-AN-R1-evidence/merge-divergence.log`
   - **The A2.8 texts.** `docs/analysis/parts/req-dlv-s14-s21.csv` still holds the two old texts (2 lines). I deliberately left it unchanged. The assignment allows "exactly the two replacements … and nothing else". Editing the part file would not restore the invariant, which is already broken by 330 rows.
   - **Question for the orchestrator.** Is the register-equals-merge pre-freeze check still in force for DG7? If it is, it fails at HEAD regardless of this task, and the part files need a separate, assigned re-sync, or a decision that retires the parts as a source. If it was retired, I found no decision saying so; a `grep` of `decisions.md` found none.
2. **Not flagged, not changed:** REQ-DLV-023's `procedure` also contains `/tmp/src.git` (the read-only bind path inside the sandbox). Neither A2.8's measured scan (`register-t1-scan.log`) nor T-R16 reports it, and it is outside the two permitted replacements. I mention it only so that no reviewer is surprised.
3. **Naming:** ADR-0064 A2.8 assigns the edit to the "requirements-analyst". D-260 and this assignment give it to the transformation-analyst, which owns the register. I followed the assignment.
4. **Interpretation:** the assignment asks me to read "your Amendment 1". No analyst amendment exists in `docs/delivery/assignments/DG7/` (only `T-DG7-AN-R1.md`). I read it as ADR-0064 Amendment 1 (T-DG7-ARCH-R2) and read that amendment's §A1 context. The task itself does not depend on it.
5. **Not run (outside the assignment's acceptance):** `pnpm test`, `pnpm -r typecheck`, `pnpm lint`, an archive build or `build-from-archive`, and the T-B11/A18 drill. None of them is claimed.

## 5. Merge instructions

- Commit `docs/delivery/requirements.csv`, this handback and `docs/delivery/handbacks/DG7/T-DG7-AN-R1-evidence/`.
- No migrations, ordering constraints or code changes. The edit does not conflict with BE-R3, DO-D4 or ARCH-R4 unless they also edit lines 100 or 117 of the register; they should not.
- After merging, `node --test apps/api/scripts/register-snapshot.test.mjs` should exit 0 on the merged tree (it does on this one).
