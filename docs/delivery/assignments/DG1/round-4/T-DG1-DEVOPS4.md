# Assignment T-DG1-DEVOPS4: devops round-4 repairs (devops-engineer)

- **Stage:** P1 / gate DG1 (round-4 repair). **Base revision:** current `HEAD` (≥ `96e75cc`). Dedicated git worktree; `node_modules` present; run **offline**; no network. Write ONLY `deploy/**`, `.github/workflows/ci.yml` (or staged `deploy/ci/ci.yml`), `licenses/**`, `.env.example`, and the Prettier config/ignore if needed.

## Findings

### F-DG1-119 (Medium) — the committed deploy/images.lock.json fails `pnpm format:check`, so the CI verify job is deterministically red
`deploy/scripts/pin-images.mjs` writes `deploy/images.lock.json` with `JSON.stringify`, which Prettier does not consider formatted, so `pnpm format:check` fails on the committed lock and integration/e2e/images never run. **Fix durably** — because `pin-images --apply` rewrites the lock in CI, a one-off `prettier --write` would drift again. Make it stable, e.g. add `deploy/images.lock.json` to the Prettier ignore (it is a generated lock), OR make `pin-images.mjs` emit Prettier-compatible JSON and format the committed file now. Confirm `pnpm format:check` passes on the committed tree and still passes after a `pin-images --apply`. (If you choose prettier-ignore, make sure the file is still valid JSON and the pin-images `--check` is unaffected.)

### F-DG1-120 (Low) — check-ci-needs.mjs does not restrict the delivery-gates checkout step's `with:` inputs
`deploy/scripts/check-ci-needs.mjs` allow-lists the gate job's steps but not the `with:` inputs of its `actions/checkout` step, so a `ref:` or `repository:` override could make `validate.mjs` check a different tree than the product jobs build. **Fix:** on the gate job's checkout step, reject any `with:` key outside a minimal safe set (no `ref`, `repository`, `path` override that points elsewhere). Add a self-test case (fail-before/pass-after). This also closes F-DG1-107's residual.

## Self-verification (offline)
`pnpm format:check` passes on the committed tree; `node --test deploy/scripts/tests/*.test.mjs`; `node deploy/scripts/check-ci-needs.mjs` on the installed workflow; `node deploy/scripts/pin-images.mjs --check` (still exits 1 only on the test-only keycloak, D-049). Anything you cannot run is BLOCKED.

## Handback
`docs/delivery/handbacks/DG1/round-4/T-DG1-DEVOPS4-devops-engineer.md` — the fixes, proof `format:check` passes, self-test output; note any `deploy/ci/ci.yml` change to install to `.github/workflows/ci.yml`.
