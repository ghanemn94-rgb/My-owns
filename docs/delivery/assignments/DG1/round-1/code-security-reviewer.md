# DG1 gate review — code-security-reviewer (round 1, clean re-gate)
Task ID: `T-DG1-REV-SEC-R1`. Independent code & security reviewer for the **DG1 gate**. You did not implement any DG1 requirement. Read-only to implementation (you may write under `docs/delivery/reviews/DG1/round-1/` and `test-evidence/DG1/code-security/round-1/`).

## Candidate
- **candidate_id:** `sha256:25c97340b6047e87e82642c28e90dea72cdd07b5bbd5d81986f497e5e863061b` — verify `node tools/gates/candidate.mjs --stage DG1`. Complete clone; 391 files.
- **manifest:** `docs/delivery/candidates/DG1/25c97340b6047e87.manifest.json`.
- Node 24.21.0 at `/opt/nvm/versions/node/v24.21.0/bin`.

## Context
Single clean gate round for the final remediated P1 product (dev history preserved on branch `claude/mobily-transformation-platform-kwcc4i` + tag `dg1-dev-history-d1cb245`). Review the candidate on its own merits: correctness, architecture, authorization, data integrity, concurrency, injection, security — with file:line, reproducible findings.

## Focus
- **ADR-0002 module boundaries:** `apps/api/src/modules.ts` + the dependency-lint `apps/api/src/architecture.test.ts` (`architecture.testkit.ts`). Confirm the lint fails closed on boundary violations and that its declaration-file / default-deny built-in / `process.*` rules are sound (the testkit header documents the member-audit).
- **Every mutation** has a server-side authorization check, validation, optimistic concurrency and an audit event, each covered by tests. The audit trigger rejects UPDATE/DELETE. Decimal money/rates. No secrets in the repo. No public CDNs.
- **keycloak (D-049):** node/postgres/playwright pinned by digest; keycloak (quay.io) is the disclosed test-only residual. **REQ-DLV-042 online-registry install (D-057):** the hermetic sandbox has no package registry, so the live-registry install effect cannot run — record the **offline** `install-sandbox` acceptance suite as PASS and note the online effect as the D-057 environmental residual. Do **NOT** record a BLOCKED check for it (a BLOCKED check fails the gate round).

## Checks to run (real output; a missing tool/DB is BLOCKED) — Node 22, and confirm unit on Node 24
`pnpm -r typecheck`, `pnpm -r build`, `pnpm lint`, `pnpm openapi:lint` (33 ops), `pnpm check:no-cdn`, `pnpm format:check`, `pnpm test` and `PATH=/opt/nvm/versions/node/v24.21.0/bin:$PATH pnpm test`, the integration suite on a disposable PostgreSQL (unique port) **run twice** (determinism), `node --test tools/gates/tests/*.test.mjs tools/agents/tests/*.test.mjs`, `node --test deploy/scripts/tests/*.test.mjs`, `tools/deps/tests/install-sandbox.test.sh` (14 ACs offline; online-registry is the D-057 residual — note it, do not BLOCK the gate on it), `node licenses/generate-sbom.mjs --check`, `node tools/gates/validate.mjs --historical --stage DG0` (must pass). Confirm the three ci.yml copies are byte-identical. Evidence under `docs/delivery/test-evidence/DG1/code-security/round-1/`.

## Requirements to check (record EXACTLY these)
`REQ-DLV-025`, `REQ-DLV-033`, `REQ-DLV-042`, `REQ-S16-001`, `REQ-S16-003`, `REQ-S16-004`, `REQ-S19-004`, `REQ-S19-006`.

## Record format (MANDATORY — the gate validator checks these)
Write `docs/delivery/reviews/DG1/round-1/code-security-reviewer.json`:
- `assignment`: exactly `docs/delivery/assignments/DG1/round-1/code-security-reviewer.md` — a bare path, nothing appended.
- `candidate_id` above; `reviewer_role`: `code-security-reviewer`; `round`: 1; `stage_id`: `DG1`.
- `checks_run[]`: each has `id`, `environment`, `procedure`, `expected`, `actual`, `exit_status` (integer), `result` (`PASS`/`FAIL`/`BLOCKED`), `evidence[]` (existing repo paths).
- `requirements_checked[]`: exactly the ids above.
- `findings[]`: only findings raised **this round**; if non-empty also write `code-security-reviewer.findings.json` (`reported_by: code-security-reviewer`). None → empty, no sidecar.
- `verdict`: `PASS` only if all assigned requirements complete with evidence and no unresolved Critical/High/mandatory; else `FAIL`.
