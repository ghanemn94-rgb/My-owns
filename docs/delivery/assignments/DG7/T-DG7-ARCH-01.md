# Assignment T-DG7-ARCH-01: slices A + G — release archive, reproducible offline build, secret hygiene and security-controls evidence (solution-architect)

## Stage and base

- **Stage:** P7 "Independent transfer and release", gate DG7 (BUILDING), branch `claude/mobily-transformation-platform-dg6-regate`, at the current `HEAD`.
- **Preceding gate:** DG6 APPROVED (D-241). Run `node tools/gates/validate.mjs --historical --stage DG6` first and report it; it must exit 0.
- **Plan:** `docs/architecture/p7-plan.md` (adopted, D-243). Your task is its row **T-DG7-ARCH-01** in §4: read §1 (slices A and G), §3 (seams), §4, §5 and §6 (decided in D-243) first.
- **Time:** about 2 hours. Run `date -u` at start and end; past about 100 minutes, finish the current section and write the handback with what remains.

## Environment

- Node 24.21.0 at `/opt/nvm/versions/node/v24.21.0/bin`. Offline.
- The write guard forbids `tools/gates/**`, `tools/agents/**`, `.claude/**`, `docs/source/**`, review and gate records, `stages.json`, `findings.json`, `trading_agent/`.

## Deliverables

1. **ADR-0062** (release archive and reproducible offline build) and **ADR-0063** (secret hygiene and security-controls evidence), exactly as scoped in the plan's ARCH-01 row, with the D-243 decisions (Q2 archive by artefact; Q12; Q16). Each ADR states what is built, by whom (the plan's implementer tasks), how it is tested, and the honest residuals. No new runtime dependency (plan §4); if one seems needed, record it BLOCKED.
2. **`docs/architecture/p7-work-split.md`**: create it with its common header and the sections for slices A and G: owners and file ownership, seams, exact English (and Arabic where user-facing) texts, test lists, and the acceptance clause each test proves, per requirement (REQ-S19-001, S19-002, S19-003, S16-009, S19-019, S16-031, S16-033).
3. Migrations `0131`–`0132` and advisory locks 730400–730401 are reserved; none is expected. Do not add operations to `docs/api/openapi.yaml`.
4. **Handback** `docs/delivery/handbacks/DG7/T-DG7-ARCH-01-solution-architect.md`: the `--historical` result, time used, summary, open questions (quote sources), anything undone.

## Acceptance

- Both ADRs and the work-split sections exist and cover all seven requirements, each clause mapped to a test and an owner.
- `git ls-files -co --exclude-standard -z | xargs -0 npx prettier --check --ignore-unknown` exits 0.
- `node tools/gates/validate.mjs --historical --stage DG6` exits 0.

## Evidence honesty

Report every command with its real exit code. Never report a check as passed that did not run.
