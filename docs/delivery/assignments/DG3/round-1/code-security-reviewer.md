# DG3 gate review: code-security-reviewer (round 1)

Task ID: `T-DG3-REV-SEC-R1`. You are the independent code and security reviewer of the frozen **DG3** candidate (P3 "Mobilization and portfolio"). You did not implement any DG3 requirement and are read-only to the implementation.

## Candidate

- **candidate_id:** `sha256:873115d9bc84f763d8ec0670f0e5e320b013dc26faba6e3026395b09ed5c9f33`. Verify it with `node tools/gates/candidate.mjs --stage DG3` (753 files) on a **complete clone**. If the clone is incomplete, the review is BLOCKED.
- **manifest:** `docs/delivery/candidates/DG3/873115d9bc84f763.manifest.json`.
- **source_commit:** `928b7654`.
- **Node:** 24.21.0 at `/opt/nvm/versions/node/v24.21.0/bin`; 22.22.2 at `/opt/node22/bin`.
- **Browser:** pre-installed Chromium (`PLAYWRIGHT_BROWSERS_PATH=/opt/pw-browsers`). Never run `playwright install`.
- **Ports:** use ports below 32768; the harnesses retry on collision. **Your ranges are 26300–26399.** The other two reviewers run at the same time on other ranges.
- **Previous gates:** DG2 and DG1 are APPROVED. `node tools/gates/validate.mjs --historical --stage DG2` and `--historical --stage DG1` must pass.
- **Design and delivery context:**
  - `docs/architecture/adr/ADR-0021`…`ADR-0024`;
  - `docs/architecture/p3-work-split.md`, including §9, the amendments;
  - `docs/delivery/decisions.md` D-078;
  - the P3 implementer handbacks in `docs/delivery/handbacks/DG3/`.
- **The binding acceptance texts** are in `docs/delivery/requirements.csv` (`acceptance`, for the 32 rows with `final_gate` = DG3). Test them literally.
- **Product gates G1–G6 are business approvals inside the product.** They never imply or relate to the engineering gates DG0–DG7.

## Your focus: correctness, architecture, authorization, data integrity, concurrency, injection and security

Inspect the P3 diff directly (`git diff 2376ca4..928b7654`, product code: `apps/**`, `packages/**`, migrations). Back every finding with a file and line reference, and a reproduction. Cover at least the following.

### Authorization

- Every P3 mutation (109 operations) needs all of:
  - server-side authorization **re-checked at commit time** (BE18A);
  - validation;
  - `If-Match` (409/428);
  - an audit event;
  - no client or remote I/O inside a transaction.
- **Read-only auditor (AUD).** AUD gets 403 on every P3 write. Run the AUD sweep.
- **Separation of duties** in the business approvals. Each of these must be impossible:
  - a weight-set approver who is also the proposer;
  - an override approver who is also the proposer;
  - a Finance validator who is also the author (both baseline and formula version);
  - a dispensation decided by its recorder;
  - a G4 decision by a non-approver or by the submitter (403), or on a superseded submission (409);
  - a deliverable accepted by its submitter.
- **No on-behalf decisions.** No P3 business approval may be taken on someone's behalf (ADR-0021 §6). Try it on every one.
- **The G1 agreements** (0025 guard). Approving G1 without them gives 422, and the database refuses at COMMIT.

### Data integrity and concurrency

- **The dependency graph** (ADR-0023 §5, 0022 guard). A→B→C→A is refused **naming the cycle**. Two connections inserting A→B and B→A concurrently: exactly one commits. Check the advisory-lock registry (ADR-0016 §6): every class is distinct and none is spelled outside the registry.
- **Decimals.** Weights, scores, money and FTE are decimal end to end, with no `Number()` or float on these values. The weighted score is exact (3.3000). The 95% and 105% weight totals are refused with nothing written.
- **The formula engine** (`packages/shared/src/formula/**`):
  - there is **no dynamic code path** (`eval`, `Function`, `vm`, dynamic `import()`, `with`), and the ESLint override enforces this;
  - the limits hold against hostile input;
  - try fuzz and injection inputs;
  - division by zero gives Unknown;
  - the lineage rows are append-only;
  - the rounding record is stored on the row (`0027`).
- **Migrations `0020`–`0027`.** They are forward-only. Every mutable table has its row guard, the version step, a deferred audit-coverage constraint and append-only history. The audit `changes` shape conforms to the contract.

### Contract and seams

- **Contract** (`docs/api/openapi.yaml`, 270 operations):
  - every operation declares the ADR-0007 §5b statuses;
  - `config.consumes` equals each operation's request media type;
  - strict UTF-8 parsing applies;
  - the module graph is acyclic (`workflows` does not import `portfolio`);
  - the `GateFactsProvider` and `t08ScheduleFlags` injection works.
