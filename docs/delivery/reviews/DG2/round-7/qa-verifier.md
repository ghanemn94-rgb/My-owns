# DG2 round 7 — qa-verifier narrative (T-DG2-REV-QA-R7)

**Candidate:** `sha256:ede1a9362bb276ce620e440bf9f6a599f6695d395b8e495eaefec30107b016de` (532 files, source `90439483`). Recomputed in the candidate tree (HEAD `36524e5`, freeze metadata only) and in a disposable clone. **Verdict: PASS.** One new Low, non-mandatory finding: F-DG2-310.

## What I ran (both locale settings: `LANG`/`LC_ALL` unset, and `LANG=C.UTF-8`)
| Area | Result |
|---|---|
| typecheck, build, lint, openapi:lint (161 ops), no-cdn, format, contrast | all exit 0 |
| Unit `pnpm test` | 9/9 runs 673/673 (4× Node 24, 4× Node 22, 1× under CPU load) |
| Integration (full project) | 5 completed runs per locale (1 under load each), all 531/531, 0 skipped |
| Integration + QA suites | 571/571 per locale |
| framework-errors + admin loop | 12/12 runs 22/22, 0 skipped |
| Product e2e (P1, P2, p2-blank-text, A20; EN+AR; Define→G2, Design→G3) | 62/62 per locale |
| QA acceptance stack (`qa-stack.sh`, port copy) | 114/114 per locale, `server_encoding UTF8` logged |
| axe | 592 screens, 0 violations |
| validate `--register DG2` / `--pipeline` / `--reconcile`, `--historical DG1` | PASS |

## Integration determinism (D-067)
- The orchestrator's symptom (one file failing at setup, 11 skipped) **did not recur**. framework-errors and admin ran 24 times in total, in both locales and under load, all green.
- Two of my attempts did fail, and both are explained. `with-pg.sh` exited 3 because postgres could not bind its port (EADDRINUSE). All the harness ports (and every default: 54331/54340/54351/54361) are inside the kernel ephemeral range 32768–60999. A client socket in TIME_WAIT on that port blocks a later `bind`+`listen` even with SO_REUSEADDR, which I reproduced in isolation (`11-port-collision-repro.*`). That cause is test tooling only and is raised as **F-DG2-310 (Low)**. Both runs were repeated green. A bind failure stops before vitest starts, so it is *not* the D-067 symptom, which stays unreproduced.
- The first QA-stack attempt failed with "Cannot find module". The cause was Playwright collecting my committed evidence spec copies, the same as in round 6. I fixed that in the clone only and reran.

## D-067 behaviour (my own spec `tests/round-7/e2e/dg2-qa-r7.spec.ts`)
- **Lone surrogate:** refused inline in EN ("Remove the unsupported character from this text.") and in AR RTL ("أزِل الحرف غير المدعوم من هذا النص."), and nothing is sent. A surrogate injected into the outgoing request gets a real server 400 `validation.invalid_character` at `/outOfScope`, shown localized. The API refuses 4 shapes in 3 fields, `changeSummary` and a body key. Charter and versions stay unchanged, and the control (emoji + Arabic) is stored verbatim. In the OIDC callback, a lone surrogate leads to 302 `token_invalid` (integration, 6 cases).
- **Router and connection errors over a real socket:** `%ZZ`, `%ED%A0%80`, a POST with a bad id, an SPA bad path, an oversized header, an oversized URL and a malformed request line. All 7 cases answer 400 `application/problem+json` with the expected code, a matching requestId and the 12/12 routed security headers, with no internals echoed. The stack stays healthy afterwards.

## Residuals (PASS on the offline/config surface, not BLOCKED)
Registry D-057 (offline install 371/371 reused; `deps:verify` timed out with no network), CI D-058 (workflows present, UTF8 database in CI), Keycloak D-049 (fake-IdP oidc 33/33).

qa-verifier grants no business, Finance or IT approval. Product G1–G6 never implies DG7.
