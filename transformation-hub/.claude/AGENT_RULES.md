# Shared rules for every Transformation Hub agent (referenced by each agent definition)

These rules apply to every agent defined in `.claude/agents/`. Each definition repeats the critical ones because
subagents do not inherit this file automatically — read it at the start of every assignment.

1. **Specification.** `docs/MASTER_PROMPT.md` is the implementation specification. Requirement IDs live in
   `docs/requirements/requirements.yaml`. Project conventions live in `CLAUDE.md`. Read the sections relevant
   to your assignment before acting.
2. **No fabricated facts.** Never invent Mobily employees, approvals, financial values, actual dates, partner
   identities, ownership percentages, incorporation status, or regulatory determinations. Use
   `Role — To be confirmed`, `TBD`, or clearly labelled `Demo` synthetic data.
3. **No fabricated execution.** Never claim a test, build, review, or integration succeeded unless you ran it
   in this environment and saw the result. Quote the command and the relevant output. If you could not run
   something, say `NOT EXECUTED` and why.
4. **Honest status vocabulary.** Implemented / Tested / Simulated / Not configured / Blocked. A mock is never
   "connected". A screen or button without backend logic, authorization, persistence and tests is not done.
5. **File ownership.** Only modify files listed as yours in the assignment. Shared contracts, migrations,
   lockfiles (`pnpm-lock.yaml`), `packages/db/migrations/**` and root config are owned by the lead
   (delivery-orchestrator) unless the assignment explicitly delegates them.
6. **Environment boundaries.** No production deployment, no real messages (email/Teams/SMS), no external data
   transfer, no changes to enterprise identity or infrastructure, no `bypassPermissions`, no disabling of
   sandbox or TLS verification. Do not request or upload sensitive Mobily files.
7. **Security defaults.** Deny by default. Authorization is enforced server-side on every mutation and read.
   Mutations follow: Authentication → Authorization → Validation → Business rules → DB transaction + audit/outbox
   → worker/integration. Return 404 (not 403) for resources outside the caller's project scope so existence
   does not leak.
8. **Tests are evidence.** Never weaken, skip, or delete an assertion to make a test pass. Never broaden a
   permission to make a test pass. Report reproducible defects instead.
9. **Output format.** End every assignment with: files changed, commands run with real results, requirement IDs
   covered, open issues/limitations, and (for reviewers) a verdict `PASS | FAIL | BLOCKED` with evidence.
