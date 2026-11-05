import { homedir } from 'node:os';
import type { Environment } from '@sheavly/core/environment/environment.types';
import type {
  CreateConversation,
  LiveConversation,
} from '@sheavly/host/conversations/conversations.types';
import type { ModelId } from '@sheavly/protocol/model/model.types';
import type { TrustStore } from '@sheavly/workspace/trust/trust.service';
import type { FileLocks } from '@sheavly/workspace/file-locks/file-locks.service';
import { findSkills } from '@sheavly/workspace/skills/skills.helper';
import { harnessConversation } from './conversation.helper.js';
import { createBackendHarness } from './harness.helper.js';
import type { ServedSettings } from './harness.types.js';
import { modelCallsTo } from './model-calls.helper.js';
import { skillsNotice } from './notices.utils.js';
import type { PlacedConversationStore } from '../profiles/placed-conversation-store.service.js';
import type { Profiles } from '../profiles/profiles.service.js';
import type { WorkspaceModels } from '../profiles/profiles.types.js';
import { parseRequestEnv } from './settings.validator.js';

/**
 * One conversation as the backend serves it: placed in a folder on a profile (what the start asked
 * for, or the backend's own folder and the profile its workspace is bound to), with its own
 * models (the profile's, behind its own switch, so changing this conversation's model leaves the
 * others alone), the harness on the settings, and the run it reports (the UI shows its trust from
 * that). Skills that didn't load go to `log`, and each model call to `MODEL_CALLS_FILE` and, with
 * SHOW_MODEL_CALLS, to `log`.
 *
 * `places` decides the placement once per conversation and remembers it by `id`, so the store
 * knows where the conversation's files go before its first one is written.
 *
 * Throws a `SetupError` (`invalid`) for a workspace or profile that can't be used, and a
 * `ConversationsError` (`not_set_up`) when no profile with a usable model can be found; models
 * that were left out are noted on `log`.
 */
export async function servedConversation(params: {
  env: Environment;
  profiles: Profiles;
  places: PlacedConversationStore;
  trustStore: TrustStore;
  settings: ServedSettings;
  asked: Parameters<CreateConversation>[0];
  /** Shared with the backend's other conversations, so edits to one file take turns. */
  fileLocks: FileLocks;
  log: (text: string) => void;
}): Promise<LiveConversation> {
  const { env, profiles, places, trustStore, settings, asked, fileLocks, log } = params;
  const { id, messages, storage } = asked;
  const placement = await places.decide({ id, asked });
  const workspace = await profiles.modelsFor({ placement, request: parseRequestEnv(env) });

  for (const note of workspace.notes) log(`${note}\n`);

  const harness = await createBackendHarness({
    provider: workspace.models.switch,
    workspaceRoot: placement.workspace,
    fileLocks,
    skipAllowList: settings.skipAllowList,
    title: 'Conversation',
    trustStore,
    env,
    trustWorkspace: settings.trustWorkspace,
    home: homedir(),
    onModelCall: modelCallsTo({ settings, log }),
    ...(storage && { entries: storage.entries, resume: storage.resume }),
  });
  const skills = skillsNotice(await findSkills(harness.skills));

  if (skills) log(`${skills}\n`);

  return harnessConversation({
    harness,
    messages,
    storage,
    maxTurns: settings.maxTurns,
    waitForTasks: settings.waitForTasks,
    run: {
      details: () => ({
        workspace: harness.workspace.root,
        profile: placement.profile,
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
