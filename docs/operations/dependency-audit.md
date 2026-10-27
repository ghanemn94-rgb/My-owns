# Dependency audit (P6; ADR-0052 §6, REQ-S16-030 "dependency checks")

Two controls check the third-party packages against published security advisories. They are not interchangeable.

| Control | Where it runs | Source of advisories | Fails on |
|---|---|---|---|
| **Live audit**: `pnpm audit --audit-level high --prod` | CI job `dependency-audit` (`deploy/ci/ci.yml`); any host that reaches the configured registry | The registry's advisory service, at the moment it runs | a High or Critical advisory on a production dependency |
| **Offline snapshot check**: `node deploy/scripts/dep-audit.mjs` | `pnpm test` (Vitest project `unit-node`), the same CI job, restricted networks | The **dated snapshot** committed as `deploy/advisories/snapshot-<yyyy-mm-dd>.json` | a High or Critical advisory in the snapshot matching a **shipped** SBOM component (scopes `runtime`, `bundled`), or a shipped component the snapshot never queried |

The offline check only knows the advisories that existed when the snapshot was retrieved. It prints the snapshot's
retrieval date and age on every run. It is **never** a substitute for the live audit, and a pass of the offline check
says nothing about advisories published after that date.

## The SBOM it reads

`licenses/sbom.cdx.json` is generated from `pnpm-lock.yaml` by `node licenses/generate-sbom.mjs` (see
`licenses/README.md`). Each npm component carries its scope:

- `runtime`: shipped as `node_modules` in the `mth-app` image;
- `bundled`: compiled into the web bundle;
- `development`: build, lint and test tooling, never shipped.

The runtime scope follows the production workspace links of `apps/api`, `apps/worker` and
`packages/{config,db,shared}` (for example `packages/reporting`), the same closure the image assembly ships.
`generate-sbom.mjs --check` runs before the audit in CI. After any lockfile change, regenerate the SBOM first.

Matches on `development` components, and Moderate or Low matches, are listed but do not fail. This is the same split
as the live audit's `--prod --audit-level high`.

## Refreshing the snapshot

The refresh needs network access to the registry's bulk advisory endpoint
(`POST <registry>/-/npm/v1/security/advisories/bulk`):

```bash
node licenses/generate-sbom.mjs                      # the SBOM must match the lockfile
node deploy/scripts/dep-audit.mjs --refresh          # writes deploy/advisories/snapshot-<today>.json
NODE_USE_ENV_PROXY=1 node deploy/scripts/dep-audit.mjs --refresh   # behind an HTTP(S) proxy (Node 24)
node deploy/scripts/dep-audit.mjs --refresh --registry https://<IT mirror>   # a mirror that serves the endpoint
```

The snapshot records:

- its source: the endpoint URL, and the advisory database, which is the GitHub Advisory Database (CC-BY-4.0) as the
  npm registry serves it;
- its retrieval time;
- the SBOM and lockfile hash it queried, and every queried `name@version`.

Format it (`npx prettier --write deploy/advisories/`) and commit it. Older snapshots may stay in the repository as history, because the check always uses the newest
file by the date in its name. Refresh it after every lockfile change. Otherwise the check reports the new versions as
**not covered** (status Unknown) and fails.

Optional: `--max-age-days <n>` also fails when the snapshot is older than `n` days. `pnpm test` does not use it, so
that the test stays deterministic.

## Restricted networks

A network with no route to the registry's advisory service cannot run the live audit: the CI step **fails**
(BLOCKED), and is never skipped. In such a network:

- run the offline check against a snapshot refreshed where the service is reachable, and record the snapshot date with
  the result;
- or point `--registry` at an internal mirror that serves the bulk advisory endpoint.

## What a failure means and who decides

A failing audit means a published High or Critical advisory affects a package the product ships. The fix is a
dependency change: an upgrade, an override, or replacing the package. The delivery orchestrator decides on that, and
in production so does Mobily IT. An engineering agent never accepts a security risk on anyone's behalf. Neither
control has a waiver list.

## Recorded runs

The DG6 runs, with their dates, results and the tested lockfile hash, are in
`docs/delivery/handbacks/DG6/T-DG6-DO-A-devops-engineer.md` and its evidence folder. That record is engineering
evidence. It is not a Mobily IT security approval.
