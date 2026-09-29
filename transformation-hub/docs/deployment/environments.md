# Environments and promotion

| Environment | Purpose | Data | Identity | Mode | AI | Deployed with |
|---|---|---|---|---|---|---|
| dev (developer machine) | Build and debug | Synthetic Demo seed only | Demo-user picker (`HUB_MODE=demo`) | `NODE_ENV=development` | off / mock (labelled Simulated) | `pnpm dev` or `deploy/compose/compose.dev.yml` |
| ci | Automated verification | Synthetic, recreated per job | Demo / test IdP in integration tests | `test` / `development` | mock | GitHub Actions (`transformation-hub-ci.yml`) |
| test | Integration with Mobily services, load tests, restore drills | Synthetic; **never production data** | Mobily **test** IdP tenant/realm | `production` guard on, `standard` mode | off (or approved test endpoint) | Helm, separate namespace or cluster |
| staging | Release candidate, UAT, performance soak | Synthetic or approved anonymised data (Data Governance decision) | Mobily IdP (staging client) | `production`, `standard` | as production | Helm, same values as production except hosts and secrets |
| prod | Operation | Real data | Mobily IdP (production client, MFA) | `production`, `standard` | per approved mode | Helm, change-controlled |

## Separation rules

- **Separate** namespaces (preferably clusters) for test, staging and prod, each with its own PostgreSQL database, **roles and passwords**, bucket, OIDC client, TLS certificate and Secrets. Nothing is shared between prod and non-prod.
- **Never copy demo users or secrets to production.** The Demo seed refuses `NODE_ENV=production`. OIDC refuses demo users. The production bootstrap refuses a database containing demo users. Configuration validation rejects the development password, demo mode, mock AI, local storage and insecure cookies.
- **Never copy production data to lower environments** (C-35). Test data is synthetic. Any anonymised dataset needs a Data Governance decision and a DPIA check (MQ-19).
- Images are promoted **by digest** from test → staging → prod. They are not rebuilt per environment. The same digest that passed staging is deployed to production.
- Configuration differences live in per-environment values files in Mobily's configuration repository, reviewed like code.

## Transition to production (without demo data)

1. Provision a new database and roles (DBA), a bucket, the IdP client, the certificate and the Secrets for **prod**.
2. `helm upgrade --install` with the prod values. The migration Job creates the schema.
3. Run the production bootstrap once: organization, templates, platform schedules and the first administrator bound to the IdP. No passwords, no demo data ([installation.md](installation.md) §5).
4. The administrator provisions users and roles ([user-provisioning.md](user-provisioning.md)). Project setup follows the in-app wizard (spec §21): charter, perimeter, committee and delegation, baseline, confidentiality, AI mode.
5. Run the backup and a restore drill of the empty production database before go-live.
6. The go-live decision rests with Mobily's infrastructure, security and business owners. *Engineering verification complete* is not *production approval* (spec §22).
