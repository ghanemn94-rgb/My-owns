# @mth/config

**Responsibility.** The runtime configuration contract and loader (ADR-0011). `src/index.ts` lists every
environment variable (`ENV_VARS`) with whether it is required or secret, and its default. The loader (P1,
backend-workflow-engineer) validates `process.env` with zod at startup and exits with a clear message on
any error. It also refuses `AUTH_MODE=dev` when `NODE_ENV=production`, and supports `<NAME>_FILE` for
secrets mounted as files.

Secrets are never read from the repository, never logged, and never sent to the web client.
devops-engineer derives `.env.example` (no secret values) from `ENV_VARS`.
