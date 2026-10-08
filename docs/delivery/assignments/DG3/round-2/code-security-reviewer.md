# DG3 gate review: code-security-reviewer (round 2)

Task ID: `T-DG3-REV-SEC-R2`. You are the independent code and security reviewer re-reviewing the **repaired** DG3 candidate (P3 "Mobilization and portfolio"). You did not implement any DG3 requirement and are read-only to the implementation.

## Candidate

- **candidate_id:** `sha256:58ef3f4777967f7f5791565d6075c3ec28b45c3a42a58903057b81b522540f31`. Verify it with `node tools/gates/candidate.mjs --stage DG3` (754 files) on a **complete clone**. If the clone is incomplete, the review is BLOCKED.
- **manifest:** `docs/delivery/candidates/DG3/58ef3f4777967f7f.manifest.json`.
- **source_commit:** `f49ca1604857f8a79dce28c306cff895e6158d8e`.
- **Round 1** reviewed candidate `sha256:873115d9bc84f763d8ec0670f0e5e320b013dc26faba6e3026395b09ed5c9f33` at source `928b7654`. All three reviewers gave PASS. Two Low findings were raised and repaired since: F-DG3-100 and F-DG3-120 (D-080).
- **The repair diff:** `git diff 928b7654..f49ca1604857f8a79dce28c306cff895e6158d8e`, product code (`apps/**`, `packages/**`, `eslint.config.js`, `docs/api/**`, `docs/architecture/**`).
  - The repair commits are `4175262` (T-DG3-KBE-D, merged in `011654d`) and `ea8e2de` (T-DG3-ARCH-05, merged in `2f30603`); D-081 records one orchestrator edit, renumbering the two new §9 items of `p3-work-split.md` as 23 and 24.
  - The handbacks are `docs/delivery/handbacks/DG3/T-DG3-ARCH-05-solution-architect.md` and `T-DG3-KBE-D-kpi-benefits-engineer.md`.
- **Node:** 24.21.0 at `/opt/nvm/versions/node/v24.21.0/bin`; 22.22.2 at `/opt/node22/bin`.
- **Browser:** pre-installed Chromium (`PLAYWRIGHT_BROWSERS_PATH=/opt/pw-browsers`). Never run `playwright install`.
- **Ports:** use ports below 32768; the harnesses retry on collision. **Your ranges are 26300–26399.** The other two reviewers run at the same time on other ranges.
- **Previous gates:** DG2 and DG1 are APPROVED. `node tools/gates/validate.mjs --historical --stage DG2` and `--historical --stage DG1` must pass.
- **Design and delivery context:**
  - `docs/architecture/adr/ADR-0021`…`ADR-0024`;
  - `docs/architecture/p3-work-split.md`, including §9, the amendments;
  - `docs/delivery/decisions.md` D-078 to D-081;
  - your own round-1 record, `docs/delivery/reviews/DG3/round-1/code-security-reviewer.json`, and its evidence.
- **The binding acceptance texts** are in `docs/delivery/requirements.csv` (`acceptance`, for the 32 rows with `final_gate` = DG3). Test them literally.
- **Product gates G1–G6 are business approvals inside the product.** They never imply or relate to the engineering gates DG0–DG7.

## Verify your round-1 finding on THIS candidate, adversarially

**F-DG3-100 (Low, REQ-PB-056).** The formula engine's "no dynamic code" guards (the ESLint override and the `fuzz.test.ts` source scan) accepted code that builds and runs a function from a string.

**The claimed fix** is T-DG3-KBE-D, `4175262` (merged in `011654d`):
- the ESLint override for `packages/shared/src/formula/**` now refuses:
  - the `Function`, `eval` and `Reflect` globals;
  - any `Function` identifier;
  - a computed `constructor` member;
  - `createRequire` and `require`;
  - imports of `node:module` and `module`;
- the source scan matches the same forms;
- a lint probe exercises each form.

The handback lists the exact rules and the probe output.

To verify:
1. **Re-run your round-1 bypass probe.** It is `docs/delivery/test-evidence/DG3/code-security/round-1/lint-bypass-probe.log` and its inputs. Every one of the six bypass forms must now fail lint **and** the scan, on a disposable copy, never in the candidate tree.
2. **Probe the class again** for any remaining way to evaluate text as code, or load a module dynamically, under `packages/shared/src/formula/**` that passes both guards. For example:
   - `globalThis` or `self` indexing;
   - `Object.getOwnPropertyDescriptor` on a function's constructor;
   - destructuring `{ constructor }`;
   - an `AsyncFunction` or `GeneratorFunction` reached through a prototype;
   - `import.meta` tricks;
   - tagged templates.

   Report each attempt and its outcome.
