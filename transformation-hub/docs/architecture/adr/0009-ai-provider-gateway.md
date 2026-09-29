# ADR-0009 — AI model providers behind a policy gateway; platform works with AI off

- Status: Accepted · Date: 2026-09-29
- Requirements: spec §12, §16 (Model Provider interface; no assumption that Claude weights can be hosted), AT-21, AT-22

## Decision
`ModelProvider` interface with adapters: `off`, `mock` (deterministic, always labelled **Simulated**),
`openai_compatible` (for a licensed local/self-hosted model endpoint), `anthropic` (only via an approved enterprise
gateway/endpoint). Every call passes the `AiPolicyGateway`: mode check, kill switch, budget/circuit breaker,
classification ceiling per project (`max_classification_to_provider`), destination allowlist, and redaction. Provider
failures or budget exhaustion degrade only AI features. Default mode per project is `off`.
The Claude Code subscription used to build this software is unrelated to production inference, licensing and cost.
