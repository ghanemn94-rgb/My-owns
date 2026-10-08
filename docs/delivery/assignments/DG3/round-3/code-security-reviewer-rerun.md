# DG3 gate review: code-security-reviewer (round 3)

> **Re-run.** Your first round-3 run (`DG3-T-DG3-REV-SEC-R3-code-security-reviewer-20261008T111004Z-f4a7a1f4`) was killed by a container restart before it wrote a record. Its transcript and partial evidence were moved to `docs/delivery/test-evidence/DG3/code-security-r3-orphaned/` for provenance only. Do not cite them; produce all evidence afresh under `docs/delivery/test-evidence/DG3/code-security/round-3/`. Everything else in this assignment is unchanged.

Task ID: `T-DG3-REV-SEC-R3B`. You are the independent code and security reviewer re-reviewing the **repaired** DG3 candidate (P3 "Mobilization and portfolio"). You did not implement any DG3 requirement and are read-only to the implementation.

## Candidate

- **candidate_id:** `sha256:f2b4c77a026c6825d323cdc89782d63410ec9ead05666e06d90a4d51988d1d1d`. Verify it with `node tools/gates/candidate.mjs --stage DG3` (757 files) on a **complete clone**. If the clone is incomplete, the review is BLOCKED.
- **manifest:** `docs/delivery/candidates/DG3/f2b4c77a026c6825.manifest.json`.
- **source_commit:** `ce988e20f7ea2752cd3283995fbf7ed05b704485`.
- **Round 2** reviewed candidate `sha256:58ef3f4777967f7f5791565d6075c3ec28b45c3a42a58903057b81b522540f31` at source `f49ca160`.
  - **domain:** PASS. It verified F-DG3-120 (now CLOSED_VERIFIED) and raised F-DG3-170 (Medium).
  - **code-security:** FAIL. Its verification of F-DG3-100 failed.
  - **qa:** FAIL. It raised F-DG3-180 (Medium), the same badge overflow as F-DG3-170.
  - **Why this round is a full re-review (D-082).** The round-2 code-security and qa runs report a configuration change, because the orchestrator created repair worktrees while they ran. Neither run can serve as gate evidence. So this round is a **full** re-review, not a delta check.
- **The repair diff:** `git diff f49ca160..ce988e20f7ea2752cd3283995fbf7ed05b704485`, product code (`apps/**`, `packages/**`, `eslint.config.js`, `vitest.config.ts`, `package.json`, `docs/api/**`, `docs/architecture/**`).
  - The repair commits are `de06138` (T-DG3-KBE-E, merged in `a715b54`) and `6b30768` (T-DG3-FE-G, merged in `3dcb41f`); there are no orchestrator edits (D-083).
  - The handbacks are `docs/delivery/handbacks/DG3/T-DG3-KBE-E-kpi-benefits-engineer.md` and `T-DG3-FE-G-frontend-ux-engineer.md`.
- **Node:** 24.21.0 at `/opt/nvm/versions/node/v24.21.0/bin`; 22.22.2 at `/opt/node22/bin`.
- **Browser:** pre-installed Chromium (`PLAYWRIGHT_BROWSERS_PATH=/opt/pw-browsers`). Never run `playwright install`.
- **Ports:** use ports below 32768; the harnesses retry on collision. **Your ranges are 26300–26399.** The other two reviewers run at the same time on other ranges.
- **Clones, not worktrees.** Work in a `git clone` under your private `$TMPDIR`. **Never run `git worktree add` on this repository.** A new worktree changes the configuration snapshot of every concurrent run (D-082).
- **Previous gates:** DG2 and DG1 are APPROVED. `node tools/gates/validate.mjs --historical --stage DG2` and `--historical --stage DG1` must pass.
- **Design and delivery context:**
  - `docs/architecture/adr/ADR-0021`…`ADR-0024`;
  - `docs/architecture/p3-work-split.md`, including §9, the amendments;
  - `docs/delivery/decisions.md` D-078 to D-083;
  - your own round-1 and round-2 records under `docs/delivery/reviews/DG3/round-{1,2}/`, and their evidence.
