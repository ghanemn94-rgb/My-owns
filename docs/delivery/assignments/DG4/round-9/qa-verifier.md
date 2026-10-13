# DG4 gate review: qa-verifier (round 9)

Task ID: `T-DG4-REV-QA-R9`. You are the independent QA verifier of the frozen **DG4** candidate (P4 "Execution value and sustainment"). You may author tests under `docs/delivery/test-evidence/DG4/qa/tests/round-9/`, never product code.

## Candidate

- **candidate_id:** `sha256:18c18fe4eda7cbc1c9b2c42ffd22f5ec5c1c4851be1a34183cb118bd4ddad76c`. Verify it with `node tools/gates/candidate.mjs --stage DG4` (1475 files) on a **complete clone**. If the clone is incomplete, the review is BLOCKED.
- **manifest:** `docs/delivery/candidates/DG4/18c18fe4eda7cbc1.manifest.json`.
- **source_commit:** `f2ae717`.
- **Node:** 24.21.0 at `/opt/nvm/versions/node/v24.21.0/bin`; 22.22.2 at `/opt/node22/bin`.
- **Browser:** pre-installed Chromium (`PLAYWRIGHT_BROWSERS_PATH=/opt/pw-browsers`). Never run `playwright install`.
- **Ports:** use ports below 32768; the harnesses retry on collision. **Your ranges are 26500–26699.** The other two reviewers run at the same time on other ranges.
- **Previous gates:** DG3, DG2 and DG1 are APPROVED. `node tools/gates/validate.mjs --historical --stage DG3` must pass, and so must `--historical --stage DG2` and `--historical --stage DG1`.
- **Design and delivery context:**
  - `docs/architecture/p4-plan.md`;
  - `docs/architecture/p4-work-split.md`;
  - `docs/architecture/adr/ADR-0025` … `ADR-0038`, with their dated amendments, which win where they differ from the original text;
  - `docs/delivery/decisions.md` D-088 to D-136;
  - the P4 implementer handbacks in `docs/delivery/handbacks/DG4/`;
  - the QA authoring handbacks in `docs/delivery/test-evidence/DG4/qa/T-DG4-QA-{A,B,C,D}-authoring/`.
- **The binding acceptance texts** are in `docs/delivery/requirements.csv` (`acceptance`, for the 137 rows with `final_gate` = DG4). Test them literally. The DG4 rows are IMPLEMENTED with evidence (`validate.mjs --register DG4` PASS). Their `notes` disclose every clause that is covered only partly; judge whether each such disclosure is acceptable.
- **Product gates G1–G6 are business approvals inside the product.** They never imply or relate to the engineering gates DG0–DG7. Product G6 never implies DG7.
- **The confined sandbox** gives you a read-only `node_modules`. Vitest's config loader then needs `--configLoader runner` (QA-A's finding). Use it, and say so. Run anything that builds or writes in a disposable clone under `$TMPDIR`.
- **Machine load.** The three reviews run at the same time, so the load is high. A long e2e journey can cross its 30 s limit under load; D-111, D-112 and D-115 record this. If a test times out, re-run that spec alone and report both runs. Never treat a timeout as a pass, and never hide one.

## This round's scope: a confirmation and re-verification round (D-136; it overrides 'full review' wherever this assignment says so)

- **Why this round.** The round-8 release-auditor BLOCKED DG4 on four record defects (B1–B4, D-136). With the user's authorization the history was rewritten to restore 33 deleted run files under `docs/delivery/runs/DG4` (write-once). Every commit id from `eda5588` onward changed; no file content other than those 33 restored files changed. The old head `72c0e653a3` is kept on the local ref `backup/pre-dg4-writeonce-repair-72c0e653a3` in `/home/user/My-owns`, and the old→new map is `docs/delivery/test-evidence/DG4/history-rewrite-D-136.shamap.txt`.
- **The product is unchanged.** Round 8's source `8553323` is now `5cd1e06`. `git diff 5cd1e06..f2ae7170630456a772e1ceac90ab6d96b68e3f5c -- . ':!docs/delivery'` is empty: the product code, tests and contract are byte-identical to round 8's candidate `8014e5ce` and round 7's `baa6ff4d`, which you reviewed in full. The diff holds only delivery records: D-135 and D-136 in `decisions.md`, `findings.json`, `stages.json`, `progress.md`, and the two `history-rewrite-D-136.*` files.
- **Required this round:**
  1. verify the candidate identity on a complete clone;
  2. show that the diff from `5cd1e06` touches only `docs/delivery/**`;
  3. check the rewrite claim yourself (the old commits are reachable only through the backup ref, which a clone of `/home/user/My-owns` carries as `origin/backup/pre-dg4-writeonce-repair-72c0e653a3`): run `git diff backup/pre-dg4-writeonce-repair-72c0e653a3 a445b2470b --stat` (exactly the 33 restored files, all additions), and spot-check at least three lines of the SHA map (same subject, author date and committer date, and `git diff <old> <new>` lists only restored run files);
  4. judge D-136 against the evidence;
  5. run the validators (`--historical --stage DG3`, `DG2`, `DG1`, `--register DG4`, `--pipeline`) and the static checks (typecheck, lint, format, openapi:lint, no-cdn).
