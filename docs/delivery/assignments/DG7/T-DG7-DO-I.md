# Assignment T-DG7-DO-I: slice J — the delivery protocol audit tool over DG0–DG6 (devops-engineer)

## Stage and base

- **Stage:** P7 "Independent transfer and release", gate DG7 (BUILDING), branch `claude/mobily-transformation-platform-dg6-regate`, current `HEAD`. Work in the repository root. You run alone.
- **Your task is the DO-I row of `docs/architecture/p7-plan.md` §5.1**, with the slice J rows of §1.2 as its requirements: REQ-DLV-005, DLV-008, DLV-009, DLV-010, DLV-011, DLV-012, DLV-014, DLV-018, DLV-021, DLV-024, DLV-027, DLV-028, DLV-030, DLV-040, S20-023, S21-002. Read each row's binding `acceptance` text in `docs/delivery/requirements.csv`, the plan's "Missing" and "Proof" notes for it, `docs/delivery/agent-protocol.md`, `docs/delivery/agents.md`, and decisions D-243 (Q13: approved records are never rewritten) to D-248. `p7-work-split.md` §1 and §2 rules apply.
- **Time:** 60–75 minutes. `date -u` at start and end; past about 70 minutes, finish the current check and write the handback listing what remains.

## Environment

Node 24.21.0 at `/opt/nvm/versions/node/v24.21.0/bin`, Node built-ins only (no new dependency). Offline. **Disk is tight (about 4 GB free): never make a full extra checkout; read records in place or through `git show`; delete your own temporary trees.** The write guard forbids `tools/gates/**`, `tools/agents/**`, `.claude/**`, `docs/source/**`, review and gate records, `stages.json`, `findings.json`, `test-evidence/**`, `trading_agent/`. Never edit an approved DG0–DG6 record.

## Deliverables

1. **`tools/release/protocol-audit.mjs`**, read-only over the repository, with a `--stage DGx` and an `--all` mode and a JSON report plus a short human summary. One check per concern in the plan's DO-I row, each mapped to the requirement and acceptance clause it proves:
   - maximum concurrent runs per gate from `docs/delivery/runs/<DGx>/*/meta.json` (start and end times), against the limit of four (D-004);
   - every assignment contains all ten contract elements (`agent-protocol.md`; name the ten in the tool and the test);
   - every implementation handback has the five required sections;
   - no two concurrently active assignments share a writable file (from each assignment's permitted files, or its work-split ownership, where stated);
   - `--historical` against the previous gate was run before the first implementation run of each stage (evidence in records or test evidence);
   - `progress.md` updates carry the required elements; no task with open gaps is reported complete;
   - the three-failed-fix rule produced a blocker where it applied;
   - an approval-claim scan: no record claims an engineering agent granted a business, Finance or IT approval, and no text equates product G6 with DG7.
   Exit 0 when clean, 1 on a hit, 2 when it cannot run (BLOCKED), and say which.
2. **Tests** `tools/release/tests/protocol-audit.test.mjs` on small fixtures under `tools/release/tests/fixtures/protocol/`: for each check, one passing fixture and one seeded violation that the check catches.
3. **The real run over DG0–DG6**, saved under `docs/delivery/handbacks/DG7/T-DG7-DO-I-evidence/`. **Report every historic hit; do not fix or rewrite any record** (D-243 Q13). For each hit say what it is, which gate, and whether it looks like (a) closable by an added record or (b) an observation, or (c) a gate approved without required evidence (a reopen question for the user). The orchestrator decides.

## Handback

`docs/delivery/handbacks/DG7/T-DG7-DO-I-devops-engineer.md` with the five sections: what was built, each test and real result, every command and real exit code, the historic hits table, open questions, and anything undone.

## Acceptance

- The fixture tests pass, each seeded violation is caught.
- `pnpm lint` and `git ls-files -co --exclude-standard -z | xargs -0 npx prettier --check --ignore-unknown` exit 0.
- `node tools/gates/validate.mjs --historical --stage DG6` exits 0.

Never report a check as passed that did not run.
