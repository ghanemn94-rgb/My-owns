# DG1 round 10: code-security-reviewer narrative

**Verdict: PASS.** Candidate `sha256:18fee161…8807`, freeze commit `265af7e`, reviewed at HEAD `241a377`. Run `DG1-T-DG1-REV-SEC-R10-code-security-reviewer-20261001T143212Z-d1279204`.

## Candidate
- HEAD `241a377` is the freeze commit plus metadata only: assignments, manifest and `stages.json`.
- The recomputed ID is `18fee161` in the real repo and in a full clone at both commits. It was unchanged after HEAD advanced to `ff83817`, which is another reviewer's run auto-commit (I did not open those files).
- The source delta since round 9 is two files: `architecture.testkit.ts` and `architecture.test.ts`.
- Informational: in `stages.json`, `candidate.frozen_at` is 14:30:22Z but the round-10 entry says `frozen_at` 13:52:40Z.

## F-DG1-130: verified, CLOSED_VERIFIED
`architecture.testkit.ts:101` bans `setEngine` as a "native loader".

**Spelled forms (`01-lint-probes.log`).** Planted via `fileViolations("transformations", …)`:
- All three assigned forms are violations.
- So are 11 more spellings: aliased, destructured, default member, `\u` escape, `\x` string escape, template key, re-export and renamed re-export, optional chain, dynamic literal import, and a bare string literal.
- Constructed keys are caught by rule 2.

**Positive controls.** Importing `randomUUID`/`createHash` (with `createHash("sha256")`), the namespace import on its own, and `getFips` all produce 0 violations.

**Suites.** `architecture.test.ts` passes 105/105, and the real 13-module tree has 0 violations.

**Member audit (`03-member-audit.log`).** I enumerated 503 own members of the seven built-ins and their sub-namespaces on Node 22.22.2 / OpenSSL 3.5.5.
- Only `setEngine` loads code.
- `setFips(<.so path>)` did not run the planted constructor, while `setEngine` did.
- The header's audit is correct.

## New: F-DG1-132 (Low, non-mandatory, REQ-S16-003)
The ban is name-based. Value-level enumeration of the allow-listed namespace reaches the same function without a banned name or a non-literal key:

```ts
import * as nodeCrypto from "node:crypto";
const members = new Map(Object.entries(nodeCrypto));
(members.get(["set", "Engine"].join("")) as (p: string) => void)(path);
```

- **Lint result:** `moduleViolations("transformations")` is `[]`.
- **Runtime result:** the `.so` constructor ran and wrote its marker before `ERR_CRYPTO_ENGINE_UNKNOWN` (`02-enum-e2e.log`).
- **What it contradicts:** "rule 1 now bans [setEngine] in every form" (testkit:51, test:15).
- **Why not ban `Object.entries`:** `new Map(Object.entries(x)).get(name)` is the dictionary idiom rule 2 recommends, and module code uses it (`identity/routes.ts:35`, `access/rules.ts:55`).
- **Suggested fix:** flag a namespace or default binding of `node:crypto` used other than as `ns.member`, the way rule 3 handles `process`. Alternatively, name this route under residual (a).
- **Why Low:** this is a static lint over human-reviewed code, not a runtime boundary. The severity is consistent with F-DG1-125, F-DG1-127, F-DG1-129 and F-DG1-130.

## Checks
| Check | Result |
|---|---|
| typecheck, build, lint, openapi:lint, check:no-cdn, format:check | 0 errors |
| Unit suite | 298/298 |
| Integration (PostgreSQL 16.13, port 5491) | 200/200, run twice |
| Gate and agent tooling tests | 105/105 |
| Deploy script tests | 59/59 |
| SBOM check | OK |
| DG0 historical validation | PASS |
| Three `ci.yml` copies | byte-identical; check-ci-needs OK |
| Assigned requirements | 8/8 IMPLEMENTED with `final_gate` DG1; all evidence present |

**BLOCKED (environment):**
- AC-1 (effect) of the install-sandbox suite: registry ECONNREFUSED. The other 13 checks pass.
- The Node 24 re-run of the audit: no Node 24 runtime is available.

F-DG1-131 is not assigned to me. I did not record a verification for it, although D-055 now reads accurately ("four of the seven… reviewed safe headroom").
