# Supply chain: registry, SBOM, vulnerabilities, licences, updates

## Images

| Image | Dockerfile / target | Contents | Runtime user |
|---|---|---|---|
| `transformation-hub/api` | `apps/api/Dockerfile` / `api` | Node 22 slim base; `pnpm deploy --prod` output (`dist`, production `node_modules`, migrations, post-migrate SQL, templates); entrypoint | UID 10001, GID 0 |
| `transformation-hub/api-chromium` (optional) | `apps/api/Dockerfile` / `api-chromium` | as `api`, plus the Playwright-matched Chromium (playwright-core 1.56.1), Noto fonts and tini | UID 10001, GID 0 |
| `transformation-hub/web` | `apps/web/Dockerfile` | Next.js standalone server + static assets (fonts bundled) | UID 10001, GID 0 |

Hardening built into the images:

- multi-stage builds, with no compilers, sources or tests in the runtime stage;
- **npm, npx, corepack and yarn removed** from runtime images (C-38);
- application files are root-owned and read-only for the runtime user;
- only `/tmp`, `/data/objects` (dev local storage) and the Next.js cache are writable;
- they work with `readOnlyRootFilesystem` and arbitrary OpenShift UIDs;
- `HEALTHCHECK`s and OCI labels (version, revision) are set;
- no secrets, and no build arguments carry credentials.

**Build status in the build environment:** no Docker daemon was available, so **no image was built** (NOT
EXECUTED). Instead, every `RUN` step of both Dockerfiles was executed with the same commands on a copy of the
context that honoured `.dockerignore`, and the resulting layouts were started:

- **API:** migrated a scratch DB via `hub-entrypoint migrate`, served `/healthz` and `/readyz`, and refused unsafe production configuration.
- **Web:** served `/login` with HTTP 200, and wrote no files outside `.next/cache`.

The simulation found and fixed one defect: the Dockerfiles did not copy `tsconfig.base.json`, so the TypeScript
build failed.

Operator commands (context = `transformation-hub/`):

```bash
docker build -f apps/api/Dockerfile --target api \
  --build-arg NODE_BASE=<registry>/library/node:22.22.2-bookworm-slim@sha256:<digest> \
  --build-arg NPM_REGISTRY=https://<npm-mirror>/ --build-arg APP_VERSION=<v> --build-arg GIT_COMMIT=<sha> \
  -t <registry>/transformation-hub/api:<v> .
docker build -f apps/api/Dockerfile --target api-chromium --build-arg PLAYWRIGHT_DOWNLOAD_HOST=https://<mirror> … -t <registry>/transformation-hub/api-chromium:<v> .
docker build -f apps/web/Dockerfile --build-arg HUB_API_URL=http://hub-api:4000 … -t <registry>/transformation-hub/web:<v> .
```

The Dockerfiles use only standard instructions (no BuildKit-only `RUN --mount`), so they also build with Buildah
(OpenShift builds) or Kaniko.

## Private registry mirroring

