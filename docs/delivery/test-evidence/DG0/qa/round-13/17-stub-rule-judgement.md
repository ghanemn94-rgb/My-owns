# qa-verifier round 13: can the D-026 zero-length stub rule hide a real configuration change?

The assignment asks for a judgement on the rule in `tools/agents/run-agent.sh` `config_snapshot()`, which skips any
**zero-length, untracked, non-symlink** file among the Claude configuration and ignore/attribute files it scans in the
repository and its worktrees. Evidence: `04-qa13-new-cases.log` (QA13-R1, R1b, R2, R3) and `05-stub-rule-old-vs-new.log`.

## What I tested (runner end to end, stub `claude`, candidate 6c61f2e vs round-12 runner 7f09967)

| Case | Round-12 runner (no stub rule) | Candidate | Meaning |
|---|---|---|---|
| R3: new zero-length untracked `.gitattributes` and nested `.claude/hooks/h.sh` | exit 71 (reported) | exit 0, not reported (by design) | the rule works as intended; the same files **with content** are still reported (exit 71, 2 entries) |
| R1: pre-existing untracked, **non-ignored**, non-empty `CLAUDE.local.md` truncated to 0 | exit 71 | exit 0, `external_config_changed` [], but recorded in `meta.outputs` | still traced (via the run snapshot) |
| R1b: pre-existing **ignored**, non-empty `.claude/settings.local.json` truncated to 0 | exit 71 | exit 0, no trace anywhere | **newly hidden by the stub rule** |
| R2: the same ignored file **deleted** | exit 0, no trace | exit 0, no trace | pre-existing gap: `diff pre post \| grep '^>'` keeps only added lines, so a file that vanishes from the find-based scan is never reported |

## Judgement

- The rule cannot hide **added** configuration: a zero-length file carries none, and anything with content, any symlink,
  and any tracked file (even truncated) is still reported. Test directions in `tools/agents/tests/runner.test.mjs` agree.
- It can hide the **removal of content** from an ignored (or untracked-and-invisible) configuration file, by truncating it
  to zero. The effect is the same as deleting the file, which the scan never reported (R2, both versions). The
  threat model's detection row ("changes configuration ... whether or not git ignores them") therefore overstates:
  removals and truncations of scanned files leave no trace.
- Impact is low. Only a process **outside** the agent sandbox can write these paths (the sandbox denies `.claude`,
  `CLAUDE*.md`, `.mcp.json`, `.gitignore`, `.gitattributes` in the repository and every worktree: `08-live-guard-probe.log`).
  Removing configuration can only remove restrictions that are not loaded anyway (`--setting-sources project`; local
  and user settings are not read). Tracked project settings count even when truncated. Removing an ignore file makes
  more files visible, not fewer.
- Recorded as a Low, non-mandatory finding (F-DG0-234) with a proposal: also report removed lines (`'^<'`) or a
  pre-existing path turning zero-length, or state the limit in the threat model. I'd accept it as an observation.
