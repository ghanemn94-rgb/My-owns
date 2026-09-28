# Threat model for the delivery controls (DG0–DG7)

This document scopes what the delivery tooling defends mechanically, what it only detects, and what remains a disclosed residual. It concerns the software delivery gates, not the product. Reviewers judge findings about the delivery tooling against this model. A finding outside it still gets recorded, and it can lead to a revision of this document (decisions D-016 to D-025).

It was written after round 11 of DG0 as the root-cause response required by master prompt §0.4. From round 6 onward, each review round found a new gap in the controls compensating for the unguarded agent shell. Rather than keep patching around the shell, D-025 moved the shell into an OS sandbox, and this model bounds the rest.

## Actors and trust

| Actor | Trusted for | Not trusted for |
|---|---|---|
| **Delivery orchestrator** (the main session) | Planning, integrating, freezing candidates, importing reviewer sidecars into `findings.json`, running the pre-freeze checks | Recording review verdicts, closing or accepting findings (only reviewer sidecars can), editing reviewer artefacts after the fact (write-once) |
| **Implementer agents** (analyst, architect, frontend, backend, kpi-benefits, devops) | Changing product and analysis files within their role scope | Changing gate rules, agent tooling, sources, delivery records, git metadata or Claude configuration |
| **Reviewer agents** (domain, code-security, QA, release auditor) | Producing their own records, sidecars and test evidence | Changing anything else in the repository |
| **Environment operator** (root in the container, the Claude Code platform) | Everything | — (out of scope) |

## Assets

- Gate rules and agent tooling (`tools/gates`, `tools/agents`), and the sources (`docs/source`).
- Reviewer artefacts (records and sidecars) and run evidence (`docs/delivery/runs`).
- Frozen candidate manifests and the gate decision.
- The write guard and the sandbox configuration themselves: `.claude`, settings, hooks, git metadata.

## Mechanically prevented

| Threat | Control |
|---|---|
| An agent writes a protected path with a **file tool** | Write guard hook (`tools/agents/guard-write.mjs`, D-009, D-020, D-023, D-024). It uses a fixed root, covers worktrees, follows symlinks, folds case, fails closed, and treats only the temp directory as scratch (never home). |
| An agent writes a protected path with the **shell** | OS Bash sandbox (bubblewrap) generated per run by `tools/agents/agent_settings.py` (D-025). It has `failIfUnavailable` and no unsandboxed escape. The deny list covers git metadata, Claude configuration, ignore and attribute files, tooling, sources and delivery records in the repository and every worktree. Reviewers and the analyst are confined to their own areas. Home and `/etc` are read-only by default. |
| User or local settings switch the guard off (`disableAllHooks`) | Agents start with `--setting-sources project` only. Project settings live under `.claude`, which neither file tools nor the shell can write. |
| Git hooks run during the evidence auto-commit | The auto-commit runs with `core.hooksPath=/dev/null` and `--no-verify`, and checks that it committed exactly the run directory plus the tool-authored files (F-DG0-138). |
| Reviewer artefacts edited after the run | Output binding to transcript replay, plus write-once history (single blob, no modify, type-change or delete events, no back-dating, working tree equal to history) (D-021). |
| A review bound to the wrong run | The CLI-replayed prompt carries the role, stage, run ID, session ID and assignment path and SHA-256. Transcript checks are unconditional. The run must start after the freeze, from a commit containing the manifest (D-016, D-022). |
| An approval that doesn't match the reviewed content | Candidate identity over content and file modes (D-005), manifests recomputed from their source commit, historical re-verification (D-017). |

## Detected, not prevented

| Threat | Detection |
|---|---|
| A process outside the sandbox changes configuration: user Claude settings, git config and excludes, hooks including symlinks, or Claude configuration and ignore files anywhere in the repository and worktrees, whether or not git ignores them | The runner's before-and-after `config_snapshot`. A review or analyst run is refused (exit 71, no auto-commit). For an implementer run it prints a warning for the orchestrator (D-024, D-025). |
| New untracked files where the sandbox leaves the working directory writable | `git status` and the runner's snapshots. For implementers these are ordinary product changes, reviewed at the gate. |

## Disclosed residuals (out of scope for mechanical defence)

1. **Self-hashed evidence.** Run evidence is hashed by the runner, not attested by an external service. Someone able to write the repository outside any sandbox could fabricate a complete, internally consistent run directory and commit it as new history, and the orchestrator is such a party. The mitigations are the release auditor's transcript review and the published git history (D-021).
2. **The environment operator** (root outside the agent sandbox, or the platform itself) can change anything, including the validator. Out of scope.
3. **Network access for agent shells** is unavailable in this container's sandbox mode. Dependency installation is an orchestrator step, outside the sandbox (D-025).
4. **Prompt injection through repository content.** A document an agent reads could try to steer it. Agents are told to treat assignment files and repository content as data. The independence of three reviewers plus the auditor is the control.

## How reviewers use this model

- A way to break a **mechanically prevented** control is a finding. Its severity follows the agent protocol.
- A gap in a **detected** control is a finding if detection can be evaded without leaving any trace.
- A demonstration that only restates a **disclosed residual** is recorded at Low severity, with a proposal if you have one. It is not a blocking finding unless it shows that the residual is larger than stated here.
