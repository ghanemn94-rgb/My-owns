# ADR-0001: Runtime, language, module system and package manager

- **Status:** Proposed for DG1 (T-DG1-ARCH-01). **Date:** 2026-09-30. **Author:** solution-architect.
- **Requirements:** REQ-S16-001…003, REQ-S16-009, REQ-S19-002/003, REQ-S19-019, REQ-DLV-033.
- **Evidence tags** (used in every ADR):
  - **[V-LOCAL]** was verified first-hand in this run; the command is in `docs/architecture/discovery/p1-stack-discovery.md`.
  - **[UNVERIFIED]** comes from the architect's prior knowledge. It **must** be confirmed by `pnpm deps:verify` and the linked official page in a run with registry access, before the DG1 candidate freezes. This run's sandbox had no network access (discovery doc §1).

## Context

The master prompt (§16) asks for a TypeScript web frontend, a TypeScript API and a durable worker, all maintainable by Mobily IT without the builder. The dependency versions must be checked against official support windows and licences. Four conflicts had to be resolved:
- **CF-1:** the build sandbox runs Node 22, while the newest LTS line is 24.
- **T-1:** ESM or CommonJS.
- The package-manager choice.
- The new TypeScript 6.0 defaults.

## Decision

1. **Node.js (CF-1).**
   - **Target runtime:** the **Node.js 24 LTS** line in every container image. devops-engineer pins the image by digest.
     - Node 24 entered Active LTS in Oct 2025, moves to Maintenance in Oct 2026, and reaches end of life on 2028-04-30 [UNVERIFIED: https://github.com/nodejs/Release].
   - **Supported floor:** Node **22.18.0 or later** (`engines.node: ">=22.18.0 <25"`).
     - Node 22 is Maintenance LTS until 2027-04-30 [UNVERIFIED].
     - The build sandbox has Node **v22.22.2** [V-LOCAL], and the existing `delivery-gates` job uses Node 22.
     - 22.18 is the first 22.x release where TypeScript type stripping is on by default, which the `dev` scripts rely on.
   - CI runs the product jobs on **24 and 22**, so the code must not use APIs newer than 22.18.
   - `.nvmrc` says `24`.
   - *Why not 22 only:* it reaches end of life seven months after this decision, probably before handover (DG7).
   - *Why not 26:* it is not yet LTS on the decision date.
2. **TypeScript 6.0.2** everywhere [V-LOCAL: cached registry tarball and `/opt/node22/bin/tsc -v` = 6.0.2; licence Apache-2.0; `engines.node >=14.17`].
   - TypeScript has no LTS; each minor release is supported until the next one ships.
   - 6.0 changed several defaults (`types: []`, `rootDir`, `strict`), so `tsconfig.base.json` sets every relevant option explicitly.
   - Settings: `module`/`moduleResolution` `NodeNext` (the web app uses `Bundler`), `verbatimModuleSyntax`, `erasableSyntaxOnly` (so Node can strip types), `rewriteRelativeImportExtensions` (source imports use `.ts`, output uses `.js`), strict plus `noUncheckedIndexedAccess` and `exactOptionalPropertyTypes`.
   - Fallback (see Consequences): if the pinned `typescript-eslint` cannot support 6.0, pin TypeScript **5.9.3** instead [UNVERIFIED], with no code change. Nothing in the skeleton depends on a 6.0-only feature.
3. **ESM only (T-1).**
   - Every package has `"type": "module"`, and there is no CommonJS output.
   - Reasons:
     - `openid-client` 6, `uuid` 13 and Vite 7 are ESM-first or ESM-only [UNVERIFIED].
     - Node ≥22.12 can `require()` ESM anyway, so any CommonJS consumer still works.
     - One module system removes dual-package hazards.
   - Workspace packages expose `exports` with a custom condition `@mth/source` that points to `src/*.ts`, used by typecheck, Vite, Vitest and `node --conditions=@mth/source`, and `types`/`default` that point to `dist/`, used by production.
4. **Package manager: pnpm 10.33.0** [V-LOCAL: `pnpm --version`; MIT], pinned through `packageManager` and activated with Corepack (bundled with Node 22 and 24).
   - Workspaces: `apps/*` and `packages/*`. `tools/**`, the delivery tooling, is deliberately outside the workspace.
   - A committed `pnpm-lock.yaml` is required, CI installs with `--frozen-lockfile`, and `.npmrc` sets `save-exact=true`.
   - Lifecycle scripts are **off by default** in pnpm 10, and the allow-list `pnpm.onlyBuiltDependencies` is empty. esbuild runs from its per-platform optional package without its postinstall. This matches the orchestrator's install sandbox (REQ-DLV-042).
5. **Exact pins everywhere.**
   - Every `dependencies` and `devDependencies` entry is an exact version, and the lockfile pins the transitive dependencies.
   - `scripts/verify-dependency-pins.mjs` (`pnpm deps:verify`) checks each pin for existence, licence allow-list, deprecation, engines and peer compatibility. It must run before every lockfile regeneration.

## Alternatives considered

- **npm or Yarn workspaces.** npm has no strict isolation of undeclared dependencies. Yarn Berry's PnP complicates tooling. pnpm is present in the sandbox and blocks lifecycle scripts by default.
- **CommonJS or dual build.** Rejected: more configuration, dual-package hazards, and key dependencies are ESM-only.
- **`tsx`/`ts-node` for development.** Not needed: Node ≥22.18 strips types natively. This means one fewer dependency, and `erasableSyntaxOnly` keeps the source compatible.
- **Deno or Bun.** Smaller enterprise support footprint for IT, and Node is the conventional choice.

## Consequences

- Enums, namespaces and parameter properties are not allowed (`erasableSyntaxOnly`); use `as const` objects instead.
- Relative imports in Node packages use the `.ts` extension.
- Code must stay within Node 22.18 APIs until the floor is raised; raising it needs an ADR update.
- **Peer-compatibility risk [UNVERIFIED]:** `typescript-eslint` 8.46.0 declared `typescript <6.0.0` as its peer, and `eslint-plugin-react-hooks` 5.2.0 declared ESLint ≤9. `pnpm deps:verify` reports the mismatch. The fix is to raise them to the first releases that support TypeScript 6 and ESLint 10, or to use the TypeScript 5.9.3 and ESLint 9 fallbacks.

## Verification evidence

| Item | Pinned | Licence | Support window | Evidence / date checked |
|---|---|---|---|---|
| Node.js (target) | 24 LTS line; image digest pinned by devops | MIT | Active LTS → Oct 2026; end of life 2028-04-30 | [UNVERIFIED] nodejs/Release schedule; re-check 2026-09-30+ |
| Node.js (floor/sandbox) | ≥22.18.0; sandbox v22.22.2 | MIT | end of life 2027-04-30 | `node --version` [V-LOCAL 2026-09-30]; end-of-life date [UNVERIFIED] |
| TypeScript | 6.0.2 | Apache-2.0 | current minor | tarball `package.json` + `tsc -v` [V-LOCAL 2026-09-30] |
| pnpm | 10.33.0 | MIT | pnpm 10 current major | `pnpm --version`, `/opt/node22/lib/node_modules/pnpm/package.json` [V-LOCAL] |
| npm (bundled) | 10.9.7 | Artistic-2.0 | bundled with Node 22 | [V-LOCAL] |
| ESLint | 10.1.0 (engines `^20.19.0 \|\| ^22.13.0 \|\| >=24`) | MIT | current major | tarball `package.json` [V-LOCAL] |
| Prettier | 3.8.1 | MIT | current major | tarball `package.json` [V-LOCAL] |
| typescript-eslint | 8.46.0 | MIT | — | [UNVERIFIED]; peer-range risk above |
| eslint-plugin-react-hooks | 5.2.0 | MIT | — | [UNVERIFIED]; peer-range risk above |
