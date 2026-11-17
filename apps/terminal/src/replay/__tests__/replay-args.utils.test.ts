import { describe, expect, it } from 'vitest';
import { ReplayOptionError } from '../../errors/replay.errors.js';
import { parseReplayArgs } from '../replay-args.utils.js';

describe('parseReplayArgs', () => {
  it('takes the target and the options in any order', () => {
    expect(parseReplayArgs(['--json', 'last', '--from', '40', '--session', 'main'])).toEqual({
      target: 'last',
      from: 40,
      session: 'main',
      json: true,
      summary: false,
    });
  });

  it('starts at the first entry and renders by default', () => {
    expect(parseReplayArgs(['0007'])).toEqual({
      target: '0007',
      from: 0,
      json: false,
      summary: false,
    });
  });

  it.each([
    [[], 'one conversation folder or workbook run'],
    [['a', 'b'], 'one conversation folder or workbook run'],
    [['a', '--from'], '--from needs a value'],
    [['a', '--from', '--json'], '--from needs a value'],
    [['a', '--from', 'x'], 'a seq'],
    [['a', '--sesion', 'x'], 'Unknown option --sesion'],
  ])('refuses %j rather than replay something else', (argv, message) => {
    expect(() => parseReplayArgs(argv)).toThrow(ReplayOptionError);
    expect(() => parseReplayArgs(argv)).toThrow(message);
  });
});
