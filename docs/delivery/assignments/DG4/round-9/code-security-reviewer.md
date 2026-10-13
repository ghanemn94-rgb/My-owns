# DG4 gate review: code-security-reviewer (round 9)

Task ID: `T-DG4-REV-SEC-R9`. You are the independent code and security reviewer of the frozen **DG4** candidate (P4 "Execution value and sustainment"). You did not implement any DG4 requirement and are read-only to the implementation.

## Candidate

- **candidate_id:** `sha256:18c18fe4eda7cbc1c9b2c42ffd22f5ec5c1c4851be1a34183cb118bd4ddad76c`. Verify it with `node tools/gates/candidate.mjs --stage DG4` (1475 files) on a **complete clone**. If the clone is incomplete, the review is BLOCKED.
- **manifest:** `docs/delivery/candidates/DG4/18c18fe4eda7cbc1.manifest.json`.
- **source_commit:** `f2ae717`.
- **Node:** 24.21.0 at `/opt/nvm/versions/node/v24.21.0/bin`; 22.22.2 at `/opt/node22/bin`.
- **Browser:** pre-installed Chromium (`PLAYWRIGHT_BROWSERS_PATH=/opt/pw-browsers`). Never run `playwright install`.
- **Ports:** use ports below 32768; the harnesses retry on collision. **Your ranges are 26300–26399.** The other two reviewers run at the same time on other ranges.
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
| F-DG4-100 | Medium | `docs/delivery/reviews/DG4/round-2/code-security-reviewer.verifications.json` | `5d6f4802f9f737f9f93f033dc9f48b54d43ab526` | `70fcefa172`, `bff9725eb2` |
| F-DG4-101 | Medium, mandatory | `docs/delivery/reviews/DG4/round-2/code-security-reviewer.verifications.json` | `70fcefa172ef522a3dfc9515bfd53e179a9e49b2` | `70fcefa172` |
| F-DG4-102 | Low | `docs/delivery/reviews/DG4/round-2/code-security-reviewer.verifications.json` | `07b72f32611295d979b3055dc04cdfa830126d2a` | `07b72f3261` |
| F-DG4-103 | Low | `docs/delivery/reviews/DG4/round-2/code-security-reviewer.verifications.json` | `bff9725eb2769df6df885f4fbcc113dd9ddfa7b5` | `bff9725eb2` |
| F-DG4-104 | Medium | `docs/delivery/reviews/DG4/round-3/code-security-reviewer.verifications.json` | `276623e3bf96fa2d35aeef795126931d5504d01d` | `276623e3bf` |
| F-DG4-105 | Medium | `docs/delivery/reviews/DG4/round-4/code-security-reviewer.verifications.json` | `433627332166c48e73a032b095ebefaa29b72169` | `22ef6c7832`, `4336273321` |
| F-DG4-106 | Low | `docs/delivery/reviews/DG4/round-6/code-security-reviewer.verifications.json` | `9b6b3ed17aceaba5eb6500129160a66bfa9a4e82` | `9d66f671c9`, `9b6b3ed17a` |

For each finding:
1. confirm `fix_revision` is a commit, an ancestor of `f2ae7170630456a772e1ceac90ab6d96b68e3f5c`, and that every listed fix commit is an ancestor of it (`git merge-base --is-ancestor`);
2. confirm each remapped commit maps to its old id in the SHA map, and that the old and new commits change the same product content (`git diff <old>^ <old> -- . ':!docs/delivery'` equals the same for the new ids);
3. confirm the fix is still present in the frozen candidate, citing your earlier verification and the file and line of the fix; re-run your earlier probe or the targeted test where it is cheap, within the load envelope.

Write `docs/delivery/reviews/DG4/round-9/code-security-reviewer.verifications.json` = `{ "verifications": [ {finding_id, result, status_after, note, evidence[]} ] }`, one entry per finding above: `result: "PASS"`, `status_after: "CLOSED_VERIFIED"` when all three hold; otherwise `result: "FAIL"`, `status_after: "OPEN"`, with the reason.

**Your verdict:** PASS only if every finding above re-verifies (and, for qa, F-DG4-148 is re-accepted) and your confirmation checks pass.

## Your focus: correctness, architecture, authorization, data integrity, concurrency, injection and security

Inspect the P4 diff directly: `git diff d3e6fe6..f2ae717`, covering product code (`apps/**`, `packages/**`) and migrations `0028`–`0060`. Back every finding with a file and line reference, and a reproduction. Cover at least the following.

### Authorization and separation of duties

- **Every P4 mutation needs all five of these:**
  - server-side authorization **re-checked at commit time**;
  - validation;
  - `If-Match` (409/428), including the version-0 `ETag: "0"` reads of D-109;
  - one audit event;
  - no client or remote I/O inside a transaction.
- **AUD and ADM-only callers.** AUD gets 403 on every P4 write, and an ADM-only caller sees nothing transformation-scoped. Run the sweep.
- **Business approvals** (ADR-0026). It must be impossible to self-approve, to approve as a non-approver, to approve a stale version (409), or to resubmit or withdraw as a non-requester (`approval.not_requester`). Check delegation and its loop guard, and the escalation timer.
- **Finance validation.** Only Finance validates, and a validated value can never be edited in place.
- **Handovers.** Only the receiving owner accepts.
- **Scope.** The dashboard, drill-down, My Work, traceability and orphan reads must never disclose another transformation's records (ADR-0037 §6); an unreadable id is 404. Note the two known outsider-status differences: dispensation writes answer 403, reporting/modular writes answer 404 (D-111, D-112).

### Data integrity, jobs and concurrency

