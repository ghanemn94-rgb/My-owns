# Assignment T-DG7-ARCH-R3: ADR-0064 Amendment 2 (baseline audit ids, mode 2 allowance) (solution-architect)

## Stage and base

- **Stage:** P7 "Independent transfer and release", gate DG7 (BUILDING), branch `claude/mobily-transformation-platform-dg6-regate`, at the current `HEAD`.
- **Preceding gate:** DG6 APPROVED (D-241). Run `node tools/gates/validate.mjs --historical --stage DG6` first and report it; it must exit 0.
- **Plan:** `docs/architecture/p7-plan.md` (adopted, D-243). This is a repair task under plan §5.3 (ARCH repair). Read §C of `docs/architecture/p7-work-split.md`, ADR-0064, the DG1 audit ADRs (append-only `audit_event`, its triggers and `seq`), decisions D-258 and D-259, your Amendment 1, and the handbacks of ARCH-R2, BE-R1 (§0, R1) and DO-D2 (§4 gaps 1–6, Q1–Q2) in `docs/delivery/handbacks/DG7/` first.
- **Time:** about 2 hours. **Disk is tight (about 4 GB free): never make a full extra checkout; delete your own temporary trees.** Run `date -u` at start and end; past about 100 minutes, finish the current section and write the handback with what remains.

## Environment

- Node 24.21.0 at `/opt/nvm/versions/node/v24.21.0/bin`. Offline.
- The write guard forbids `tools/gates/**`, `tools/agents/**`, `.claude/**`, `docs/source/**`, review and gate records, `stages.json`, `findings.json`, `trading_agent/`.

## Deliverables

1. **ADR-0064 Amendment 2** (dated section; never rewrite approved text), deciding:
   - **R1 (D-259 direction):** migrations write some `audit_event` rows with deterministic ids, so source and target hold the same baseline rows. A carried row whose `id` equals a target baseline row is accepted **only if every column is byte-identical** (it is the same event from the same migration); it is then counted as `already_present`, recorded in the import report and verified by reconciliation, never inserted twice. Any difference in content refuses the import (exit 1, exact text). Nothing is skipped silently, renumbered or archived. Confirm or improve this with reasons, staying inside the DG1 guarantees.
   - **Mode 2 allowance (DO-D2 Q2):** how a post-use recheck accounts for rows D8's writes create whose keys no API response returns (gate instance updates, work items, decision child rows, role assignments, lifecycle rows). Define an allowance that stays strict (e.g. per-table expected deltas derived from the action list, or keys collected from the audit events of the drill's own actor), never "ignore the table".
   - **REQ-DLV-006 asset-scan hit (DO-D2 gap 1):** the register snapshot quotes `/var/tmp/mth-run.XXXXXX` and a `/tmp` path, and ADR-0062 R2 refuses the runtime tree. Decide: the snapshot builder neutralises absolute paths in register text, or an R2 allow-list entry with a reason (if ADR-0062 §8 permits).
2. Append `### C.13 BE-R2: finish the load and recheck (backend-workflow; repair; after ARCH-R3)` to §C with files, exact texts, tests (including BE-R1's gaps: `tools/migration/prepare-target.mjs`, `--keep-reports`, `reconcile-migration --from` and mode 2 `--after-use --allow`, `recheck.ts`, `parseAllowance`, the R1 rule, the snapshot fix) and `### B.7 DO-D3: run the transfer drill to the end (devops-engineer; repair; after BE-R2)` (fix any drill bugs; the job digest via the §2.3 encoder; CI fragment). Never edit existing sections.
3. **Handback** `docs/delivery/handbacks/DG7/T-DG7-ARCH-R3-solution-architect.md`: the `--historical` result, options weighed, decisions, residual risks.

## Acceptance

- The amendment keeps the DG1 audit guarantees and states how; `pnpm -r typecheck`, `pnpm lint` and `pnpm openapi:lint` exit 0.
- `git ls-files -co --exclude-standard -z | xargs -0 npx prettier --check --ignore-unknown` exits 0.
- `node tools/gates/validate.mjs --historical --stage DG6` exits 0.

## Evidence honesty

Report every command with its real exit code. Never report a check as passed that did not run.
