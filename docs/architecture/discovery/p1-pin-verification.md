# P1 dependency-pin verification (orchestrator, REQ-DLV-042)

The solution-architect (T-DG1-ARCH-01) proposed the version pins offline; its agent sandbox has no network (D-025), so most pins were marked `[UNVERIFIED]`. The orchestrator verified them against the npm registry and ran the first sandboxed install (`tools/deps/install-sandbox.sh`, D-027/REQ-DLV-042). This document records the verification and the pin changes the install required.

- **Date checked:** 2026-09-30.
- **Registry:** `https://registry.npmjs.org/` (reachable from the install sandbox, which shares the host network; the agent sandboxes do not).
- **Install wrapper:** `tools/deps/install-sandbox.sh create` (bubblewrap: read-only root; only the repo and the pnpm store writable; lifecycle scripts off; `pnpm.onlyBuiltDependencies: []`).
- **Result of the final install:** `Done`, **0 unmet peer dependencies**, `pnpm-lock.yaml` committed.
- **Full build verification (sandboxed, clean toolchain):** `pnpm -r typecheck` ✓, `pnpm -r build` ✓ (7 packages; `apps/web` builds under Vite 7, 31 modules), `pnpm lint` ✓ (`eslint . --max-warnings=0`), `pnpm openapi:lint` ✓ (OpenAPI 3.1.1, 32 operations). All exit 0.

## Pin changes the install required

The architect's offered fallback was "TypeScript 5.9.3 + ESLint 9". Verification showed a better resolution that **keeps the modern stack** (TypeScript 6, ESLint 10, React 19, Vite 7) by moving three tool pins forward instead of the language/linter back:

| Package | Was (architect, offline) | Now (verified) | Why |
|---|---|---|---|
| `typescript-eslint` (root) | `8.46.0` | `8.71.0` | 8.46.0 peers `eslint ^8.57\|\|^9` and `typescript >=4.8.4 <6.0.0` — rejected ESLint 10.1.0 and TS 6.0.2. 8.71.0 peers `eslint ^8.57\|\|^9\|\|^10` and `typescript >=4.8.4 <6.1.0` — both satisfied. (TS stays at 6.0.2; 8.71.0 does **not** allow TS 7, so we do not jump to TS 7.) |
| `eslint-plugin-react-hooks` (root) | `5.2.0` | `7.1.1` | 5.2.0 peers `eslint … \|\|^9` (no 10). 7.1.1 adds `\|\|^10.0.0`. `eslint . --max-warnings=0` passes with the flat config after the bump. |
| `i18next` (apps/web) | `25.5.2` | `26.4.2` | 25.5.2 peers `typescript ^5` — rejected TS 6. 26.4.2 peers `typescript ^5\|\|^6\|\|^7`. |
| `react-i18next` (apps/web) | `16.0.0` | `17.0.15` | 16.0.0 peers `typescript ^5`. 17.0.15 peers `typescript ^5\|\|^6\|\|^7`, `i18next >=26.2.0` (satisfied by 26.4.2). |
| `openapi-types` (root, new devDep) | — | `12.1.3` | `@apidevtools/swagger-parser@10.1.1` has a `openapi-types >=7` peer that was unmet; adding it removes the "Peer dependencies that should be installed" warning. |

All other pins the architect proposed installed and built without change. The ADR evidence tables (ADR-0001, ADR-0009, ADR-0012) still carry the architect's `[UNVERIFIED]` tags for the unchanged pins; a solution-architect follow-up (or an orchestrator evidence edit) should replace those tags with "verified 2026-09-30 against the registry; installs and builds clean" and update the four changed pins above. No functional ADR decision changed — only tool patch/minor levels moved to match the chosen stack.

## Licence note
No new licence risk: `openapi-types` (MIT), `typescript-eslint` (MIT), `eslint-plugin-react-hooks` (MIT), `i18next`/`react-i18next` (MIT). The MinIO (AGPL) decision (L-flags, ADR-0010) is unaffected — it is not bundled.
