# ADR-0015 — How the Claude Code build agents were executed

- Status: Accepted · Date: 2026-09-29
- Requirements: spec §18

## Context
Agent definitions were created in `.claude/agents/` during the build session (Claude Code 2.1.284). Custom agent types
are registered when a session starts, so they were **not** invocable as native `subagent_type`s in the session that
created them (verified: "Agent type 'carveout-domain-analyst' not found").

## Decision
- Each role ran as a separate general-purpose subagent (separate context) that was instructed to load and obey its
  definition file and `.claude/AGENT_RULES.md`. Tool limits in the definitions were therefore enforced by instruction,
  not by the harness. Reviewer independence (separate context, no authorship of the reviewed change) was preserved.
- A symlink `../.claude/agents → transformation-hub/.claude/agents` lets future sessions opened at the repository root
  register the agents natively.