- **Carry-forward:** for every other check of your role, cite your round-7 or round-8 evidence on the identical code. Say plainly in each check's `actual` that it was not re-run and why. Do not report a check you did not run as run this round.
- **The load envelope** (`environment.md` limitation 6): while qa runs `pnpm test` (load ≤ 8), domain and code-security must not run `pnpm test`, the integration suite or e2e. A targeted run of a single test file for a re-verification below is allowed.

## Re-verify the findings you closed before (B2)

Each of these was CLOSED_VERIFIED by you in an earlier round. The rewrite changed their commit ids, so each is FIXED_PENDING_VERIFICATION again (D-136), with `fix_revision` set to the remapped commit; where a fix spans parallel branches, it is the first integration commit containing all of them.

| Finding | Severity | Your last verification | Remapped `fix_revision` (full id) | Fix commits after the rewrite |
|---|---|---|---|---|
| F-DG4-140 | Low | `docs/delivery/reviews/DG4/round-2/qa-verifier.verifications.json` | `12bb5c81b7c25972d8099b792b0b86178586343b` | `12bb5c81b7` |
| F-DG4-141 | Low | `docs/delivery/reviews/DG4/round-2/qa-verifier.verifications.json` | `07b72f32611295d979b3055dc04cdfa830126d2a` | `07b72f3261` |
| F-DG4-143 | Medium | `docs/delivery/reviews/DG4/round-5/qa-verifier.verifications.json` | `5f68ba25a2b49d4ed48f066a4c77635847d56249` | `5f68ba25a2` |
| F-DG4-144 | Low | `docs/delivery/reviews/DG4/round-5/qa-verifier.verifications.json` | `5f68ba25a2b49d4ed48f066a4c77635847d56249` | `5f68ba25a2` |
| F-DG4-145 | Low | `docs/delivery/reviews/DG4/round-6/qa-verifier.verifications.json` | `9b6b3ed17aceaba5eb6500129160a66bfa9a4e82` | `9d66f671c9`, `9b6b3ed17a` |
| F-DG4-146 | Low | `docs/delivery/reviews/DG4/round-7/qa-verifier.verifications.json` | `c675003488f6d10fbd3b0b914ecf2a740109be5d` | `c675003488` |
| F-DG4-147 | Low | `docs/delivery/reviews/DG4/round-7/qa-verifier.verifications.json` | `c675003488f6d10fbd3b0b914ecf2a740109be5d` | `c675003488` |

For each finding:
1. confirm `fix_revision` is a commit, an ancestor of `f2ae7170630456a772e1ceac90ab6d96b68e3f5c`, and that every listed fix commit is an ancestor of it (`git merge-base --is-ancestor`);
2. confirm each remapped commit maps to its old id in the SHA map, and that the old and new commits change the same product content (`git diff <old>^ <old> -- . ':!docs/delivery'` equals the same for the new ids);
3. confirm the fix is still present in the frozen candidate, citing your earlier verification and the file and line of the fix; re-run your earlier probe or the targeted test where it is cheap, within the load envelope.

Write `docs/delivery/reviews/DG4/round-9/qa-verifier.verifications.json` = `{ "verifications": [ {finding_id, result, status_after, note, evidence[]} ] }`, one entry per finding above: `result: "PASS"`, `status_after: "CLOSED_VERIFIED"` when all three hold; otherwise `result: "FAIL"`, `status_after: "OPEN"`, with the reason.

## F-DG4-148: re-record the acceptance (D-134)

