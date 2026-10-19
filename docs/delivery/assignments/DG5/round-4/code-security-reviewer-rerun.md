# DG5 gate review: code-security-reviewer (round 4)

> **Re-run.** The first round-4 run, `DG5-T-DG5-REV-SEC-R4-code-security-reviewer-20261019T095848Z-d66ca737`, was stopped by a container restart at about 12:31Z (about two and a half hours in) before it wrote a record. Its runner survived the restart and committed the run folder as it stood (`c3c964e`; exit 143, no result). That run folder stays in `docs/delivery/runs/DG5/` (write-once). Its partial evidence and its partial verifications sidecar (moved to `docs/delivery/test-evidence/DG5/code-security-r4-orphaned/reviews-round-4/`) are kept for provenance only in `docs/delivery/test-evidence/DG5/code-security-r4-orphaned/` (without its screenshots). Do not cite any of it; produce all evidence afresh under `docs/delivery/test-evidence/DG5/code-security/round-4/`, and write your own record and sidecars. The domain review of this round has finished, so only the code-security and qa reviews run now. Everything else in this assignment is unchanged.

Task ID: `T-DG5-REV-SEC-R4B`. You are the independent code security reviewer of the frozen **DG5** candidate (P5 "Configuration automation and outputs"). You did not implement any DG5 requirement and are read-only to the implementation.

## Candidate

- **candidate_id:** `sha256:26d4ad92320eeaa2a9931a4254988c12b8d0ed175873dc7aab912894a8f5e1bf`. Verify it with `node tools/gates/candidate.mjs --stage DG5` (2188 files) on a **complete clone**. If the clone is incomplete, the review is BLOCKED.
- **manifest:** `docs/delivery/candidates/DG5/26d4ad92320eeaa2.manifest.json`.
- **source_commit:** `fb9c221`.
- **Node:** 24.21.0 at `/opt/nvm/versions/node/v24.21.0/bin`; 22.22.2 at `/opt/node22/bin`.
- **Browser:** pre-installed Chromium (`PLAYWRIGHT_BROWSERS_PATH=/opt/pw-browsers`). Never run `playwright install`.
- **Ports:** use ports below 32768; the harnesses retry on collision. **Your ranges are 26500–26599.** The other two reviewers run at the same time on other ranges.
- **Previous gates:** DG4, DG3, DG2 and DG1 are APPROVED. `node tools/gates/validate.mjs --historical --stage DG4` must pass, and so must `--historical --stage DG3`, `DG2` and `DG1`.
- **Design and delivery context:**
  - `docs/architecture/p5-plan.md` and `docs/architecture/p5-work-split.md`;
  - `docs/architecture/adr/ADR-0039` … `ADR-0050`, with their dated amendments (T-DG5-ARCH-R1 to R6), which win where they differ from the original text; the DG1–DG4 ADRs they extend;
  - `docs/delivery/decisions.md` D-141 to D-175 (the repair waves and their decisions: D-155 to D-175; rounds 1–3 and their repairs: D-170 to D-175);
  - the P5 implementer handbacks in `docs/delivery/handbacks/DG5/`;
  - the QA authoring handbacks in `docs/delivery/test-evidence/DG5/qa/T-DG5-QA-{A,C,D,B,E,F,E2,F2}-authoring/`;
  - the orchestrator's merged-tree verifications in `docs/delivery/test-evidence/DG5/orchestrator-D-*/` and the merged-tree verification named in D-175 (`orchestrator-D-175/`).
- **The binding acceptance texts** are in `docs/delivery/requirements.csv` (`acceptance`, for the 78 rows with `final_gate` = DG5). Test them literally. The DG5 rows are IMPLEMENTED with evidence (`validate.mjs --register DG5` PASS). Their `notes` disclose every clause covered only partly; judge whether each such disclosure is acceptable.
- **Product gates G1–G6 are business approvals inside the product.** They never imply or relate to the engineering gates DG0–DG7. Product G6 never implies DG7.
- **The confined sandbox** gives you a read-only `node_modules`. Vitest's config loader then needs `--configLoader runner`; the A06 and A07 root specs need `E2E_SCREENSHOT_DIR` pointed at a writable path. Use them, and say so. Run anything that builds or writes in a disposable clone under `$TMPDIR`.
- **The demo database:** `e2e/support/with-demo-stack.sh` starts a demo-initialized stack (`AUTH_MODE=dev`), where the demo role users `roaming.user.*` sign in through the dev sign-in (D-165). The production-initialized stack is `apps/web/e2e/support/with-stack.sh`.
- **Machine load.** The three reviews run at the same time, so the load is high. A long e2e journey can cross its 30 s limit under load. If a test times out, re-run that spec alone and report both runs. Never treat a timeout as a pass, and never hide one.

