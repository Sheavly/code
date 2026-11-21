import { describe, expect, it } from 'vitest';
import { portMovedNotice } from '../port-notice.utils.js';

describe('portMovedNotice', () => {
  it('says a default port that was taken moved, and where to read the real one', () => {
    expect(portMovedNotice({ portIsDefault: true, defaultPort: 4310, port: 22001 })).toBe(
      '→ port 4310 is taken, so this server listens on 22001 instead (read the discovery file, not a fixed port)',
    );
  });

  it('says nothing when the default port was free', () => {
    expect(portMovedNotice({ portIsDefault: true, defaultPort: 4310, port: 4310 })).toBeUndefined();
  });

  it('says nothing for a port the user chose, even port 0', () => {
    expect(
      portMovedNotice({ portIsDefault: false, defaultPort: 4310, port: 22001 }),
    ).toBeUndefined();
  });
});