3. **Confirm the guard did not change the engine.**
   - The shipped engine still lints clean.
   - The formula unit tests and the fuzz test pass, and the engine's behaviour is unchanged. Re-run your probe C fuzz on this candidate.

Write `docs/delivery/reviews/DG3/round-2/code-security-reviewer.verifications.json` = `{ "verifications": [ {finding_id, result, status_after, note, evidence[]} ] }`:
- if the fix is genuine: `result: "PASS"`, `status_after: "CLOSED_VERIFIED"`;
- otherwise: `result: "FAIL"`, with the reason and the reproduction.

A residual form you judge not worth a finding belongs in the note, with your reasoning.

## Re-review: no regression, plus the full checks

Re-inspect the whole repair diff (`git diff 928b7654..f49ca1604857f8a79dce28c306cff895e6158d8e`, product code). It includes **T-DG3-ARCH-05**, the `inheritedApproval` annotation on `GateInstance` (contract, `workflows/gates.ts`, zod `gate.ts`, the Gates screens). For that annotation, check:

- **Reads only.**
  - It never changes `gate_instance.status`, never writes, and never makes a gate look approved.
  - Is it read under the same authorization as the gate list or gate view? It must not leak a dispensation to a user who cannot read that transformation.
  - Is it read without client or remote I/O inside a transaction?
- **The module graph stays acyclic:** `workflows` does not import `portfolio`. Check `architecture.test.ts`.
- **The contract change is additive.**
  - It is nullable, and the zod mirror matches.
  - `contract.test.ts` still pins 270 operations, every one live, and every `p3-pending-*.ts` is empty.
- **Web.** Session-bound actions only, translated in EN and AR, with no approved colour on the badge.

Then confirm that your round-1 conclusions still hold on this candidate:
- authorization re-checked at commit time;
- the AUD-403 sweep;
- separation of duties and no on-behalf decisions in every P3 business approval;
- the G1 agreements guard;
- the dependency-graph cycle refusal and concurrency;
- the advisory-lock registry (730219–730223, distinct);
- decimals end to end;
- the formula engine's limits, fuzz and injection;
- migrations `0020`–`0027`.

Re-use your round-1 probes where they apply.

### Run these, with real output

A missing tool or database is BLOCKED.

- `pnpm -r typecheck`
- `pnpm -r build`
- `pnpm lint`
- `pnpm openapi:lint`
- `pnpm check:no-cdn`
- `pnpm format:check`
- `pnpm test` on Node 22 **and** Node 24
- The integration suite on a disposable PostgreSQL, **twice**: once with `LANG`/`LC_ALL` unset and once with `LANG=C.UTF-8`. It includes `contract.test.ts` and migrations `0001`→`0027`.
- The AUD-403 sweep.
- `node tools/gates/validate.mjs --historical --stage DG2` and `--historical --stage DG1`.

Put your evidence under `docs/delivery/test-evidence/DG3/code-security/round-2/`.

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

Write `docs/delivery/reviews/DG3/round-2/code-security-reviewer.json` with these fields:

- `assignment` = exactly `docs/delivery/assignments/DG3/round-2/code-security-reviewer.md` (bare path);
- `candidate_id` as above;
- `reviewer_role: code-security-reviewer`, `round: 2`, `stage_id: DG3`;
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

- **Your id range for any NEW finding:** **F-DG3-160 to F-DG3-169**, used in order. Never use another id. The other reviewers have their own ranges, and F-DG3-100 and F-DG3-120 are taken.
- **The sidecar.** If you raise findings, write `docs/delivery/reviews/DG3/round-2/code-security-reviewer.findings.json` = `{ "schema_version": 1, "findings": [ ... ] }`. If you raise none, set `findings: []` and write no sidecar.
- **Each finding object has EXACTLY these keys, and no others.** `locations` is NOT allowed:
  - `id`;
  - `stage_id` ("DG3");
  - `requirement`;
  - `severity` (Critical|High|Medium|Low);
  - `mandatory_violation` (bool);
  - `title`, `reproduction`, `expected`, `actual`;
  - `evidence` (array of repository paths);
  - `reported_by` ("code-security-reviewer");
  - `reported_in` ("docs/delivery/reviews/DG3/round-2/code-security-reviewer.json");
  - `owner` (an implementer role: backend-workflow-engineer | kpi-benefits-engineer | frontend-ux-engineer | solution-architect | transformation-analyst | devops-engineer);
  - `status` ("OPEN");
  - `history` (`[{at, status:"OPEN", note}]`).

**Severity guidance.**
- **High or mandatory** is a broken acceptance criterion, a security or authorization hole, a wrong financial result, or a business approval that can be fabricated or bypassed.
- **Low** is cosmetic, or a documentation drift with no behavioural effect.
- Be precise. An observation you do not consider a defect belongs in a check's `actual`, not in a finding.
