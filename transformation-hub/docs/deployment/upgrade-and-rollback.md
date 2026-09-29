# Upgrade and rollback

## Principles

- **Migrations are forward-only.** Drizzle SQL migrations (`packages/db/migrations`) are applied by the owner role in the pre-upgrade migration Job, followed by the idempotent `post-migrate.sql` (RLS, grants, triggers). There are **no down-migrations**. Recovery from a bad schema change is a *roll-forward* fix, or a restore.
- **Expand/contract.** A release may only make schema changes that the **previous** application version tolerates: additive tables and columns, new nullable columns, new indexes created concurrently where large. Destructive changes (drop or rename a column, tighten a constraint) ship in a **later** release, after no running version uses the old shape. This is what makes an application-only rollback safe.
- **One image version** runs api, worker, migration and bootstrap. Always deploy by **digest**.

## Standard upgrade

1. **Pre-checks.**
   - Read the release notes and the list of new migrations: `git diff <old>..<new> -- packages/db/migrations`.
   - Confirm the images are mirrored, scanned and signed-off ([supply-chain.md](supply-chain.md)).
   - Run `bash scripts/ops/validate-deploy.sh` with the environment values.
2. **Backup** immediately before: `scripts/ops/backup.sh --label pre-upgrade-<version>`, and confirm `SHA256SUMS`. For large databases, a platform snapshot/PITR marker as well.
3. **Upgrade:**
   ```bash
   helm upgrade hub deploy/helm/transformation-hub -n <ns> -f values-prod-inputs.yaml -f <mode overlay> \
     --set image.api.digest=sha256:… --set image.web.digest=sha256:… --wait --timeout 15m
   ```
   - The `pre-upgrade` hook runs the migration Job first. **If it fails, Helm stops before any Deployment changes**, so the old pods keep serving the old schema.
   - Rolling updates use `maxUnavailable: 0`, and the PDBs keep at least one pod during node drains.
4. **Verify.**
   - Readiness is green.
   - `healthcheck` exits 0.
   - Sign-in works.
   - Background jobs are processing (worker logs; the queue view).
   - The audit chain verifies (`audit.chain.verify`).
5. **Record** the change: versions, digests, migration hashes, duration and the operator.

## Rollback decision tree

| Situation | Action |
|---|---|
| Migration Job failed | Nothing rolled out. Read the Job logs. A failed migration is transactional, so the schema is unchanged — unless it contained non-transactional DDL such as `CREATE INDEX CONCURRENTLY`; check `drizzle.__drizzle_migrations`. Fix forward and re-run |
| New pods fail readiness | `helm rollback hub <previous revision>`. The rollback returns the **application** to the previous image. The schema stays at the new version, which is safe under expand/contract |
| Application bug after a successful rollout, schema expand-only | `helm rollback` (application only) or roll forward with a fix |
| Data-corrupting defect or destructive migration | Stop writers (scale api/worker to 0) and assess. **Restore** the pre-upgrade backup into a new database ([backup-restore.md](backup-restore.md)), including quiesce and reconciliation. Then deploy the previous version against it. Changes made after the backup point must be re-entered |
| Security incident | Follow `docs/security/incident-response-runbook.md` first (containment, forensic snapshot), then this table |

`helm rollback` does not run the migration hook backwards. Hooks run `pre-upgrade` only for upgrades, and a rollback
re-applies the previous manifests. No database change happens during a rollback.

## Platform upgrades

| Component | Procedure |
|---|---|
| Node.js base image | Rebuild both images on the new mirrored digest (22.x LTS). Full CI, then staging soak |
| PostgreSQL minor | DBA rolling or failover. The app reconnects: the pool retries and `/readyz` reports unready while the DB is unavailable |
| PostgreSQL major | `pg_upgrade` or dump/restore by the DBA. Afterwards, run `restore.sh` verification-style checks (row counts, `hub_audit_verify`, RLS as `hub_app`) |
| Kubernetes/OpenShift | Validate the chart against the target version first: `KUBE_VERSION=<new> bash scripts/ops/validate-deploy.sh` |
| Framework majors (NestJS 12 ESM, TypeScript 7) | Planned engineering work (ADR-0002). Not an operations-only change |

Nothing in this document was executed against a cluster in the build environment. The migration command itself
(`hub-entrypoint migrate`) was executed locally against scratch PostgreSQL 16 databases.
