# DG1 round-11 review — common instructions
You are independently re-reviewing the DG1 candidate after the round-10 **BLOCK** (qa FAIL). The three round-10 findings are now fixed. Read your role file next.

## Candidate (all three reviewers + auditor)
- **candidate_id:** `sha256:e5cc6ef982ba7d53ed80138c0cbaa0119bcfe8dcaad4e324b5dafdb6431afeb8`
- **source_commit:** `32e6478de3c49b2c80d044b8a2d5d89f88c35f65` is the freeze commit (candidate-excluded metadata only); the recomputed id is identical — verify `node tools/gates/candidate.mjs --stage DG1`. Complete clone (not shallow). **391 files** (a new web test-harness file was added).
- **manifest:** `docs/delivery/candidates/DG1/e5cc6ef982ba7d53.manifest.json`.

## What changed since round 10 (all three findings now `FIXED_PENDING_VERIFICATION`)
- **F-DG1-214 (Medium, REQ-DLV-033):** the unit-web suite failed deterministically on **Node 24** (ADR-0001's production target; CI runs product jobs on 24 and 22) — 12/110 with "Expected signal to be an instance of AbortSignal", because the built-in jsdom environment installs jsdom's `AbortController`/`AbortSignal` while `Request` stays undici's, and react-router's signal is rejected by undici 7's `instanceof` on Node 24. Fix: a **custom vitest environment** `apps/web/test/jsdom-native-abort-environment.ts` that runs jsdom but restores Node's native `AbortController`/`AbortSignal` (captured before jsdom overrides), keeping the signal and `Request` in one realm. Harness-only — no product change. `apps/web/vitest.config.ts` references it; `apps/web/tsconfig.json` includes `test`.
- **F-DG1-132 ≡ F-DG1-215 (Low, REQ-S16-003):** `crypto.setEngine` reachable by **enumerating** the allow-listed `node:crypto` namespace (`Object.entries`/`Map`/`find` + a runtime-built key) — documented and pinned as **residual (a)** data-flow (banning namespace-as-value would break legitimate `new Map(Object.entries(x)).get(name)` in identity/access); the header's "every form" is corrected to "every SPELLED form".
- **F-DG1-011 (Low, REQ-S16-003):** D-055's version/exhaustiveness framing corrected — the overclaim dropped; the member-audit's runtime named (Node 22.22.2) and **re-run on Node 24.21.0** (the production target) with identical results (evidence `docs/delivery/test-evidence/DG1/orchestrator/node24-member-audit.log`).

A Node 24.21.0 binary is available at `/opt/nvm/versions/node/v24.21.0/bin`.

## Your job
Verify the finding(s) you own (your role file lists them); re-run your checks (real output; a missing tool/DB is BLOCKED). Where a check can run on Node 24, run it on **both** Node 22 and Node 24 (the round-10 BLOCK was a Node-24-only failure). Re-check the 12 DG1-final requirements; confirm no regression. You did not implement these repairs. Write `docs/delivery/reviews/DG1/round-11/<role>.json` + sidecars; evidence under `docs/delivery/test-evidence/DG1/<key>/round-11/`. PASS only if the fixes verify, every assigned requirement is complete with existing evidence, and no unresolved Critical/High/mandatory remains. A namespace-enumeration reach of an allow-listed member is the documented residual (a), not a new finding.