F-DG4-148 (Low, not mandatory) is ACCEPTED_OBSERVATION from your round-8 verification, with the load envelope in `environment.md` limitation 6. Re-record it on this candidate:
1. Run `pnpm test` at least twice inside the envelope (1-minute load ≤ 8, sampled at least every 30 s), once with `LANG`/`LC_ALL` unset and once with `LANG=C.UTF-8`. Do this before any other heavy work of yours.
2. Report every run with its load samples.
3. Add F-DG4-148 to your verifications file: `result: "PASS"`, `status_after: "ACCEPTED_OBSERVATION"`, with your rationale, if the runs inside the envelope pass; otherwise `result: "FAIL"`, `status_after: "OPEN"`, with the reason.

**Your verdict:** PASS only if every finding above re-verifies (and, for qa, F-DG4-148 is re-accepted) and your confirmation checks pass.

## Your focus: derive checks from the acceptance criteria of all 137 DG4-final requirements

Run positive, negative, regression, bilingual and reliability checks, and test every `acceptance` text **literally**.
- **Tests you may write:** under `docs/delivery/test-evidence/DG4/qa/tests/round-9/`, never in the candidate tree (agent-protocol: the candidate is frozen). Never touch product code.
- **Evidence:** put it under `docs/delivery/test-evidence/DG4/qa/round-9/`.
- **The executable acceptance suites in the candidate.** `tests/qa/**` and `e2e/**` hold A03, A04, A05, A08, A09, A10, A11, A12, A13 and A14, plus QA-D's two tests. Each QA authoring handback has a requirement → test table.
  - Re-run the suites.
  - Read each test, and check that it asserts its row's clause.
  - Probe beyond them wherever a clause is untested or only partly tested; the register `notes` say where.

### Execute, with real output

A missing tool or database is BLOCKED.

1. **Static:** `pnpm -r typecheck`, `pnpm -r build`, `pnpm lint`, `pnpm openapi:lint`, `pnpm check:no-cdn`, `pnpm format:check`, and `pnpm --filter @mth/design-tokens run check:contrast`.
2. **Unit:** `pnpm test` on Node 22 and Node 24, in both locale settings.
3. **Integration:** run it on a disposable PostgreSQL, **twice**. It covers migrations `0001`→`0060` and `contract.test.ts` (652 operations; every `p4-pending-*.ts` list empty). Then run `tests/qa` on its own.
4. **e2e:**
   - run the product journeys (`apps/web/e2e`) and the acceptance specs (`e2e/`) on the real stack, `--workers=1`;
   - in **chromium-en and chromium-ar**, in both locale settings;
   - axe must report no serious or critical issues;
   - include an AUD read-only pass;
   - check 390 px and 200 % text on the P4 screens.
5. **REQ-DLV-036:** the A04, A09, A10 and A11 executable tests pass on **this frozen candidate**. Record the counts per suite.
6. **Register and pipeline:**
   - `node tools/gates/validate.mjs --register DG4`;
   - `--pipeline`;
   - `--historical --stage DG3`.

## Requirements to check (record EXACTLY these, 137)

