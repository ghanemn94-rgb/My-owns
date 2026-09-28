
## Round __ROUND__ specifics (re-review after repairs)

- **The candidate changed after round 1.** Review the new frozen candidate in full, not just the diff. Use `git diff __PREV_COMMIT__..__COMMIT__` to see what changed since the round-1 candidate (`__PREV_COMMIT__`).
- **Verify your own earlier findings independently.** Each finding you raised in earlier rounds is listed in `docs/delivery/findings.json` with its `fix_revision` and `fix_summary`.
  - For each one, reproduce the original failure against the old commit if possible, then show whether it's fixed in the new candidate. Run the regression tests, and write your own reproduction where the existing tests are insufficient.
  - Record the result in `docs/delivery/reviews/DG0/round-__ROUND__/<your-role>.verifications.json`, as `{"verifications": [{"finding_id", "result": "PASS|FAIL", "status_after": "CLOSED_VERIFIED|REJECTED_INVALID|OPEN", "note", "evidence": []}]}`.
  - Use `CLOSED_VERIFIED` only if the fix is complete and correct. If it isn't, keep the finding `OPEN` with result `FAIL`, and explain why.
  - You may only verify findings **you** reported. Findings from other reviewers are verified by their reporters.
- **New findings** continue in your ID block:
  - domain-reviewer: from `F-DG0-006`;
  - code-security-reviewer: from `F-DG0-110`;
  - qa-verifier: from `F-DG0-204`.
  - Every new finding must have `stage_id` `DG0`. The validator rejects relabelled, dropped or altered findings.
- **Rule changes since round 1.** The validator now binds each review to its run: complete, hash-consistent run evidence, the exact assignment file and SHA-256 you were given, and a start after the freeze. Don't edit your assignment file. Your `invocation_reference` is the one in your prompt.
- **Infrastructure note.** If your shell is refused because the permission classifier returned no verdict, wait and retry. The runner now resumes your session automatically after such an outage. Record anything you ultimately couldn't run as BLOCKED.
