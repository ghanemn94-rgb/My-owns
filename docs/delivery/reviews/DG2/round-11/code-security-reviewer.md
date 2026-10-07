# DG2 round 11: code-security-reviewer

**Verdict: PASS.** This is an engineering delivery-gate review only. It grants no business, Finance or IT approval, and it implies nothing about product gates G1-G6.

- **Candidate:** `sha256:23e6c0a2…7bad` (547 files), source `cbdb4f6`, freeze `309aff2`. Recomputed in the working tree and in clean clones.
- **Session:** `00836eea`. I authored nothing in this scope.

## The auditor's defect: F-DG2-410 (Medium, not mandatory), raised and CLOSED_VERIFIED

I reproduced it with my own raw-socket probe on the round-10 candidate `7fd1a89c` (`repro-7fd1a89c.log`).

**R1/R1c, a 30 MiB over-limit upload (chunked and Content-Length):**
- the server answers 413 with `Connection: keep-alive` and never closes;
- after the client has gone, it holds the socket for 69,985 / 69,998 ms;
- `app.close()` takes 71,994 ms.

**R3, the sibling defect: requests refused before the body is read (401 without credentials, 403, 428, 404).** These stay keep-alive and drain about 300 MiB in 6 s.

**On this candidate**, the same probe gives the following, on Node 22 with LANG unset and on Node 24 with LANG=C.UTF-8:
- 413 now carries `Connection: close`;
- the server closes 128-284 ms after connect and releases the socket within about 0.5 s;
- `app.close()` takes 0-1 ms;
- refusals close at once, after only 0.1-0.9 MiB is accepted.

**Root cause, confirmed in the code and in the Node 22/24 built-ins.** The upload iterator's `return()` detaches the socket before destroying the request, so the parser `readStop()`s a socket that nothing reads again. That socket survives until `keepAliveTimeout`.

**Why the `destroySoon` override is safe:**
- it is installed per socket, only when a close is decided;
- the only server call site is `resOnFinish` under `res._last`;
- when there is no `destroySoon`, the fallback is Node's own `end()`.

**No regression.** The following are all unchanged against `7fd1a89c` (R2, R7):
- keep-alive after a 200;
- the raw-byte sha256;
- bodyLimit;
- strict UTF-8;
- media types (D-070);
- CSRF/Origin;
- authorization.

**Shutdown.** Idle sockets close at once, in-flight work that finishes within the grace completes normally, and stalled requests are cut at the grace (R5). The SIGTERM test passes.

**Unmatched-route rate limiting (R4/R4b).** Each unmatched request is counted exactly once. The SPA fallback works, and there is no CSRF or authorization bypass. Every 429 carries the security headers.

## New findings from the class probe (both OPEN)

- **F-DG2-411 (Medium, not mandatory).** `uploadEvidenceContent` takes a pooled connection and the row lock before it reads the body.
  - With 6 stalled uploads against a harness pool of 5, every other user's `/api/v1/me` and `/readyz` hang (R8). The same happens at 7fd1a89c.
  - The hold now ends at `requestTimeout`, 300 s by default; R8b shows 3 s when it is set to 3 s. Before BE16 it was unbounded.
  - Production uses a pool of 20, so 20 stalled sockets block the whole API.
- **F-DG2-412 (Low, not mandatory).** A JSON body aborted by the client, or cut by the new `requestTimeout`, is logged as `unhandled error` at level 50 and mapped to a 500 (R6a, R6d). BE16 fixed this for the upload route only (R6e).

## Records

- **F-DG2-206 (D-071).** The owner is now `delivery-orchestrator`, the author of `ee46813`. This is a records-only change. The validator no longer reports "verified by its own owner".

## Checks and evidence honesty

Every required check ran and exited 0:

| Check | Result |
|---|---|
| build | pass |
| typecheck | pass |
| lint | pass |
| openapi-lint | 161 operations |
| no-cdn | pass |
| format | pass |
| unit, Node 22 and Node 24 | 771/771 each |
| unit under load (load average up to 9.16) | 771/771 |
| integration, run 1 (SQL_ASCII) | 583/583 |
| integration, run 2 (UTF8) | 583/583 |
| AUD-403 sweep, both runs | 146/146 |
| DG0 and DG1 historical validation | PASS |

The following non-zero exits and notices appear in the evidence I cite:
- **The probe runs exit 1 by design.** Every failing assertion is listed and explained in `probes/README.md` and in checks SEC-R11-01/02.
- **`validate --stage DG2` exits 1, as expected while DG2 is REVIEWING.**
- **Warnings and notices.** The build prints Vite's chunk-size advisory, and the unit runs print the FSTDEP022 deprecation notice. Both also appeared in round 10.
- **Concurrent load.** Unit Node 24 overlapped a 25 s probe run.
- **Repository changes during the run.** The domain reviewer's evidence was committed to the main tree; I did not read it.

No log shows a hook timeout or a failed suite. Earlier iterations of my probe had harness mistakes: a missing `noteBody`, a wrong bucket assumption and a timing race. Their logs were superseded and are not cited. The cited logs come from the final probe, sha256 `0b60ece2…`.
