# DG1 round-13 review — common instructions
You are independently re-reviewing the DG1 candidate after the round-12 all-PASS, which raised two Low findings. Both are now fixed. Read your role file next.

## Candidate (all three reviewers + auditor)
- **candidate_id:** `sha256:00f1498cd5e9a166db501452f699a3270ffca82455593fe9c0ab84a83e01c80b`
- **source_commit:** `08cbd12f00c5c0561f9718900e71c9baf3d8e0c1` is the freeze commit (candidate-excluded metadata only); the recomputed id is identical — verify `node tools/gates/candidate.mjs --stage DG1`. Complete clone (not shallow). 391 files.
- **manifest:** `docs/delivery/candidates/DG1/00f1498cd5e9a166.manifest.json`.

## What changed since round 12 (both findings now `FIXED_PENDING_VERIFICATION`)
- **F-DG1-134 (Low, REQ-S16-003):** the module lint's `walk()` scanned only `/\.(ts|tsx)$/`, so a module-dir file named `.mts/.cts/.mjs/.cjs/.js/.jsx` evaded every rule (1–5) and the module-interface check (it typechecks under NodeNext and ships in `dist`). Fixed: `walk()` now matches `CODE_FILE = /\.[cm]?[jt]sx?$/` (all buildable JS/TS), so every module file is linted; `scanSource` parses `.tsx/.jsx` as TSX and the rest as TS; `isTest` uses `TEST_FILE = /\.test\.[cm]?[jt]sx?$/`. The real module tree has **0** non-`.ts/.tsx` files, so nothing changes for it; a planted `.mts` is now linted (self-check).
- **F-DG1-216 (Low, REQ-S16-003):** `D-055` still called the `node:crypto` namespace-enumeration route "residual (a)" though round-12 rule 5 closed it. Fixed: both D-055 mentions now say the route is **closed by rule 5** (named imports only), consistent with the testkit header.

A Node 24.21.0 binary is at `/opt/nvm/versions/node/v24.21.0/bin`.

## Your job
Verify the finding(s) you own (your role file lists them); re-run your checks (real output; a missing tool/DB is BLOCKED; where a check runs on Node 24, run both). Re-check the 12 DG1-final requirements; confirm no regression. You did not implement these repairs. Write `docs/delivery/reviews/DG1/round-13/<role>.json` + sidecars; evidence under `docs/delivery/test-evidence/DG1/<key>/round-13/`. PASS only if the fixes verify, every assigned requirement is complete with existing evidence, and no unresolved Critical/High/mandatory remains.