- **The binding acceptance texts** are in `docs/delivery/requirements.csv` (`acceptance`, for the 32 rows with `final_gate` = DG3). Test them literally.
- **Product gates G1–G6 are business approvals inside the product.** They never imply or relate to the engineering gates DG0–DG7.

## Verify F-DG3-100 on THIS candidate, adversarially

**F-DG3-100 (Low, REQ-PB-056).** Your round-2 verification FAILED it. Both guards were still spelling denylists, and you found O2 and N1–N11.

**The claimed fix** is T-DG3-KBE-E, `de06138` (merged in `a715b54`). It follows the direction you suggested. Read its handback, §1–§5, and its per-form table.

- **Run-time layer.**
  - The whole formula test corpus runs again as the Vitest project `unit-formula-nocodegen`, in forks started with `--disallow-code-generation-from-strings`.
  - `pnpm test` runs it as a second invocation (root `package.json`).
  - A canary, `codegen.nocodegen.test.ts`, asserts that the flag is present and that `Function`, `eval`, AsyncFunction and GeneratorFunction throw `EvalError`.
  - A preload, `test-support/nocodegen-preload.mjs`, lets tinypool start its forks under the flag.
- **Static layer, engine sources.**
  - Imports are an allowlist: relative imports plus `decimal.js`.
  - These globals are refused: `process`, `global`, `globalThis`, `self`, `window` and the browser aliases.
  - Also refused: `constructor` literals, templates and identifiers; prototype reflection; string-assembled computed keys; `import.meta`.
  - The scan mirrors all of this.
- **ADR-0024 §6** now states what each layer guarantees and the residual.

To verify:

1. **Re-run your round-2 probes** in a disposable clone, never in the candidate tree:
   - `docs/delivery/test-evidence/DG3/code-security/round-2/probes/guard-bypass-probe.mjs`;
   - `probes/residual-runtime.mjs`.

   For O1–O6 and N1–N12, report which layer refuses each form: lint, scan, or run time (`EvalError` in `unit-formula-nocodegen`, through `pnpm test`).
2. **Attack the run-time layer itself.** For example:
   - Is the flag really applied to every fork of that project?
   - Can a formula test file escape it, through `vmForks`, `threads` or a per-file pool override?
   - Does the preload re-enable or emulate any code generation?
   - Does `pnpm test` fail when the canary fails?
   - Can the no-codegen project be silently skipped (an empty include, a filter)?
   - Does a code-generation path inside the engine, reached only at evaluation time and not at import, fail the tests?
3. **Probe the static class again** for any remaining form that passes lint, the scan **and** the run-time layer. Report each attempt.
4. **Check the claims.** Is ADR-0024 §6 now exactly true, including the CSP claim (`script-src 'self'` with no `unsafe-eval`) and the stated residual?
5. **Confirm the engine is unchanged and its tests pass in both projects,** and re-run your probe C fuzz.

Write `docs/delivery/reviews/DG3/round-3/code-security-reviewer.verifications.json` = `{ "verifications": [ {finding_id, result, status_after, note, evidence[]} ] }`:
- if the fix is genuine: `result: "PASS"`, `status_after: "CLOSED_VERIFIED"`;
- otherwise: `result: "FAIL"`, with the reason and the reproduction.

A residual form you judge not worth a finding, for example one that only an unexercised path could reach and that the ADR states honestly, belongs in the note with your reasoning.

## Full re-review: no regression, plus the full checks

This round is a **full** review of the candidate, because your round-2 run cannot serve as gate evidence (D-082). Re-inspect:

- **The repair diff** (`git diff f49ca160..ce988e20f7ea2752cd3283995fbf7ed05b704485`).
  - **T-DG3-FE-G** (F-DG3-170/180): a CSS-only wrap modifier for the inherited-approval badge, and a new e2e spec. Check that the base `.status-chip` is unchanged and that no other chip changed.
  - **The KBE-E test-infrastructure changes:** `vitest.config.ts`, the root `package.json` `test` script and the preload. They must not weaken any other project, for example `unit-node`, `unit-web` or `integration` inheriting the flag or losing tests. Compare the unit counts with round 2 (1565).