`REQ-PB-005`, `REQ-PB-008`, `REQ-PB-009`, `REQ-PB-010`, `REQ-PB-013`, `REQ-PB-014`, `REQ-PB-015`, `REQ-PB-020`, `REQ-PB-021`, `REQ-PB-044`, `REQ-PB-058`, `REQ-PB-060`, `REQ-PB-061`, `REQ-PB-062`, `REQ-PB-063`, `REQ-PB-064`, `REQ-PB-065`, `REQ-PB-066`, `REQ-PB-067`, `REQ-PB-068`, `REQ-PB-069`, `REQ-PB-070`, `REQ-PB-071`, `REQ-PB-072`, `REQ-PB-073`, `REQ-PB-074`, `REQ-PB-075`, `REQ-PB-076`, `REQ-PB-078`, `REQ-PB-079`, `REQ-PB-080`, `REQ-PB-081`, `REQ-PB-082`, `REQ-PB-083`, `REQ-PB-084`, `REQ-PB-085`, `REQ-DLV-036`, `REQ-S03-001`, `REQ-S03-002`, `REQ-S03-003`, `REQ-S03-004`, `REQ-S03-005`, `REQ-S03-006`, `REQ-S03-008`, `REQ-S03-009`, `REQ-S03-011`, `REQ-S04-001`, `REQ-S04-002`, `REQ-S04-007`, `REQ-S04-008`, `REQ-S04-009`, `REQ-S04-010`, `REQ-S04-012`, `REQ-S04-013`, `REQ-S04-014`, `REQ-S07-001`, `REQ-S07-002`, `REQ-S07-003`, `REQ-S07-004`, `REQ-S07-005`, `REQ-S07-006`, `REQ-S07-007`, `REQ-S07-008`, `REQ-S07-009`, `REQ-S07-010`, `REQ-S07-011`, `REQ-S07-012`, `REQ-S07-013`, `REQ-S07-014`, `REQ-S07-015`, `REQ-S07-017`, `REQ-S08-001`, `REQ-S08-002`, `REQ-S08-003`, `REQ-S08-004`, `REQ-S08-006`, `REQ-S08-008`, `REQ-S08-009`, `REQ-S08-010`, `REQ-S08-011`, `REQ-S08-013`, `REQ-S08-014`, `REQ-S08-015`, `REQ-S08-016`, `REQ-S08-017`, `REQ-S08-018`, `REQ-S09-007`, `REQ-S09-009`, `REQ-S09-010`, `REQ-S10-003`, `REQ-S10-005`, `REQ-S10-006`, `REQ-S10-007`, `REQ-S10-008`, `REQ-S10-009`, `REQ-S10-010`, `REQ-S10-011`, `REQ-S10-012`, `REQ-S10-014`, `REQ-S10-016`, `REQ-S10-017`, `REQ-S10-018`, `REQ-S10-019`, `REQ-S11-001`, `REQ-S11-002`, `REQ-S11-004`, `REQ-S11-005`, `REQ-S11-006`, `REQ-S11-007`, `REQ-S11-008`, `REQ-S11-009`, `REQ-S12-005`, `REQ-S12-006`, `REQ-S12-009`, `REQ-S12-010`, `REQ-S12-011`, `REQ-S12-014`, `REQ-S12-016`, `REQ-S13-001`, `REQ-S13-002`, `REQ-S13-003`, `REQ-S15-008`, `REQ-S16-005`, `REQ-S16-011`, `REQ-S16-014`, `REQ-S16-017`, `REQ-S16-018`, `REQ-S16-019`, `REQ-S16-020`, `REQ-S16-025`, `REQ-S20-003`, `REQ-S20-004`, `REQ-S20-005`, `REQ-S20-008`, `REQ-S20-009`, `REQ-S20-010`, `REQ-S20-011`.

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

Write `docs/delivery/reviews/DG4/round-9/qa-verifier.json` with these fields:

- `assignment` = exactly `docs/delivery/assignments/DG4/round-9/qa-verifier.md` (bare path);
- `candidate_id` as above;
- `reviewer_role: qa-verifier`, `round: 9`, `stage_id: DG4`;
- `checks_run[]`, each `{id, environment, procedure, expected, actual, exit_status (int), result (PASS|FAIL|BLOCKED), evidence[]}`;
- `requirements_checked[]`: exactly the ids listed above;
- `findings[]`: only the ids of NEW findings (strings);
- `verdict`: PASS only if all four hold:
  - every requirement you check is verifiable with evidence;
  - every failure in the logs you cite is disclosed and explained;
  - nothing Critical, High or mandatory is unresolved;
  - you raised no finding you consider blocking.

Mirror the field set of `docs/delivery/reviews/DG3/round-7/qa-verifier.json`.

## Finding record format: STRICT (use YOUR id range only)

- **Your id range for any NEW finding:** **F-DG4-149 to F-DG4-159**, used in order. Never use another id. The other reviewers have their own ranges.
- **The sidecar.** If you raise findings, write `docs/delivery/reviews/DG4/round-9/qa-verifier.findings.json` = `{ "schema_version": 1, "findings": [ ... ] }`. If you raise none, set `findings: []` and write no sidecar.
- **Each finding object has EXACTLY these keys, and no others.** `locations` is NOT allowed:
  - `id`;
  - `stage_id` ("DG4");
  - `requirement`;
  - `severity` (Critical|High|Medium|Low);
  - `mandatory_violation` (bool);
  - `title`, `reproduction`, `expected`, `actual`;
  - `evidence` (array of repository paths);
  - `reported_by` ("qa-verifier");
  - `reported_in` ("docs/delivery/reviews/DG4/round-9/qa-verifier.json");
  - `owner` (an implementer role: backend-workflow-engineer | kpi-benefits-engineer | frontend-ux-engineer | solution-architect | transformation-analyst | devops-engineer);
  - `status` ("OPEN");
  - `history` (`[{at, status:"OPEN", note}]`).

**Severity guidance.**
- **High or mandatory** is a broken acceptance criterion, a security or authorization hole, a wrong financial result, or a business approval that can be fabricated or bypassed.
- **Low** is cosmetic, or a documentation drift with no behavioural effect.
- Be precise. An observation you do not consider a defect belongs in a check's `actual`, not in a finding.
