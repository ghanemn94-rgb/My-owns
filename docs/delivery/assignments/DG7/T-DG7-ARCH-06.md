# Assignment T-DG7-ARCH-06: slice M (+ K, L) — release envelope, A28 sealing, A26/A27 drill procedures (solution-architect)

## Stage and base

- **Stage:** P7 "Independent transfer and release", gate DG7 (BUILDING), branch `claude/mobily-transformation-platform-dg6-regate`, at the current `HEAD`.
- **Preceding gate:** DG6 APPROVED (D-241). Run `node tools/gates/validate.mjs --historical --stage DG6` first and report it; it must exit 0.
- **Plan:** `docs/architecture/p7-plan.md` (adopted, D-243). Your task is its row **T-DG7-ARCH-06** in §4: read §1 (slices K, L and M, and §4.1 (the A28 two-step)), §3 (seams), §4, §5 and §6 (decided in D-243) first.
- **Time:** about 2 hours. **Disk is tight (about 4 GB free): never make a full extra checkout; delete your own temporary trees.** Run `date -u` at start and end; past about 100 minutes, finish the current section and write the handback with what remains.

## Environment

- Node 24.21.0 at `/opt/nvm/versions/node/v24.21.0/bin`. Offline.
- The write guard forbids `tools/gates/**`, `tools/agents/**`, `.claude/**`, `docs/source/**`, review and gate records, `stages.json`, `findings.json`, `trading_agent/`.

## Deliverables

1. **ADR-0073** (release envelope and A28 sealing), exactly as the plan's ARCH-06 row and §4.1 scope it: the two-step of master prompt l.621 in full; the envelope manifest format; the seal and verify tools' behaviour; where outputs live (`dist/release/`) so they stay outside the payload hash; the rehearsal on a scratch copy with a **synthetic** DG7 gate record (never a real one); the final delivery report template (limitation statement, every claimed capability linked to an executed check); and the A26 and A27 drill procedures the orchestrator runs (K). ADR-0074 stays reserved. State what is built, by whom (DO-J), how it is tested, and the honest residuals. No new runtime dependency. Sealing never implies or grants a business approval, and product gate G6 never implies DG7.
2. **`docs/architecture/p7-work-split.md`**: append §M (and K/L procedure sections) only; never edit existing sections. Give DO-J a heading `### M.1 DO-J: <title> (devops-engineer; W8; after ARCH-06 and DO-A)` with file ownership, exact texts, the test list and the requirement → clause → test table for REQ-DLV-041, S20-028, DLV-031, and the procedures for S20-026 and S20-027.
3. **Schema:** migration range `0156`–`0157`, none expected; advisory locks 730420–730421 if any. `p7-pending.ts` aggregate is frozen after this task (plan §5.3): finalize it.
4. **Handback** `docs/delivery/handbacks/DG7/T-DG7-ARCH-06-solution-architect.md`: the `--historical` result, time used, summary, open questions, anything undone.

## Acceptance

- ADR-0073 and the §M/K/L sections exist and cover the requirements above; `pnpm -r typecheck`, `pnpm lint` and `pnpm openapi:lint` exit 0.
- `git ls-files -co --exclude-standard -z | xargs -0 npx prettier --check --ignore-unknown` exits 0.
- `node tools/gates/validate.mjs --historical --stage DG6` exits 0.

## Evidence honesty

Report every command with its real exit code. Never report a check as passed that did not run.
