/**
 * Replays a stored conversation or workbook run into the terminal, without a backend, a model or
 * a network call.
 *
 *   npm run replay -- ~/.sheavly/profiles/<profile>/workspaces/<key>/conversations/<id>
 *   npm run replay -- last --from 40 --session <id>
 *   npm run replay -- 0007 --summary        what the stream says about itself, and what is wrong
 *
 * See `npm run replay -- --help` and the debugging guide of the `sheavly` skill.
 */
import { describeFailure } from './render/terminal-text.utils.js';
import { writeUntilReaderLeaves } from './replay/output.helper.js';
import { REPLAY_USAGE } from './replay/replay.constants.js';
import { parseReplayArgs } from './replay/replay-args.utils.js';
import { replayStored } from './replay/replay.helper.js';
import { replayFolder } from './replay/replay-target.helper.js';

const { write, failure } = writeUntilReaderLeaves(process.stdout);
const argv = process.argv.slice(2);

try {
  if (argv.includes('--help')) {
    write(`${REPLAY_USAGE}\n`);
  } else {
    const options = parseReplayArgs(argv);

    await replayStored({ options, write, folder: await replayFolder(options.target) });
  }

  const outputFailure = await failure();

  if (outputFailure !== undefined) throw outputFailure;
} catch (caughtError) {
  // Not `write`: with --json or --summary piped on, a failure must not mix into the data.
  process.stderr.write(`✗ ${describeFailure(caughtError)}\n`);
  process.exitCode = 1;
}
