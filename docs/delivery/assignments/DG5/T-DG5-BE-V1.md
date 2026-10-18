# Assignment T-DG5-BE-V1: DG5 round-1 repair (backend-workflow-engineer)

## Stage and working tree

- **Stage:** P5 "Configuration automation and outputs", gate DG5, **FIXING** after review round 1 on candidate `sha256:8e7d23a3…` (D-170).
- **Working tree:** a separate git worktree prepared by the orchestrator. It is your current working directory (`--cwd`), on branch `dg5/be-v1`, at the integrated `HEAD`.
  - `node_modules` is installed and the packages are built.
  - Work only in this tree. Never run `git worktree add`.
- **Concurrency (D-004):** Four repair tasks run at the same time (D-170): T-DG5-BE-V1, T-DG5-BE-V2, T-DG5-BE-V3 and T-DG5-FE-V1, each in its own worktree, at the round-1 candidate's tree plus the round-1 records. Stay strictly inside your file ownership.
- **Preceding gate:** run `node tools/gates/validate.mjs --historical --stage DG4` first, and report the result. It must exit 0.
- **Time:** the hard limit is about 2 hours. Run `date -u` at the start and at the end. If you pass about 100 minutes, finish the current item, make the tree typecheck and lint, and write the handback, listing exactly what remains.

## The findings you repair (binding)

- **F-DG5-100** (Medium, mandatory violation; REQ-S06-007; reported by code-security-reviewer in `docs/delivery/reviews/DG5/round-1/code-security-reviewer.json`): Studio configuration review: a co-author who rewrote another admin's draft can review (approve) and publish the content they wrote; the separation-of-duties check knows only the draft's creator and the requester.
  - Read the finding in full in `docs/delivery/findings.json` (reproduction, expected, actual) and its evidence: `docs/delivery/test-evidence/DG5/code-security/round-1/repro/studio-coauthor-review.test.ts`, `docs/delivery/test-evidence/DG5/code-security/round-1/repro/studio-coauthor-review.log`, `apps/api/src/modules/methodology/reviews.ts`, `apps/api/src/modules/methodology/drafts.ts`, `apps/api/src/modules/methodology/elements.ts`, `packages/db/migrations/0062_p5_config_versions.sql`.

- **The reviewer's reproduction is your regression test.** Turn it into a product test in the candidate's test tree, keep its final assertion, and show it failing before your fix (record the failing output) and passing after it.
- **The repair is decided by D-170** in `docs/delivery/decisions.md`. Read D-170 verbatim; the scope below restates it.

## Binding scope

- **Decided (D-170): a person who wrote any part of a configuration draft is one of its authors, and an author never decides its review.**
  - Today `apps/api/src/modules/methodology/reviews.ts:333` refuses only the draft's creator and the requester, and the database backstop (`0062_p5_config_versions.sql:441-444` and the requester CHECK) compares only `created_by`. Meanwhile any `methodology.configure` holder may change another admin's draft (`drafts.ts:432-458` `updateDraft`; `elements.ts:238` the element PUT).
  - **Record the contributors.** Every principal who writes the draft's content (the version row, any element row, any child row that the draft's diff covers) since the draft was created is recorded as a contributor, append-only, in the same transaction as the write. Choose the mechanism (for example a `methodology_version_contributor (version_id, user_id, first_written_at)` table maintained by database triggers that read the session actor, so that no write path can skip it) and say why.
  - **Refuse at the API and in the database.** The review decision refuses a decider who is the requester, the creator, or any recorded contributor: `403 config_review.self_review` with the existing refusal text 'You cannot review a configuration change you authored or requested.' (ADR-0039 §5 and §9). The database refuses the same, under a named constraint that `apps/api/src/modules/platform/db-errors.ts` maps to the same 403.
  - **Publish.** Where a configured review is required, publishing a version whose approving decider is a contributor is impossible by construction (the decision was refused). Add the test anyway.
  - **The other "review where configured" paths.** Check automation rule versions (`apps/api/src/modules/automation/lifecycle.ts`, `0074` CHECK `automation_rule_version_review_sod` compares only `authored_by`) and every other configured-review path for the same co-author gap. Where another principal can write a version that someone else authored, close it the same way and test it. Where no such write path exists, prove it with a test and say so.
  - **The migration.** One new migration, `packages/db/migrations/0097_p5_config_review_contributors.sql` (the only migration in this wave): forward-only, guarded, with the backfill of existing drafts (their `created_by` and `updated_by`) and audit coverage per ADR-0039. Update `packages/db/src/schema.ts` for any new table.
  - **Tests:** the reviewer's `studio-coauthor-review.test.ts` as a product integration test (403 at the decision); the database refusal through a runtime-role connection (a direct UPDATE/INSERT of a decision by a contributor is refused); the creator and requester refusals still hold; a non-contributor TO still approves and publishes.

