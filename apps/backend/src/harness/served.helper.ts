import { homedir } from 'node:os';
import type { Environment } from '@sheavly/core/environment/environment.types';
import type { LiveConversation } from '@sheavly/host/conversations/conversations.types';
import type { Message } from '@sheavly/protocol/message/message.types';
import type { ModelId } from '@sheavly/protocol/model/model.types';
import type { TrustStore } from '@sheavly/workspace/trust/trust.service';
import { findSkills } from '@sheavly/workspace/skills/skills.helper';
import { harnessConversation } from './conversation.helper.js';
import { createBackendHarness } from './harness.helper.js';
import type { ServedSettings } from './harness.types.js';
import { modelCallsTo } from './model-calls.helper.js';
import { skillsNotice } from './notices.utils.js';
import type { Profiles } from '../profiles/profiles.service.js';
import type { WorkspaceModels } from '../profiles/profiles.types.js';
import { parseRequestEnv } from './settings.validator.js';

/**
 * One conversation as the backend serves it: its own models (the workspace's profile, with its
 * own switch, so changing this conversation's model leaves the others alone), the harness on the
 * settings, and the run it reports (the UI shows its trust from that). Skills that didn't load go
 * to `log`, and each model call to `MODEL_CALLS_FILE` and, with SHOW_MODEL_CALLS, to `log`.
 *
 * Throws a `ConversationsError` (`not_set_up`) when the workspace has no profile with a model
 * that can be used; models that were left out are noted on `log`.
 */
export async function servedConversation(params: {
  env: Environment;
  profiles: Profiles;
  trustStore: TrustStore;
  settings: ServedSettings;
  messages?: Message[] | undefined;
  log: (text: string) => void;
}): Promise<LiveConversation> {
  const { env, profiles, trustStore, settings, messages, log } = params;
  const workspace = await profiles.modelsFor({
    workspaceRoot: settings.workspaceRoot ?? process.cwd(),
    request: parseRequestEnv(env),
  });

  for (const note of workspace.notes) log(`${note}\n`);

  const harness = await createBackendHarness({
    provider: workspace.models.switch,
    workspaceRoot: settings.workspaceRoot,
    skipAllowList: settings.skipAllowList,
    title: 'Conversation',
    trustStore,
    env,
    trustWorkspace: settings.trustWorkspace,
    home: homedir(),
    onModelCall: modelCallsTo({ settings, log }),
  });
  const skills = skillsNotice(await findSkills(harness.skills));

  if (skills) log(`${skills}\n`);

  return harnessConversation({
    harness,
    messages,
    maxTurns: settings.maxTurns,
    waitForTasks: settings.waitForTasks,
    run: {
      details: () => ({
        workspace: harness.workspace.root,
        ...modelsIn(workspace),
        projectTrust: harness.projectTrust,
        skipAllowList: settings.skipAllowList,
      }),
      useModel: (id) => useModel({ workspace, id, log }),
    },
  });
}

/** The model in use and the ones to switch to, all the profile's usable ones. */
function modelsIn(workspace: WorkspaceModels) {
  const { switch: active, choices } = workspace.models;

  return {
    model: choices.find((choice) => choice.id === active.active) ?? workspace.first,
    models: choices,
  };
}

/**
 * Switches to the model with this id, and remembers it as the profile's last, where its next new
 * conversation starts. False when this conversation has no such model. A model that can't be
 * remembered is told to `log` and does not undo the switch: the conversation is on it either way.
 */
function useModel(params: {
  workspace: WorkspaceModels;
  id: ModelId;
  log: (text: string) => void;
}): boolean {
  const { workspace, id, log } = params;

  if (!workspace.models.choices.some((choice) => choice.id === id)) return false;

  workspace.models.switch.use(id);
  workspace.remember(id).catch((caughtError: unknown) => {
    log(`Could not remember the model as the profile's last: ${String(caughtError)}\n`);
  });

  return true;
}
