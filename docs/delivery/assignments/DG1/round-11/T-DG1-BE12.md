# Assignment T-DG1-BE12: F-DG1-132 / F-DG1-215 — document the namespace-enumeration residual (backend-workflow-engineer)

- **Stage:** P1 / gate DG1 (round-11 repair). **Base:** current `HEAD`. `node_modules` present; run **offline**; no `pnpm install`.
- Fix **only** F-DG1-132 and F-DG1-215 (the same route, Low; full text in `docs/delivery/findings.json`). Edit **only** `apps/api/src/architecture.testkit.ts` and `apps/api/src/architecture.test.ts`. No other files except a handback under `docs/delivery/handbacks/**`.

## The finding (F-DG1-132 ≡ F-DG1-215, Low, REQ-S16-003)
The F-DG1-130 `setEngine` ban is **spelled-name**-based (rule 1 matches the identifier/string text `setEngine`). Module source can still reach `crypto.setEngine` by **enumerating** the allow-listed `node:crypto` namespace without writing the name, e.g.:
- `Object.values(c).find((x) => typeof x === "function" && x.name === "set" + "Engine")`
- `new Map(Object.entries(c)).get("set".concat("Engine"))`
- `Object.entries(c).find(([k]) => /^setEng/.test(k))![1]`
- `for (const [k, f] of Object.entries(crypto)) if (k.startsWith("set") && k.endsWith("Engine")) f(p)`
All give **0 violations** on Node 22 and 24 and reach the function at runtime. This is **not a new member** (the member-audit still shows `crypto.setEngine` is the only native loader on both runtimes). It is the same class as the existing **residual (a)**: a value (the namespace object) handed to third-party readers (`Object.entries`/`Map`/`Array.find`) with a **runtime-built key** the static lint cannot follow. The reviewers explicitly accept "name the remaining route as a residual" as a resolution.

## Required fix (document the residual accurately — do NOT chase it)
1. **Correct the overclaims** in the testkit header and the related self-check comments: the `setEngine` ban (and rule 1 generally) catches every **SPELLED** form (identifier, `.member`, `["literal"]`, destructured, string literal, unicode-escape, namespace `ns.setEngine`), **not** "every form" — a name reached only by runtime enumeration of an allow-listed namespace is **not** statically visible.
2. **Broaden residual (a)** so it unambiguously covers this route (and all its variants), e.g.: *"(a) runtime DATA FLOW the static lint cannot follow: a value — including the namespace or default binding of an allow-listed built-in (e.g. `node:crypto`) — passed to third-party or built-in readers (`Object.entries`/`Object.values`/`Map`/`Array.prototype.find`/a regex over keys) and indexed by a key built or carried at runtime, rather than written as a banned name or a directly-flagged `x[k]` computed member. The one native-loader member among the allow-listed built-ins (`crypto.setEngine`) is additionally name-banned (rule 1, every spelled form); reaching it by enumeration is this residual."* Keep residuals (b) code-gen+import and (c) WebAssembly.
3. **Self-check:** add an `it` that asserts the enumeration forms (E1–E4 above) produce **no** violation AND documents (in a comment) that this is the accepted residual (a), so the behaviour is pinned and a future reader sees it is deliberate — NOT a violation case. Keep the S1/S2/S3 spelled-form `setEngine` bans and the `node:crypto` positive control.

Rationale: a static AST lint cannot follow runtime key construction + third-party property reads; forbidding all namespace-as-value use or all dynamic property access would break legitimate code and is not a P1 goal. This stays static defence-in-depth (ADR-0002), not a runtime boundary.

## Self-verification (real output, paste into the handback)
- `pnpm vitest run apps/api/src/architecture.test.ts` — green incl. the new residual-documentation `it` and the existing S1/S2/S3 + positive control + real module tree (`moduleViolations` zero).
- `pnpm -r typecheck`; `pnpm lint`; `pnpm exec prettier --check` the two files; `pnpm test` full unit suite green.

## Handback
`docs/delivery/handbacks/DG1/round-11/T-DG1-BE12-backend-workflow-engineer.md` — the exact diff and rationale, and the real vitest output.
