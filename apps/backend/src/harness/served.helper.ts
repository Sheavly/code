import { homedir } from 'node:os';
import type { Environment } from '@sheavly/core/environment/environment.types';
import type {
  CreateConversation,
  LiveConversation,
} from '@sheavly/host/conversations/conversations.types';
import type { ModelId, ModelMode } from '@sheavly/protocol/model/model.types';
import type { PermissionStore } from '@sheavly/storage/permission-store/permission-store.service';
import type { TrustStore } from '@sheavly/workspace/trust/trust.service';
import type { FileLocks } from '@sheavly/workspace/file-locks/file-locks.service';
import { findSkills } from '@sheavly/workspace/skills/skills.helper';
import { harnessConversation } from './conversation.helper.js';
import { createBackendHarness } from './harness.helper.js';
import type { ServedSettings } from './harness.types.js';
import { modelCallsTo } from './model-calls.helper.js';
import { skillsNotice } from './notices.utils.js';
import { workspacePermissions } from './permissions.helper.js';
import type { PlacedConversationStore } from '../profiles/placed-conversation-store.service.js';
import type { Profiles } from '../profiles/profiles.service.js';
import type { WorkspaceModels } from '../profiles/profiles.types.js';
import { parseRequestEnv } from './settings.validator.js';
import { selectedProvider } from './selected-provider.helper.js';

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
  /** What the user lets `run_command` do in each folder; every conversation reads its folder's. */
  permissionStore: PermissionStore;
  settings: ServedSettings;
  asked: Parameters<CreateConversation>[0];
  /** Shared with the backend's other conversations, so edits to one file take turns. */
  fileLocks: FileLocks;
  log: (text: string) => void;
}): Promise<LiveConversation> {
  const { env, profiles, places, trustStore, permissionStore, settings, asked, fileLocks, log } =
    params;
  const { id, messages, storage } = asked;
  const placement = await places.decide({ id, asked });
  const permissions = workspacePermissions({
    store: permissionStore,
    workspace: placement.workspace,
  });
  const workspace = await profiles.modelsFor({ placement, request: parseRequestEnv(env) });

  // Resume the conversation's own selection, never a newer selection from another conversation.
  if (asked.modelSelection) {
    workspace.models.switch.use(asked.modelSelection.modelId);
    workspace.models.switch.setMode({
      name: asked.modelSelection.modelId,
      mode: asked.modelSelection.mode,
    });
  }

  for (const note of workspace.notes) log(`${note}\n`);

  const onModelCall = modelCallsTo({ settings, log });
  const harness = await createBackendHarness({
    provider: workspace.models.switch,
    subAgentProvider: () => selectedProvider({ models: workspace.models, onModelCall }),
    workspaceRoot: placement.workspace,
    fileLocks,
    permissions,
    title: 'Conversation',
    trustStore,
    env,
    trustWorkspace: settings.trustWorkspace,
    home: homedir(),
    onModelCall,
    ...(storage && { entries: storage.entries, resume: storage.resume }),
  });
  const skills = skillsNotice(await findSkills(harness.skills));

  if (skills) log(`${skills}\n`);

  return harnessConversation({
    harness,
    messages,
    storage,
    ...(settings.maxTurns !== undefined && { maxTurns: settings.maxTurns }),
    waitForTasks: settings.waitForTasks,
    run: {
      details: () => ({
        workspace: harness.workspace.root,
        profile: placement.profile,
        ...modelsIn(workspace),
        projectTrust: harness.projectTrust,
      }),
      permissionMode: async () => (await permissions.read()).mode,
      useModel: (id, mode) => useModel({ workspace, id, ...(mode && { mode }) }),
    },
  });
}

/** The model in use and the ones to switch to, all the profile's usable ones. */
function modelsIn(workspace: WorkspaceModels) {
  const { switch: active, choices } = workspace.models;

  return {
    model: {
      ...(choices.find((choice) => choice.id === active.active) ?? workspace.first),
      mode: active.activeMode ?? 'medium',
    },
    models: choices,
  };
}

/**
 * Switches to the model with this id, and remembers it as the profile's last, where its next new
 * conversation starts. Without an explicit mode it restores this model's latest mode in the
 * profile. A failed preference write rejects the switch before the active selection changes.
 */
async function useModel(params: {
  workspace: WorkspaceModels;
  id: ModelId;
  mode?: ModelMode;
}): Promise<boolean> {
  const { workspace, id } = params;

  if (!workspace.models.choices.some((choice) => choice.id === id)) return false;

  const mode = await workspace.select({ modelId: id, ...(params.mode && { mode: params.mode }) });

  workspace.models.switch.setMode({ name: id, mode });
  workspace.models.switch.use(id);

  return true;
}
