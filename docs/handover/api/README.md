# Handover: API contract, authentication and connectors

This folder is the entry point for Mobily IT to the hub's HTTP API and its integrations (REQ-S19-007, REQ-S17-004). It links to the single source of each artefact (ADR-0070 §4).

| What | Where |
| --- | --- |
| The contract (OpenAPI 3.1) | `docs/api/openapi.yaml`, version `1.6.0-p7`. `pnpm openapi:lint` checks it. |
| Contract tests | `apps/api/test/integration/contract/` (route coverage, every operation exercised, every response validated against the contract) |
| Coverage report | [`openapi-coverage.json`](openapi-coverage.json), from `tools/release/openapi-coverage.mjs` |
| Sign-in, sessions, CSRF and service identities | [`authentication.md`](authentication.md) |
| Connectors, endpoints and credentials | [`connectors.md`](connectors.md) (generated) |

## Coverage of the contract (from `openapi-coverage.json`)

The report reads the contract suite's own run (vitest `json` reporter) and has no skip list:

```sh
tests/qa/support/with-pg.sh npx vitest run --project integration apps/api/test/integration/contract \
  --reporter=json --outputFile.json=<file>
node tools/release/openapi-coverage.mjs --vitest-json <file> --out docs/handover/api/openapi-coverage.json
```

The figures below were copied from `openapi-coverage.json` as committed with this file. The report is engineering evidence and states no IT acceptance.

| Measure | Value |
| --- | --- |
| Result | **PASS**: every operation is described, routed and exercised, and responses are validated. `reasons` is empty. |
| Operations in the contract | 965 (equal to the count pinned in `contract.test.ts`) |
| Operations fully described | 965 |
| Routed and exercised by the contract suite | 965 and 965 |
| Pending (unrouted) operations | 0 |
| Skipped, todo or focused contract tests | 0 |
| Contract suite run | 3 files, 231 tests, all passed. `response-validation.test.ts` passed (119 tests). |
| `NO_400_OPERATIONS` | `completeOidcLogin`: no input that can be invalid. It is not a skip: the suite checks that the callback answers 302. |

The 22 description gaps of the first run (T-DG7-DO-H) were closed in `docs/api/openapi.yaml` by the ARCH repair T-DG7-ARCH-R1: a `summary` on 21 read and update operations and a declaration of the tag `admin`. No path, parameter, schema or response changed. Any later change to the contract means re-running the contract suite and the tool and copying the figures again.

Connectors pass their contract tests against **local test doubles** only. No authenticated test against a Mobily endpoint has been recorded, so every enterprise connector is "Not verified" (see `connectors.md`).
