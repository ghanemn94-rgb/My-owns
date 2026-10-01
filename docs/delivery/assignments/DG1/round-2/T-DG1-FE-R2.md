# Assignment T-DG1-FE-R2: round-2 repair (frontend-ux-engineer)

- **Stage:** P1 / gate DG1 (clean re-gate, round-2 repair) on branch `claude/mobily-transformation-platform-regate`. **Base:** current `HEAD`. `node_modules` present; run offline. Node 24.21.0 at `/opt/nvm/versions/node/v24.21.0/bin`.
- Edit only the test file(s) needed for this finding (test-only; no product behaviour change). Do not edit `tools/**`, `docs/source/**`, reviews or gate records. Handback under `docs/delivery/handbacks/DG1/round-2/`.

## F-DG1-144 (Low, REQ-DLV-033): non-deterministic web unit test
`apps/web/src/pages/transformations/transformations.test.tsx:523-536` — the test "English: Edit, Archive and the audit trail appear after create" failed 1 of 4 Node 22 runs: a `findByRole` used the default 1 s timeout, which is too tight under load. Evidence: `docs/delivery/test-evidence/DG1/code-security/round-1/web-flake-under-load.log`.
**Fix:** make the assertion deterministic — raise the `findByRole`/`findBy*` timeout for the controls that appear after the async create/refresh (e.g. an explicit `{ timeout: 5000 }`, or await the settling of the effective-permissions refresh before asserting), without weakening what it checks. Apply the same hardening to any sibling assertion in that test with the same race. Do not change product code.

## Self-verification (real output; paste into the handback)
- Run the specific web test **several times** (e.g. 5×) on Node 22 and show it green every time (no 1 s-timeout flake): `pnpm vitest run apps/web/src/pages/transformations/transformations.test.tsx` repeated, plus once under `PATH=/opt/nvm/versions/node/v24.21.0/bin:$PATH`.
- `pnpm -r typecheck`, `pnpm lint`, `pnpm exec prettier --check` the edited file, and the full `pnpm test` green.

## Handback
`docs/delivery/handbacks/DG1/round-2/T-DG1-FE-R2-frontend-ux-engineer.md` — the diff, the repeated-run output proving determinism, and the full-suite result.
