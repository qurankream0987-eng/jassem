---
name: Replit AI model gateway
description: How the canonical runtime uses Replit AI Integrations through its OpenAI-compatible model gateway.
---

When Replit AI Integration supplies `AI_INTEGRATIONS_OPENAI_*` credentials, treat it as the runtime's OpenAI-compatible provider and use a current GPT model. For the configured current GPT family, send `max_completion_tokens` and omit `temperature`; legacy `max_tokens` and an explicit temperature are rejected by the provider.

**Why:** The Runtime Model Gateway is responsible for producing a schema-validated proposal. Provider-side parameter rejection otherwise turns a valid chat turn into an explicit precondition failure, despite the runtime and persistence layers being healthy.

**How to apply:** Preserve explicit `MODEL_GATEWAY_*` configuration as the higher-priority override. Apply the Replit-specific request shape only to the OpenAI-compatible path; do not alter Anthropic, Gemini, or direct OpenAI request contracts without provider evidence.