- **Web:** session-bound actions only (no raw `navigate` or `setQueryData`), and no import cycle.

### Run these, with real output

A missing tool or database is BLOCKED.

- `pnpm -r typecheck`
- `pnpm -r build`
- `pnpm lint`
- `pnpm openapi:lint`
- `pnpm check:no-cdn`
- `pnpm format:check`
- `pnpm test` on Node 22 **and** Node 24
- The integration suite on a disposable PostgreSQL, **twice**: once with `LANG`/`LC_ALL` unset and once with `LANG=C.UTF-8`. It includes `contract.test.ts` (all 270 operations live, every `p3-pending-*.ts` empty) and migrations `0001`→`0027`.
- `node tools/gates/validate.mjs --historical --stage DG2` and `--historical --stage DG1`.

Put your evidence under `docs/delivery/test-evidence/DG3/code-security/round-1/`.

## Requirements to check (record EXACTLY these)

`REQ-S16-016`, `REQ-S09-008`, `REQ-DLV-035`, `REQ-S08-007`, `REQ-PB-004`, `REQ-PB-007`, `REQ-PB-022`, `REQ-S04-006`, `REQ-PB-048`, `REQ-PB-049`, `REQ-PB-051`, `REQ-PB-052`, `REQ-PB-055`, `REQ-PB-056`, `REQ-S09-003`, `REQ-S09-006`.

## Evidence honesty (DG2 round-10 audit condition 1, binding)

- In your record, report every non-zero exit, failed suite, hook timeout, skipped or flaky test, or error line that appears in any log you cite. Explain each one, whatever its cause, in the check's `actual`.
- A check whose evidence holds an unexplained failure cannot be PASS.
- A probe that exits non-zero "by design" must say exactly which assertions failed and why.

## Environmental residuals: NOT BLOCKED gate checks

Record each of these as PASS on the offline/config surface, and note the residual. A BLOCKED check fails the gate round.

- Live registry: REQ-DLV-042 AC-1, D-057.
- Live CI: REQ-DLV-025 A24, D-058.
- Keycloak: D-049.

## Record format (MANDATORY)

Write `docs/delivery/reviews/DG3/round-1/code-security-reviewer.json` with these fields:

- `assignment` = exactly `docs/delivery/assignments/DG3/round-1/code-security-reviewer.md` (bare path);
- `candidate_id` as above;
- `reviewer_role: code-security-reviewer`, `round: 1`, `stage_id: DG3`;
- `checks_run[]`, each `{id, environment, procedure, expected, actual, exit_status (int), result (PASS|FAIL|BLOCKED), evidence[]}`;
- `requirements_checked[]`: exactly the ids listed above;
- `findings[]`: only the ids of NEW findings (strings);
- `verdict`: PASS only if all four hold:
  - every requirement you check is verifiable with evidence;
  - every failure in the logs you cite is disclosed and explained;
  - nothing Critical, High or mandatory is unresolved;
  - you raised no finding you consider blocking.

Mirror the field set of `docs/delivery/reviews/DG2/round-17/code-security-reviewer.json`.

## Finding record format: STRICT (use YOUR id range only)

- **Your id range for any NEW finding:** **F-DG3-100 to F-DG3-119**, used in order. Never use another id. The other reviewers have their own ranges.
- **The sidecar.** If you raise findings, write `docs/delivery/reviews/DG3/round-1/code-security-reviewer.findings.json` = `{ "schema_version": 1, "findings": [ ... ] }`. If you raise none, set `findings: []` and write no sidecar.
- **Each finding object has EXACTLY these keys, and no others.** `locations` is NOT allowed:
  - `id`;
  - `stage_id` ("DG3");
  - `requirement`;
  - `severity` (Critical|High|Medium|Low);
  - `mandatory_violation` (bool);
  - `title`, `reproduction`, `expected`, `actual`;
  - `evidence` (array of repository paths);
  - `reported_by` ("code-security-reviewer");
  - `reported_in` ("docs/delivery/reviews/DG3/round-1/code-security-reviewer.json");
  - `owner` (an implementer role: backend-workflow-engineer | kpi-benefits-engineer | frontend-ux-engineer | solution-architect | transformation-analyst | devops-engineer);
  - `status` ("OPEN");
  - `history` (`[{at, status:"OPEN", note}]`).

**Severity guidance.**
- **High or mandatory** is a broken acceptance criterion, a security or authorization hole, a wrong financial result, or a business approval that can be fabricated or bypassed.
- **Low** is cosmetic, or a documentation drift with no behavioural effect.
- Be precise. An observation you do not consider a defect belongs in a check's `actual`, not in a finding.
