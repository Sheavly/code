import { parseExactAllowEntry } from '@sheavly/protocol/permission/permission.validator';

const OPTION_VALUES: Record<string, ReadonlySet<string>> = {
  git: new Set([
    '-C',
    '-c',
    '--git-dir',
    '--work-tree',
    '--namespace',
    '--config-env',
    '--attr-source',
    '--shallow-file',
  ]),
  npm: new Set([
    '-w',
    '--workspace',
    '--prefix',
    '--script-shell',
    '--userconfig',
    '--globalconfig',
    '--registry',
    '--cache',
    '--loglevel',
  ]),
  npx: new Set(['-p', '--package', '--userconfig', '--globalconfig', '--registry', '--cache']),
  gh: new Set(['-R', '--repo', '--hostname']),
};
const GH_GROUPS = new Set([
  'issue',
  'pr',
  'repo',
  'auth',
  'release',
  'run',
  'workflow',
  'project',
  'label',
  'secret',
  'variable',
  'gist',
  'extension',
  'cache',
]);

function executableName(word: string): string {
  return word.split(/[\\/]/).at(-1) ?? word;
}

function commandWord(params: {
  args: readonly string[];
  program: string;
  start?: number;
}): { word: string; next: number } | undefined {
  const { args, program, start = 0 } = params;
  let index = start;

  while (index < args.length) {
    const word = args[index] ?? '';

    if (word === '--') {
      const command = args[index + 1];

      return command ? { word: command, next: index + 2 } : undefined;
    }

    if (!word.startsWith('-')) return { word, next: index + 1 };

    if (program === 'npx' && (word === '-c' || word === '--call' || word.startsWith('--call='))) {
      return undefined;
    }

    index += OPTION_VALUES[program]?.has(word) ? 2 : 1;
  }

  return undefined;
}

function packageCommand(spec: string): string {
  const version = spec.lastIndexOf('@');

  // A leading @ is the scope, not a package version. Executable paths contribute only the command name.
  const local =
    spec.startsWith('.') ||
    spec.startsWith('/') ||
    spec.startsWith('\\') ||
    (spec.includes('/') && !spec.startsWith('@'));

  if (local && !spec.includes('://')) return executableName(spec);

  if (version > 0 && !local && !spec.includes('://')) return spec.slice(0, version);

  return spec;
}

/** Options and file operands never participate in approval. npm scripts and wrapper subcommands identify actual commands. */
export function commandBase(argv: readonly string[]): string[] {
  const [file = '', ...args] = argv;
  const program = executableName(file);

  if (!program || program === '*') return [];
  if (!['git', 'npm', 'npx', 'gh'].includes(program)) return [program];

  const command = commandWord({ args, program });

  if (!command) return [program];
  if (program === 'npx') return [program, packageCommand(command.word)];

  if (program === 'npm' && ['test', 't', 'tst'].includes(command.word)) {
    return [program, 'run', 'test'];
  }

  if (program === 'npm' && ['run', 'run-script'].includes(command.word)) {
    const script = commandWord({ args, program, start: command.next });

    return script ? [program, 'run', script.word] : [program, 'run'];
  }

  if (program === 'gh' && GH_GROUPS.has(command.word)) {
    const action = commandWord({ args, program, start: command.next });

    return action ? [program, command.word, action.word] : [program, command.word];
  }

  return [program, command.word];
}

/** The operation of an actual Git worktree command, ignoring executable paths and Git option operands. */
export function gitWorktreeSubcommand(argv: readonly string[]): string | undefined {
  const [file = '', ...args] = argv;

  if (executableName(file) !== 'git') return undefined;

  const command = commandWord({ args, program: 'git' });

  return command?.word === 'worktree' ? args[command.next] : undefined;
}

/** A grant covers its base command. An `exact:` JSON array names a command whose words contain spaces. */
export function allowEntryBase(entry: string): string[] {
  const exact = parseExactAllowEntry(entry);

  if (exact) return commandBase(exact);
  if (entry.startsWith('exact:')) return [];

  const words = entry.trim().split(/\s+/);

  return commandBase(words.at(-1) === '*' ? words.slice(0, -1) : words);
}
