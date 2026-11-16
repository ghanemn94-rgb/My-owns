# DG7 gate review: qa-verifier (round 7)

Task ID: `T-DG7-REV-QA-R7`. Stage `DG7` (P7 "Independent transfer and release"). You are the independent qa-verifier of the frozen **DG7** candidate. You implemented no DG7 requirement and are read-only to implementation. Requirement ids: the 54 DG7-final rows listed below. Base revision: `7579382c59e1791321d4856ac1cb2eb2cfb4edc7`.

## Candidate

- **candidate_id:** `sha256:0d71d4456adaac949e2c9af4c975f4b9976a166872195f496d5aa75fe8ed2272`. Verify it with `node tools/gates/candidate.mjs --stage DG7` (3158 files) on a complete clone, and with `--diff` against the manifest.
- **manifest:** `docs/delivery/candidates/DG7/0d71d4456adaac94.manifest.json`.
- **source_commit:** `7579382c59e1791321d4856ac1cb2eb2cfb4edc7` (record this full id in your record's `source_commit`).
- **Node:** 24.21.0 at `/opt/nvm/versions/node/v24.21.0/bin` (the default PATH resolves 22.22.x; put 24 first).
- **Browser:** pre-installed Chromium (`PLAYWRIGHT_BROWSERS_PATH=/opt/pw-browsers`). Never run `playwright install`.
- **Ports:** use ports below 32768. **Your range is 32500–32599.** The other two reviewers run at the same time.
- **Previous gates:** DG0–DG6 are APPROVED. `node tools/gates/validate.mjs --historical --stage DG6` must pass (and DG5…DG1).
- **Design and delivery context:** `docs/architecture/p7-plan.md`, `docs/architecture/p7-work-split.md`, ADR-0062 … ADR-0073 with their dated amendments (which win), `docs/delivery/decisions.md` D-242 to D-279, the DG7 handbacks in `docs/delivery/handbacks/DG7/`, QA evidence in `docs/delivery/test-evidence/DG7/qa/`, and the orchestrator evidence in `docs/delivery/test-evidence/DG7/orchestrator/` (host run, prefreeze checks, protocol audit, A26 and A27 drill reports, release notes).
- **The binding acceptance texts** are in `docs/delivery/requirements.csv` (`acceptance`, rows with `final_gate` = DG7). All 412 rows are IMPLEMENTED; 18 DG7 rows rely on the Q19 extension (D-274). Judge each literally; do not treat a disclosed gap as met.
- **Product gates G1–G6 are business approvals inside the product.** They never imply DG0–DG7. Product G6 never implies DG7. No record may claim a business, Finance, IT or production approval.
- **Sandbox limits:** read-only `node_modules` (Vitest needs `--configLoader runner`), no Docker daemon in agent sandboxes (the container half was run by the orchestrator, D-267; judge that evidence, do not mark it PASS yourself unless you re-run it), a disposable PostgreSQL via `tests/qa/support/with-pg.sh`.

## What this round is

Round 7 of DG7, on a new candidate, with all three reviewers. Round 6 (candidate `0b481627`, D-280): domain, code-security and qa all PASS; all three verified F-DG7-971 closed. They raised one shared Low gap under three ids, now FIXED_PENDING_VERIFICATION:
- **F-DG7-923 / F-DG7-942 / F-DG7-972** (Low): the D-278 transfer-drill rule and its residuals were disclosed only in `deployment.md` (English), not in `known-limitations.md`, the release notes or the Arabic summaries, as ADR-0064 Amendment 5 A5.6 requires. Repaired by AN-P7I (text) and DO-D10 (applied to `known-limitations.md`, `deployment.md`, both Arabic summaries and the handover README; a new release-notes section read from `tools/release/release-notes-disclosures.json`, with tests). D-280 records that the release-notes generator now reads that extra checked-in file (ADR-0071 §5.1) and the two history-only secret-scan allow-list entries for the round-6 QA grep patterns.

**Verify the three findings on THIS candidate:** check each surface A5.6 names carries the three required statements accurately and consistently with ADR-0064 A5.2/A5.7 and the drill code, in English and Arabic; that the generated texts are reproducible (`--check`); that the new allow-list entries cover only regexes, not secrets; and judge D-280's ADR-0071 note. Also judge the whole DG7 candidate as in earlier rounds. Disclosures for you to judge: D-249/D-270, D-274 (Q19 extension), D-278, D-280, A27 K11 partial, ADR-0065 Amendment 1, D-267, D-269. Pre-freeze evidence: `docs/delivery/test-evidence/DG7/orchestrator/prefreeze-r7/` (19 checks; secret-payload and release-tool-tests failed on two stale allow-list entries, re-run green in `prefreeze-r7b/` after scoping them to history; live CI not run).

## Your focus

deriving checks from the acceptance text of every DG7-final requirement and re-running them: A01–A27 on this candidate (A18 transfer drill and harness with their inputs, A19, A06 bundle replay, offline drill), unit/integration/e2e/visual suites in both locales, and the orchestrator drills and host-run evidence. Every mutation needs server-side authorization, validation, optimistic concurrency and an audit event, each covered by tests. Decimal money; Unknown/Stale never zero or green; Arabic RTL and English LTR. Never report a check as passed that did not run.

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

Write `docs/delivery/reviews/DG7/round-7/qa-verifier.json` with these fields:

- `assignment` = exactly `docs/delivery/assignments/DG7/round-7/qa-verifier.md` (bare path);
- `candidate_id` as above; `source_commit` as above;
- `reviewer_role: qa-verifier`, `round: 7`, `stage_id: DG7`;
- `checks_run[]`, each `{id, environment, procedure, expected, actual, exit_status (int), result (PASS|FAIL|BLOCKED), evidence[]}`;
- `requirements_checked[]`: exactly the ids listed above;
- `findings[]`: only the ids of NEW findings (strings);
- `verdict`: PASS only if all four hold:
  - every requirement you check is verifiable with evidence;
  - every failure in the logs you cite is disclosed and explained;
  - nothing Critical, High or mandatory is unresolved;
  - you raised no finding you consider blocking.

Mirror the field set of `docs/delivery/reviews/DG5/round-7/qa-verifier.json`. Put your evidence under `docs/delivery/test-evidence/DG7/qa/round-7/`.

## Finding record format: STRICT (use YOUR id range only)

- **Your id range for any NEW finding:** **F-DG7-973 to F-DG7-979**, used in order. Never use another id. The other reviewers have their own ranges.
- **The sidecar.** If you raise findings, write `docs/delivery/reviews/DG7/round-7/qa-verifier.findings.json` = `{ "schema_version": 1, "findings": [ ... ] }`. If you raise none, set `findings: []` and write no sidecar.
- **Each finding object has EXACTLY these keys, and no others.** `locations` is NOT allowed:
  - `id`;
  - `stage_id` ("DG7");
  - `requirement`;
  - `severity` (Critical|High|Medium|Low);
  - `mandatory_violation` (bool);
  - `title`, `reproduction`, `expected`, `actual`;
  - `evidence` (array of repository paths);
  - `reported_by` ("qa-verifier");
  - `reported_in` ("docs/delivery/reviews/DG7/round-7/qa-verifier.json");
  - `owner` (an implementer role: backend-workflow-engineer | kpi-benefits-engineer | frontend-ux-engineer | solution-architect | transformation-analyst | devops-engineer);
  - `status` ("OPEN");
  - `history` (`[{at, status:"OPEN", note}]`).

**Severity guidance.**
- **High or mandatory** is a broken acceptance criterion, a security or authorization hole, a wrong financial result, or a business approval that can be fabricated or bypassed.
- **Medium** must be repaired before the gate (D-192): it cannot be accepted as an observation. Use it for a real defect with a bounded effect.
- **Low** is cosmetic, or a documentation drift with no behavioural effect.
- Be precise. An observation you do not consider a defect belongs in a check's `actual`, not in a finding.