1. **Base images:** mirror `node:22.22.2-bookworm-slim` (and for dev `postgres:16.x`, `minio/minio`, `minio/mc`) into the private registry. Pin by **digest**. The Dockerfiles' default `NODE_BASE` carries a digest **placeholder** on purpose, so a release build fails until the mirrored digest is supplied. Verify the tag exists in the mirror; the version was chosen to match the tested runtime (Node v22.22.2).
2. **npm packages:** point `NPM_REGISTRY` (build arg) at the internal npm proxy. `pnpm fetch --frozen-lockfile` downloads exactly the lockfile's integrity-checked tarballs.
3. **Chromium** (optional variant): Playwright's download host must be mirrored (`PLAYWRIGHT_DOWNLOAD_HOST`), and the Debian apt sources must point to an internal mirror.
4. **Promotion:** build once, scan, sign (for example cosign or the registry's signing), then promote the **same digest** through test → staging → prod.

## SBOM — tool choice: **syft** (Anchore), CycloneDX JSON

Why syft: it produces SBOMs for both the source tree (from `pnpm-lock.yaml`) and the built images (OS packages +
node_modules). `@cyclonedx/cyclonedx-npm` covers npm only and does not read pnpm workspaces reliably.

- **Executed locally:** syft v1.52.0 (built from source) on `transformation-hub/`, excluding `node_modules` → **CycloneDX 1.6 JSON with 539 components** (for example `pkg:npm/next@16.3.6`, `pkg:npm/%40nestjs/core@11.2.6`, `pkg:npm/pg@8.23.0`). syft defaults to CycloneDX 1.7; use `-o cyclonedx-json@1.6=…` if the consumer (for example Dependency-Track) needs 1.6.
- **CI:** job `sbom` (source) and job `images` (one SBOM per image) using `anchore/sbom-action`. Artefacts are attached to the run. Archive them with each release.

## Vulnerability scanning

- **CI:** `anchore/scan-action` (grype) on the API image. **Report only**, JSON artefact, cut-off `critical` shown. `pnpm audit --prod` also runs, report only (job `audit`, `continue-on-error`).
- **Proposed policy** (Mobily Cybersecurity to confirm): block a release on **critical** findings with a fix available in production dependencies or the base image. Track high findings with an owner and due date. Record accepted risks with an expiry.
- Mobily's own registry scanner (for example Trivy, Clair or Prisma) is authoritative for images in the private registry.
- **Not executed here:** grype and `pnpm audit` (no network access to advisory databases was attempted in the build environment).

## Secret scanning

- **CI:** job `secret-scan` runs gitleaks **8.30.1** (MIT licence) over the repository history and tree, the web client bundle, and the CI test reports and logs. It **fails the build** on any finding. The binary is downloaded from the GitHub release `gitleaks_8.30.1_linux_x64.tar.gz` and verified against the SHA-256 pinned in the workflow (`551f6fc8…f2470eb`, taken from the release checksums file and checked in the build environment on 2026-09-30). When mirroring into Mobily's CI, fetch the same file from the internal artifact mirror and keep the checksum pin. Scope, allow-list policy and limits: [secrets.md](secrets.md#secret-scanning-ci).

## Licence checks

- `scripts/ops/licence-check.mjs` reads `pnpm licenses list --json --prod` and applies `scripts/ops/licence-policy.json` (a **proposal** pending Mobily Legal / OSS office):
  - permissive licences are OK;
  - strong/network copyleft or source-available licences **FAIL**;
  - weak copyleft and unknown licences give **WARN** on pull requests and **FAIL in release mode** (`--release`), unless Mobily records an approval (approver role and reference). The build team never self-approves.
- **Executed locally:** 260 package versions, **0 FAIL, 2 WARN**:
  - `@img/sharp-libvips-linux-x64@1.3.4` — LGPL-3.0-or-later. Native library pulled in by Next.js image optimisation (`sharp`). Options: approve (dynamic linking), or disable image optimisation (`images.unoptimized`) and exclude `sharp`;
  - `buffers@0.1.1` — no declared licence; transitive dependency of `exceljs` → `unzipper`.
- Other notable licences (allowed by the proposal): OFL-1.1 (bundled IBM Plex fonts), CC-BY-4.0 (`caniuse-lite` data), `(MIT OR GPL-3.0-or-later)` for `jszip`, where MIT is chosen.

## Update procedure

1. **Monthly** (and on advisories): update dependencies in a branch. Keep exact pins (`save-exact`) and the committed lockfile. Run full CI: unit, integration, e2e, restore drill, SBOM, audit, licences.
2. Rebuild the images on the latest mirrored base digest, even without code changes, to pick up OS fixes.
3. Compare SBOM diffs between releases. New licences or new transitive packages are reviewed.
4. Stage, soak and promote by digest ([upgrade-and-rollback.md](upgrade-and-rollback.md)).
5. For CI actions: pin every GitHub Action to a full commit SHA in Mobily's mirror. The workflow uses version tags because the SHAs could not be verified in the build environment.