- **The shared rules:** `docs/architecture/p5-work-split.md` §2. Reviewers check every one of them: server-side authorization re-checked at commit time, validation, optimistic concurrency, one audit event per mutation, decimal arithmetic, Unknown/Stale never zero, en and ar.
- **The design:** the ADRs the code cites (ADR-0039 onward, with their dated amendments, and the DG1–DG4 ADRs they extend), `docs/api/openapi.yaml` and the zod mirrors. **Do not change the contract** (no new operation, no new response shape). If you believe a contract change is needed, stop and write the need in your handback.
- **Decisions:** D-141 to D-170 in `docs/delivery/decisions.md`.
- **Acceptance texts:** the `acceptance` text of each finding's requirement row (`docs/delivery/requirements.csv`) stays binding and is retested literally in round 2.
- **User-facing text** must be true for the release it ships in (F-DG4-160), in en and ar.
- **Gates:** product gates G1–G6 are business approvals inside the product. No agent grants a real business, Finance or IT approval. Seed and demo data are synthetic.
- **No new dependency.**
- **Load rule (D-164).** Run `pnpm -r typecheck`, `pnpm -r build`, `pnpm lint`, the prettier check and `pnpm openapi:lint`, once each and one at a time. Then run only the Vitest projects, integration paths and e2e specs your change reaches, never two heavy runs in parallel. The repository-wide `pnpm test`, `pnpm test:integration` and the full e2e suite run once on the merged tree in the orchestrator's verification. Do not run them; report them as "not run, D-164", never as passed.
- **Ownership:** `apps/api/src/modules/methodology/**`, `apps/api/src/modules/automation/lifecycle.ts` and the automation rule-version write paths (only if the same gap exists there), `apps/api/src/modules/platform/db-errors.ts` (the new constraint mapping only), `packages/db/migrations/0097_*.sql`, `packages/db/src/schema.ts` (the new table only), and the tests under `apps/api/test/integration/{methodology,automation}/**` and `packages/db/test/**` that your change needs.
- **Concurrent owners:** T-DG5-BE-V2 edits `apps/api/src/modules/procedures/**`; T-DG5-BE-V3 edits `packages/db/src/demo/**` and the demo tests; T-DG5-FE-V1 edits `apps/web/**`. Do not edit their files.

## Environment

- **Node:** 24.21.0 at `/opt/nvm/versions/node/v24.21.0/bin`. Run offline.
- **Browser:** Chromium is pre-installed (`PLAYWRIGHT_BROWSERS_PATH=/opt/pw-browsers`). Never run `playwright install`.
- **Your harness ports are 23000–23049 only.** Use them for `QA_PG_PORT`, `E2E_PG_PORT`, `E2E_API_PORT` and `MTH_PORT_POOL`.
- **Disk.** The disk allowance is shared with three other tasks. Do not copy the pnpm store or clone the repository; remove your own temporary databases and outputs when a run ends.
- **Before tests:** remove any empty `.claude/.cc-writes` directories inside source folders.
- **Tests:** deterministic under load (F-DG4-143 to F-DG4-148); never read whole delivery folders (D-138); never stop processes with `pkill -f` or `pgrep -f`.
- **The write guard forbids editing:**
  - `tools/gates/**`, `tools/agents/**` and `.claude/**`;
  - `docs/source/**`;
  - review and gate records, `stages.json` and `findings.json`;
  - `trading_agent/`.

## Acceptance (real output in the handback)

1. These all exit 0:
   - `pnpm -r typecheck`
   - `pnpm -r build`
   - `pnpm lint`
   - `git ls-files -co --exclude-standard -z | xargs -0 npx prettier --check --ignore-unknown`
   - `pnpm openapi:lint`
2. The Vitest unit projects your change reaches pass with the locale unset and with `C.UTF-8`, one at a time. Report the counts.
3. `apps/api/test/integration/methodology`, `apps/api/test/integration/automation`, `apps/api/test/integration/contract.test.ts`, `packages/db/test/integration` and your new tests pass with `QA_PG_PORT=<port> MTH_PORT_POOL=<rest> tests/qa/support/with-pg.sh npx vitest run --configLoader runner --project integration <paths>`. Report the counts, and the failing-before output of the reproduction.
- `node tools/gates/validate.mjs --historical --stage DG4` exits 0 at the end.

## Evidence honesty

Report every command with its real exit code. Disclose and explain every non-zero exit, failed or flaky test, or timeout in the logs you cite. Never report a check as passed that did not run.

## Handback

Write `docs/delivery/handbacks/DG5/T-DG5-BE-V1-backend-workflow-engineer.md`, with logs under `docs/delivery/handbacks/DG5/T-DG5-BE-V1-evidence/`. Include:
- the files changed;
- for each finding: the cause, the fix (with `file:line`), the regression test, and its failing-before and passing-after output;
- the checks, with exit codes and counts;
- any contract, schema or dependency need, for the orchestrator;
- the ADR and data-dictionary statements your fix makes untrue or incomplete (for the architect's amendment task, T-DG5-ARCH-R4);
- the user-facing texts your work made untrue, and what you did about each;
- what remains.

Leave your changes **uncommitted** for the orchestrator to integrate.
