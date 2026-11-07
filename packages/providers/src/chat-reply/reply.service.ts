import type { StopReason, StreamEvent } from '@sheavly/core/message/message.types';
import type { TokenUsage } from '@sheavly/protocol/usage/usage.types';
import { ModelApiError } from '../errors/providers.errors.js';
import { parseToolArguments } from '../http/json.utils.js';
import type { ChatChunk, StreamingChatCall } from '../chat-completions/chat-completions.types.js';

/** Owns exactly one reply; incomplete tool arguments are never released for execution. */
export class ChatReply {
  readonly #calls = new Map<number, StreamingChatCall>();
  #thinking = '';
  #stopReason: StopReason | undefined;
  #usage: TokenUsage | undefined;

  keepChunk(chunk: ChatChunk): StreamEvent[] {
    const choice = chunk.choices.find((item) => item.index === 0);

    if (chunk.usage) {
      this.#usage = {
        inputTokens: chunk.usage.prompt_tokens,
        outputTokens: chunk.usage.completion_tokens,
        cacheReadTokens:
          chunk.usage.prompt_tokens_details?.cached_tokens ??
          chunk.usage.prompt_cache_hit_tokens ??
          0,
        cacheWriteTokens: 0,
      };
    }

    if (!choice) return [];

    if (choice.finish_reason === 'content_filter') {
      throw new ModelApiError({
        reason: 'failed',
        message: 'Chat Completions refused the response through its content filter',
      });
    }

    this.#thinking += choice.delta.reasoning_content ?? '';
    this.#keepCalls(choice.delta.tool_calls ?? []);

    if (choice.finish_reason) this.#stopReason = this.#reason(choice.finish_reason);

    return choice.delta.content ? [{ type: 'text_delta', text: choice.delta.content }] : [];
  }

  finish(params: { source: string; replayReasoning: boolean }): StreamEvent[] {
    if (!this.#stopReason) {
      throw new ModelApiError({
        reason: 'cut_off',
        message: 'Chat Completions stream ended before a finish reason',
      });
    }

    const events: StreamEvent[] = [];

    if (params.replayReasoning && this.#thinking) {
      events.push({
        type: 'reasoning',
        item: { source: params.source, data: { type: 'chat-reasoning', content: this.#thinking } },
      });
    }

    if (this.#stopReason === 'tool_use') {
      if (this.#calls.size === 0) {
        throw new ModelApiError({
          reason: 'bad_payload',
          message: 'Chat Completions finished with no tool calls',
        });
      }

      for (const [, call] of [...this.#calls].sort(([left], [right]) => left - right)) {
        if (!call.id || !call.name) {
          throw new ModelApiError({
            reason: 'bad_payload',
            message: 'Chat Completions returned an incomplete tool call',
          });
        }

        events.push({
          type: 'tool_call',
          call: { id: call.id, name: call.name, input: parseToolArguments(call.arguments) },
        });
      }
    }

    events.push({
      type: 'done',
      stopReason: this.#stopReason,
      ...(this.#usage && { usage: { tokens: this.#usage } }),
    });

    return events;
  }

  #keepCalls(deltas: NonNullable<ChatChunk['choices'][number]['delta']['tool_calls']>): void {
    for (const delta of deltas) {
      const call: StreamingChatCall = this.#calls.get(delta.index) ?? { name: '', arguments: '' };

      if (delta.id) call.id = delta.id;
      call.name += delta.function?.name ?? '';
      call.arguments += delta.function?.arguments ?? '';
      this.#calls.set(delta.index, call);
    }
  }

  #reason(reason: string): StopReason {
    if (reason === 'length') return 'max_tokens';
    if (reason === 'tool_calls') return 'tool_use';

    return 'end_turn';
  }
}
