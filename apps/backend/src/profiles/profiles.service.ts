import { realpath } from 'node:fs/promises';
import type { Environment } from '@sheavly/core/environment/environment.types';
import { ConversationsError } from '@sheavly/host/errors/conversations.errors';
import type { ModelId } from '@sheavly/protocol/model/model.types';
import { createDefaultRegistry } from '@sheavly/providers/registry/default-registry.helper';
import type { AdapterRegistry } from '@sheavly/providers/registry/registry.service';
import { workspaceKey } from '@sheavly/storage/config-store/config-store.utils';
import { ProfileRegistry } from '@sheavly/storage/profile-registry/profile-registry.service';
import type { RequestSettings } from './profiles.types.js';
import { sheavlyHome } from './home.helper.js';
import { modelsOf } from './models.helper.js';
import type { WorkspaceModels } from './profiles.types.js';

/**
 * The user's profiles as the backend uses them: which profile a workspace runs on, and the
 * models and keys in it. It is the one place in the backend that holds a key, so everything else
 * asks it for a built provider and never sees one.
 */
export class Profiles {
  readonly #registry: ProfileRegistry;
  readonly #adapters: AdapterRegistry;

  /** `env` says where the user's folder is (`sheavly_home`); `adapters` is for a test's fake fetch. */
  constructor(params: { env: Environment; adapters?: AdapterRegistry }) {
    this.#registry = new ProfileRegistry({ root: sheavlyHome(params.env) });
    this.#adapters = params.adapters ?? createDefaultRegistry();
  }

  /**
   * The models a conversation in the workspace at `workspaceRoot` runs on: its profile's usable
   * ones behind one switch, starting on the profile's last model. The profile is the one the
   * workspace is bound to, else the default.
   *
   * Throws a `ConversationsError` (`not_set_up`) when there is no profile for the workspace, or
   * the profile has no model that can be used, saying what to do. A model that cannot be built
   * is left out with a note and never fails the others.
   */
  async modelsFor(params: {
    workspaceRoot: string;
    request: RequestSettings;
  }): Promise<WorkspaceModels> {
    const { workspaceRoot, request } = params;
    const key = workspaceKey({ realPath: await realpath(workspaceRoot) });
    const found = await this.#registry.profileFor(key);

    if (!found) {
      throw new ConversationsError({
        reason: 'not_set_up',
        message: `No profile is set up for the workspace ${workspaceRoot}: create a profile with a model and its key, and make it the default.`,
      });
    }

    const profile = await this.#registry.open(found.id);
    const { models, notes } = await modelsOf({
      profile,
      registry: this.#adapters,
      request,
      ...(found.lastModelId && { startWith: found.lastModelId }),
    });

    // The switch starts on a model among the choices (see `modelsOf`), so with any choice at all
    // there is one in use. None at all is a profile with nothing usable.
    const first = models.choices.find((choice) => choice.id === models.switch.active);

    if (!first) {
      throw new ConversationsError({
        reason: 'not_set_up',
        message: [
          `The profile "${found.name}" has no model that can be used: add a model and set its key.`,
          ...notes,
        ].join('\n'),
      });
    }

    return {
      models,
      notes,
      first,
      remember: (modelId: ModelId) => this.#registry.rememberModel({ id: found.id, modelId }),
    };
  }
}
