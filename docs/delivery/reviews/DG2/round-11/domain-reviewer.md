# DG2 round 11 — domain-reviewer narrative (T-DG2-REV-DOM-R11)

**Verdict: PASS. No new findings.**

**Candidate.** `sha256:23e6c0a2834d2f255410e23197864ce283979964128791cfafc3e7075c7f7bad` (547 files). I recomputed it in the repository and in a disposable clone at freeze commit 309aff2c (source cbdb4f68). DG1 historical validation passes.

## What changed and why it doesn't affect the domain

D-071 / T-DG2-BE16 is API transport hygiene only:
- A response sent before its request body was consumed now closes the connection with a bounded lingering close.
- Shutdown is bounded with a 5 s grace period.
- Node's `requestTimeout` is set to 300 s.
- The not-found handler (the SPA fallback) is registered after the rate limiter, so it is metered.
- The evidence route maps an aborted body to the declared 400.

The diff from fe22d759 to cbdb4f68 touches no file under `apps/web`, `packages` or `docs/source`. No methodology text, gate criterion, sequencing, register column, i18n string or screen changed.

## Domain confirmation of the fix (live)

- **Normal upload.** A 2 MiB evidence file with an Arabic file name (RLM, emoji) uploads with 200 on a connection that stays keep-alive. It downloads byte-identical. A UI upload in EN and AR also works.
- **Oversized upload.** A 26 MiB upload gets the declared, localized `413 evidence.too_large` with `Connection: close`. The socket closes within about 1 ms of the response, nothing is stored, and the earlier content is unchanged. A later upload works.
- **Routing.** SPA deep links to Diagnose, Define and Design are still served, and an unknown API address returns 404.

## Full re-review

Source fidelity holds for all 26 requirements:
- the B0009 modes, shown verbatim with a labelled provisional AR translation;
- the B0018 roles;
- the B0023 gate names, with G1→G2→G3 enforced in sequence and demo decisions made live on synthetic data;
- the B0029 workstreams;
- the B0035 charter, the B0037 composed thesis and the B0039–B0043 scope checks;
- the B0050 T02 tree and the B0051 good-outcome test;
- guardrails, with G2 blocked at zero;
- the ten B0056 dimensions and the B0062 canvas;
- T03 and T04;
- the capability heatmap and journeys.

AR renders RTL and EN renders LTR. Unknown is shown as Unknown, never zero or green. Money and rates are numeric. The brand is provisional. There is no PMI or Mobily certification claim, and product gates G1–G6 never touch DG0–DG7.

## Evidence honesty

Every warning line in the cited logs is explained in the record:
- **Install:** the pre-build `mth-db` bin WARN lines.
- **Build:** the Vite chunk-size advisory.
- **Contrast:** the documented prohibited pairs (negative controls).
- **Unit tests:** the Fastify FSTDEP022 deprecation notice; the file's tests pass.
- **Stack logs:** the intended SQL_ASCII fail-closed probe (exit 1 by design, 0 tables).
- **Probe output:** the diagnostic prints, plus one expected-text wording note in my own probe (200 is the follow-up GET).

## Observation, not a finding

On a fresh transformation, G3 shows "1 of 5 mandatory outputs complete". The criterion counted as complete is `g3.design_decisions` ("every open design decision has an owner"), which is vacuously met when there are no decisions. The gate stays incomplete and red, so this isn't a false green, and it is unchanged since earlier approved rounds.

## Environmental residuals (not gate checks)

- Live registry (D-057).
- Live CI (D-058).
- Keycloak (D-049).
