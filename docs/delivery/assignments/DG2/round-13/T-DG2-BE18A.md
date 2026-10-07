# Assignment T-DG2-BE18A: T-DG2-BE18 plus F-DG2-460, an upload cut by shutdown leaves nothing behind (backend-workflow-engineer)

- **Stage:** P2 / DG2 (FIXING). **Branch:** `claude/mobily-transformation-platform-regate`. **Base:** current `HEAD`. No other agent runs at the same time.
- **Your task covers three findings.** Read `docs/delivery/assignments/DG2/round-13/T-DG2-BE18.md` in full. Every requirement, sweep, test, self-verification step and handback rule in it applies unchanged: F-DG2-440 (authorise at commit time) and F-DG2-441 (no remote call inside a transaction). This assignment adds the qa round-12 finding F-DG2-460, which arrived after T-DG2-BE18 was written, so the three fixes ship as one change.
- **Handback.** Write one handback, `docs/delivery/handbacks/DG2/T-DG2-BE18-backend-workflow-engineer.md`, covering all three findings, with evidence under `docs/delivery/handbacks/DG2/T-DG2-BE18-evidence/`.

## Finding to repair in addition
**F-DG2-460 (Medium, REQ-S16-013): an upload in flight at SIGTERM leaves an orphaned `.part` file. This is a BE17 regression.**
- **The finding.** The full text is in `docs/delivery/findings.json`. qa's probe is R12-07 in `docs/delivery/test-evidence/DG2/qa/tests/round-12/e2e/dg2-qa-r12.spec.ts`, and its round-11 test R11-02(b) fails the same way. The logs are under `docs/delivery/test-evidence/DG2/qa/round-12/`.
- **What happens.** A 10 MiB upload stalls after 2 MiB, then the API gets SIGTERM. The 5 s grace expires and the process exits 0. The store keeps `<org>/<t>/<e>/<content>.part` with 2,097,152 bytes, and it survives a restart. Nothing ever removes it.
- **Probable cause.** BE17 phase 2 (`store.receive`) holds no pooled connection. `main.ts` runs `await app.close(); await db.destroy(); process.exit(0)`, so `db.destroy()` no longer waits for the upload handler, and `process.exit` runs before `receive()`'s asynchronous cleanup (`handle.close`, then `rm`). At `309aff2` (pre-BE17) the same probe left nothing.

## Required for F-460
1. **Shutdown waits for in-flight handlers' cleanup.** Graceful shutdown tracks in-flight requests or handlers and waits, within the grace or backstop, for every handler to settle, including its `catch`/`finally` cleanup, before `db.destroy()` and `process.exit`.
   - The 5 s grace still bounds connections.
   - The backstop still bounds the whole shutdown.
   - Document the order in `docs/operations/health-readiness.md`.
2. **Defence in depth: a start-up sweep of stale temporaries.**
   - On start-up, the filesystem evidence store removes `.part` objects older than a safe age. "Safe" means no live request can still own them, given `requestTimeout`, the grace and multiple API instances sharing the store. Justify the age you choose.
   - Each removal is logged (info), with no content.
   - A final object is never removed by the sweep.
   - If you judge a sweep unsafe with shared storage, say why, and rely on (1) with tests.
3. **Sweep the class.** List every handler that owns a temporary resource (file, `.part` object, lock, timer) whose cleanup is asynchronous, and show that a graceful shutdown lets it finish.
4. **Tests.** Real process and real filesystem store:
   - R12-07: a stalled upload, then SIGTERM, leaves no `.part` and no final object, and the process exits 0 within grace plus backstop;
   - the same with an upload that is actively streaming;
   - the start-up sweep removes a stale `.part` and keeps a fresh one and every final object;
   - qa's R11-02(b) passes;
   - **negative control:** the new tests fail on `HEAD` before your change.
