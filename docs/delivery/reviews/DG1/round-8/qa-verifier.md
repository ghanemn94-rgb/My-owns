# DG1 round 8: qa-verifier (T-DG1-REV-QA-R8)

**Verdict: PASS.** One new finding: F-DG1-213 (Low, not mandatory).

- **Candidate:** `sha256:e27eaf5fb5ada8640c4463b8e3c9d5f64e5aa629fa78b49cfd2861bdc7544876`.
- **Commits:** freeze commit `11bc4c4`, HEAD `6cb3813`. Between them only candidate-excluded metadata changed. The candidate ID recomputes identically in the repository and in a full, non-shallow disposable clone.
- **Run reference:** `DG1-T-DG1-REV-QA-R8-qa-verifier-20261001T133105Z-b205ef41`.

## Fix verified (sidecar: `qa-verifier.verifications.json`)

**F-DG1-128 (Low, REQ-S16-003): CLOSED_VERIFIED.**

- **Self-check:** `architecture.test.ts` passes 80/80. R1, R2, P12, X6–X8 and A1 are all caught.
- **Negative control:** with the pre-fix testkit (c36315b), exactly R1 and R2 fail (78/80).
- **Real plants:** a `node:test` import and a `process.execve` call planted in `modules/access` each turn the module-tree check red.
- **Independent probe:** 30/30. It covers 11 `node:test` forms and 10 `process.execve` forms, plus regressions and controls.
- **Scope:** between the round-7 and round-8 manifests, only `architecture.test.ts`, `architecture.testkit.ts` and `decisions.md` changed. The change is test-only.

## Checks (in disposable clones under `$TMPDIR`, removed afterwards)

| Check | Result |
|---|---|
| typecheck / build / lint / format / no-cdn / contrast | PASS |
| openapi:lint | PASS (33 operations) |
| Unit | 273/273 |
| Integration, twice (PG 16.13, port 5492) | 200/200 in both runs. 0 57P01 in the server logs, so F-DG1-009 holds. A12/A13/A14 green. |
| Migrations / audit trigger | 0001–0008 applied. UPDATE, DELETE and TRUNCATE are rejected for the superuser and the owner. App DELETE is denied. |
| Contract test | 9/9, including getBrandingTokens |
| e2e (Chromium, `--workers=1`, port 5493) | 22/22 in EN and AR, including F-DG1-210. My independent F-DG1-210 spec passes 2/2. |
| A18 clean start / A20 token propagation | PASS / PASS |
| F-DG1-212 regression | The cited log is still the 14/14 run, and its labels equal the suite's. My own run: 13 PASS. AC-1 (effect) is BLOCKED (no registry); its offline equivalent passes. |
| `validate.mjs --register DG1` / `--pipeline` / `--reconcile` | PASS |
| The 12 DG1-final requirements | IMPLEMENTED, with all cited evidence present |

## New finding: F-DG1-213 (Low, not mandatory, REQ-S16-003)

The common assignment asked me to check adjacent loader routes against the stated residuals and the D-054 claim. I did that and found one route neither of them covers.

**The route works on the pinned Node 22.22.2:**

1. `process._debugProcess(process.pid)` activates the inspector in-process, with no import of `node:inspector`. `process.kill(process.pid, "SIGUSR1")` does the same.
2. The Node globals `fetch` and `WebSocket` then send `Runtime.evaluate` with an arbitrary code string.
3. That string runs in the same process. In my run, `globalThis.__qa` became 42.

**The lint misses it:** the candidate's `fileViolations` reports 0 violations for all three plants.

**Why it is a new finding and not a covered residual:**

- `_debugProcess` and `kill` exist in today's Node 22, so this is not a "future/unknown" method under residual (c).
- It is not code generation followed by an import (residual (b)), and it is not third-party data flow (residual (a)).
- It contradicts the D-054 and testkit-header wording that the Node 22 `process.*` loader/exec methods are "enumerated exhaustively".

**Why Low:** the lint is static defence-in-depth over human-reviewed code, not a runtime boundary. No module uses this route today, and the route opens a visible loopback debug port.

**Suggested fixes (any one of these):**

- Add `_debugProcess`/`_debugEnd` to `PROCESS_LOADERS`, and handle the self-SIGUSR1 spelling, or run with `--disable-sigusr1`.
- Adopt the default-deny allow-list the header already mentions.
- Accept the route as an observation and drop "exhaustively" from the header and D-054.

## Blocked (environment: no registry network)

- **Installer suite AC-1 (effect):** exit 1, caused by ECONNREFUSED to the registry. The offline equivalent passes.

## Observation (not a finding)

- The template text "(round-4 lint: 'missed')" also appears in the R1 and R2 self-check titles. This is cosmetic.

## Scope of my writes

- Evidence under `docs/delivery/test-evidence/DG1/qa/round-8/`.
- Three probe files under `docs/delivery/test-evidence/DG1/qa/tests/` (the `dg1-r8-*` files).
- These round-8 `qa-verifier.*` files.

I made no product changes. I did not read any other round-8 reviewer's record.
