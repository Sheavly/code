import { ProcessTerminal, TuiMainScreen } from '@earendil-works/pi-tui';
import { createClient } from '@sheavly/client/client/client.helper';
import type { ModelId } from '@sheavly/protocol/model/model.types';
import type { Backend } from '../client/client.types.js';
import { SetupError } from '../errors/setup.errors.js';
import { SetupScreen } from './setup-screen.service.js';
import { runSetupWizard } from './wizard.helper.js';

/** Opens the wizard only for an unready workspace, or an explicit --setup request. */
export async function prepareSetup(params: {
  backend: Backend;
  workspace: string;
  interactive: boolean;
  force: boolean;
}): Promise<ModelId | undefined> {
  const { backend, workspace, interactive, force } = params;
  const client = createClient(backend);
  const [setup, binding] = await Promise.all([
    client.call('getSetup', {}),
    client.call('queryWorkspaceProfile', { body: { workspace } }),
  ]);
  const profile = setup.profiles.find(({ id }) => id === binding.profile);

  if (profile?.ready && !force) return undefined;

  if (!interactive) {
    throw new SetupError(
      'Setup needs an interactive terminal. Run npm run dev:terminal -- --setup in a terminal first.',
    );
  }

  const screen = new SetupScreen(new TuiMainScreen(new ProcessTerminal()));

  screen.start();

  try {
    return await runSetupWizard({ client, ui: screen, workspace, setup });
  } finally {
    screen.stop();
  }
}
