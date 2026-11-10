# Assignment T-DG6-ARCH-14: DG6 round-2 repair: SecretRef binding design (F-DG6-181, High) and ADR-0053 freshness text (F-DG6-160) (solution-architect)


## What to change (read first)

Documentation and design only; do not change product code. A backend task (T-DG6-BE-Z2) implements your design right after you.

1. **F-DG6-181 (High, mandatory, REQ-S16-029).** Read the finding verbatim in `docs/delivery/reviews/DG6/round-2/code-security-reviewer.findings.json` and its reproduction under `docs/delivery/test-evidence/DG6/code-security/round-2/`. Today any `MTH_SECRET_<NAME>` resolves for any consumer (`apps/api/src/modules/platform/secrets.ts`), the connector write check (`apps/api/src/modules/integrations/connectors.ts` `assertSecretRefInNamespace`) tests only the name's shape, the http_pull adapter sends the value to any https host, and `resolvable` in `credentialRefViews` reveals whether a guessed name exists. Amend ADR-0052 §5 (and ADR-0051/others it touches) so that "a SecretRef names a secret IT holds for this setting" is enforced:
   - how IT declares, outside the database and without a secret value in the repo, which organization and which setting/consumer (connector id or kind, webhook, SMTP, S3, assistant) each secret is provisioned for, and that installation-level secrets (S3, SMTP, assistant, webhook signing) can never be named by a tenant setting;
   - where the check runs (write time and resolve time, fail closed), the problem code and status, the audit event;
   - whether `resolvable` is reported only for refs bound to the caller's organization and setting (no existence oracle);
   - whether an egress host rule is needed for http_pull (decide, or state why the binding alone suffices);
   - the configuration doc (`docs/operations` / `configuration.md`) and handover text to change.
   Write an implementation brief for BE-Z2 in your handback: files, the exact rules, the tests that must fail before and pass after (including the reviewer's reproduction), and the migration if any. Record the decision as a proposed D-entry text in the handback (the orchestrator records it).
2. **F-DG6-160 (Low).** Read the finding in `docs/delivery/reviews/DG6/round-2/domain-reviewer.findings.json`. Correct ADR-0053 (line ~79, "Not changed by this repair") to the shipped `kpiFreshness` behaviour after T-DG6-BE-Y3 (last-known-value rule, an empty later period does not hide a stale value, the scan opens data_stale), using BE-Y3's handback section 6. Verify against `apps/worker/src/handlers/operations.ts`, and record the change in the ADR history.

Also sweep ADR-0051 §2 against T-DG6-BE-Z1 (benefit_calculation now in SENSITIVE_CHILD_SOURCES; handback `docs/delivery/handbacks/DG6/T-DG6-BE-Z1-backend-workflow-engineer.md`) and update the ADR if it enumerates the sources. List any code that contradicts the ADRs as a proposed finding.

## Stage and working tree

- **Stage:** P6 "Integration and system hardening", gate DG6 (FIXING after review round 2).
- **Working tree:** a separate git worktree prepared by the orchestrator. It is your current working directory (`--cwd`), on branch `dg6/arch-14`, at the integrated `HEAD`.
  - `node_modules` is installed and the packages are built.
  - Work only in this tree. Never run `git worktree add`.
- **Concurrency (D-004):** no other task runs at the same time in their own worktrees. Touch only what your repair needs.
- **Preceding gate:** run `node tools/gates/validate.mjs --historical --stage DG5` first, and report the result. It must exit 0.
- **Time:** the hard limit is about 2 hours. Run `date -u` at the start and at the end.
  - Work in the order your section gives.
  - If you pass about 100 minutes, finish the current item, make the tree typecheck and lint, and write the handback, listing exactly what remains. Name its separable second half if your section gives one (D-059/D-070).

## Binding scope

- **Your scope:** the findings named above. The p6-work-split section that owns each touched file still applies.
- **The shared rules:** `p6-work-split.md` §2. Reviewers check every one of them.
- **The design:** the ADRs your section cites (ADR-0051 onward, and the DG1–DG5 ADRs they extend), `docs/api/openapi.yaml`, and the zod mirrors.
- **Decisions:** D-193 to D-196 in `docs/delivery/decisions.md` (D-195 decides p6-plan Q1–Q14; D-196 decides the ARCH-01 handback questions). Read them verbatim.
- **Pending operations:** move each operation you route out of your `apps/api/test/support/p6-pending-*.ts` list. Exercise it in your `p6-exercises-*.ts` so `contract.test.ts` stays green.
- **Acceptance texts:** the `acceptance` text of every requirement row your section assigns to you (`docs/delivery/requirements.csv`) is binding, and reviewers test it literally. A row that cites a later-stage A-test is judged on its own acceptance text (D-142).
- **User-facing text** must be true for the release it ships in (F-DG4-160): when your work ships a feature that an existing en/ar string calls planned or later, correct that string in both languages, or list it in your handback for the owner of that file.
- **Gates:** product gates G1–G6 are business approvals inside the product. No agent grants a real business, Finance or IT approval. Seed and demo data are synthetic.
- **Migrations (D-196):** if you need one, take the next id above the highest file in `packages/db/migrations/` on your branch and say so in the handback; the orchestrator renumbers at merge if needed. Never reuse a retired id.
- **e2e budgets are measured** (F-DG5-145/146/151 class): every new spec states a budget from a loaded measurement.
- **No new dependency.** If you need one, write the need in your handback with its official documentation, support window and licence; the orchestrator decides and installs it (D-195).

## Environment

- **Node:** 24.21.0 at `/opt/nvm/versions/node/v24.21.0/bin`. Run offline.
- **Browser:** Chromium is pre-installed (`PLAYWRIGHT_BROWSERS_PATH=/opt/pw-browsers`). Never run `playwright install`.
- **Your harness ports are 28950–28999 only.** Use them for `QA_PG_PORT`, `E2E_PG_PORT`, `E2E_API_PORT` and `MTH_PORT_POOL`.
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
2. `pnpm test` passes with the locale unset and with `C.UTF-8`, in every Vitest invocation it runs. Report the counts.
3. The full `pnpm test:integration` is **not** required here (it takes over 2 hours on this host); the orchestrator runs it on the merged tree. Run the integration files your change touches, if any, inside `tests/qa/support/with-pg.sh`, and report their counts.
4. `node tools/gates/validate.mjs --historical --stage DG5` exits 0.

## Evidence honesty

Report every command with its real exit code. Disclose and explain every non-zero exit, failed or flaky test, or timeout in the logs you cite. Never report a check as passed that did not run.

## Handback

Write `docs/delivery/handbacks/DG6/T-DG6-ARCH-14-solution-architect.md`, with logs under `docs/delivery/handbacks/DG6/T-DG6-ARCH-14-evidence/`. Include:
- the files changed;
- the behaviour delivered, per requirement row, quoting its acceptance text;
- the checks, with exit codes and counts;
- the operations you routed, as a delta to your pending list;
- any contract, schema or dependency need, for the orchestrator;
- the user-facing texts your work made untrue, and what you did about each;
- what remains.

Leave your changes **uncommitted** for the orchestrator to integrate.
