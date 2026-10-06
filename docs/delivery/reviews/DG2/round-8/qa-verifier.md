# DG2 round 8 — qa-verifier narrative (T-DG2-REV-QA-R8)

**Candidate:** `sha256:9331e9d1…124f` (539 files), source `cf3446e4`. **Verdict: PASS.**

**Finding status:**
- F-DG2-310 is **CLOSED_VERIFIED** (see `qa-verifier.verifications.json`).
- F-DG2-340 is new: Low, non-mandatory.

## F-DG2-310 (harness port collisions): verified
- **Kernel behaviour.** My round-7 repro still shows the same kernel behaviour. Client ports are only ever assigned in the range 32768–60999, and every harness default now sits below it.
- **`port-collision-check.sh`.** It passes 5/5. Its negative control still reproduces the original defect on the old harness.
- **My own forced-TIME_WAIT cases on the real stacks** (with-stack, qa-stack, A18 clean start, clean-start-local), all passing:
  - each stack retries on PostgreSQL and on the API, and logs the retry;
  - it exports the URLs and ports it actually used;
  - two concurrent runs on the same port both start;
  - a foreign listener is never taken over;
  - non-bind failures, strict mode and exhausted retries fail closed with BLOCKED and exit 3.
- **Every run this round started on its first attempt:** 10 integration runs, 2 QA-suite runs and 4 final e2e runs.

## D-068 regression (strict UTF-8, platform statuses)
- **Invalid UTF-8 bodies.** All 48 raw-socket requests return 400 `validation.json` at pointer `""`. They cover 8 invalid shapes, 3 framings (including a split across chunks) and requests with and without a session. Nothing is stored.
- **Undecodable query strings.** All 104 probes over every GET query parameter in the contract return 400 `validation.format` at `/query/<name>`. A request without a session still gets 401.
- **Valid text.** Arabic, emoji, ZWJ sequences and combining marks round-trip byte for byte. This holds even when the body is cut mid-character across chunks, and also through the UI in EN and AR.
- **429.** All 161 operations declare 429, and the live sweep passes.

## F-DG2-340 (new, Low)
`RecordForm` renders a pointer-`""` validation message twice, in two `role="alert"` regions. The new `validation.json` path exposes it. The logic is pre-existing (round 4), and the normal SPA cannot trigger it.

## Process notes
Two QA-stack attempts failed because of my own mistakes, not the product:
- **Attempt 1:** evidence copies of earlier specs were left inside the clone.
- **Attempt 2:** a race in my new R8-05 spec.

Both are logged and explained, the spec is fixed, and both locales were rerun green on the fixed spec. A `pkill` meant to stop attempt 1 did not reach the background batch, because each shell runs in its own PID namespace. The partial log from that run is recorded as such and is not counted.

## Residuals (not BLOCKED)
- D-057: no live registry.
- D-058: no live CI run.
- D-049: no live Keycloak.

## Scope of this verdict
This verdict grants no business approval. Product G1–G6 never imply DG7.
