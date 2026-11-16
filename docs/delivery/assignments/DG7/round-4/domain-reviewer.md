# DG7 gate review: domain-reviewer (round 4)

Task ID: `T-DG7-REV-DOM-R4`. Stage `DG7` (P7 "Independent transfer and release"). You are the independent domain-reviewer of the frozen **DG7** candidate. You implemented no DG7 requirement and are read-only to implementation. Requirement ids: the 54 DG7-final rows listed below. Base revision: `471072d6481a346c356e985d07b49721ebdda571`.

## Candidate

- **candidate_id:** `sha256:d91f7152950ed7119b412db0135836c53a3f01e95300af32c86db367f0712e59`. Verify it with `node tools/gates/candidate.mjs --stage DG7` (3155 files) on a complete clone, and with `--diff` against the manifest.
- **manifest:** `docs/delivery/candidates/DG7/d91f7152950ed711.manifest.json`.
- **source_commit:** `471072d6481a346c356e985d07b49721ebdda571` (record this full id in your record's `source_commit`).
- **Node:** 24.21.0 at `/opt/nvm/versions/node/v24.21.0/bin` (the default PATH resolves 22.22.x; put 24 first).
- **Browser:** pre-installed Chromium (`PLAYWRIGHT_BROWSERS_PATH=/opt/pw-browsers`). Never run `playwright install`.
- **Ports:** use ports below 32768. **Your range is 32300–32399.** The other two reviewers run at the same time.
- **Previous gates:** DG0–DG6 are APPROVED. `node tools/gates/validate.mjs --historical --stage DG6` must pass (and DG5…DG1).
- **Design and delivery context:** `docs/architecture/p7-plan.md`, `docs/architecture/p7-work-split.md`, ADR-0062 … ADR-0073 with their dated amendments (which win), `docs/delivery/decisions.md` D-242 to D-276, the DG7 handbacks in `docs/delivery/handbacks/DG7/`, QA evidence in `docs/delivery/test-evidence/DG7/qa/`, and the orchestrator evidence in `docs/delivery/test-evidence/DG7/orchestrator/` (host run, prefreeze checks, protocol audit, A26 and A27 drill reports, release notes).
- **The binding acceptance texts** are in `docs/delivery/requirements.csv` (`acceptance`, rows with `final_gate` = DG7). All 412 rows are IMPLEMENTED; 18 DG7 rows rely on the Q19 extension (D-274). Judge each literally; do not treat a disclosed gap as met.
- **Product gates G1–G6 are business approvals inside the product.** They never imply DG0–DG7. Product G6 never implies DG7. No record may claim a business, Finance, IT or production approval.
- **Sandbox limits:** read-only `node_modules` (Vitest needs `--configLoader runner`), no Docker daemon in agent sandboxes (the container half was run by the orchestrator, D-267; judge that evidence, do not mark it PASS yourself unless you re-run it), a disposable PostgreSQL via `tests/qa/support/with-pg.sh`.

## What this round is

Round 4 of DG7, on a new candidate. Round 3 (candidate `60dd90b6`, D-276) closed 915, 935, 961, 962, 963 (all three reviewers) and left four open, now FIXED_PENDING_VERIFICATION (fixes at `1fa349f0`):
- **F-DG7-920** (Low) / **F-DG7-960** (Medium): the DG7 C3 handback hits. AN-P7G derived the count from a fresh protocol audit (C3 = 7) and names all seven in REQ-DLV-012, including `T-DG7-DO-D8-devops-engineer.md`; release notes and known limitations regenerated and now agree. Check the count against a fresh `protocol-audit.mjs --stage DG7` on THIS candidate, and every disclosure surface.
- **F-DG7-921** (Medium): A18 "intact after a full restart". AN-P7G cites the DO-D8B T-B11 run that restarted PostgreSQL and discloses that the earlier DO-D7/DO-E D9 runs restarted only the API and worker.
- **F-DG7-940** (Medium): BE-R8 added `apps/api/test/integration/transfer/export-scope.test.ts` (business_unit and transformation scoped ADM_TECH: 403 on all five export operations, no row, no audit). Re-run the mutant (remove the scoped `authorize()` in `requireExportRight`) and confirm the shipped tests now fail.

**Verify each of the four on THIS candidate, adversarially**, and record CLOSED_VERIFIED or keep it open with evidence. Disclosures for you to judge: D-249/D-270 (protocol-audit hits, user decision), D-274 (Q19 extension, user decision), A27 K11 partial, ADR-0065 Amendment 1 (`automation_rule` excluded), D-267 (Keycloak e2e outside the build proxy; one host, not air-gapped, not HA), D-269. Orchestrator pre-freeze evidence for this candidate: `docs/delivery/test-evidence/DG7/orchestrator/prefreeze-r4/` (19 checks, all exit 0; live CI not run).

## Your focus

source fidelity to the playbook and master prompt, operating logic, governance, KPI/benefit semantics where P7 touches them, and real user outcomes of the transfer, handover documentation set, in-app register, About and release notes. Every mutation needs server-side authorization, validation, optimistic concurrency and an audit event, each covered by tests. Decimal money; Unknown/Stale never zero or green; Arabic RTL and English LTR. Never report a check as passed that did not run.

## Requirements to check (record EXACTLY these, 54)

- `REQ-DLV-005`
- `REQ-DLV-008`
- `REQ-DLV-009`
- `REQ-DLV-010`
- `REQ-DLV-011`
- `REQ-DLV-012`
- `REQ-DLV-014`
- `REQ-DLV-018`
- `REQ-DLV-021`
- `REQ-DLV-024`
- `REQ-DLV-027`
- `REQ-DLV-028`
- `REQ-DLV-030`
- `REQ-DLV-031`
- `REQ-DLV-039`
- `REQ-DLV-040`
- `REQ-DLV-041`
- `REQ-S01-001`
- `REQ-S01-006`
- `REQ-S02-003`
- `REQ-S02-005`
- `REQ-S16-008`
- `REQ-S16-009`
- `REQ-S16-024`
- `REQ-S16-031`
- `REQ-S16-033`
- `REQ-S17-004`
- `REQ-S19-001`
- `REQ-S19-002`
- `REQ-S19-003`
- `REQ-S19-005`
- `REQ-S19-007`
- `REQ-S19-008`
- `REQ-S19-009`
- `REQ-S19-010`
- `REQ-S19-011`
- `REQ-S19-012`
- `REQ-S19-013`
- `REQ-S19-014`
- `REQ-S19-015`
- `REQ-S19-016`
- `REQ-S19-017`
- `REQ-S19-018`
- `REQ-S19-019`
- `REQ-S20-018`
- `REQ-S20-019`
- `REQ-S20-023`
- `REQ-S20-026`
- `REQ-S20-027`
- `REQ-S20-028`
- `REQ-S20-031`
- `REQ-S21-002`
- `REQ-S21-003`
- `REQ-S21-004`

## Evidence honesty (DG2 round-21 audit condition 1, binding)

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

Write `docs/delivery/reviews/DG7/round-4/domain-reviewer.json` with these fields:

- `assignment` = exactly `docs/delivery/assignments/DG7/round-4/domain-reviewer.md` (bare path);
- `candidate_id` as above; `source_commit` as above;
- `reviewer_role: domain-reviewer`, `round: 7`, `stage_id: DG7`;
- `checks_run[]`, each `{id, environment, procedure, expected, actual, exit_status (int), result (PASS|FAIL|BLOCKED), evidence[]}`;
- `requirements_checked[]`: exactly the ids listed above;
- `findings[]`: only the ids of NEW findings (strings);
- `verdict`: PASS only if all four hold:
  - every requirement you check is verifiable with evidence;
  - every failure in the logs you cite is disclosed and explained;
  - nothing Critical, High or mandatory is unresolved;
  - you raised no finding you consider blocking.

Mirror the field set of `docs/delivery/reviews/DG5/round-4/domain-reviewer.json`. Put your evidence under `docs/delivery/test-evidence/DG7/domain/round-4/`.

## Finding record format: STRICT (use YOUR id range only)

- **Your id range for any NEW finding:** **F-DG7-922 to F-DG7-929**, used in order. Never use another id. The other reviewers have their own ranges.
- **The sidecar.** If you raise findings, write `docs/delivery/reviews/DG7/round-4/domain-reviewer.findings.json` = `{ "schema_version": 1, "findings": [ ... ] }`. If you raise none, set `findings: []` and write no sidecar.
- **Each finding object has EXACTLY these keys, and no others.** `locations` is NOT allowed:
  - `id`;
  - `stage_id` ("DG7");
  - `requirement`;
  - `severity` (Critical|High|Medium|Low);
  - `mandatory_violation` (bool);
  - `title`, `reproduction`, `expected`, `actual`;
  - `evidence` (array of repository paths);
  - `reported_by` ("domain-reviewer");
  - `reported_in` ("docs/delivery/reviews/DG7/round-4/domain-reviewer.json");
  - `owner` (an implementer role: backend-workflow-engineer | kpi-benefits-engineer | frontend-ux-engineer | solution-architect | transformation-analyst | devops-engineer);
  - `status` ("OPEN");
  - `history` (`[{at, status:"OPEN", note}]`).

**Severity guidance.**
- **High or mandatory** is a broken acceptance criterion, a security or authorization hole, a wrong financial result, or a business approval that can be fabricated or bypassed.
- **Medium** must be repaired before the gate (D-192): it cannot be accepted as an observation. Use it for a real defect with a bounded effect.
- **Low** is cosmetic, or a documentation drift with no behavioural effect.
- Be precise. An observation you do not consider a defect belongs in a check's `actual`, not in a finding.
