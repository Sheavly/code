import { sessionIdSchema } from '@sheavly/protocol/session/session.validator';
import { ReplayOptionError } from '../errors/replay.errors.js';
import type { ReplayOptions } from './replay.types.js';

/** The value after `flag` at `index`, or an error saying the flag needs one. */
function valueAfter(params: { argv: readonly string[]; index: number }): string {
  const { argv, index } = params;
  const value = argv[index + 1];

  if (value === undefined || value.startsWith('--')) {
    throw new ReplayOptionError(`${argv[index] ?? 'The option'} needs a value`);
  }

  return value;
}

/** A `--from` value: a whole number, the `seq` to start at. */
function seqOf(value: string): number {
  if (/^\d+$/.test(value)) return Number(value);

  throw new ReplayOptionError(`--from takes a seq, a whole number (got "${value}")`);
}

/**
 * The replay command line, parsed. Throws `ReplayOptionError` for a missing target, an unknown
 * option, or an option without a usable value, so a typo never replays something else.
 */
export function parseReplayArgs(argv: readonly string[]): ReplayOptions {
  const words: string[] = [];
  const options = { from: 0, json: false, summary: false };
  let session: ReplayOptions['session'];

  for (let index = 0; index < argv.length; index++) {
    const arg = argv[index] ?? '';

    switch (arg) {
      case '--json':
        options.json = true;
        break;
      case '--summary':
        options.summary = true;
        break;
      case '--from':
        options.from = seqOf(valueAfter({ argv, index }));
        index++; // the value is read
        break;
      case '--session':
        session = sessionIdSchema.parse(valueAfter({ argv, index }));
        index++;
        break;
      default:
        if (arg.startsWith('--')) throw new ReplayOptionError(`Unknown option ${arg}`);
        words.push(arg);
    }
  }

  const [target, ...extra] = words;

  if (target === undefined || extra.length > 0) {
    throw new ReplayOptionError('Replay takes one conversation folder or workbook run');
  }

  return { target, ...options, ...(session !== undefined && { session }) };
}
