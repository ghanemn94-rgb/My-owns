# Assignment T-DG6-DO-Z1: DG6 round-2 follow-up: restricted-network operations text (devops-engineer)

## Stage and working tree

- **Stage:** P6, gate DG6 (FIXING after review round 2). Working tree: a separate worktree prepared by the orchestrator, your `--cwd`, branch `dg6/do-z1`, at the integrated `HEAD`. You run alone (D-004).
- **Preceding gate:** run `node tools/gates/validate.mjs --historical --stage DG5` first and report it (must exit 0).

## What to change

T-DG6-ARCH-14's handback (`docs/delivery/handbacks/DG6/T-DG6-ARCH-14-solution-architect.md` §7 item 2) proposes a Low documentation finding: `docs/operations/restricted-network.md` lines 5–10 say the processes need "exactly two services … The application makes no other outbound calls" and that SMTP, connectors and an AI endpoint "will be … listed here when it exists". In P6 these integrations exist (off by default, configured by IT).

Correct the text so it is true for this release: list each optional outbound destination that P6 ships (email channel/SMTP, connectors' endpoints, the object store if external, the optional assistant endpoint, and any other you find by checking the code and `docs/operations/configuration.md`), say each is off unless IT configures it, and point to the secret binding's `hosts` (D-209, `configuration.md` "The binding") and to the deployment's egress policy as the control for where they may connect. Verify each statement against the code. Sweep the other `docs/operations/*.md` and the handover docs for the same "no other outbound calls" claim and correct them the same way. Do not change product code.

## Write guard

Never edit `tools/gates/**`, `tools/agents/**`, `.claude/**`, `docs/source/**`, review and gate records, `stages.json`, `findings.json` or `trading_agent/`.

## Acceptance

- `git ls-files -co --exclude-standard -z | xargs -0 npx prettier --check --ignore-unknown` exits 0; `pnpm lint` exits 0.
- `node tools/gates/validate.mjs --historical --stage DG5` exits 0.
- Report every command with its real exit code; never report a check as passed that did not run.

## Handback

Write `docs/delivery/handbacks/DG6/T-DG6-DO-Z1-devops-engineer.md`: files changed, each corrected statement with the code it was verified against, the checks, and what remains. Leave changes **uncommitted**.
