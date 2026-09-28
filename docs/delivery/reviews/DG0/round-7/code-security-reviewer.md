# DG0 round 7: code-security review (narrative)

- **Reviewer:** code-security-reviewer
- **Run:** `DG0-T-DG0-REV-SEC-R7-code-security-reviewer-20260928T162818Z-b9224c10`
- **Candidate:** `sha256:dee0316dce953eb00665cbfc452ba9da140dce70b9faa0c028af0de38626cece` @ `e11b5f08`, confirmed by recomputation.
- **Verdict:** FAIL

## New findings

### F-DG0-132 (High, mandatory): empty transcripts skip every transcript check

In `tools/gates/lib/rules.mjs`, `checkInvocation` parses the transcript into `lines` and then runs these checks only inside `if (lines.length) { … }` (line 294):
- the init-line check;
- the D-022 CLI-replayed prompt check;
- the final-result check.

The D-021 independent transcript replay of bound outputs is also guarded by `lines.length` (line 341).

A transcript that is valid gzip of `""` (or of blank lines) parses to `[]`. It then satisfies everything except the SHA-256 in `meta.json`, and the forger writes that SHA-256 anyway.

My reproduction (`round-7/repro-r7.test.mjs`) shows that `validateGate` returns no errors in each of these cases:
- a reviewer run whose transcript is empty;
- a record rewritten after its run, where the round-7 replay otherwise catches it;
- a closure of a High finding;
- the committed, approved forgery in `--historical` mode.

The gap predates round 7, because the same tests pass on `a059b55`. It brings back the original F-DG0-102 forgery cost: meta, result and an empty gzip. That is well short of the "complete, internally consistent run directory" that D-021 discloses as the residual.

**Fix:**
- Reject an empty parsed transcript.
- Run the init, prompt and result checks unconditionally.
- Treat a `null` replay as an error.
- Add regression tests for `gzip("")` and `gzip("\n")`.

### F-DG0-133 (Low): the prompt's assignment isn't compared with meta

The replayed prompt names the assignment path and its SHA-256, and it is the only hash-bound statement of what the run was asked to do. The validator compares the record's assignment with `meta.assignment` only. I'd accept this as an observation once F-DG0-132 is fixed.

## Re-confirmation of my 23 earlier findings

I reproduced every original failure again in this run on its original commit:
- `26642c72`, `83860be3`, `540b3c69` and `53f5d176` (the four original repro suites);
- `a059b55`, for the round-6 residual and F-DG0-130/131;
- the runner behaviour on `53f5d176`.

I then tested each fix on `e11b5f08`. Result: 22 findings are CLOSED_VERIFIED, and F-DG0-102 stays OPEN because of the F-DG0-132 gap.

- **F-DG0-115 (round-6 residual):** the single-blob write-once rule, with events against every parent, rejects the back-dated side branch plus merge. So do the M-event and back-dating checks. I found no ordering-, colour- or root-related way around it. Real history passes the new checks.
- **F-DG0-130/131:** in a fresh clone the whole prefreeze passes, and the tree and candidate ID are unchanged. The dirty check now uses the candidate definition itself and fails closed.

## Independent checks of the round-7 repairs

- **D-022:** this run's own real CLI transcript carries the prompt as a `user` event with `isReplay: true`. The candidate's `checkInvocation` accepts it for my role and rejects it for another role.
- **Runner:** with a stub that mirrors the real stdin/replay behaviour, runs bind correctly, including resumes. Denied and shell edits are not bound, the exit code propagates, a failed auto-commit exits 70, and argument or path injection is not possible.
- **Guard:** it fails closed without git. Every protected surface is blocked end to end, including through a symlinked directory, a planted `.git`, case changes and `..` segments. The Bash gap is disclosed.
- **CI and repository hygiene:** CI uses pinned SHAs, `contents: read` and `fetch-depth: 0`. The repository has no secrets and no CDN references, and `* -text` makes autocrlf checkouts reproduce the candidate.

## Harness corrections (disclosed)

These are mistakes in my own probe scripts; each is annotated in its log.
- The first no-git guard probe returned 127 because `env` couldn't find `bash`. It was re-run correctly in `08`.
- The first settings-hook check used a wrong match pattern. It was re-run in `13`.
- One `PIPESTATUS` in `18` captured `tail`'s status instead of prefreeze's. The FAIL line is the result that counts.
