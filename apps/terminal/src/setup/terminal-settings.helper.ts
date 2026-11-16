import type { Setup } from '@sheavly/protocol/setup/setup.types';
import type { SetupClient, SetupUi } from './setup.types.js';

/** Global preferences can be changed before choosing or creating any profile. */
export async function chooseSetupProfile(params: {
  client: SetupClient;
  ui: SetupUi;
  setup: Setup;
}): Promise<string> {
  const { client, ui, setup } = params;

  while (true) {
    const selection = await ui.choose({
      title: 'Choose a profile for this workspace',
      items: [
        ...setup.profiles.map(({ id, name, ready }) => ({
          value: id,
          label: name,
          description: `${ready ? 'Ready' : 'Needs setup'} · ${id}`,
        })),
        { value: 'new', label: 'Create a profile', description: 'For example Personal or Work' },
        { value: 'terminal-settings', label: 'Terminal settings', description: 'All profiles' },
      ],
    });

    if (selection !== 'terminal-settings') {
      return selection;
    }

    await configureTerminalSettings({ client, ui });
  }
}

async function configureTerminalSettings(params: {
  client: SetupClient;
  ui: SetupUi;
}): Promise<void> {
  const { client, ui } = params;
  const { terminal: current = {} } = await client.call('getSetup', { signal: ui.signal });
  const motion = await ui.choose({
    title: 'Terminal motion',
    initial: current.reducedMotion ? 'reduced' : 'animated',
    items: [
      { value: 'animated', label: 'Animated', description: 'Working spinner' },
      {
        value: 'reduced',
        label: 'Reduced motion',
        description: 'Static marker; times update each second',
      },
    ],
  });
  const bell = await ui.choose({
    title: 'Terminal bell',
    initial: current.bell ? 'on' : 'off',
    items: [
      { value: 'off', label: 'Off', description: 'No audible or visual bell (default)' },
      {
        value: 'on',
        label: 'On',
        description: 'Reply completed, approval waiting, tool over 5 seconds',
      },
    ],
  });

  await client.send('setTerminalSettings', {
    body: { ...current, reducedMotion: motion === 'reduced', bell: bell === 'on' },
    signal: ui.signal,
  });
  ui.notice('Terminal settings saved for all profiles. They apply when the chat opens.');
}
