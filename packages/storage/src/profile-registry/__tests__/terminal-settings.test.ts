import { describe, expect, it } from 'vitest';
import { ProfileRegistry } from '../profile-registry.service.js';
import { ASTRA, HOME, WORK, useTempRegistry } from '../../testing/registry.fake.js';

const temp = useTempRegistry();

describe('global terminal settings', () => {
  it('persists across restarts without modifying profiles', async () => {
    const registry = temp.registry();

    await registry.setTerminalSettings({ reducedMotion: true });
    await registry.put({ id: WORK, name: 'Work' });
    await registry.put({ id: HOME, name: 'Home' });

    const restarted = new ProfileRegistry({ root: temp.root() });

    expect((await restarted.config()).terminal).toEqual({ reducedMotion: true });
    expect(await restarted.get(WORK)).toEqual({ id: WORK, name: 'Work' });
    expect(await restarted.get(HOME)).toEqual({ id: HOME, name: 'Home' });
  });

  it('keeps settings across profile changes, including deletion, and can turn motion off', async () => {
    const registry = temp.registry();

    await registry.put({ id: WORK, name: 'Work' });
    await registry.setTerminalSettings({ reducedMotion: true });
    await Promise.all([
      registry.put({ id: WORK, name: 'Day job' }),
      registry.rememberModel({ id: WORK, modelId: ASTRA, mode: 'high' }),
    ]);

    expect(await registry.get(WORK)).toMatchObject({
      name: 'Day job',
      lastModelSelection: { modelId: ASTRA, mode: 'high' },
    });
    expect((await registry.config()).terminal).toEqual({ reducedMotion: true });
    await registry.setTerminalSettings({ reducedMotion: false });
    expect((await registry.config()).terminal).toEqual({ reducedMotion: false });
    expect((await registry.get(WORK))?.modelModes).toEqual({ [ASTRA]: 'high' });
    await registry.delete(WORK);
    expect((await registry.config()).terminal).toEqual({ reducedMotion: false });
  });
});
