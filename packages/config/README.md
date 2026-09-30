# @mth/config

**Responsibility.** The runtime configuration contract and loader (ADR-0011). `src/index.ts` lists every
environment variable (`ENV_VARS`) with whether it is required or secret, and its default. The loader (P1,
backend-workflow-engineer) validates `process.env` with zod at startup and exits with a clear message on
any error. It also refuses `AUTH_MODE=dev` when `NODE_ENV=production`, and supports `<NAME>_FILE` for
secrets mounted as files.

Usage: `loadConfig(service)` (`"api" | "worker" | "db-cli"`, in `src/load.ts`, re-exported from the package root)
returns a frozen, typed `AppConfig` or throws `ConfigError` listing every problem at once. Messages name variables,
never values. A variable is required for a service when its catalogue entry is `required` and lists that service in
`usedBy`; OIDC is all-or-nothing and mandatory for the API when `AUTH_MODE=oidc`; `http:` issuers are refused in
production. `NAME` and `NAME_FILE` together are an error.

Secrets are never read from the repository, never logged, and never sent to the web client.
devops-engineer derives `.env.example` (no secret values) from `ENV_VARS`.
