import { modelEffortSchema } from '@sheavly/protocol/model/model.validator';
import { listModels, pickModel } from './chat.utils.js';
import type { ChatConversation } from './chat.types.js';

/** Lists available models or switches by unambiguous name or id, effective next model call. */
export async function runModelCommand(params: {
  conversation: ChatConversation;
  typed: string | undefined;
}): Promise<string> {
  const { conversation, typed } = params;
  const { model, models } = await conversation.details();

  if (models.length === 0) {
    return `Only ${model.adapter} / ${model.model} is set up in this profile: add another model to switch.`;
  }

  if (typed === undefined) return listModels({ choices: models, active: model.id });

  const picked = pickModel({ choices: models, typed });

  if (picked.kind === 'none') return `Unknown model ${typed}; /model lists them.`;

  if (picked.kind === 'ambiguous') {
    const same = listModels({ choices: picked.choices, active: model.id });

    return `${String(picked.choices.length)} models are called ${typed}; use an id:\n${same}`;
  }

  const { choice } = picked;

  if (!(await conversation.useModel(choice.id))) {
    return `Unknown model ${typed}; /model lists them.`;
  }

  const updated = await conversation.details();

  return `→ ${choice.name}: ${choice.adapter} / ${choice.model} · ${updated.model.effort ?? 'medium'}`;
}

/** Lists or changes reasoning effort for the selected model without switching its identity. */
export async function runEffortCommand(params: {
  conversation: ChatConversation;
  typed: string | undefined;
}): Promise<string> {
  const { conversation, typed } = params;
  const { model } = await conversation.details();

  if (typed === undefined) {
    return `${model.name} · ${model.effort ?? 'medium'}\nEfforts: low, medium, high, extreme`;
  }

  const effort = modelEffortSchema.safeParse(typed.toLowerCase());

  if (!effort.success) return 'Choose an effort: low, medium, high, extreme.';

  if (!(await conversation.useModel(model.id, effort.data))) {
    return 'The selected model is no longer available.';
  }

  return `→ ${model.name} · ${effort.data}`;
}
