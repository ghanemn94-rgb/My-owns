# Private / offline mode (AT-22)

Goal: when external egress and LLM access are disabled, **no unapproved external traffic** occurs, while assets,
fonts and core functions keep working internally.

## Controls

| Layer | Control | Where | Status |
|---|---|---|---|
| Network | Default-deny NetworkPolicy for all release pods. Egress only to DB, object storage, IdP (api), OTEL collector, proxy, and the approved AI endpoint (worker, opt-in). Fail closed when a CIDR is missing | `templates/networkpolicy.yaml` | Rendered and validated (kubeconform, invariants). **Not applied to a cluster** |
| Application | `HUB_PRIVATE_MODE=true`; `HUB_EGRESS_ALLOWLIST` host allowlist for the in-app HTTP guard (C-18) | config.ts, chart `app.egressAllowlist` | Configured by the chart |
| AI | Default mode **off**; mock refused in production; AI egress only in the Local-AI / Gateway overlays | `values-private-*.yaml` | Validated per mode (AI-off renders no AI env and no AI rule) |
| Web assets | Fonts bundled from `@fontsource` (`url(../media/*.woff2)`); no CDN; CSP `connect-src 'self'`, `font-src 'self' data:` | apps/web | Verified in the build output (below) |
| Telemetry | `NEXT_TELEMETRY_DISABLED=1` at build and run time (web scripts, Dockerfiles, chart, compose); OTEL only to an **internal** collector (SDK not wired yet); MinIO `MINIO_UPDATE=off` | Dockerfiles, chart, compose | Configured |
| Dev stack | Compose `backend` network `internal: true`: db, migrate, worker and MinIO have no outbound route | compose.dev.yml | `docker compose config` PASS; not run |
| Proxy | If a corporate proxy is mandatory, Node needs `NODE_USE_ENV_PROXY=1` (verified: Node 22.22.2 ignores `HTTPS_PROXY` for `fetch` without it) | chart `proxy.*` | Configured |

## Static check of built artefacts — `scripts/ops/egress-check.sh`

The script scans the shipped web build (`apps/web/.next`: static assets, server output, standalone server; not the
build cache) and the API `dist` for absolute `http(s)://` URLs outside an allowlist. Allowlisted entries are
reference-only strings: XML/SVG namespaces, JSON-Schema ids, React/Next error-doc links, loopback and reserved
example domains, plus `HUB_EGRESS_ALLOWLIST` and `--allow` hosts.

Severity:

- **FAIL:** browser-fetchable references — CSS `url()`/`@import`, `src`/`srcset`, `<link>` elements including compiled JSX `("link",{href})` — and any URL in compiled API code.
- **WARN:** other strings in JS, such as documentation links in error messages. These are for review.

Results in the build environment (executed):

| Target | Result |
|---|---|
| `apps/api/dist` (109 files, after merging 5d0dd09) | **0 FAIL, 0 WARN** — no absolute URLs in compiled API code |
| Fresh web build from this branch (`next build`, standalone; 1 CSS, 12 HTML/RSC, 647 JS/JSON files) | **0 FAIL, 26 WARN**: `http://hub-api` (in-cluster rewrite target, allowed with `--allow hub-api`), github.com licence/issue links, `preview.nextjs.org` docs link in a dev-inspector page, datatracker.ietf.org, and regex fragments (`https://a`, `http://n`). With `--allow hub-api` (as in CI): 0 FAIL, 20 WARN |
| Positive control (fixture with a Google Fonts `<link>`, a `@font-face url(https://fonts.gstatic.com/…)`, a `preconnect` to a CDN and a tracking-pixel `src`) | **4 FAIL, 1 WARN** — all four fetchable references detected; the plain `<a href>` reported as WARN |

CI runs the same check after `next build` (job `web`).

## Runtime proof still required (in a Mobily test environment)

These steps are **not executed** — they need a cluster:

1. Deploy with `values-private-ai-off.yaml` and NetworkPolicies enabled.
2. From an api pod, try a non-allowlisted host (for example `node -e "fetch('https://example.com').then(r=>console.log(r.status))"`). Expect a timeout or refusal. Repeat from the worker.
3. Run the core journeys (AT-30 flow, committee, reports) with a browser HAR recording. Expect **same-origin requests only**.
4. Confirm deterministic reporting works with AI off (AT-21), and that the proxy or firewall logs show no attempts to public hosts.
5. Record the evidence (HAR, logs, commands) for SEC-T-19.
