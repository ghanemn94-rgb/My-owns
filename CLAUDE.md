# Mobily Transformation Hub — project rules

A platform that operationalizes the Business Transformation Playbook v1.0 for Mobily. It is delivered through eight software delivery gates (DG0–DG7), each backed by independent review evidence.

## Sources (read-only)
- Playbook (authoritative methodology): `docs/source/playbook.md`. Cite blocks as `B0001`–`B0165`. The original is `docs/source/Business_Transformation_Playbook.docx`, SHA-256 `2584a352…548ad2`.
- Master prompt (product and delivery requirements): `docs/source/master-prompt-v2.0.md`. Anchored blocks `M0001`–`M0423` are in `docs/source/master-prompt.anchored.md`.
- The playbook is a practical synthesis *inspired by* PMI/Brightline/BRM, with custom extensions. Never call it, or this product, an official PMI standard or a certified product.
- `#0078FF` is a **provisional** brand token, not a verified Mobily colour. Without an official logo, use a clearly provisional text wordmark.

## Two gate systems: keep them separate
- **DG0–DG7**: engineering delivery gates. Records live in `docs/delivery/`.
- **G1–G6**: business approvals inside the product. An engineering agent never grants a real business, Finance or IT approval. Product gate G6 never implies DG7.

## Delivery protocol (details: `docs/delivery/agent-protocol.md`, master prompt §0)
- Stage loop: Plan → Implement → Integrate (freeze candidate) → Review (domain, code-security, QA: independent, same candidate) → Findings → Repair → Reverify → Audit (release-auditor) → APPROVED/BLOCKED.
- A gate passes only with:
  - three PASS reviews plus an auditor PASS on the same candidate ID;
  - all assigned requirements complete;
  - required checks actually run and passed;
  - zero unresolved Critical/High findings and zero unresolved mandatory violations.
- Candidate ID = SHA-256 over the stage manifest (`node tools/gates/candidate.mjs --stage DGx`). Review and gate metadata are excluded. The commit is recorded only as a traceability pointer.
- Validator: `node tools/gates/validate.mjs --stage DGx` (exits non-zero on failure). Run it against the previous approved gate (`--historical`) before starting implementation in each stage.
- Don't start a later stage before the preceding gate is APPROVED. Read-only discovery is allowed.
- Project agents are defined in `.claude/agents/`. Invoke them with `tools/agents/run-agent.sh`, which runs a separate `claude -p --agent` process with a unique session ID, the orchestrator's model and a write guard. See `docs/delivery/agents.md`.
- Implementers must not edit `tools/gates/**`, `tools/agents/**`, `.claude/agents/**`, `docs/source/**`, reviews or gate records.

## Delivery records
`docs/delivery/`:
- `requirements.csv` (register)
- `stages.json` (stage state)
- `decisions.md`
- `findings.json`
- `progress.md` (checkpoint and next action)
- `reviews/DGx/round-N/`
- `gates/DGx.json`
- `test-evidence/`
- `runs/` (agent invocation evidence)
- `environment.md`

## Engineering conventions (from P1; ADRs in `docs/architecture/`)
- The stack and its conventions are fixed by the P1 ADRs. Follow them.
- Every mutation needs a server-side authorization check, validation, optimistic concurrency and an audit event, each covered by tests.
- Decimal arithmetic for money and rates. Missing or stale data shows Unknown/Stale, never zero or green.
- Arabic RTL and English LTR for every user-facing string. The default timezone is Asia/Riyadh and the default currency SAR, both configurable.
- No public CDNs or builder-hosted runtime dependencies. No secrets in the repository.
- Never report a check as passed that didn't run. Missing tools or credentials make a check BLOCKED.

## Unrelated content
`trading_agent/` is a separate pre-existing user project. Do not modify it.
