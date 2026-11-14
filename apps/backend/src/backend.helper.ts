import type { Environment } from '@sheavly/core/environment/environment.types';
import { Conversations } from '@sheavly/host/conversations/conversations.service';
import type { AdapterRegistry } from '@sheavly/providers/registry/registry.service';
import { servedConversation } from './harness/served.helper.js';
import type { ServedSettings } from './harness/harness.types.js';
import { SearchChains } from './harness/search-chains.service.js';
import { parseRequestEnv } from './harness/settings.validator.js';
import { permissionStoreFor, sheavlyHome, trustStoreFor } from './profiles/home.helper.js';
import { PermissionSetup } from './profiles/permission-setup.service.js';
import { PlacedConversationStore } from './profiles/placed-conversation-store.service.js';
import { Profiles } from './profiles/profiles.service.js';
import type { ProfileSetup } from './profiles/setup.service.js';
import type { WorkspaceSetup } from './profiles/workspace-setup.service.js';
import { FileLocks } from '@sheavly/workspace/file-locks/file-locks.service';

/**
 * The backend's two halves, built on one set of profiles so a change made through `setup` shows in
 * the next conversation: the conversations, each placed in a folder on a profile (what its start
 * asked for, else this backend's folder and that folder's profile) and kept there in the user's
 * folder, so a restart finds them (`listStored`, `reopen`) and several can run at once; and the
 * setup a UI uses to make that profile in the first place. The one place that puts the pieces
 * together, which `serve.ts` and the tests share.
 *
 * `adapters` is for a test's fake `fetch`. `log` hears what a person should see: models and skills
 * that were left out, each model call with `SHOW_MODEL_CALLS`, and stored conversations that
 * can't be used. `remoteSetupAllowed` is whether this backend may hand out access over a network
 * (a key, a trust; see `ProfileSetup`).
 */
export function createBackend(params: {
  env: Environment;
  settings: ServedSettings;
  log: (text: string) => void;
  remoteSetupAllowed: boolean;
  adapters?: AdapterRegistry;
}): {
  conversations: Conversations;
  setup: ProfileSetup;
  workspaces: WorkspaceSetup;
  permissions: PermissionSetup;
} {
  const { env, settings, log, remoteSetupAllowed, adapters } = params;
  const profiles = new Profiles({ env, ...(adapters && { adapters }) });
  const trustStore = trustStoreFor(env);
  const permissionStore = permissionStoreFor(env);
  const places = new PlacedConversationStore({
    profiles,
    fallbackWorkspace: settings.workspaceRoot ?? process.cwd(),
    onProblem: ({ file, message }) => log(`Stored conversation ${file} is left out: ${message}\n`),
  });
  // One set for every conversation of this backend: they key by real path, so two conversations
  // editing one file take turns, whichever profile each runs on.
  const fileLocks = new FileLocks();
  // Likewise for search: one chain per backend order, so a rate limit is remembered by all.
  const searchChains = new SearchChains();

  return {
    setup: profiles.setup({ request: parseRequestEnv(env), remoteSetupAllowed }),
    // The same trust store the conversations read, so a grant shows in the next one.
    workspaces: profiles.workspaces({ trust: trustStore, remoteSetupAllowed }),
    // The same store the conversations read on every command, so a change applies to them at once.
    permissions: new PermissionSetup({
      store: permissionStore,
      home: sheavlyHome(env),
      env,
      remoteSetupAllowed,
    }),
    conversations: new Conversations({
      store: places,
      create: (asked) =>
        servedConversation({
          env,
          profiles,
          places,
          trustStore,
          permissionStore,
          settings,
          asked,
          fileLocks,
          searchChains,
          log,
        }),
    }),
  };
}