- **Then the whole P3 surface, as in round 1.** Re-use your round-1 and round-2 probes:
  - every P3 mutation: authorization re-checked at commit time, validation, `If-Match`, audit, no I/O inside a transaction;
  - the AUD-403 sweep;
  - separation of duties and no on-behalf decision in every P3 business approval;
  - the G1 agreements guard;
  - the dependency-graph cycle refusal and its concurrency;
  - the advisory-lock registry (730219–730223, distinct);
  - decimals end to end;
  - the formula engine's limits, fuzz and injection;
  - migrations `0020`–`0027`;
  - the contract (270 operations live, every `p3-pending-*.ts` empty);
  - the `inheritedApproval` annotation: read-only, read under the transformation read gate, acyclic modules, an additive contract change.

### Run these, with real output

A missing tool or database is BLOCKED.

- `pnpm -r typecheck`
- `pnpm -r build`
- `pnpm lint`
- `pnpm openapi:lint`
- `pnpm check:no-cdn`
- `pnpm format:check`
- `pnpm test` on Node 22 **and** Node 24. Both Vitest invocations must run; report both counts.
- The integration suite on a disposable PostgreSQL, **twice**: once with `LANG`/`LC_ALL` unset and once with `LANG=C.UTF-8`. It includes `contract.test.ts` and migrations `0001`→`0027`.
- The AUD-403 sweep.
- `node tools/gates/validate.mjs --historical --stage DG2` and `--historical --stage DG1`.

Put your evidence under `docs/delivery/test-evidence/DG3/code-security/round-3/`.

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

Write `docs/delivery/reviews/DG3/round-3/code-security-reviewer.json` with these fields:

- `assignment` = exactly `docs/delivery/assignments/DG3/round-3/code-security-reviewer-rerun.md` (bare path);
- `candidate_id` as above;
- `reviewer_role: code-security-reviewer`, `round: 3`, `stage_id: DG3`;
- `checks_run[]`, each `{id, environment, procedure, expected, actual, exit_status (int), result (PASS|FAIL|BLOCKED), evidence[]}`;
- `requirements_checked[]`: exactly the ids listed above;
- `findings[]`: only the ids of NEW findings (strings);
- `verdict`: PASS only if all of these hold:
  - F-DG3-100 verifies CLOSED;
  - every requirement you check is verifiable with evidence;
  - every failure in the logs you cite is disclosed and explained;
  - nothing Critical, High or mandatory is unresolved;
  - you raised no finding you consider blocking.

Mirror the field set of your round-1 record, `docs/delivery/reviews/DG3/round-1/code-security-reviewer.json`.

## Finding record format: STRICT (use YOUR id range only)

- **Your id range for any NEW finding:** **F-DG3-190 to F-DG3-199**, used in order. Never use another id. The other reviewers have their own ranges, and F-DG3-100, F-DG3-120, F-DG3-170 and F-DG3-180 are taken.
- **The sidecar.** If you raise findings, write `docs/delivery/reviews/DG3/round-3/code-security-reviewer.findings.json` = `{ "schema_version": 1, "findings": [ ... ] }`. If you raise none, set `findings: []` and write no sidecar.
- **Each finding object has EXACTLY these keys, and no others.** `locations` is NOT allowed:
  - `id`;
  - `stage_id` ("DG3");
  - `requirement`;
  - `severity` (Critical|High|Medium|Low);
  - `mandatory_violation` (bool);
  - `title`, `reproduction`, `expected`, `actual`;
  - `evidence` (array of repository paths);
  - `reported_by` ("code-security-reviewer");
  - `reported_in` ("docs/delivery/reviews/DG3/round-3/code-security-reviewer.json");
  - `owner` (an implementer role: backend-workflow-engineer | kpi-benefits-engineer | frontend-ux-engineer | solution-architect | transformation-analyst | devops-engineer);
  - `status` ("OPEN");
  - `history` (`[{at, status:"OPEN", note}]`).

**Severity guidance.**
- **High or mandatory** is a broken acceptance criterion, a security or authorization hole, a wrong financial result, or a business approval that can be fabricated or bypassed.
- **Low** is cosmetic, or a documentation drift with no behavioural effect.
- Be precise. An observation you do not consider a defect belongs in a check's `actual`, not in a finding.
