# Prompt caching

How each backend caches a prompt, what a request must send, what the usage reports, and what it means for the provider contract. Read on 2026-11-10; vendors change these pages, so re-read before relying on a number.

The contract side (the prefix rules every adapter follows, `ProviderRequest.cacheKey`) is in [@sheavly/core's providers.md](../../core/docs/providers.md#prompt-caching). Cache read and write tokens already arrive in the `usage` events (`ModelUsage`), so no backend below needs a new event.

## What the harness sends

| Backend                                    | Sent today                                                                                                                                                        |
| ------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Messages (`azure-anthropic`, any Messages) | Top-level `cache_control: {type: "ephemeral"}`, plus a block-level marker on the last history block when notices follow it. `promptCaching: false` turns both off |
| Responses (`openai`, `azure-openai`)       | `prompt_cache_key` = `ProviderRequest.cacheKey` (the session id). With `explicitCache: true`, also explicit-only `prompt_cache_options` and history breakpoints   |
| Chat Completions (`azure-chat`)            | No cache controls; maps cache reads when the backend reports them in `usage`                                                                                      |

Caching keeps processed prompt prefixes at the provider for minutes to hours (see each backend below), and the Messages request sends `cache_control` unless `promptCaching` is `false`. A deployment under a zero-retention agreement, or one that rejects the field with a 400 (the legacy Bedrock integration for Opus 4.6 and earlier), sets `promptCaching: false`. The session id sent as the Responses `prompt_cache_key` is a random UUID, never derived from a path, title or prompt.

A session is one cache scope: the main session and each sub-agent have their own key. Anthropic matches on content, so sub-agents with an identical prefix share entries whatever the key.

## Backends

### Anthropic Messages, and Azure Claude (Foundry)

[Docs](https://platform.claude.com/docs/en/build-with-claude/prompt-caching), [Foundry](https://learn.microsoft.com/en-us/azure/foundry/foundry-models/concepts/claude-models). Read 2026-11-10.

- Opt-in. A top-level `cache_control` caches everything up to the last cacheable block and moves forward as the conversation grows. Block-level `cache_control` is explicit (up to 4 breakpoints). The cached prefix is `tools`, then `system`, then `messages`.
- Default lifetime 5 minutes, refreshed by each read at no cost, measured from the start of the request; `ttl: "1h"` costs more to write. Minimum prefix depends on the model (Bedrock's table lists 512 to 4,096 tokens); a shorter prompt is silently not cached, so the check is cache read tokens above zero.
- Foundry lists prompt caching as stable on Microsoft Foundry. The starting finding that it only works on the native `/anthropic/v1/messages` endpoint, not on Foundry's Responses surface, was not re-verified in this pass.
- Usage: `cache_read_input_tokens`, `cache_creation_input_tokens` (already mapped).
- Contract impact: none. A per-request `ttl` option would be an adapter option, not a contract change.
- Not verified: whether the top-level field still reuses earlier blocks when the final block changes. The adapter avoids relying on it by marking the last history block, so notices after it never end the cached prefix.

#### Signed-thinking replay and transient notices

Prompt-cache reuse and signed-thinking replay are separate mechanisms. On models with preserved
thinking (Sonnet 5.5, Opus 5.5 and later) a thinking block's signature covers `system`, `tools`
and every earlier message, and the API may refuse a block whose prefix changed (400) or let it
through and bill it. Anthropic's rule is append-only: anything the caller adds to a request is
stored with its message and sent again in the same place
([preserved thinking](https://platform.claude.com/docs/en/build-with-claude/preserved-thinking)).

A transient notice (`context-usage`, `running-tasks`) rides one call, so the reply made on that
call is signed over a prefix that includes it. Messages therefore stores, in the reply's replay
state, the notice text blocks its request carried (`notices`) next to the prefix hash covering
them. When it rebuilds history it puts those blocks back at the end of the user message before
that reply, checks the hash, and replays the thinking. The current call's own notices are then
appended after all history, as before. Stored history is not changed: the notice text lives only
in the opaque replay state. Cache breakpoints stay on the last history block, so the current
notice never ends a cached prefix.

A reply whose hash still fails (instructions, tools or an earlier message changed, or its thinking carries a source tag that
does not match the current endpoint and model) keeps its text and tool calls and loses its thinking, reported as
`prefix_changed`. Removing a thinking block changes the prefix of later replies, so those fail
too. Earlier replies that still match remain replayable.

**Cost of the choice.** Every earlier notice stays in the request, so the model reads one
`context-usage` line per earlier call, about 60 tokens each, cacheable like the rest of history.
A transient notice is therefore no longer transient to the model, only to stored history and the
UI. Responses and Chat Completions have no analogous signature check and are unchanged.

**Measured** (Sonnet 5.5, `thinking-replay` workbook check, `--effort high`, a `context-usage`
notice on every call; one run each unless stated):

| Version                     | Calls | Thinking blocks per reply | Calls with a drop | Output tokens | Time   |
| --------------------------- | ----- | ------------------------- | ----------------- | ------------- | ------ |
| Notices dropped (two runs)  | 4     | 0/0/2/1                   | 1 of 4, both runs | 965, 1,000    | 10-11s |
| Notices replayed (one run)  | 4     | 0/0/2/0                   | 0 of 4            | 783           | 9.6s   |
| Notices dropped (`extreme`) | 4+    | 1/2/2/2                   | 0, 1, 2, 3, 4     | 6,013 over 4  | 42s    |

The drop count grows with each reply that carried thinking, which is what the rule predicts.
Cache reads were the same size either way, so caching did not drive the difference. The "after"
row is a single run, and its last reply happened to carry no thinking, so it shows the drop gone
but does not price it: output tokens differ by 180 to 220 between versions against a run-to-run
spread near 35 for the same version, which is suggestive and not a measurement of savings. A
fuller comparison needs repeated runs at `high` and `extreme` on both versions.

Fake-network regressions verify serialization and these local prefix decisions, not server cache
hits, billing or model quality.

### Azure OpenAI and OpenAI Responses

[Azure](https://learn.microsoft.com/en-us/azure/foundry/openai/how-to/prompt-caching), [OpenAI](https://developers.openai.com/api/docs/guides/prompt-caching). Read 2026-11-10.

- Automatic. The whole rendered prefix (instructions, tools, history) must match; a changed `tools` or `reasoning.effort` setting changes it.
- `prompt_cache_key` improves matching for related requests. Beyond about 15 requests a minute for one prefix and key, some requests may miss; Azure advises spreading higher volume over several keys with a stable mapping.
- GPT-5.6 and later add `prompt_cache_options` (`mode`, `ttl`) and `prompt_cache_breakpoint` on input blocks, and charge for cache writes. Models before it reject those parameters.
- Usage: `input_tokens_details.cached_tokens` (cache reads, a subset of input) and `cache_write_tokens` (cache writes, also a subset). A missing write count is 0, so older backends keep working; a negative or non-integer count, or reads plus writes exceeding total input, is rejected.
- Implicit mode ends its write at the latest user message or tool result. The harness sends transient notices as a last user message that the next request no longer contains, so that write could never be matched again.
- `explicitCache` (config of `openai` and `azure-openai`, default `true`; set `false` for models before GPT-5.6): sends `prompt_cache_options: {mode: "explicit"}` and marks up to four retained user messages and tool results with `prompt_cache_breakpoint`, which is the limit of cache writes per request. The boundary before the latest tool-call turn stays marked for lookup even when four or more parallel results would otherwise replace every earlier marker; remaining slots mark the latest results. Notices follow the last breakpoint, so they are never written, and the previous request's boundary stays marked on the next. User and tool content is sent as `input_text` blocks (tool results inside `function_call_output.output`) so a message does not change form when it stops being the boundary. Stored history is not changed.
- It is on by default, for GPT-5.6 or later models (such as GPT-6.1 Sol). It is never guessed from a model or deployment name, which Azure lets you choose freely; a model before GPT-5.6 rejects the fields with a 400, so leave it off there. A prefix under the minimum cacheable length (1,024 tokens) is not cached.
- A saved definition without `explicitCache` gets the adapter default, `true`, everywhere: conversations, connection checks and setup forms. Deployments that don't support it must set `explicitCache: false` themselves. See [backend models and keys](../../../apps/backend/docs/harness.md#models-and-keys).
- Azure supports breakpoints on Standard pay-as-you-go deployments of GPT-5.6 and later. On provisioned (PTU-M) deployments only GPT-6 and newer do, so leave `explicitCache` off for a provisioned GPT-5.6 deployment. Azure reports `cache_write_tokens` on Standard deployments.
- A prompt over 272K input tokens is billed at 2x the input and cache rates and 1.5x the output rate for the whole request on OpenAI. The model's configured pricing is flat, so `estimatedCostUsd` understates those calls.
- Cost: writes cost 1.25x the ordinary input rate at the default 30-minute lifetime; reads cost 0.1x (0.05x on Sol and Terra). `pricedProvider` charges each input token once at the ordinary, read or write rate.
- Contract impact: none. The adapter marks the end of the retained history itself, as the Messages adapter does.

### Chat Completions backends (DeepSeek, Azure chat)

[DeepSeek](https://api-docs.deepseek.com/guides/kv_cache/), [Azure inference transport](https://learn.microsoft.com/en-us/python/api/azure-ai-inference/azure.ai.inference.chatcompletionsclient?view=azure-python-preview).

- Upstream DeepSeek's disk cache is automatic, enabled by default and best effort. It matches a request's start against persisted prefix units (the end of the user input, the end of the output, detected common prefixes and fixed token intervals). A request must fully match a unit to hit, so retained history must stay byte-identical. Construction takes seconds; reuse is not guaranteed.
- Chat sends no artificial `cache_control`, cache key or cache breakpoints. Stable instructions, tools and retained history precede transient notices. Changing a notice changes the end of the request, not that retained prefix. Fake multi-tool and subsequent-user-turn tests verify those serialized bytes and history isolation; they do not prove the server persisted a reusable unit before the notice.
- Usage: `prompt_cache_hit_tokens` is cache reads; `prompt_cache_miss_tokens` is uncached input, **not cache writes**. The optional `prompt_tokens_details.cached_tokens` is an alternative or duplicate read count, and wins when both appear; reads are counted once as a subset of `prompt_tokens`. All reported counts must be nonnegative integers. A reported read or miss count cannot exceed `prompt_tokens`. Beyond that bound, a provider whose own counts disagree keeps its reply and misses are derived here as input minus reads, so inconsistent telemetry never costs an answer that already streamed.
- Final usage retains total input and output, maps reads, and reports zero cache writes: misses do not measure cache creation. Missing cache fields, a null read or miss count, empty or null optional token details and absent or null usage leave usage unreported; a null count is unreported, not a measured zero. A default read count of zero is not evidence that caching was measured or unavailable; absent usage stays absent.
- The shared protocol needs no miss field: uncached input is total input minus reads, and no write measurement is available. `cacheKey` is ignored.
- These are upstream DeepSeek semantics and offline adapter accounting checks, not a claim that every Foundry deployment returns those fields, uses the same cache persistence rules, or charges upstream rates. One paid check on `DeepSeek-V4.1-Flash-1017` (eight capped requests, at most 512 output tokens each) saw cache reads on repeated and extended prefixes with zero writes; it did not measure billing, other deployments, or the upstream cache's persistence rules.

### Amazon Bedrock

[Docs](https://docs.aws.amazon.com/bedrock/latest/userguide/prompt-caching.html). Read 2026-11-10.

- Two kinds: implicit (best effort, no request change) and explicit (model-specific markers). Converse and ConverseStream take a standalone `cachePoint` in `system`, `messages` and `tools`; InvokeModel for Claude takes `cache_control`; OpenAI models on Bedrock take `prompt_cache_breakpoint` on the Responses, Chat Completions and InvokeModel APIs, and Converse does not support explicit caching for them.
- Up to 4 checkpoints per request for the models listed; minimums 512 to 4,096 tokens by model; TTL 5 minutes or 1 hour for Claude, 30 minutes for the OpenAI models listed. An entry lives on the server that handled the request, so a request sent before an identical one has started responding writes a new entry instead of reading one.
- Usage reports tokens read from and written to the cache.
- What the built-in adapters send ([Models on Amazon Bedrock](backends.md#models-on-amazon-bedrock)): `bedrock-anthropic` is the Messages protocol, so it sends the top-level `cache_control` unless `promptCaching` is `false`, and ends the prefix before `notices` as `anthropic-messages/cache-breakpoint.utils.ts` does. Bedrock accepts the top-level field only for the models its caching page lists (Haiku 4.5, Sonnet 4.6, Opus 4.7, 4.8, 5 and 5.5, Sonnet 5 and 5.5, Haiku 5.5); another model answers `ValidationException`, so set `promptCaching: false` for it. `bedrock-openai` is the Responses protocol and sends the explicit breakpoints of `explicitCache` (on by default; 30 minutes, at least 1,024 tokens, GPT-6 and later), and nothing in `ProviderRequest` changes. Neither adapter sends `cachePoint`: that belongs to Converse, which is not implemented.

### Vertex AI and Gemini

[Docs](https://docs.cloud.google.com/gemini-enterprise-agent-platform/models/context-cache/context-cache-overview). Read 2026-11-10.

- Implicit caching is on by default (90% off cached tokens, in-memory and durable tiers, an entry lives at most 24 hours). Keep common content first and send similar requests close together.
- Explicit caching creates a cache object with a TTL that later requests reference, with a storage charge. Usage is `cachedContentTokenCount`, for both kinds.
- Contract impact: implicit needs nothing. Explicit caches are created and referenced by name, which does not fit "mark the request"; it would need a provider-side lifecycle (create, refresh, delete) and probably a way to know when history was summarized. Not needed until a Gemini adapter wants it. **Follow-up: decide it in the Gemini adapter issue.**

### OpenRouter and other gateways

[Docs](https://openrouter.ai/docs/guides/best-practices/prompt-caching). Read 2026-11-10.

- Most upstreams cache automatically; Anthropic and some Qwen routes need `cache_control` on content blocks. Sticky routing keeps repeat requests on the same upstream provider, for 60 minutes of inactivity.
- A `session_id` (body field or `x-session-id` header, up to 256 characters) is used directly as the sticky key; without one, `prompt_cache_key` is the fallback, otherwise a hash of the opening messages.
- Usage: `prompt_tokens_details.cached_tokens` and `cache_write_tokens`.
- Contract impact: `cacheKey` maps directly to `session_id`, which is the case it was shaped for. A gateway adapter sends it and applies the Messages or Responses rules per upstream.

## Recommendation

1. Keep `cacheKey` as the one contract field: it says which calls belong together and never what to cache. Every router and gateway above takes such a key; backends that match on content ignore it.
2. Do not add marker positions or cache objects to `ProviderRequest`. The one position that matters, the end of the stable prefix, is the start of `notices`, which an adapter already knows.
3. Keep caching opt-out per adapter (`promptCaching` on Messages), because a backend can reject the field (the legacy Bedrock integration for Opus 4.6 and earlier, from the issue's starting findings).
4. Check that it works from usage, not from the request: cache read tokens above zero on the second turn.

## Follow-ups

Not opened yet; each needs an issue before the adapter it belongs to:

- Bedrock over Converse (`cachePoint`) or InvokeModel, for models that speak neither Messages nor Responses.
- Gemini adapter: implicit now, explicit cache lifecycle only if needed.
- Optional 1-hour TTL for Messages, and a 12-hour `ttl` for Responses, if idle gaps over the default lifetime show up in real runs.
- Measure live reuse on Sol with consecutive tool turns (cache reads and writes in `usage`). It needs paid calls, so it has not been run.