## Round 4: what changed since round 3, and what to judge

- **Round 3** ran on candidate `sha256:fc93b239…`, source `bbd6294`. Its result:
  - domain PASS;
  - code-security PASS;
  - qa PASS.
  F-DG5-120, 122, 142 and 143 were verified closed. Four findings were new and are open:
  - F-DG5-123 (Low, domain);
  - F-DG5-102 (Low, code-security);
  - F-DG5-144 (Medium, qa);
  - F-DG5-145 (Low, qa; the same defect as F-DG5-102).
  The gate validator needs every finding in a terminal state, so D-174 decided their repairs.
- **The repairs:** repair wave Y (T-DG5-BE-Y1, BE-Y2, FE-Y1) and ARCH-R6 delivered them, with one orchestrator comment-only edit. D-175 records the integration and the merged-tree verification.
- **The round-3 records and evidence** are in `docs/delivery/reviews/DG5/round-3/` and `docs/delivery/test-evidence/DG5/{domain,code-security,qa}/round-3/`. A container restart stopped the first code-security and qa runs of round 3. Their material in `docs/delivery/test-evidence/DG5/{code-security,qa}-r3-orphaned/` is provenance only (D-174); do not cite it.
- **D-175's disclosed observations are open for you to judge:** each in your focus, accept it with a reason in a check's `actual`, or raise a finding.

## Verify your open finding on THIS candidate, adversarially

- **F-DG5-102 (Low; REQ-S16-001):** the ADR-0002 module-boundary unit test exceeded its fixed 30 s budget in full Node 22 runs under review load.
  - **Claimed fix (T-DG5-BE-Y2):**
    - rule 4 passes an `EMPTY_EMIT` `before` transformer to the same `ts.transpileModule` call, so nothing is transformed or printed and the diagnostics are unchanged. This makes it about 28 % faster;
    - a guard test compares rule 4 with a full `ts.transpileModule` over eight extensions. The handback also reports a mutation check and a 10,752-case differential with 0 differences;
    - the full walk has its own 150 s budget, and the module-owned tests keep 30 s;
    - plus the orchestrator's comment-only edit `2d0f98c`.
  - **To verify:**
    - re-run your Node 22 and Node 24 unit runs under the review load, and the test alone;
    - judge adversarially whether the `EMPTY_EMIT` path could miss a syntax error the old path caught. Use the guard test, its mutation check and your own hostile sources;
    - confirm that every planted-violation and allow-list control is unchanged and passes.
- **Also in the repair diff:**
  - **T-DG5-BE-Y1's seed rows** must respect every guard and audit rule: TL holds `tom.edit`, `initiative.edit` and `traceability.link`; each write has one audit event; the seed stays refused in production.
  - **T-DG5-FE-Y1** is CSS only, with no markup change. Include the 409 conflict banner's new rules.

**The verifications file.** Write `docs/delivery/reviews/DG5/round-4/code-security-reviewer.verifications.json` = `{ "verifications": [ {finding_id, result, status_after, note, evidence[]} ] }`.
- If the fix is genuine: `result: "PASS"`, `status_after: "CLOSED_VERIFIED"`.
- Otherwise: `result: "FAIL"`, with the reason and the reproduction.

A residual you judge not worth a finding goes in the note, with your reasoning. **Your verdict can be PASS only if each of your open findings verifies CLOSED.**

