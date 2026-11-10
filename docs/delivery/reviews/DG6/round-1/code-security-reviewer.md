# DG6 clean re-gate, round 1: code-security review (T-DG6-REV-CS-RG-R1)

- **Candidate:** `sha256:b506084b2c497c82d6e4de07789d35314bf1b3e3bb83f1dd6bf420a6c4510451` (2769 files), source `98feb869cd85671b3e95679e13bd255c421cb80d`.
- **Reviewer:** code-security-reviewer, session `957b9774-6d41-4bf4-988c-23a8910b30d6`.
- **Verdict:** **FAIL**, with one new Medium finding (F-DG6-920). Under D-192 a Medium must be repaired before the gate.
- **Engineering gates only:** nothing here relates to product gates G1–G6, and product G6 never implies DG7.

## Verdict basis

Everything I ran passes except one defect in the assistant's read-time permission re-check.

**F-DG6-920 (Medium, REQ-S17-007; owner backend-workflow-engineer).**
- **The flaw.** ADR-0059 §9 promises that "a revoked grant hides earlier answers too". The implementation stores and re-checks only the records the model chose to cite (`guardrails.ts:192` `citationsFor`, `answer.ts:105`), not every record it was given.
- **Reproduction.** I used the shipped `http_endpoint` provider against the suite's local fake model (`repro/zz-sec-r1-assistant-uncited.test.ts`, log 30).
  - The model was given two transformations' records and cited only one.
  - The grant on the uncited one was then revoked. A direct read of it now answers 404.
  - The stored answer, which names the revoked record, is still served with `contentWithheld: false`.
- **Why the suites miss it.** The test adapter always cites every item, and the existing §9 test writes citations directly.
- **Bounded effect.** Only the conversation owner keeps seeing text they could read when it was produced. Uncited items can include an evidence excerpt of up to 8,000 characters.
- **Expected repair.** Keep every record item given to the model for the read-time check (for example a context list beside the citations), or withhold an answer when any given record becomes unreadable.

## What I ran (all in disposable copies under `$TMPDIR`, removed afterwards)

| Check | Result |
|---|---|
| Candidate ID: working tree, `--ref` source, `--ref` freeze, each clone | equal, 2769 files (01, 50) |
| install, build, typecheck, lint, format, openapi-lint (932 ops), no-cdn | exit 0 (02–08); Vite chunk-size advisory disclosed |
| `pnpm test` Node 22 / Node 24 | every test passes. Exit 1 comes only from a Vitest worker RPC timeout under load; the unit-node project re-run with 2 workers exits 0 (10b/10c, 11b/11c) |
| Integration, LANG unset / C.UTF-8 (3 shards each) | 439 files, 4354 passed, 1 skip (by design), 1 todo (stale), exit 0 (12c, 13c); contract 932/932 |
| Targeted e2e, real stack, en and ar | 18 + 4 + 6 passed: A12-1…6, A14, A17, A21, A21 degradation with a loopback-only connection log, draft recovery after clearing storage, compare-reapply (51–53) |
| log scan + canary grep over the integration logs | PASS (42) |
| validators: `--historical` DG5…DG1, `--register DG6` | PASS (40) |
| P6 role sweep (AUD 40 writes; ADM-only reads, search) | refused / nothing visible (31–34) |
| Old fixes re-run: F-DG6-380 probe; token probes; issuer-tag mutant | 10/10 bursts complete; 31/31; mutant caught 8/31 (36–38) |
| Assistant uncited-source reproduction | defect reproduced, F-DG6-920 (30) |
| Short load re-measurement on this tree | every class within target; dashboards p95 191 ms (load/) |

**Load.** Three reviews ran concurrently, and the 1-minute load stayed at 11–28 throughout (`load-samples*.log`). The D-134 envelope (8 or less) was never available, so every unit result is from above it.

## Disclosures

- **An orphaned pipeline.** My first background pipeline (`tests.sh`) could not be stopped with `pkill`, because every Bash call runs in its own PID namespace.
  - It ran `pnpm test` at the same time as the intended pipeline. So `10-unit-node22.log` and `11-unit-node24.log` each interleave two runs. They contain one ENOENT from the sparse clone, one unit-web wait failure at load 25 and one `architecture.test.ts` 30 s timeout at load 25.
  - It then started an integration run (`12-…`).
  - I stopped it by deleting its clone (log 41). Its 12/13 logs show the resulting breakage.
  - None of these four logs is gate evidence. The clean re-runs are 10b/11b/10c/11c and 12c/13c.
