# OpenAI Market Usage Guard

Date: 17 Jul 2026
Status: Approved — option A

## Goal

Reduce OpenAI token and web-search consumption without changing portfolio
accounting, historical entry prices, units, or the shared PostgreSQL authority.

## Request policy

Each eligible manual refresh sends all four market keys in one Responses API
request using the configured GPT-5.6 model, `reasoning.effort: none`, low web
search context, `max_output_tokens: 300`, and `max_tool_calls: 2`. The response
remains strict JSON with auditable source links. Missing keys are not retried
automatically; their last successful PostgreSQL values remain visible.

## Shared cooldown

Before calling OpenAI, the server asks PostgreSQL for the most recently saved
quotes. If any successful quote was saved less than five minutes ago, the route
returns the merged persisted quote set with `cooldownActive: true`. The browser
states clearly that no additional OpenAI request was made.

## Observability and privacy

For each completed OpenAI response, Railway receives one structured log entry
containing model, input tokens, cached input tokens, output tokens, reasoning
tokens, total tokens, and web-search call count. Logs never include the API key,
prompt, portfolio holdings, prices, or personal data.

## Verification

Tests must prove the bounded request payload, one-request partial-failure
behavior, persisted cooldown short circuit, retained prior quotes, transparent
dashboard status, and secret-free usage log. Production validation must confirm
one real refresh followed by one cooldown hit without a second usage log.
