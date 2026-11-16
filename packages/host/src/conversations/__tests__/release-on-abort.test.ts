import { describe, expect, it } from 'vitest';
import { releaseOnAbort } from '../prompt.helper.js';

describe('releaseOnAbort', () => {
  it('releases the stop switch when the signal aborts, and not before', () => {
    const switches = new Map<string, AbortController>();
    const stop = new AbortController();
    const signal = new AbortController();

    switches.set('a', stop);
    releaseOnAbort({ signal: signal.signal, switches, id: 'a', stop });
    expect(switches.has('a')).toBe(true);

    signal.abort();
    expect(switches.has('a')).toBe(false);
  });

  it('releases at once for a signal that was aborted before it was handed over', () => {
    const switches = new Map<string, AbortController>();
    const stop = new AbortController();

    switches.set('a', stop);
    releaseOnAbort({ signal: AbortSignal.abort(), switches, id: 'a', stop });
    expect(switches.has('a')).toBe(false);
  });

  it('leaves the switch of a later prompt alone, and can be called again', () => {
    const switches = new Map<string, AbortController>();
    const first = new AbortController();
    const later = new AbortController();
    const release = releaseOnAbort({
      signal: new AbortController().signal,
      switches,
      id: 'a',
      stop: first,
    });

    switches.set('a', later);
    release();
    release();

    expect(switches.get('a')).toBe(later);
  });
});