**The repair diff** is `git diff bbd6294..fb9c221`, from round 3's source `bbd6294` to this candidate's source. The repairs are:
- T-DG5-BE-Y1 (the demo's key deliverables, capability changes and trace links; the `demo.test.ts` teardown budget);
- T-DG5-BE-Y2 (the ADR-0002 boundary test: rule 4 without emit printing, a guard test, its own 150 s budget);
- T-DG5-FE-Y1 (the Diagnose and 409 conflict-banner reflow; the spec `p5-diagnose-reflow.spec.ts`);
- T-DG5-ARCH-R6 (documentation only);
- the orchestrator's comment-only edit `2d0f98c` to `apps/api/src/architecture.testkit.ts`.

Their handbacks are in `docs/delivery/handbacks/DG5/`. D-174 decided each repair; D-175 records the integration, the verification and the observations disclosed for you to judge.

- **Re-inspect the whole repair diff for regressions.** A repair must not weaken any other behaviour.
- **Then run your full review,** as below. This round is a complete review of the new candidate.

## Your focus: correctness, architecture, authorization, data integrity, concurrency, injection and security

Inspect the P5 diff directly: `git diff e70ac02..fb9c221`, covering product code (`apps/**`, `packages/**`) and migrations `0062`–`0097`. Back every finding with a file and line reference, and a reproduction. Cover at least the following.

### Authorization and separation of duties

- **Every P5 mutation needs all five of these:**
  - server-side authorization **re-checked at commit time**;
  - validation;
  - `If-Match` (409/428), including the `ETagOrZero` reads;
  - one audit event;
  - no client or remote I/O inside a transaction.
- **AUD and ADM-only callers.** AUD gets 403 on every P5 write. An ADM-only caller sees nothing transformation-scoped. The navigation is hidden server-side. Run the sweep.
- **The Studio.** Only methodology admins edit and publish. A review where configured cannot be done by the author. ADM roles are never approvers. Stable ids, fixed sets and source columns are protected at the API and at the database.
- **Approvals.** Sequential and parallel routes; conditional approval; the routed (effective) approver everywhere (`routedApproverOf`, `approver_configured`, `0094`); the gate pack through `WorkflowsReadPort`.
- **Automation.** Execution under the initiating or service identity with its permissions (REQ-S12-003). Human-only actions are refused. The dry run writes nothing (rolled back). The builder's `samplePayload`.
- **Procedures.** Rule A's narrowed identity guard (`0096`) allows exactly one transition, and every other `transformation_id` change is refused. Adopted steps are authorized in their transformation (D-167).
- **Demo isolation.** Demo seeding is refused in production. The dev-issuer binding is created only with `AUTH_MODE=dev` outside production (D-165). The demo access administrator holds no business or approval permission.

### Data integrity, jobs and concurrency

- **Exactly once.**
  - **Scope:** rule executions, starters, cut-off packs, Day-90 and health jobs, exports, reminders and approvals.
  - **Proof:** the advisory-lock registry (730250 onwards), the unique backstops, the outbox and relay, and replay of the same event.
  - **The relay.** Every enqueued event type is registered in `OUTBOX_EVENT_SCHEMAS` (D-QA-F2-1). An unregistered type must never stall later events.
- **Exports.** The file store keys, the per-attempt files and their cleanup, the size limit, and download authorization (requester only; 404 otherwise).
- **Formula injection.** Neutralized in XLSX and CSV. System totals are formulas generated only from the fixed template.
- **Decimals.** Money, rates, scores and totals are decimal end to end, with no float.
- **Migrations `0062`–`0097`.** They are forward-only and contiguous. Each has row guards, version steps, audit coverage and append-only history. `0094`'s one-off trigger disable is judged (ADR-0039 C2).
- **Snapshots.** Immutable content and `content_sha256`; the optional `synthetic` member only in a demo database.

### Contract and seams

- **The contract.** `docs/api/openapi.yaml` has 846 operations. Every `p5-pending-*.ts` list is empty, `P5_PENDING_TESTS_BE_O` included. Check `config.consumes` and the media-type pin.
- **The module graph.** It is acyclic: reporting imports neither workflows nor admin (ports wired in `server.ts`); the worker imports no API code.
- **The web.** Session-bound actions only; lazy routes; no import cycle; no public CDN (`pnpm check:no-cdn`); bundled fonts.

### Run these, with real output

A missing tool or database is BLOCKED.
- `pnpm -r typecheck`, `pnpm -r build`, `pnpm lint`, `pnpm openapi:lint`, `pnpm check:no-cdn`, `pnpm format:check`;
- `pnpm test` on Node 22 **and** Node 24;
- the integration suite on a disposable PostgreSQL, **twice**: once with `LANG`/`LC_ALL` unset and once with `LANG=C.UTF-8`. It includes `contract/contract.test.ts` and migrations `0001`→`0097`;
- `node tools/gates/validate.mjs --historical --stage DG4`.

Put your evidence under `docs/delivery/test-evidence/DG5/code-security/round-4/`.

## Requirements to check (record EXACTLY these, 42)

`REQ-PB-093`, `REQ-S01-002`, `REQ-S03-007`, `REQ-S04-011`, `REQ-S05-001`, `REQ-S05-002`, `REQ-S05-006`, `REQ-S06-001`, `REQ-S06-002`, `REQ-S06-004`, `REQ-S06-005`, `REQ-S06-006`, `REQ-S06-007`, `REQ-S06-008`, `REQ-S06-009`, `REQ-S06-010`, `REQ-S07-016`, `REQ-S08-005`, `REQ-S10-013`, `REQ-S10-015`, `REQ-S12-001`, `REQ-S12-002`, `REQ-S12-003`, `REQ-S12-004`, `REQ-S12-012`, `REQ-S12-015`, `REQ-S12-020`, `REQ-S12-021`, `REQ-S12-022`, `REQ-S12-025`, `REQ-S12-026`, `REQ-S13-005`, `REQ-S13-006`, `REQ-S13-007`, `REQ-S13-010`, `REQ-S15-004`, `REQ-S16-010`, `REQ-S16-012`, `REQ-S16-015`, `REQ-S16-021`, `REQ-S18-001`, `REQ-S18-003`.

## Evidence honesty (DG2 round-10 audit condition 1, binding)

- In your record, report every non-zero exit, failed suite, hook timeout, skipped or flaky test, or error line that appears in any log you cite. Explain each one, whatever its cause, in the check's `actual`.
- A check whose evidence holds an unexplained failure cannot be PASS.
- A probe that exits non-zero "by design" must say exactly which assertions failed and why.

## Environmental residuals: NOT BLOCKED gate checks

Record each of these as PASS on the offline/config surface, and note the residual. A BLOCKED check fails the gate round.
- Live registry: REQ-DLV-042 AC-1, D-057.
- Live CI: REQ-DLV-025 A24, D-058.
- Keycloak and a real demo IdP: D-049; the demo deployment's IdP is a devops item (ADR-0050 §1); the dev-mode binding of D-165 is the test path.
- AI and external notification adapters: none ships in P5 (D-142 Q11); A21's "disabled" is the shipped configuration (D-165).

## Record format (MANDATORY)

Write `docs/delivery/reviews/DG5/round-4/code-security-reviewer.json` with these fields:

- `assignment` = exactly `docs/delivery/assignments/DG5/round-4/code-security-reviewer-rerun.md` (bare path);
- `candidate_id` as above;
- `reviewer_role: code-security-reviewer`, `round: 4`, `stage_id: DG5`;
- `checks_run[]`, each `{id, environment, procedure, expected, actual, exit_status (int), result (PASS|FAIL|BLOCKED), evidence[]}`;
- `requirements_checked[]`: exactly the ids listed above;
- `findings[]`: only the ids of NEW findings (strings);
- `verdict`: PASS only if all four hold:
  - every requirement you check is verifiable with evidence;
  - every failure in the logs you cite is disclosed and explained;
  - nothing Critical, High or mandatory is unresolved;
  - you raised no finding you consider blocking.

Mirror the field set of `docs/delivery/reviews/DG4/round-10/code-security-reviewer.json`.

## Finding record format: STRICT (use YOUR id range only)

- **Your id range for any NEW finding:** **F-DG5-103 to F-DG5-119** (F-DG5-100 to F-DG5-102 are taken), used in order. Never use another id. The other reviewers have their own ranges.
- **The sidecar.** If you raise findings, write `docs/delivery/reviews/DG5/round-4/code-security-reviewer.findings.json` = `{ "schema_version": 1, "findings": [ ... ] }`. If you raise none, set `findings: []` and write no sidecar.
- **Each finding object has EXACTLY these keys, and no others.** `locations` is NOT allowed:
  - `id`;
  - `stage_id` ("DG5");
  - `requirement`;
  - `severity` (Critical|High|Medium|Low);
  - `mandatory_violation` (bool);
  - `title`, `reproduction`, `expected`, `actual`;
  - `evidence` (array of repository paths);
  - `reported_by` ("code-security-reviewer");
  - `reported_in` ("docs/delivery/reviews/DG5/round-4/code-security-reviewer.json");
  - `owner` (an implementer role: backend-workflow-engineer | kpi-benefits-engineer | frontend-ux-engineer | solution-architect | transformation-analyst | devops-engineer);
  - `status` ("OPEN");
  - `history` (`[{at, status:"OPEN", note}]`).

**Severity guidance.**
- **High or mandatory** is a broken acceptance criterion, a security or authorization hole, a wrong financial result, or a business approval that can be fabricated or bypassed.
- **Low** is cosmetic, or a documentation drift with no behavioural effect.
- Be precise. An observation you do not consider a defect belongs in a check's `actual`, not in a finding.
