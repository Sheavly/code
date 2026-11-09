import type { Provider } from '@sheavly/core/provider/provider.types';
import type { Summarizer } from '@sheavly/core/summary/summary.types';
import { summarySectionIdSchema } from '@sheavly/protocol/message/message.validator';
import type { ModelUsage } from '@sheavly/protocol/usage/usage.types';
import { SummaryReplyError } from '../errors/summary.errors.js';
import { assertSectionIds } from '../sections/definition.utils.js';
import type { ModelSection, RuleSection } from '../sections/sections.types.js';
import { DEFAULT_MODEL_SECTIONS } from './model.constants.js';
import { parseSectionReply } from './model.validator.js';
import { summaryInstructions, summaryRequest } from './prompt.utils.js';

/**
 * A summarizer that has a model write the sections it is asked for, and rules write the rest
 * (the user's own messages, a trail of tool calls). The UI gives it a `Provider`, so a cheaper
 * model can write summaries than the one doing the work.
 *
 * The call sends its own short instructions and no tools (nothing runs), at temperature zero
 * where the provider accepts it. The history is given as data with a rule never to follow it,
 * and the previous checkpoint is given to be updated, not regenerated. A section the model leaves
 * out keeps its previous text. The call's usage is returned for the loop to report.
 *
 * `redact` hides credential forms in the history before it is sent, and in every section before it
 * is stored (the model's, since it may restate a secret it was shown, and the rules', which copy
 * what the user typed). The app supplies it because it knows its own credential forms.
 *
 * Throws a `SummaryDefinitionError` for no sections or a repeated section id. `summarize` throws a
 * `SummaryReplyError` when the reply cannot be used, which the loop reports as a failed summary.
 */
export function modelSummarizer(params: {
  provider: Provider;
  redact: (text: string) => string;
  name?: string;
  sections?: readonly ModelSection[];
  ruleSections?: readonly RuleSection[];
}): Summarizer {
  const {
    provider,
    redact,
    name = 'model',
    sections = DEFAULT_MODEL_SECTIONS,
    ruleSections = [],
  } = params;

  assertSectionIds({
    summarizer: name,
    ids: [...sections, ...ruleSections].map((section) => section.id),
  });

  const instructions = summaryInstructions(sections);

  return {
    name,
    summarize: async ({ messages, previous, signal }) => {
      const before = (id: string) => previous?.sections.find((section) => section.id === id)?.body;
      const modelText =
        sections.length > 0
          ? await askModel({
              provider,
              name,
              signal,
              instructions,
              request: summaryRequest({ previous, messages, redact }),
              sections,
            })
          : { written: new Map<string, string>(), usage: undefined };

      const modelWritten = sections.flatMap(({ id, title }) => {
        const written = modelText.written.get(id);
        const body = written === undefined ? before(id) : redact(written);

        return body ? [{ id: summarySectionIdSchema.parse(id), title, body }] : [];
      });
      const ruleWritten = ruleSections.flatMap((rule) => {
        // A rule copies what the user typed or a tool was called with, so it is redacted too.
        const body = redact(rule.write({ messages, previous: before(rule.id) }));

        return body ? [{ id: summarySectionIdSchema.parse(rule.id), title: rule.title, body }] : [];
      });

      return { sections: [...modelWritten, ...ruleWritten], usage: modelText.usage };
    },
  };
}

/** One summary call: streams the reply to the end, and returns the parsed sections and usage. */
async function askModel(params: {
  provider: Provider;
  name: string;
  signal: AbortSignal;
  instructions: string;
  request: string;
  sections: readonly ModelSection[];
}): Promise<{ written: Map<string, string>; usage: ModelUsage | undefined }> {
  const { provider, name, signal, instructions, request, sections } = params;
  let reply = '';
  let usage: ModelUsage | undefined;
  let stopReason: string | undefined;

  for await (const event of provider.stream({
    instructions,
    messages: [{ role: 'user', content: request }],
    tools: [],
    temperature: 0,
    signal,
  })) {
    if (event.type === 'text_delta') reply += event.text;

    if (event.type === 'done') {
      usage = event.usage;
      stopReason = event.stopReason;
    }
  }

  // A reply cut off at the output limit is half a JSON object: refuse it, never repair it.
  if (stopReason !== 'end_turn') {
    throw new SummaryReplyError({
      summarizer: name,
      problem: `it ended with ${stopReason ?? 'no stop reason'}, not a finished reply`,
    });
  }

  return { written: parseSectionReply({ summarizer: name, reply, sections }), usage };
}
