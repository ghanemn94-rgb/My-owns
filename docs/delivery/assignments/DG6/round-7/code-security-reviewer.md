# DG6 gate review: code-security-reviewer (round 7, clean re-gate)

Task ID: `T-DG6-REV-CS-RG-R7`. You are the independent code security reviewer of the frozen **DG6** candidate (P6 "Integration and system hardening"). You did not implement any DG6 requirement and are read-only to the implementation.

## Candidate

- **candidate_id:** `sha256:10f71f2418567878bffddfb004efbf342347029fd799dd3076af40aca32e2fc5`. Verify it with `node tools/gates/candidate.mjs --stage DG6` (2775 files) on a **complete clone**. If the clone is incomplete, the review is BLOCKED.
- **manifest:** `docs/delivery/candidates/DG6/10f71f2418567878.manifest.json`.
- **source_commit:** `d8868b2a5c074b13c04693a88644c25ef2792583` (record this full 40-character id in your record's `source_commit`).
- **Node:** 24.21.0 at `/opt/nvm/versions/node/v24.21.0/bin`; 22.22.2 at `/opt/node22/bin` if present (if it is absent, say so: the Node 22 run is then BLOCKED, not PASS).
- **Browser:** pre-installed Chromium (`PLAYWRIGHT_BROWSERS_PATH=/opt/pw-browsers`). Never run `playwright install`.
- **Ports:** use ports below 32768; the harnesses retry on collision. **Your range is 32450–32499.** The other two reviewers run at the same time on other ranges.
- **Previous gates:** DG0 to DG5 are APPROVED. `node tools/gates/validate.mjs --historical --stage DG5` must pass, and so must `--historical --stage DG4`, `DG3`, `DG2` and `DG1`.
- **Design and delivery context:**
  - `docs/architecture/p6-plan.md` and `docs/architecture/p6-work-split.md`;
  - `docs/architecture/adr/ADR-0051` … `ADR-0059` and `ADR-0061` (there is no ADR-0060), with their dated amendments, which win where they differ from the original text; `ADR-0043` as amended by T-DG6-ARCH-07 to ARCH-10 (worker batching, the `automation_rule_enablement` ledger of migrations `0122`/`0123`, D-204 and D-205); the DG1–DG5 ADRs they extend;
  - `docs/delivery/decisions.md` D-193 to D-240 (DG6 start and plan: D-194 to D-196; the build waves: D-197 to D-202; round 1 and its repairs: D-206 to D-208; round 2 and its repairs: D-209 and D-210; round 3 and its repairs: D-211; round 4 and its repairs: D-212 to D-214; round 5 and its repairs: D-215, D-216; round 6 and its repairs: D-217 to D-220; round 7 and its repairs: D-221 to D-225; round 8 and its repairs: D-226 to D-230; round 9 and its repair: D-231, D-232; round 10 and its repair: D-233, D-234; round 11 and its repair: D-235, D-236; round 12, the blocked audit and the clean re-gate: D-237, D-238; the re-gate audit round 4 and its repair: D-239; rounds 5 and 6 and the re-freeze: D-240; the pre-freeze repairs: D-203 to D-205);
  - the P6 implementer and architect handbacks in `docs/delivery/handbacks/DG6/`;
  - the QA authoring handbacks in `docs/delivery/test-evidence/DG6/qa/T-DG6-QA-*-authoring/`;
  - the orchestrator's merged-tree verifications in `docs/delivery/test-evidence/DG6/orchestrator-*/`. The final one is `orchestrator-final-60787d8/` (read its `README.md`). The candidate's product tree (outside `docs/delivery`) equals `60787d89f`'s byte for byte.
- **The binding acceptance texts** are in `docs/delivery/requirements.csv` (`acceptance`, for the 48 rows with `final_gate` = DG6). Test them literally. The DG6 rows are IMPLEMENTED with evidence (`validate.mjs --register DG6` PASS). Their `notes` disclose every clause covered only partly, and several say "the binding re-run is the orchestrator's freeze verification" (REQ-S12-019, REQ-S15-014, REQ-S17-007, among others). Judge whether each such disclosure is acceptable, and re-run what it defers rather than trusting it.
- **Product gates G1–G6 are business approvals inside the product.** They never imply or relate to the engineering gates DG0–DG7. Product G6 never implies DG7.
- **The confined sandbox** gives you a read-only `node_modules`. Vitest's config loader then needs `--configLoader runner`; the A06 and A07 root specs need `E2E_SCREENSHOT_DIR` pointed at a writable path. Use them, and say so. Run anything that builds or writes in a disposable clone under `$TMPDIR`.
- **The stacks.** `apps/web/e2e/support/with-stack.sh` starts the production-initialized stack (it runs **no worker**; specs that need one start it themselves). `e2e/support/with-demo-stack.sh` starts a demo-initialized stack (`AUTH_MODE=dev`), where the demo role users `roaming.user.*` sign in through the dev sign-in (D-165).
- **Test-only settings.** The A17 webhook suites need `MTH_SECRET_QA_A17_WEBHOOK_SIGNING_SECRET=qa-a17-synthetic-signing-secret-0001`. It is a synthetic test value, not a secret (renamed by T-DG6-BE-Y2 for the `MTH_SECRET_*` SecretRef namespace, F-DG6-120). The worker's batch and concurrency are `WORKER_JOB_BATCH_SIZE` / `WORKER_JOB_CONCURRENCY` (defaults 8 and 4, D-203).
- **Machine load.** The three reviews run at the same time, so the load is high. A long e2e journey can cross its time limit under load. If a test times out, re-run that spec alone and report both runs. Never treat a timeout as a pass, and never hide one.

## What this round is

This is round 7 of DG6's **clean re-gate** (D-238).
- **Round 1** (candidate `b506084b`) raised F-DG6-900 (Low) and F-DG6-920 (Medium); repaired in T-DG6-BE-RG1 and T-DG6-FE-RG1; CLOSED_VERIFIED in round 2.
- **Round 2** (candidate `d62b187b`) raised F-DG6-960/970/980 (Medium, one defect: a withheld answer re-sent to the model as history) and F-DG6-971 (Low); the qa run was killed by a container restart (exit 143, no record). Repaired in T-DG6-BE-RG2 (`a0cf22bba`, migration 0129).
- **Round 3** (candidate `32e41b55`): domain, code-security and qa all PASS (the first attempt of all three was killed by a container restart and relaunched); 960/970/971/980 CLOSED_VERIFIED; no new finding.
- **Round 4** (same candidate): the release audit T-DG6-AUDIT-RG-R4 BLOCKED on one Low finding, **F-DG6-990**: seeded product text named engineering delivery gates DG2-DG4 (24 served strings: the `kpi.freshness_scan` job description, 16 automation starter change summaries, 6 procedure validation rules). See `docs/delivery/reviews/DG6/round-4/` and `test-evidence/DG6/audit/round-4/`.
- **Repair T-DG6-BE-RG3** (commit `60787d89f`, handback `docs/delivery/handbacks/DG6/T-DG6-BE-RG3-backend-workflow-engineer.md`; D-239): migration `0130_p6_seeded_text_business_terms.sql` rewords the stored seeded texts; `apps/api/test/integration/text-scan/seeded-texts.test.ts` scans served seeded data for DG0-DG7 references. D-239 leaves five append-only `audit_event.reason` texts (which carry task/decision ids, not gate names) as history; judge that ruling.
- **Round 5** (candidate `5e819f7a`, source `3c8b9a3`): code-security PASS; F-DG6-990 CLOSED_VERIFIED by domain and code-security. Domain FAIL on **F-DG6-911** (Medium); the qa run was killed by a container restart (exit 143, no record) and its committed sidecar raised the same defect as **F-DG6-951**: `stages.json` jumped DG6 VERIFYING -> REVIEWING at the round-5 freeze with no FIXING entry for the round-4 audit BLOCK, so every `--historical` validator exited 1.
- **Fix** (commit `e7cb240e7`, `stages.json` only, meta-excluded): a FIXING entry at 06:42:33Z with a note that it was recorded late.
- **Round 6** (same candidate `5e819f7a`): domain PASS, qa PASS; 911, 951 and 990 verified closed. qa raised **F-DG6-952** (Low, as an observation): the `stages.json` history timestamps of two APPROVED gates are out of order (DG5, DG0) and the validator does not check order. The orchestrator proposes it as an accepted observation (it does not rewrite approved gates' history); only the release auditor can concur. Judge it, and say in a check's `actual` whether you agree.
- **Why this round 7 (D-240).** A fix must be an ancestor of the verifying round's frozen `source_commit` and of the gate's, and `e7cb240e7` came after `3c8b9a3`, so 911/951 could not close on `5e819f7a`. `decisions.md` gained **D-240** (in the candidate), and DG6 was re-frozen at `d8868b2a5c074b13c04693a88644c25ef2792583`, which contains `e7cb240e7`. The product tree is unchanged: `git diff 3c8b9a3acfe657348249feb297b52cf208324a07 d8868b2a5c074b13c04693a88644c25ef2792583 -- . ':!docs/delivery'` must be empty, and the only candidate change is the D-240 row of `decisions.md`; confirm both. Read D-240 and judge it.
- **Merged-tree verification:** `docs/delivery/test-evidence/DG6/orchestrator-final-60787d8/` (V18, 15/15 exit 0; integration 4370; e2e 556 + 556). Its product tree equals this candidate's: `git diff 60787d89ffa2562d491af424bc1024b4e3bc2d57 d8868b2a5c074b13c04693a88644c25ef2792583 -- . ':!docs/delivery'` must be empty; confirm it.

- **This is a full gate review of DG6.** Your verdict binds the gate on this candidate. List every DG6-final requirement in `requirements_checked`. Give the repair diff `git diff 60787d89ffa2562d491af424bc1024b4e3bc2d57 d8868b2a5c074b13c04693a88644c25ef2792583 -- . ':!docs/delivery'` adversarial, line-level attention: migration `0130` (version steps, row guards, audit events, append-only history), the new scan and its exclusions, and any other served or rendered text that still names DG0-DG7.
- You may re-use your own earlier evidence for unchanged areas, but re-run anything the repair diff can affect, and say what you re-used.
- The old branch's findings (F-DG6-100 to F-DG6-740) are context, not records.

## Verify the open findings on THIS candidate, adversarially

- **Open findings:** F-DG6-911 and F-DG6-951 (Medium, one defect, the `stages.json` record fix `e7cb240e7`). Verify both on THIS candidate: `--historical` DG1-DG5 and `--pipeline` exit 0, and nothing else in DG6's `stages.json` history is inconsistent (state equals the last entry; every transition legal). Read each in full in `docs/delivery/findings.json` and the sidecar that raised it. F-DG6-990 is CLOSED_VERIFIED; re-run its probe `docs/delivery/test-evidence/DG6/audit/round-4/probes/zz-aud-r4-served-dg-labels.test.ts` (or an equivalent) as a regression check.

For each one:
1. Re-run the reproduction from the round in which it was raised on this candidate (the real stack where the finding was observed there).
2. Where practical, run a mutant that reverts the fix, to show that the test catches it.
3. Read each finding in full in `docs/delivery/findings.json` and in the sidecar that raised it.

Write `docs/delivery/reviews/DG6/round-7/code-security-reviewer.verifications.json` = `{ "verifications": [ {finding_id, result, status_after, note, evidence[]} ] }`, where `status_after` is CLOSED_VERIFIED or OPEN. Your verdict can be PASS only if every one of them verifies CLOSED_VERIFIED. Then run your full review of this candidate.

- **Judge these open questions the orchestrator did not decide (D-238).** If you judge one a defect, raise it as a finding with a severity; if not, explain why in a check's `actual`:
  - D-229: connector configuration names stay cannot-name; and the D-228 (4) out-of-scope ruling on cross-organization ids. Try to find a served column, response, notification channel or write path that still names a sensitive record, or a token sequence that loses or misplaces a hidden literal after edits, grant changes or concurrent saves.

## Your focus: correctness, architecture, authorization, data integrity, concurrency, injection and security

Inspect the P6 diff directly: `git diff 660f40c7d141b6fb73c145e0ee7a053ceb5905de..d8868b2a5c074b13c04693a88644c25ef2792583` (DG5's approved source commit to this candidate), covering product code (`apps/**`, `packages/**`) and migrations `0098`–`0130`. Back every finding with a file and line reference, and a reproduction. Cover at least the following.

### Authorization, scope and sensitivity

- **Every P6 mutation needs all five of these:**
  - server-side authorization **re-checked at commit time**;
  - validation;
  - `If-Match` (409/428);
  - one audit event, with actor, action, time, record id, prior and new version and reason (REQ-S16-032);
  - no client or remote I/O inside a transaction (connector calls, outbound writes, notification sends, assistant provider calls).
- **AUD and ADM-only callers.** AUD gets 403 on every P6 write (the P6 operations are in `apps/api/test/support/p6-operations.ts`); an ADM-only caller sees nothing transformation-scoped. Run the sweep.
- **Scope and sensitivity (ADR-0051).** Organization, BU, transformation and sensitive-record scoping on reads, files, exports, search indexes, saved views and deep links (REQ-S10-002, REQ-S10-004, REQ-S12-024, REQ-S13-013). Sensitive grants and their revocation.
- **Service identities (ADR-0053, REQ-S16-029).** Each connector and job runs under a constrained identity; no secret appears in logs, records or API responses.
- **The assistant (ADR-0059).** It can never submit an approval, certify a benefit, set a value or create evidence; retrieval is scoped to the caller; uploaded-document content is untrusted (prompt injection, REQ-S17-011). Off by default.

### Input hardening and secrets (ADR-0052, ADR-0054)

- Uploads: file-type allow-list, size limits, content sniffing, safe preview (REQ-S13-011); rate limits; response validation against the contract (REQ-S16-027).
- Webhooks: signature verification, timestamp window, replay protection, body limits. Secret rotation. Secrets only through the SecretProvider registry (`env`, `file`), never in the repository.
- Imports: CSV/XLSX parsing limits, formula injection, decimal handling, duplicate detection, idempotent commit.
- Sessions, OIDC other-realm rejection (REQ-S16-007), storage adapter contract (REQ-S16-006), and the six clauses of REQ-S16-030.

### Data integrity, jobs and concurrency

- **Exactly once** for connector runs, import commits, outbound writes, reindex, notification delivery and rule executions: advisory locks, unique backstops, the outbox and relay, kill-and-restart (A13).
- **The worker (D-203, ADR-0043 as amended).** Batch and concurrency (`WORKER_JOB_BATCH_SIZE`/`WORKER_JOB_CONCURRENCY`, defaults 8/4) keep exactly-once and the per-rule locks. Judge the `automation_rule_enablement` ledger (`0122`, `0123`), the version-at-occurrence evaluation (D-204), the enabled-at-evaluation kill switch (D-205) and the residual commit-order race ADR-0043 documents.
- **Concurrency (REQ-S16-026, A14).** No silent overwrite; compare and re-apply.
- **Integrity (REQ-S16-023).** Canonical links, uniqueness, required owners and the integrity sweep.
- **Cursors.** Keyset pagination with a total order and no microsecond truncation (the BE-X7 repair).
- **Migrations `0098`–`0130`.** Forward-only and contiguous, with row guards, version steps, audit coverage and append-only history (renumbered at merge, D-196 item 2 and D-202).

### Contract and seams

- **The contract.** `docs/api/openapi.yaml` (`1.5.0-p6`) has 932 `operationId`s by a plain count; record the count `contract/contract.test.ts` reports. Every `p6-pending-*.ts` list must be empty. Check `config.consumes` and the media-type pin.
- **The module graph.** Acyclic; the worker imports no API code.
- **The web.** Session-bound actions only; no public CDN (`pnpm check:no-cdn`); bundled fonts.

### Run these, with real output

A missing tool or database is BLOCKED.
- `pnpm -r typecheck`, `pnpm -r build`, `pnpm lint`, `pnpm openapi:lint`, `pnpm check:no-cdn`, `pnpm format:check`;
- `pnpm test` on Node 22 **and** Node 24;
- the integration suite on a disposable PostgreSQL, **twice**: once with `LANG`/`LC_ALL` unset and once with `LANG=C.UTF-8`. It includes `contract/contract.test.ts` and migrations `0001`→`0130`;
- `node tools/gates/validate.mjs --historical --stage DG5`.

## Requirements to check (record EXACTLY these, 36)

`REQ-S01-005`, `REQ-S02-006`, `REQ-S10-002`, `REQ-S10-004`, `REQ-S12-019`, `REQ-S12-023`, `REQ-S12-024`, `REQ-S13-011`, `REQ-S13-013`, `REQ-S15-010`, `REQ-S16-006`, `REQ-S16-007`, `REQ-S16-022`, `REQ-S16-023`, `REQ-S16-026`, `REQ-S16-027`, `REQ-S16-029`, `REQ-S16-030`, `REQ-S16-032`, `REQ-S17-001`, `REQ-S17-002`, `REQ-S17-003`, `REQ-S17-005`, `REQ-S17-006`, `REQ-S17-007`, `REQ-S17-008`, `REQ-S17-009`, `REQ-S17-010`, `REQ-S17-011`, `REQ-S20-012`, `REQ-S20-013`, `REQ-S20-014`, `REQ-S20-017`, `REQ-S20-022`, `REQ-S20-029`, `REQ-S20-030`.

## Evidence honesty (DG2 round-11 audit condition 1, binding)

- In your record, report every non-zero exit, failed suite, hook timeout, skipped or flaky test, or error line that appears in any log you cite. Explain each one, whatever its cause, in the check's `actual`.
- A check whose evidence holds an unexplained failure cannot be PASS.
- A probe that exits non-zero "by design" must say exactly which assertions failed and why.

## Environmental residuals: NOT BLOCKED gate checks

Record each of these as PASS on the offline/config surface, and note the residual. A BLOCKED check fails the gate round.
- Live registry: REQ-DLV-042 AC-1, D-057.
- Live CI: REQ-DLV-025 A24, D-058.
- Keycloak and a real enterprise IdP: D-049. The OIDC clauses are tested against the bundled test issuer (REQ-S16-007); the SAML broker is documented, not run.
- External systems: no real Mobily system, mail server, messaging service or AI provider is reachable. Connectors, outbound writes, notification channels and the assistant are exercised through their test adapters and the shipped "disabled" configuration (ADR-0055, ADR-0054, ADR-0059).
- Production capacity: the REQ-S20-029 and REQ-S20-030 targets are provisional engineering targets measured on one sandbox host, not verified Mobily capacity (the register notes).

## Record format (MANDATORY)

Write `docs/delivery/reviews/DG6/round-7/code-security-reviewer.json` with these fields:

- `assignment` = exactly `docs/delivery/assignments/DG6/round-7/code-security-reviewer.md` (bare path);
- `candidate_id` as above; `source_commit` as above;
- `reviewer_role: code-security-reviewer`, `round: 7`, `stage_id: DG6`;
- `checks_run[]`, each `{id, environment, procedure, expected, actual, exit_status (int), result (PASS|FAIL|BLOCKED), evidence[]}`;
- `requirements_checked[]`: exactly the ids listed above;
- `findings[]`: only the ids of NEW findings (strings);
- `verdict`: PASS only if all four hold:
  - every requirement you check is verifiable with evidence;
  - every failure in the logs you cite is disclosed and explained;
  - nothing Critical, High or mandatory is unresolved;
  - you raised no finding you consider blocking.

Mirror the field set of `docs/delivery/reviews/DG5/round-7/code-security-reviewer.json`. Put your evidence under `docs/delivery/test-evidence/DG6/code-security/round-7/`.

## Finding record format: STRICT (use YOUR id range only)

- **Your id range for any NEW finding:** **F-DG6-932 to F-DG6-939**, used in order. Never use another id. The other reviewers have their own ranges.
- **The sidecar.** If you raise findings, write `docs/delivery/reviews/DG6/round-7/code-security-reviewer.findings.json` = `{ "schema_version": 1, "findings": [ ... ] }`. If you raise none, set `findings: []` and write no sidecar.
- **Each finding object has EXACTLY these keys, and no others.** `locations` is NOT allowed:
  - `id`;
  - `stage_id` ("DG6");
  - `requirement`;
  - `severity` (Critical|High|Medium|Low);
  - `mandatory_violation` (bool);
  - `title`, `reproduction`, `expected`, `actual`;
  - `evidence` (array of repository paths);
  - `reported_by` ("code-security-reviewer");
  - `reported_in` ("docs/delivery/reviews/DG6/round-7/code-security-reviewer.json");
  - `owner` (an implementer role: backend-workflow-engineer | kpi-benefits-engineer | frontend-ux-engineer | solution-architect | transformation-analyst | devops-engineer);
  - `status` ("OPEN");
  - `history` (`[{at, status:"OPEN", note}]`).

**Severity guidance.**
- **High or mandatory** is a broken acceptance criterion, a security or authorization hole, a wrong financial result, or a business approval that can be fabricated or bypassed.
- **Medium** must be repaired before the gate (D-192): it cannot be accepted as an observation. Use it for a real defect with a bounded effect.
- **Low** is cosmetic, or a documentation drift with no behavioural effect.
- Be precise. An observation you do not consider a defect belongs in a check's `actual`, not in a finding.
