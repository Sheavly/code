import { appendFileSync } from 'node:fs';
import { homedir } from 'node:os';
import type { ProviderRequest } from '@sheavly/core/provider/provider.types';
import type { LiveConversation } from '@sheavly/host/conversations/conversations.types';
import type { Message } from '@sheavly/protocol/message/message.types';
import { findSkills } from '@sheavly/workspace/skills/skills.helper';
import { terminalConversation } from './conversation.helper.js';
import { createTerminalHarness } from './harness.helper.js';
import type { ProviderSettings, ServedSettings } from './harness.types.js';
import { describeModelCall, modelCallLine } from './model-calls.utils.js';
import { now } from '@sheavly/core/clock/clock.helper';
import { skillsNotice } from './notices.utils.js';
import { providerFromEnv, trustStoreFromEnv } from './settings.helper.js';

/**
 * One conversation as the backend serves it: its own provider from `env` (so switching its model
 * leaves the others alone), the terminal harness on the settings, and the run it reports (the UI
 * shows its trust from that). Skills that didn't load go to `log`, and each model call to
 * `MODEL_CALLS_FILE` and, with SHOW_MODEL_CALLS, to `log`.
 */
export async function servedConversation(params: {
  env: NodeJS.ProcessEnv;
  settings: ServedSettings;
  messages?: Message[] | undefined;
  log: (text: string) => void;
}): Promise<LiveConversation> {
  const { env, settings, messages, log } = params;
  const providerSettings = providerFromEnv(env);
  const harness = await createTerminalHarness({
    provider: providerSettings.provider,
    workspaceRoot: settings.workspaceRoot,
    skipAllowList: settings.skipAllowList,
    title: 'Conversation',
    trustStore: trustStoreFromEnv(env),
    env,
    trustWorkspace: settings.trustWorkspace,
    home: homedir(),
    onModelCall: modelCallsTo({ settings, log }),
  });
  const skills = skillsNotice(await findSkills(harness.skills));

  if (skills) log(`${skills}\n`);

  return {
    ...terminalConversation({
      harness,
      messages,
      maxTurns: settings.maxTurns,
      waitForTasks: settings.waitForTasks,
    }),
    run: {
      details: () => ({
        workspace: harness.workspace.root,
        ...modelsOf(providerSettings),
        projectTrust: harness.projectTrust,
        skipAllowList: settings.skipAllowList,
      }),
      useModel: (name) => useModel({ providerSettings, name }),
    },
  };
}

/** Where each model call goes: the file, and the log with SHOW_MODEL_CALLS. Undefined for neither. */
function modelCallsTo(params: { settings: ServedSettings; log: (text: string) => void }) {
  const { settings, log } = params;
  const { modelCallsFile: file, showModelCalls: show } = settings;

  if (!file && !show) return undefined;

  return (request: ProviderRequest) => {
    // Appended as it happens, so a run that dies mid-way still has every call up to there.
    if (file) appendFileSync(file, modelCallLine({ request, at: now() }));
    if (show) log(describeModelCall(request));
  };
}

/** The model in use and the ones to switch to: one, named by its model, when MODELS is unset. */
function modelsOf(settings: ProviderSettings) {
  const { adapter, model, models } = settings;

  if (!models) return { model: { name: model, adapter, model }, models: [] };

  const active = models.choices.find((choice) => choice.name === models.switch.active);

  return { model: active ?? { name: model, adapter, model }, models: models.choices };
}

function useModel(params: { providerSettings: ProviderSettings; name: string }): boolean {
  const { models } = params.providerSettings;

  if (!models?.choices.some((choice) => choice.name === params.name)) return false;
  models.switch.use(params.name);

  return true;
}