- **Record round.** The assignment asks for `round: 7`. This round is 1 in `stages.json` and the directory, and the validator requires equality, so the record uses 1.
- **Diff range.** The assignment's diff range ends at `70f05ed49`, the old branch's round-7 freeze. I reviewed `660f40c7d..98feb869c`.
- **Migrations.** They run to 0127, not 0123/0125, and I reviewed 0098–0127.
- **Node 22 version.** `/opt/node22` is v22.22.0, while `environment.md` says 22.22.2.
- **Sharding.** I ran the integration suite in shards because each background task here is capped at 2 hours. The union is the full project, and the counts equal the orchestrator's final run.
- **HEAD moved.** The repository HEAD moved to `bb7f8068a` (the domain reviewer's auto-committed run). The candidate is unchanged, and I did not open that reviewer's records.

## Open questions of D-238 (my judgement)

- **D-228 (1) / D-233 tokens.** They are sound.
  - Positions count every literal of the stored version, identically when redacting and when resolving.
  - The tag is an HMAC over the row key, id and row version.
  - Resolution happens after `FOR UPDATE` and If-Match.
  - Actions and starter parameters are strict schemas, so a token cannot be moved into a served or rendered field.
  - The re-run probes and the mutant confirm all of this.
  - Dry-run is an equality-only oracle: it confirms a guessed uuid but cannot extract one. This is not a finding.
- **D-229.** Connector `field_mappings.source` and SecretRef names can hold a uuid. Only connector administrators or IT write them, and they are configuration text, not product-created references. I accept the cannot-name classification.
- **D-228 (4).** A cross-organization id discloses nothing resolvable, since `markedInOrganizations` covers all of the principal's organizations. Accepted.

## Source review (P6 diff `660f40c7d..98feb869c`), files read in full

- **assistant:** `retrieval.ts`, `answer.ts`, `guardrails.ts`, `conversations.ts` (read-time check).
- **automation:** `versions.ts` (tokens, update), `rules.ts` (`configurer`/`loadRuleForWrite`), `conditions.ts`, `dry-run.ts`, `executions.ts`/`failures.ts` (masking, cursors).
- **worker:** `apps/worker/src/automation/engine.ts` (candidates and ledger, locks, once-key), `handlers/notifications.ts` (`sendDelivery`), `handlers/digests.ts`.
- **integrations:** `webhooks.ts` (verify, parse, replay, auto-commit), `connectors.ts` (mappings, on-behalf-of), `adapters/http-pull.ts`, `outbound.ts`, `imports/parsers/xlsx.ts`.
- **evidence:** `preview.ts`, `content-policy.ts`, `routes.ts` download.
- **reporting/exports:** `jobs.ts` (download re-check), `packages/reporting/src/injection.ts`.
- **tasks/access:** `tasks/deep-links.ts`, `access/sensitive-reach.ts`.
- **operations:** `operations/exceptions.ts` (linked KPI scope).
- **portfolio:** `portfolio/deliverable-confirmation.ts`.
- **identity and server:** `identity/oidc.ts`, `server.ts` (trustProxy, rate-limit keys), `packages/config` (worker bounds).
- **migrations:** 0098–0127 (grants to AUD; P6 numbering).

## Requirements (36)

| Requirement | Evidence | Result |
|---|---|---|
| REQ-S01-005 | integration (A11/A17 suites), `deliverable-confirmation.ts` review | satisfied |
| REQ-S02-006 | integration (A08/A12), role sweep, `p6-draft-recovery` e2e (storage cleared, reload) | satisfied |
| REQ-S10-002, REQ-S10-004, REQ-S20-012 | sweep, sensitive-reach suites, token probes, A12 e2e | satisfied |
| REQ-S12-019, REQ-S12-023, REQ-S12-024 | integration, A17/A21/A12 e2e, source review | satisfied |
| REQ-S13-011, REQ-S13-013 | integration, A12-3 e2e, preview and content-policy review | satisfied |
| REQ-S15-010, REQ-S16-026, REQ-S20-014 | integration, A14 and p6 compare/draft e2e | satisfied |
| REQ-S16-006 | `store-contract.test.ts` | satisfied |
| REQ-S16-007 | `oidc.ts` review and integration | other-realm rejection satisfied; Keycloak-realm e2e login is the D-049 residual (not run) |
| REQ-S16-022, REQ-S16-023 | integration | satisfied |
| REQ-S16-027 | contract 932/932, sweep | satisfied |
| REQ-S16-029 | log scan, secrets scan | satisfied |
| REQ-S16-030 | integration | satisfied |
| REQ-S16-032 | integration | satisfied |
| REQ-S17-001…006, REQ-S17-008, REQ-S17-010, REQ-S17-011, REQ-S20-013, REQ-S20-017, REQ-S20-022 | integration, A21 e2e, F-DG6-380 probe, source review | satisfied |
| REQ-S17-009 | A21 degradation e2e with connection log (loopback only), `providerFor` review | satisfied for the specs I captured; whole-suite capture not run by me |
| REQ-S17-007 | — | **not fully satisfied (F-DG6-920)** |
| REQ-S20-029 | load re-measurement on this tree (dashboards now measured); `getWorkstreamDashboard` still unmeasured | satisfied, with residuals |
| REQ-S20-030 | load re-measurement on this tree, A12-4 e2e | satisfied, with residuals |
