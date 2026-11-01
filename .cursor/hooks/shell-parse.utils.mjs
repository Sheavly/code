// Shell command reading for the git guard. Best-effort by design:
// no regex reading of shell is complete (variables, eval, scripts written then run).

// Commit/PR messages are prose that may *mention* forbidden flags or git commands, so their
// values are blanked before matching. Only quoted values and `"$(cat <<'EOF' …)"` heredocs are
// skipped, and only for commands where these flags carry prose: elsewhere `-b` is a branch.
const MESSAGE_FLAG = String.raw`(?:-m|-t|-b|--message|--title|--body|--notes)`;
const HEREDOC_MESSAGE = new RegExp(
  String.raw`(\s${MESSAGE_FLAG}[\s=]+)"\$\(cat <<-?\s*(['"]?)(\w+)\2\n[\s\S]*?\n\s*\3\s*\)"`,
  'g',
);
const QUOTED_MESSAGE = new RegExp(String.raw`(\s${MESSAGE_FLAG}[\s=]+)("[^"]*"|'[^']*')`, 'g');
const MESSAGE_COMMAND =
  /(?:^|[;&|\n])\s*(?:\w+=\S*\s+)*(?:\S*\/)?(?:git\b[^;&|\n]*\b(?:commit|tag|merge|stash|notes)|gh\s+(?:pr|issue|release))\b[^;&|\n]*$/;

// String.replace passes the match offset and whole string last, after every capture group.
function blankMessage(match, flag, ...rest) {
  const [offset, whole] = rest.slice(-2);

  return MESSAGE_COMMAND.test(whole.slice(0, offset)) ? `${flag}MESSAGE` : match;
}

export function stripMessages(command) {
  return command.replace(HEREDOC_MESSAGE, blankMessage).replace(QUOTED_MESSAGE, blankMessage);
}

// `git commit` options that reuse or generate the message instead of taking a new one.
const REUSED_MESSAGE =
  /(?:^|\s)(?:--no-edit|-[cC]|--reuse-message|--reedit-message|--fixup|--squash)(?:[\s=]|$)/;
const ANY_HEREDOC = /<<-?\s*(['"]?)(\w+)\1\n([\s\S]*?)\n\s*\2(?=\s|\)|$)/;
const MESSAGE_VALUE = /(?:^|\s)(?:-m|--message)(?:\s+|=)("((?:[^"\\]|\\.)*)"|'([^']*)')/g;
const FILE_VALUE = /(?:^|\s)(?:-F|--file)(?:\s+|=)(\S+)/;

/** The text of `command` after its first `git … commit`, or null when it runs no commit. */
function readCommitArgs(command) {
  const match = /(?:^|[;&|\n(]\s*|\s)(?:\S*\/)?git(?:\s+-[Cc]\s+\S+)*\s+commit\b([\s\S]*)$/.exec(
    command,
  );

  return match ? match[1] : null;
}

/**
 * The message a `git commit` in `command` would record, for checking before it runs:
 * - `{ message }` from its `-m` values (joined like git does) or the heredoc it reads (`-F -`,
 *   or `-m "$(cat <<'EOF' …)"`);
 * - `{ file }` when it reads `-F <path>`;
 * - `{ reused: true }` when it keeps or generates the message (`--no-edit`, `-C`, `--fixup`);
 * - `{ editor: true }` when git would open an editor, which hangs an agent;
 * - null when the command runs no commit.
 */
export function readCommitMessage(command) {
  const args = readCommitArgs(command);

  if (args === null) return null;
  if (REUSED_MESSAGE.test(args)) return { reused: true };

  const heredoc = ANY_HEREDOC.exec(args);

  if (heredoc) return { message: heredoc[3].trim() };

  const values = [...args.matchAll(MESSAGE_VALUE)].map(
    (match) => match[2]?.replace(/\\(.)/g, '$1') ?? match[3],
  );

  if (values.length > 0) return { message: values.join('\n\n').trim() };

  const file = FILE_VALUE.exec(args)?.[1];

  return file ? { file } : { editor: true };
}

/** The value of the first of `flags` (`-b x` or `--base=x`), or undefined. */
export function flagValue(params) {
  const { args, flags } = params;

  for (let index = 0; index < args.length; index++) {
    const [name, inline] = args[index].split(/=(.*)/s);

    if (flags.includes(name)) return inline ?? args[index + 1];
  }

  return undefined;
}

/** Positional args, skipping flags, redirections and the values of the flags in `valued`. */
export function positionals(params) {
  const { args, valued = [] } = params;
  const result = [];

  for (let index = 0; index < args.length; index++) {
    const arg = args[index];

    if (valued.includes(arg)) index++;
    else if (!arg.startsWith('-') && !/^\d*>/.test(arg)) result.push(arg);
  }

  return result;
}

// Quotes and escapes only change how the shell splits words, so dropping them turns
// `"git" push` and `bash -c "git push -f"` back into plain words to inspect.
export function normalize(command) {
  return command.replace(/["'\\]/g, '').replace(/\$\(|`|\(|\)/g, ' ; ');
}

// `2>&1`-style fd duplications are one token so their `&` isn't read as a separator.
const TOKEN = /\d*>&\d+|\d*>>?|\|\||&&|[|;&]|[^\s|;&<>]+/g;
const SEPARATORS = new Set(['|', '||', '&&', ';', '&']);
const ENV_ASSIGNMENT = /^[A-Za-z_][A-Za-z0-9_]*=/;

/** The simple commands in a (normalized) command line, each as words without leading env assignments. */
export function toSegments(command) {
  const segments = [[]];

  for (const token of command.match(TOKEN) ?? []) {
    if (SEPARATORS.has(token)) segments.push([]);
    else segments.at(-1).push(token);
  }

  return segments
    .map((tokens) =>
      tokens.slice(
        Math.max(
          0,
          tokens.findIndex((t) => !ENV_ASSIGNMENT.test(t)),
        ),
      ),
    )
    .filter((tokens) => tokens.length > 0);
}
