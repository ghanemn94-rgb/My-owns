# DG2 gate review — code-security-reviewer (round 1)

Task ID: `T-DG2-REV-SEC-R1`. Independent code & security reviewer of the frozen **DG2** candidate. You did not implement any DG2 requirement.

## Candidate
- **candidate_id:** `sha256:8ef26b710e343ed3535934904bccd677eab87894bb2cb62d5fb7677d6a95355b` — verify `node tools/gates/candidate.mjs --stage DG2` (513 files). Complete clone.
- **manifest:** `docs/delivery/candidates/DG2/8ef26b710e343ed3.manifest.json`. **source_commit** `98a8d99`. Node 24.21.0 at `/opt/nvm/versions/node/v24.21.0/bin`; Node 22.22.2 floor.
- DG1 is APPROVED; `node tools/gates/validate.mjs --historical --stage DG1` must pass.

## What to review — correctness, authorization, data integrity, concurrency, security (adversarially)
Inspect the P2 diff/source under `apps/api/src/modules/**`, `packages/db/migrations/0010`-`0018`, `packages/shared/src/**`, and the ADRs 0015-0020. Verify:
- **Server-side authorization on every P2 mutation (REQ-S10-001, REQ-S16-013):** every create/edit/validate/approve/decide/assign route goes through the single policy function, scoped per ADR-0020; technical admins are not business approvers. **Re-run the read-only auditor (AUD) sweep: every P2 mutation must return 403 and write a denied-mutation audit event, while AUD can read every P2 resource (403 not 404).** Try a cross-organization and a wrong-scope actor (expect 404/403).
- **Entity integrity (REQ-S16-013):** DiagnosticFinding, Baseline, Evidence, ValuePool, Outcome, StrategicGuardrail each create+read through the API with authorization; the DB guards (migration 0010) actually fire — an INSERT/UPDATE without its audit event fails at COMMIT; `version` must step by exactly 1; append-only history tables reject UPDATE/DELETE; polymorphic record refs are constrained to the same transformation. Re-run a probe on a disposable DB.
- **Optimistic concurrency:** `If-Match`/ETag required; 409 on mismatch; a stale submission/edit cannot silently overwrite.
- **Product gates G1-G3 security (REQ-PB-016/017/018, REQ-S04-003/004/005, REQ-DLV-034, REQ-S13-012):** a decision by a non-configured approver **or by the submitter** → 403; a decision on a superseded submission version → 409; evidence that is only a filename or an inaccessible link is **unverified** and never satisfies a criterion; submission blocked when a mandatory criterion is incomplete (nothing written). **The product gates must not read or write any engineering DG0-DG7 record.**
- **Decimal + validation (REQ-PB-027/028):** money/rates are decimal strings, never floats (check the value helpers and the kpi module); unquantified value pools never read as 0; a validated total rises only on approval; out-of-domain inputs rejected server-side (422/400) with field pointers.
- **Charter versioning (REQ-PB-029):** each save creates an immutable `charter_version` snapshot; invalid baseline date rejected.
- **Evidence (REQ-S13-012):** upload/download/review enforce the parent record's authorization; the store confines keys; the creator cannot verify their own evidence.

## Checks (real output; a missing tool/DB is BLOCKED) — Node 22; confirm unit on Node 24
`pnpm -r typecheck`, `pnpm -r build`, `pnpm lint`, `pnpm openapi:lint`, `pnpm check:no-cdn`, `pnpm format:check`, `pnpm test` (Node 22 and 24), the integration suite on a disposable PostgreSQL (unique port) **twice** incl. `contract.test.ts`, the gate 403/409 cases, the DB-guard probe and the AUD-403 sweep, `node tools/gates/validate.mjs --historical --stage DG0` and `--historical --stage DG1`. Evidence under `docs/delivery/test-evidence/DG2/code-security/round-1/`.

## Requirements to check (record EXACTLY these)
`REQ-S10-001`, `REQ-S16-013`, `REQ-S13-012`, `REQ-DLV-034`, `REQ-PB-016`, `REQ-PB-017`, `REQ-PB-018`, `REQ-PB-027`, `REQ-PB-028`, `REQ-PB-029`.

## Environmental residuals — do NOT record as BLOCKED gate checks
Live-registry install (REQ-DLV-042 AC-1, **D-057**), live GitHub-Actions CI (REQ-DLV-025 A24, **D-058**), keycloak (**D-049**): record the offline/config surface PASS and note the live effect as the documented residual. A BLOCKED check fails the gate round.

## Record format (MANDATORY)
`docs/delivery/reviews/DG2/round-1/code-security-reviewer.json`: `assignment` = exactly `docs/delivery/assignments/DG2/round-1/code-security-reviewer.md` (bare path); `candidate_id` above; `reviewer_role: code-security-reviewer`; `round: 1`; `stage_id: DG2`; `checks_run[]` each `{id, environment, procedure, expected, actual, exit_status, result (PASS|FAIL|BLOCKED), evidence[]}`; `requirements_checked[]` exactly the ids above; `findings[]` only NEW ones (+ `.findings.json` if any); `verdict` PASS only if all verify, no unresolved Critical/High/mandatory.
