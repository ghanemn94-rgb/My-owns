# DG1 gate review — code-security-reviewer (round 2, clean re-gate)
Task ID: `T-DG1-REV-SEC-R2`. Independent code & security reviewer re-reviewing the **repaired** DG1 candidate. You did not implement any DG1 requirement.

## Candidate
- **candidate_id:** `sha256:e6979e12111aeb1456f591d66f8437d9f491c7e8e58215ea7c5a9f233cbfe71d` — verify `node tools/gates/candidate.mjs --stage DG1`. Complete clone; 394 files.
- **manifest:** `docs/delivery/candidates/DG1/e6979e12111aeb14.manifest.json`. Node 24.21.0 at `/opt/nvm/versions/node/v24.21.0/bin`.

## Verify these round-1 findings are fixed on THIS candidate (you raised them) — adversarially
- **F-DG1-140 (Medium, mandatory):** a BU hierarchy cycle can no longer commit, even under concurrency. Migration `0009_business_unit_hierarchy_guard.sql` adds a trigger + `pg_advisory_xact_lock` + locking ancestor walk + a pre-check; `organization/routes.ts` takes the same lock before its checks. **Re-run the reviewer's own repro** (`docs/delivery/test-evidence/DG1/code-security/round-1/repro-bu/`) and confirm the concurrent cycle is now refused (and the sequential friendly 422 still holds).
- **F-DG1-141 (Medium, mandatory):** re-parent now authorizes `business_unit.manage` on the destination parent (or the org for a top-level move); a unit-scoped manager can no longer move a unit into a branch it lacks rights on (403 + denied-mutation audit). Re-run the repro; confirm the exposure is gone and legitimate in-scope moves still work.
- **F-DG1-142 (Medium):** the limiter keys on `u:<userId>` (validated session, token hashed, bounded TTL map) or `ip:<request.ip>` (TRUST_PROXY-aware), never a raw cookie. Re-run `repro-ratelimit/`; confirm cookie rotation no longer resets the bucket.
- **F-DG1-143 (Low):** `ajv`/`ajv-formats`/`yaml` moved to devDependencies; a module-source import of `ajv` is now a lint violation (re-run `repro-ajv/`). Note: they remain transitive fastify runtime deps (documented) — confirm that framing is honest.
- **F-DG1-144 (Low):** the flaky web test is deterministic now. **F-DG1-145 (Low):** the three views are documented + schema.ts comment fixed. **F-DG1-146 (Low):** D-057 now says 13/14 offline (AC-1 effect is the live-registry residual).
Write `docs/delivery/reviews/DG1/round-2/code-security-reviewer.verifications.json` with an entry per finding `{finding_id, result, status_after: CLOSED_VERIFIED, note, evidence[]}`.

## Checks (real output; a missing tool/DB is BLOCKED) — Node 22; confirm unit on Node 24
`pnpm -r typecheck`, `pnpm -r build`, `pnpm lint`, `pnpm openapi:lint`, `pnpm check:no-cdn`, `pnpm format:check`, `pnpm test` and `PATH=/opt/nvm/versions/node/v24.21.0/bin:$PATH pnpm test`, the integration suite on a disposable PostgreSQL (unique port) **twice** (incl. the new `bu-hierarchy-guard.test.ts` and migration 0009), `node --test tools/gates/tests/*.test.mjs tools/agents/tests/*.test.mjs`, `node --test deploy/scripts/tests/*.test.mjs`, `tools/deps/tests/install-sandbox.test.sh`, `node licenses/generate-sbom.mjs --check`, `node tools/gates/validate.mjs --historical --stage DG0`. Confirm the three ci.yml copies byte-identical. Evidence under `docs/delivery/test-evidence/DG1/code-security/round-2/`.

## Environmental residuals — do NOT record as BLOCKED gate checks
The live-registry install effect (AC-1, REQ-DLV-042) is the disclosed residual **D-057**; the live GitHub-Actions CI execution (A24, REQ-DLV-025) is the disclosed residual **D-058**. Record the OFFLINE install-sandbox suite (13/14) PASS and the CI **config** checks PASS, and note the live effects as these documented residuals. Do not emit a `BLOCKED` check for them (a BLOCKED check fails the gate round).

## Requirements to check (record EXACTLY these)
`REQ-DLV-025`, `REQ-DLV-033`, `REQ-DLV-042`, `REQ-S16-001`, `REQ-S16-003`, `REQ-S16-004`, `REQ-S19-004`, `REQ-S19-006`.

## Record format (MANDATORY)
`docs/delivery/reviews/DG1/round-2/code-security-reviewer.json`: `assignment` = exactly `docs/delivery/assignments/DG1/round-2/code-security-reviewer.md` (bare path); `candidate_id` above; `reviewer_role: code-security-reviewer`; `round: 2`; `stage_id: DG1`; `checks_run[]` each `{id, environment, procedure, expected, actual, exit_status, result (PASS|FAIL|BLOCKED), evidence[]}`; `requirements_checked[]` exactly the ids above; `findings[]` only NEW ones (+ `.findings.json` if any); `verdict` PASS only if all verify, requirements complete, no unresolved Critical/High/mandatory.