- **Exactly once.**
  - **Scope:** calculation runs, Finance queue items, corrective cases, escalations, interventions, reviews, checks and closures.
  - **Proof:** the advisory-lock registry (730224–730249), the unique backstops, `runOnce`, and replay of the same event.
  - **The worker:** it imports no API code, and the parity tests hold (D-102).
- **Decimals.** Money, rates, shares and allocations are decimal end to end, with no float.
- **Formula lineage.** It is stored, and `sources` are found by name (ADR-0027 C1, C4–C5).
- **Migrations `0028`–`0060`.** They are forward-only and contiguous. Each has row guards, version steps, audit coverage and append-only history.
- **The `Problem.params` addition** (D-114). Check that it is additive and that every other problem response is unchanged.

### Contract and seams

- **The contract.** `docs/api/openapi.yaml` has 652 operations. Every `p4-pending-*.ts` list is empty. Check `config.consumes` and the media-type pin.
- **The module graph.** It is acyclic, `governance` → `raid` included, and `raid` never imports `governance` (ADR-0032 G1).
- **Production wiring.** It goes through `server.ts` (D-107).
- **The web.** Session-bound actions only; lazy routes (D-115); no import cycle.

### Run these, with real output

A missing tool or database is BLOCKED.
- `pnpm -r typecheck`, `pnpm -r build`, `pnpm lint`, `pnpm openapi:lint`, `pnpm check:no-cdn`, `pnpm format:check`;
- `pnpm test` on Node 22 **and** Node 24;
- the integration suite on a disposable PostgreSQL, **twice**: once with `LANG`/`LC_ALL` unset and once with `LANG=C.UTF-8`. It includes `contract.test.ts` and migrations `0001`→`0060`;
- `node tools/gates/validate.mjs --historical --stage DG3`.

Put your evidence under `docs/delivery/test-evidence/DG4/code-security/round-9/`.

## Requirements to check (record EXACTLY these, 52)

`REQ-PB-013`, `REQ-PB-015`, `REQ-PB-082`, `REQ-PB-083`, `REQ-PB-085`, `REQ-S03-001`, `REQ-S03-008`, `REQ-S04-002`, `REQ-S04-009`, `REQ-S04-010`, `REQ-S04-014`, `REQ-S07-003`, `REQ-S07-009`, `REQ-S07-013`, `REQ-S07-015`, `REQ-S08-004`, `REQ-S08-006`, `REQ-S08-015`, `REQ-S08-017`, `REQ-S09-010`, `REQ-S10-003`, `REQ-S10-005`, `REQ-S10-006`, `REQ-S10-007`, `REQ-S10-008`, `REQ-S10-009`, `REQ-S10-010`, `REQ-S10-011`, `REQ-S10-012`, `REQ-S10-014`, `REQ-S10-016`, `REQ-S10-017`, `REQ-S10-018`, `REQ-S10-019`, `REQ-S11-005`, `REQ-S11-009`, `REQ-S12-005`, `REQ-S12-006`, `REQ-S12-009`, `REQ-S12-010`, `REQ-S12-011`, `REQ-S12-014`, `REQ-S12-016`, `REQ-S13-001`, `REQ-S16-005`, `REQ-S16-011`, `REQ-S16-014`, `REQ-S16-017`, `REQ-S16-018`, `REQ-S16-019`, `REQ-S16-020`, `REQ-S16-025`.

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

Write `docs/delivery/reviews/DG4/round-9/code-security-reviewer.json` with these fields:

- `assignment` = exactly `docs/delivery/assignments/DG4/round-9/code-security-reviewer.md` (bare path);
- `candidate_id` as above;
- `reviewer_role: code-security-reviewer`, `round: 9`, `stage_id: DG4`;
- `checks_run[]`, each `{id, environment, procedure, expected, actual, exit_status (int), result (PASS|FAIL|BLOCKED), evidence[]}`;
- `requirements_checked[]`: exactly the ids listed above;
- `findings[]`: only the ids of NEW findings (strings);
- `verdict`: PASS only if all four hold:
  - every requirement you check is verifiable with evidence;
  - every failure in the logs you cite is disclosed and explained;
  - nothing Critical, High or mandatory is unresolved;
  - you raised no finding you consider blocking.

Mirror the field set of `docs/delivery/reviews/DG3/round-7/code-security-reviewer.json`.

## Finding record format: STRICT (use YOUR id range only)

- **Your id range for any NEW finding:** **F-DG4-107 to F-DG4-119**, used in order. Never use another id. The other reviewers have their own ranges.
- **The sidecar.** If you raise findings, write `docs/delivery/reviews/DG4/round-9/code-security-reviewer.findings.json` = `{ "schema_version": 1, "findings": [ ... ] }`. If you raise none, set `findings: []` and write no sidecar.
- **Each finding object has EXACTLY these keys, and no others.** `locations` is NOT allowed:
  - `id`;
  - `stage_id` ("DG4");
  - `requirement`;
  - `severity` (Critical|High|Medium|Low);
  - `mandatory_violation` (bool);
  - `title`, `reproduction`, `expected`, `actual`;
  - `evidence` (array of repository paths);
  - `reported_by` ("code-security-reviewer");
  - `reported_in` ("docs/delivery/reviews/DG4/round-9/code-security-reviewer.json");
  - `owner` (an implementer role: backend-workflow-engineer | kpi-benefits-engineer | frontend-ux-engineer | solution-architect | transformation-analyst | devops-engineer);
  - `status` ("OPEN");
  - `history` (`[{at, status:"OPEN", note}]`).

**Severity guidance.**
- **High or mandatory** is a broken acceptance criterion, a security or authorization hole, a wrong financial result, or a business approval that can be fabricated or bypassed.
- **Low** is cosmetic, or a documentation drift with no behavioural effect.
- Be precise. An observation you do not consider a defect belongs in a check's `actual`, not in a finding.
