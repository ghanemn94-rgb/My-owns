# DG6 gate review: code-security-reviewer (round 5)

Task ID: `T-DG6-REV-CS-R5`. You are the independent code security reviewer of the frozen **DG6** candidate (P6 "Integration and system hardening"). You did not implement any DG6 requirement and are read-only to the implementation.

## Candidate

- **candidate_id:** `sha256:832e5c823462ad72859017506cde6a54087ddff15d926a2916bf32ce79d14988`. Verify it with `node tools/gates/candidate.mjs --stage DG6` (2740 files) on a **complete clone**. If the clone is incomplete, the review is BLOCKED.
- **manifest:** `docs/delivery/candidates/DG6/832e5c823462ad72.manifest.json`.
- **source_commit:** `d7b21bad306f6aacf10eaea5848d5449dbc4043e` (record this full 40-character id in your record's `source_commit`).
- **Node:** 24.21.0 at `/opt/nvm/versions/node/v24.21.0/bin`; 22.22.2 at `/opt/node22/bin` if present (if it is absent, say so: the Node 22 run is then BLOCKED, not PASS).
- **Browser:** pre-installed Chromium (`PLAYWRIGHT_BROWSERS_PATH=/opt/pw-browsers`). Never run `playwright install`.
- **Ports:** use ports below 32768; the harnesses retry on collision. **Your range is 30050–30099.** The other two reviewers run at the same time on other ranges.
- **Previous gates:** DG0 to DG5 are APPROVED. `node tools/gates/validate.mjs --historical --stage DG5` must pass, and so must `--historical --stage DG4`, `DG3`, `DG2` and `DG1`.
- **Design and delivery context:**
  - `docs/architecture/p6-plan.md` and `docs/architecture/p6-work-split.md`;
  - `docs/architecture/adr/ADR-0051` … `ADR-0059` and `ADR-0061` (there is no ADR-0060), with their dated amendments, which win where they differ from the original text; `ADR-0043` as amended by T-DG6-ARCH-07 to ARCH-10 (worker batching, the `automation_rule_enablement` ledger of migrations `0122`/`0123`, D-204 and D-205); the DG1–DG5 ADRs they extend;
  - `docs/delivery/decisions.md` D-193 to D-214 (DG6 start and plan: D-194 to D-196; the build waves: D-197 to D-202; round 1 and its repairs: D-206 to D-208; round 2 and its repairs: D-209 and D-210; round 3 and its repairs: D-211; round 4 and its repairs: D-212 to D-214; the pre-freeze repairs: D-203 to D-205);
  - the P6 implementer and architect handbacks in `docs/delivery/handbacks/DG6/`;
  - the QA authoring handbacks in `docs/delivery/test-evidence/DG6/qa/T-DG6-QA-*-authoring/`;
  - the orchestrator's merged-tree verifications in `docs/delivery/test-evidence/DG6/orchestrator-*/`. The final one is `orchestrator-final-8a24a1c/` (read its `README.md`): a full run on `8a24a1c62` in which every step exits 0. The candidate's product tree equals `8a24a1c62`'s.
- **The binding acceptance texts** are in `docs/delivery/requirements.csv` (`acceptance`, for the 48 rows with `final_gate` = DG6). Test them literally. The DG6 rows are IMPLEMENTED with evidence (`validate.mjs --register DG6` PASS). Their `notes` disclose every clause covered only partly, and several say "the binding re-run is the orchestrator's freeze verification" (REQ-S12-019, REQ-S15-014, REQ-S17-007, among others). Judge whether each such disclosure is acceptable, and re-run what it defers rather than trusting it.
- **Product gates G1–G6 are business approvals inside the product.** They never imply or relate to the engineering gates DG0–DG7. Product G6 never implies DG7.
- **The confined sandbox** gives you a read-only `node_modules`. Vitest's config loader then needs `--configLoader runner`; the A06 and A07 root specs need `E2E_SCREENSHOT_DIR` pointed at a writable path. Use them, and say so. Run anything that builds or writes in a disposable clone under `$TMPDIR`.
- **The stacks.** `apps/web/e2e/support/with-stack.sh` starts the production-initialized stack (it runs **no worker**; specs that need one start it themselves). `e2e/support/with-demo-stack.sh` starts a demo-initialized stack (`AUTH_MODE=dev`), where the demo role users `roaming.user.*` sign in through the dev sign-in (D-165).
- **Test-only settings.** The A17 webhook suites need `MTH_SECRET_QA_A17_WEBHOOK_SIGNING_SECRET=qa-a17-synthetic-signing-secret-0001`. It is a synthetic test value, not a secret (renamed by T-DG6-BE-Y2 for the `MTH_SECRET_*` SecretRef namespace, F-DG6-120). The worker's batch and concurrency are `WORKER_JOB_BATCH_SIZE` / `WORKER_JOB_CONCURRENCY` (defaults 8 and 4, D-203).
- **Machine load.** The three reviews run at the same time, so the load is high. A long e2e journey can cross its time limit under load. If a test times out, re-run that spec alone and report both runs. Never treat a timeout as a pass, and never hide one.

## What this round is

This is DG6's fifth gate round. Round 4 on candidate `4b84bf20` (source `654e39d89b66c0975ebef293d607f480f58408e3`) passed the QA review and failed the domain and code-security reviews (D-212). Every open finding was routed to a repair task, and all of them are merged. A root e2e failure found by the orchestrator's verification was root-caused to a product race and repaired before this freeze (D-213, BE-Z6). See D-214. The handbacks are in `docs/delivery/handbacks/DG6/T-DG6-{BE-Z5,FE-Z3,AN-Z3,BE-Z6}-*.md`, with evidence in `T-DG6-BE-Z5-evidence/`, `T-DG6-FE-Z3-evidence/` and `T-DG6-BE-Z6-evidence/`.
- The diff since round 4 is `git diff 654e39d89b66c0975ebef293d607f480f58408e3..d7b21bad306f6aacf10eaea5848d5449dbc4043e`. Review all of it, not only the lines a finding names.
- New since round 4:
  - BE-Z5 (F-DG6-300, 280): the traceability, missing-links, G6-readiness and register reports, and the blocker escalation's executive ask, no longer carry a sensitive benefit's code, title or values to a reader who gets 404 on the benefit. The new sweep test `sensitive-reach-sweep.test.ts` calls every GET operation it can fill from seeded data (375 of 446) as such a reader. Its declared residuals are in the handback's §10;
  - FE-Z3 (F-DG6-320, 301, 281): EN and AR text for `kpi.stale`, `operations.heartbeat_missed` and three field-error codes; the connector target label; `problems-all.test.ts` now also covers field-error and exception codes;
  - AN-Z3: register rows;
  - BE-Z6 (D-213): a system re-raise of an open operational exception no longer bumps the version a human acknowledge or resolve was based on; a conflict between two humans still returns 409. `e2e/a22-p6-operability.spec.ts` now exercises a re-raise between page load and acknowledge.

## Verify your open findings on THIS candidate, adversarially

- **F-DG6-300 (High, mandatory; the traceability, missing-links, G6-readiness and register reports leak a sensitive benefit's code, title and values; repair T-DG6-BE-Z5).**
- **F-DG6-301 (Low; three field-error codes have no EN/AR text; repair T-DG6-FE-Z3).**

For each one:
1. Re-run the reproduction from the round in which it was raised on this candidate (the real stack where the finding was observed there).
2. Where practical, run a mutant that reverts the fix, to show that the test catches it.
3. Read each finding in full in `docs/delivery/findings.json` and in the sidecar that raised it.

Write `docs/delivery/reviews/DG6/round-5/code-security-reviewer.verifications.json` = `{ "verifications": [ {finding_id, result, status_after, note, evidence[]} ] }`, where `status_after` is CLOSED_VERIFIED or OPEN. Your verdict can be PASS only if every one of them verifies CLOSED_VERIFIED. Then run your full review of this candidate.

- **Judge these open questions the orchestrator did not decide (D-214).** If you judge one a defect, raise it as a finding with a severity; if not, explain why in a check's `actual`:
  - BE-Z5's declared residuals (handback §10): the 71 GET operations the sweep cannot fill from seeded data; the search index not exercised by the sweep; stored rows created before the fix keep a benefit title (no migration); benefit ids in the frozen G6 snapshot; the counts kept as truthful verdicts (G6 placeholder, `hiddenItemCount`, frozen `itemCount`, report totals, `benefit_missing`). Is each acceptable under ADR-0051?
  - BE-Z6: does the re-raise rule hide a real conflict, lose a system update, or let a stale human write overwrite a newer human one?
  - Try to reach a sensitive benefit's code, title or values through any report, export, search, inbox, escalation, lineage or audit path the sweep does not cover.

## Your focus: correctness, architecture, authorization, data integrity, concurrency, injection and security

Inspect the P6 diff directly: `git diff 660f40c7d141b6fb73c145e0ee7a053ceb5905de..d7b21bad306f6aacf10eaea5848d5449dbc4043e` (DG5's approved source commit to this candidate), covering product code (`apps/**`, `packages/**`) and migrations `0098`–`0123`. Back every finding with a file and line reference, and a reproduction. Cover at least the following.

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
- **Migrations `0098`–`0125`.** Forward-only and contiguous, with row guards, version steps, audit coverage and append-only history (renumbered at merge, D-196 item 2 and D-202).

### Contract and seams

- **The contract.** `docs/api/openapi.yaml` (`1.5.0-p6`) has 932 `operationId`s by a plain count; record the count `contract/contract.test.ts` reports. Every `p6-pending-*.ts` list must be empty. Check `config.consumes` and the media-type pin.
- **The module graph.** Acyclic; the worker imports no API code.
- **The web.** Session-bound actions only; no public CDN (`pnpm check:no-cdn`); bundled fonts.

### Run these, with real output

A missing tool or database is BLOCKED.
- `pnpm -r typecheck`, `pnpm -r build`, `pnpm lint`, `pnpm openapi:lint`, `pnpm check:no-cdn`, `pnpm format:check`;
- `pnpm test` on Node 22 **and** Node 24;
- the integration suite on a disposable PostgreSQL, **twice**: once with `LANG`/`LC_ALL` unset and once with `LANG=C.UTF-8`. It includes `contract/contract.test.ts` and migrations `0001`→`0125`;
- `node tools/gates/validate.mjs --historical --stage DG5`.

## Requirements to check (record EXACTLY these, 36)

`REQ-S01-005`, `REQ-S02-006`, `REQ-S10-002`, `REQ-S10-004`, `REQ-S12-019`, `REQ-S12-023`, `REQ-S12-024`, `REQ-S13-011`, `REQ-S13-013`, `REQ-S15-010`, `REQ-S16-006`, `REQ-S16-007`, `REQ-S16-022`, `REQ-S16-023`, `REQ-S16-026`, `REQ-S16-027`, `REQ-S16-029`, `REQ-S16-030`, `REQ-S16-032`, `REQ-S17-001`, `REQ-S17-002`, `REQ-S17-003`, `REQ-S17-005`, `REQ-S17-006`, `REQ-S17-007`, `REQ-S17-008`, `REQ-S17-009`, `REQ-S17-010`, `REQ-S17-011`, `REQ-S20-012`, `REQ-S20-013`, `REQ-S20-014`, `REQ-S20-017`, `REQ-S20-022`, `REQ-S20-029`, `REQ-S20-030`.

## Evidence honesty (DG2 round-10 audit condition 1, binding)

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

Write `docs/delivery/reviews/DG6/round-5/code-security-reviewer.json` with these fields:

- `assignment` = exactly `docs/delivery/assignments/DG6/round-5/code-security-reviewer.md` (bare path);
- `candidate_id` as above; `source_commit` as above;
- `reviewer_role: code-security-reviewer`, `round: 5`, `stage_id: DG6`;
- `checks_run[]`, each `{id, environment, procedure, expected, actual, exit_status (int), result (PASS|FAIL|BLOCKED), evidence[]}`;
- `requirements_checked[]`: exactly the ids listed above;
- `findings[]`: only the ids of NEW findings (strings);
- `verdict`: PASS only if all four hold:
  - every requirement you check is verifiable with evidence;
  - every failure in the logs you cite is disclosed and explained;
  - nothing Critical, High or mandatory is unresolved;
  - you raised no finding you consider blocking.

Mirror the field set of `docs/delivery/reviews/DG5/round-1/code-security-reviewer.json`. Put your evidence under `docs/delivery/test-evidence/DG6/code-security/round-5/`.

## Finding record format: STRICT (use YOUR id range only)

- **Your id range for any NEW finding:** **F-DG6-360 to F-DG6-379**, used in order. Never use another id. The other reviewers have their own ranges.
- **The sidecar.** If you raise findings, write `docs/delivery/reviews/DG6/round-5/code-security-reviewer.findings.json` = `{ "schema_version": 1, "findings": [ ... ] }`. If you raise none, set `findings: []` and write no sidecar.
- **Each finding object has EXACTLY these keys, and no others.** `locations` is NOT allowed:
  - `id`;
  - `stage_id` ("DG6");
  - `requirement`;
  - `severity` (Critical|High|Medium|Low);
  - `mandatory_violation` (bool);
  - `title`, `reproduction`, `expected`, `actual`;
  - `evidence` (array of repository paths);
  - `reported_by` ("code-security-reviewer");
  - `reported_in` ("docs/delivery/reviews/DG6/round-5/code-security-reviewer.json");
  - `owner` (an implementer role: backend-workflow-engineer | kpi-benefits-engineer | frontend-ux-engineer | solution-architect | transformation-analyst | devops-engineer);
  - `status` ("OPEN");
  - `history` (`[{at, status:"OPEN", note}]`).

**Severity guidance.**
- **High or mandatory** is a broken acceptance criterion, a security or authorization hole, a wrong financial result, or a business approval that can be fabricated or bypassed.
- **Medium** must be repaired before the gate (D-192): it cannot be accepted as an observation. Use it for a real defect with a bounded effect.
- **Low** is cosmetic, or a documentation drift with no behavioural effect.
- Be precise. An observation you do not consider a defect belongs in a check's `actual`, not in a finding.
