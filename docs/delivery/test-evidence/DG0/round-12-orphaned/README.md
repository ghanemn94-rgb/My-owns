# Orphaned round-12 review attempt (not evidence for any gate decision)

The round-12 **domain-reviewer** run (`DG0-T-DG0-REV-DOM-R12-domain-reviewer-20260928T183204Z-1a1764b5`) finished its review with verdict PASS and no new findings. The runner then refused to auto-commit its evidence and exited 71, because its configuration scan reported two changed files:

- `/home/user/My-owns/.mcp.json`
- `/home/user/My-owns/CLAUDE.local.md`

Both files were zero-length and untracked (SHA-256 `e3b0c442…b855`, the empty string). They were the transient stub files that the Claude Code Bash sandbox creates in the working directory while sandboxed commands run (D-025). Nothing wrote configuration into them. This was a false positive in the orchestrator-owned runner.

Even so, the validator requires `external_config_changed` to be empty for a binding run. Its meta records the two entries, so the run cannot bind, and the orchestrator does not edit run evidence to make it bind.

What was done:
- The run directory is kept unchanged under `docs/delivery/runs/DG0/` as a record that the invocation happened.
- The review record was moved here unchanged from `docs/delivery/reviews/DG0/round-12/domain-reviewer.json`.
- Its test evidence stays in `docs/delivery/test-evidence/DG0/domain/round-12/`, bound by the hashes in the run's `meta.json` `outputs`.
- It counts toward no gate.

The runner fix: `config_snapshot` in `tools/agents/run-agent.sh` now skips zero-length, untracked, non-symlink files. Such a file has no content that could configure anything. A regular file that has content, or that git tracks, is still reported (decision D-026).

The domain review is re-run in round 13 as a fresh invocation.
