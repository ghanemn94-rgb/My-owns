# DG0 round 24: code-security-reviewer

- **Candidate:** `sha256:f0f3a93a1fcf33e58b1d553e39205cc8bc1764407189b69904d2d58e976f351a` (source `6db3b83`).
- **Run:** `DG0-T-DG0-REV-SEC-R24-code-security-reviewer-20260930T132356Z-9132b6ee`
- **Verdict:** **PASS**, with one Low observation (F-DG0-168).

## What changed and what I checked
The candidate changed only `tools/gates/lib/rules.mjs`, its test file and `decisions.md` (D-040).

1. **Run-head binding (F-DG0-166/249). Closed.**
   - `checkClosure` now requires a CLOSED_VERIFIED `fix_revision` to be an ancestor of two commits:
     - the verifying run's `head_commit_at_start`;
     - the gate candidate.
   - The round's `source_commit` is no longer consulted. The conditional skip at `rules.mjs:738` cannot be used as an escape, because `checkInvocation` already errors on every malformed or absent head.
   - I reran my round-23 forge (SEC24-1) on `--no-local` clones of both commits:
     - baseline (`6438e20`): 0 errors;
     - candidate (`6db3b83`): rejected with "not in the verifying run's starting history".
   - These protections are unchanged:
     - absent or typo'd fixes are rejected (SEC24-3);
     - malformed or absent verifier heads are rejected (SEC24-4);
     - the immutable-field lock holds (SEC24-5);
     - the genuine-fix control passes (SEC24-2).
   - On the real history, all 110 closures satisfy the binding.
2. **Comments (F-DG0-014/167). Closed.** The `commitPresent` and `findManifest` header comments now say that `findManifest`'s content-preserving tolerance is the only absence tolerance. The code agrees.
3. **New, F-DG0-168 (Low, not mandatory). D-040 replaced the round-candidate check instead of adding to it.**
   - Scenario (SEC24-6), in a genuine round with no forged metadata:
     1. The orchestrator commits a candidate-scope change after the freeze.
     2. The verifier's run starts from a head that contains it.
     3. That verifier closes a finding, with that change as the fix.
   - Result: round 23's validator rejected this; this candidate accepts it.
   - Impact is limited to mis-attribution. The fix must still be in the gate candidate, which all three reviewers review.
   - Suggested fix: in `checkInvocation`, require the head's candidate content to equal the round candidate. That allows only metadata-only commits after the freeze. The census shows all 61 computable real review runs already comply.
4. **Unchanged since round 23, and their tests still pass:** the write guard, runner and process sandbox, extraction, and CI.
   - Residual 7: the `/proc/sys` entries pass `access(W_OK)`. I checked this without writing, because a write would change host-global state. It is as disclosed.
   - Residual 8: another run's `/proc/<pid>/root` is denied. It is as disclosed.
   - CI keeps `contents: read`, pinned action SHAs and `fetch-depth: 0`.
5. **Everything else passes:**
   - 101/101 node tests and 22/22 Python tests;
   - the pre-freeze: 11/11 checks;
   - candidate determinism;
   - the secrets and CDN scan;
   - all 19 DG0-final requirements.

## Notes on the assignment
- `review-common.md` says "Review round: `23`", but it also gives the output path `round-24/`. The validator requires `record.round` to equal the directory's round, so I recorded `round: 24`.
- HEAD moved during my run (`372a379`): the domain reviewer's auto-commit, under `reviews/` and `runs/` only. The candidate ID is unchanged. I did not read its content.
