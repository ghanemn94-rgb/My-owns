# DG2 round 17: code-security-reviewer (T-DG2-REV-SEC-R17)

**Verdict: PASS.** No new findings. F-DG2-530 is verified CLOSED_VERIFIED.

- **Candidate:** `sha256:ddaab3cc264b0e13caadcb17f0d1811eff8ad1ec9364b7ba9c03727b83350750` (564 files), recomputed in the
  working tree and in a clean clone. HEAD 23edabf = source 805da3e + the round-17 freeze metadata (5 files under docs/delivery).
- **Run:** session 682880ae, run `DG2-T-DG2-REV-SEC-R17-code-security-reviewer-20261007T185426Z-682880ae`.

## Scope note: diff range

The assignment names `git diff fe22d759..cbdb4f68` as "the product changes since round 16". Those commits are the
round-10→11 repairs (D-070/D-071, BE16), already reviewed in rounds 11–16. The product change since round 16 is
`e3b2375..805da3e`: 30 files, all under `apps/web` plus `eslint.config.js`, and no API, DB or worker change. I reviewed that
range and the full files it touches. The stat of the named range is kept for the record in `diff-scan.log`.

## F-DG2-530: verified (details in `code-security-reviewer.verifications.json`)

- **Round-16 Y1:** passes on Node 22 and on Node 24, with the round-16 probe rerun unchanged.
- **Round-15 (X1–X7) and round-14 probes:** pass unchanged.
- **The mechanism is sound by construction.**
  - The generation is captured at `begin()`.
  - `action.navigate` and `action.setQueryData` re-check it at call time.
  - Every `begin()` sits before the first await.
  - Raw `useNavigate` is confined to the three session transitions.
  - A navigation's page GETs are held behind a `/me` and refused if the generation moved while they waited.
- **New class probe Z1–Z6:** the post-create `/me` slower than the 5 s timeout, a slow edit, an immediate navigation,
  and the residual window. No DOM state ever paired B's header with A's data, or A's header with B's data, outside
  the documented residual.

## D-077 residual: accepted

In Z3, a refetch inside 2 s shows B's own rows under A's header.

- Nothing of A's is ever shown to B; only the cookie holder's own, server-authorised data is shown.
- A write from that view is refused 403 csrf.
- It ends at the next navigation, the next GET after the window, or a refocus.
- A query-string-only navigation (Z5) behaves the same way. It is within the stated "filter / page of results" class.

## Observations (not raised)

1. **The lint convention can be evaded by deliberate obfuscation** (`lint-bypass-probe.log`). These three forms pass
   both the ESLint rule and the scan test:
   - a destructured `const { setQueryData } = queryClient`;
   - a computed `queryClient["setQueryData"]`;
   - an alias named `action`.

   Namespace and renamed `useNavigate` imports are refused. No candidate code uses any of the three forms. The runtime
   guarantee comes from the session-bound API that the pages hold, not from lint.
2. **Liveness (Z6).** A navigation's page GETs wait for its `/me`. A `/me` that never answers leaves the page Loading
   until the browser's fetch gives up. This is by design, and a hung `/me` already breaks the session gate.
3. **URL in the address bar.** In Z1 the URL keeps A's new record id after the switch: an opaque id, refused to B
   (404). This is the same as whatever page A had open in the shared tab.
4. **Temporary directories.** The integration harness leaves its `mth-evidence-*` temp stores in `$TMPDIR`. The `.part` files
   in two `mth-evidence-shutdown-*` stores are the start-up-sweep test's deliberately kept fixtures (fresh `.part`,
   `notes.part`, wrong-depth `.part`), not leaked upload temporaries. Deleted with the clones.

## Checks

- **Static checks:** typecheck, build, lint, openapi-lint (161 operationIds), no-cdn and format all exit 0.
- **Unit tests:** 926/926 on Node 22, on Node 24, and on both again under concurrent load (loadavg 8.5–10.9 on 4 vCPU).
- **Integration:** 612/612 in both locale runs (SQL_ASCII with LANG unset; UTF8 with C.UTF-8), with every named suite
  and migrations 0001–0019.
- **Other:** the AUD-403 sweep passes 146/146 per run, and `validate --historical` passes for DG0 and DG1.
- **Disclosed non-zero exit:** `lint-bypass-probe.log` exits 1 by design (the two import bypasses refused).
- **Disclosed warnings:**
  - Fastify FSTDEP022 deprecation in the unit logs;
  - the Vite chunk-size advisory;
  - the pre-build missing-bin WARN in `install.log`, fixed by `install2`;
  - test-printed `SWEEP` lines.
