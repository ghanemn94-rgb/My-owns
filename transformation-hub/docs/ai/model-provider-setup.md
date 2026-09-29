# AI runtime — model provider setup (spec §16, ADR-0009)

## Status in this build

| Provider | Status | What exists |
|---|---|---|
| `off` | Implemented (default for every project) | no provider calls |
| `mock` | **Simulated** — Implemented and Tested | local deterministic scripts: `mock-benign` (default), `mock-hostile` and `mock-down` (evaluation only, refused in production); every output is labelled Simulated |
| `openai_compatible` | **Not configured** — adapter Implemented, never contacted | chat-completions request with a JSON reply contract; request/response shape tested only against a stubbed `fetch` |
| `anthropic` | **Not configured** — adapter Implemented, never contacted | Messages API (`POST {gateway}/v1/messages`, `anthropic-version: 2023-06-01`) behind an approved enterprise gateway only; refusal stop reason handled; tested only against a stubbed `fetch` |

No real model has been run in this environment. Nothing here claims equivalence between a local model and any other
model; quality, latency and resource use must be measured in an approved environment (spec §16).

## Configuration (environment)

| Variable | Purpose |
|---|---|
| `HUB_AI_ALLOW_MOCK` | `true` in dev/test/demo; production configuration refuses `true` (platform config) |
| `HUB_EGRESS_ALLOWLIST` | comma-separated hosts the platform may call; a provider host must be listed (exact host or `.suffix`) |
| `HUB_AI_OPENAI_BASE_URL` / `HUB_AI_OPENAI_API_KEY` | licensed local / self-hosted OpenAI-compatible endpoint (e.g. `https://llm.internal/v1`) and optional bearer token |
| `HUB_AI_ANTHROPIC_GATEWAY_URL` / `HUB_AI_ANTHROPIC_API_KEY` | APPROVED enterprise gateway in front of the Anthropic API; key only if the gateway does not inject credentials |

Secrets come from the secret store / environment, never from the database or source control, and are never returned by
the API or logged.

## Enabling a provider for a project

1. Platform: set the endpoint variables and add the host to `HUB_EGRESS_ALLOWLIST` (change-controlled; MQ-06/MQ-07).
2. Project: a holder of `ai.settings.manage` sets `provider`, `model`, `maxClassificationToProvider` (≤ the provider's
   hard maximum: external gateway `internal`, local `restricted`), `monthlyTokenBudget` (required), `perRunTokenLimit`,
   `perRunTimeoutMs`, quiet hours. Enabling defaults to Advisory. Saving refuses unconfigured providers
   (`ai.provider_not_configured`) and non-allowlisted hosts (`EGRESS_NOT_APPROVED`).
3. At run time the gateway re-checks the allowlist before any network call (`AI_EGRESS_BLOCKED`).
4. `GET …/ai/status` shows `configured_unverified` until an operator has verified the endpoint; the UI must never show
   "connected" for the mock.

Default Anthropic model when none is set: `claude-opus-5-5` (cost estimates use indicative list prices; billing comes
from the gateway). The adapter uses raw HTTP because adding `@anthropic-ai/sdk` changes the lockfile (lead-owned); once a
gateway is approved, switching to the official SDK with `baseURL` = gateway URL is recommended.

## Provider contract

`ModelProvider.generate(request, signal)` receives: task, locale, question, context items (untrusted-data envelopes
with source type/id/version/location/title and a warning for instruction-like text), missing-input keys, the list of
propose tools the model may request, max output tokens and model name. It returns claims
(`{text, kind, citations[{type,id}]}`), tool calls and token usage. The system prompt asks for JSON and states that
sources are data, but **the prompt is not the security boundary**: containment is enforced by the runtime.
