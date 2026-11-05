import type { ModelId } from '@sheavly/protocol/model/model.types';
import type { ProfileId } from '@sheavly/protocol/profile/profile.types';
import type { ModelChoice } from '@sheavly/protocol/server/server.types';
import type { ModelSwitch } from '../harness/harness.types.js';
import type { parseRequestEnv } from '../harness/settings.validator.js';

/** The request settings the backend reads from its environment (`MODEL_*`), as `parseRequestEnv` returns them. */
export type RequestSettings = ReturnType<typeof parseRequestEnv>;

/**
 * Where a conversation belongs: the folder it works in (a real path) and the profile whose models
 * and keys it runs on. Both are decided when it starts and never change, so its stream, history
 * and index stay together, and a reopened conversation comes back to the same place.
 */
export type Placement = {
  workspace: string;
  profile: ProfileId;
};

/** The models of a profile that can be used, and a note for each file or model that cannot. */
export type ProfileModels = {
  models: ModelSwitch;
  /** One line for each model skipped, and why; never a key or anything the provider said. */
  notes: string[];
};

/** A workspace's models, and how to remember which one the user chose last. */
export type WorkspaceModels = ProfileModels & {
  /** The model a conversation starts on: the switch's active one, which is among the choices. */
  first: ModelChoice;
  /**
   * Remembers `modelId` as the profile's last chosen model, where its next new conversation
   * starts. Rejects when it cannot be written; the conversation's own model is not affected.
   */
  remember: (modelId: ModelId) => Promise<void>;
};
