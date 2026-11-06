import { createHash } from 'node:crypto';
import { lstatSync, readFileSync, realpathSync, statSync } from 'node:fs';
import path from 'node:path';
import { format } from 'prettier';
import { isMissingPath } from './hooks.errors.mjs';

const SAFE_OPTIONS = new Set([
  'printWidth',
  'tabWidth',
  'useTabs',
  'semi',
  'singleQuote',
  'quoteProps',
  'trailingComma',
  'bracketSpacing',
  'bracketSameLine',
  'arrowParens',
  'proseWrap',
  'endOfLine',
  'htmlWhitespaceSensitivity',
  'vueIndentScriptAndStyle',
  'embeddedLanguageFormatting',
  'singleAttributePerLine',
]);

function hash(source) {
  return createHash('sha1').update(source).digest('hex');
}

function safeOptions(projectRoot) {
  try {
    const file = path.join(projectRoot, '.prettierrc.json');

    if (lstatSync(file).isSymbolicLink()) return {};

    const options = JSON.parse(readFileSync(file, 'utf8'));

    return Object.fromEntries(
      Object.entries(options).filter(
        ([name, value]) =>
          SAFE_OPTIONS.has(name) && ['string', 'number', 'boolean'].includes(typeof value),
      ),
    );
  } catch (caughtError) {
    if (isMissingPath(caughtError)) return {};
    throw caughtError;
  }
}

function isInside(params) {
  const relative = path.relative(params.root, params.file);

  return (
    relative !== '' &&
    relative !== '..' &&
    !relative.startsWith(`..${path.sep}`) &&
    !path.isAbsolute(relative)
  );
}

function formatterFiles(params) {
  const { command, cwd, projectRoot } = params;
  const match = /^npx[ \t]+prettier[ \t]+--write[ \t]+(.+)$/.exec(command);

  // Predict only literal file arguments. Config scripts, plugins, shell expansion and CLI options
  // are never executed or guessed by this guard; unsupported commands receive no attribution credit.
  if (!match || /[\n'"`$|;&*?<>]/.test(match[1])) return [];

  const arguments_ = match[1].trim().split(/\s+/);

  if (arguments_.some((file) => file.startsWith('-'))) return [];

  return arguments_
    .map((file) => {
      const absolute = path.resolve(cwd, file);
      const relative = path.relative(projectRoot, absolute);

      return { absolute, relative };
    })
    .filter(
      ({ absolute, relative }) =>
        isInside({ root: projectRoot, file: absolute }) &&
        !/^(node_modules|dist|coverage)[/\\]/.test(relative) &&
        /\.(ts|tsx|js|mjs|json|md)$/.test(relative),
    );
}

async function predictFile(params) {
  const { absolute, relative, before, options, projectRoot } = params;

  try {
    if (!before.files[relative]) return undefined;
    if (!statSync(absolute).isFile()) return undefined;
    const root = realpathSync(projectRoot);

    if (!isInside({ root, file: realpathSync(absolute) })) return undefined;

    const source = readFileSync(absolute);
    const beforeHash = hash(source);

    // A status-only snapshot cannot establish a clean file's preimage. Fail closed on missing
    // evidence and on another writer changing the file while prediction is being computed.
    if (before.files[relative] !== beforeHash) return undefined;

    const formatted = await format(source.toString('utf8'), { ...options, filepath: absolute });

    if (!isInside({ root, file: realpathSync(absolute) })) return undefined;
    if (hash(readFileSync(absolute)) !== beforeHash) return undefined;

    return { beforeHash, formattedHash: hash(formatted) };
  } catch (caughtError) {
    // Missing files and syntax failures are left to the actual formatter. They prove no write.
    if (isMissingPath(caughtError) || caughtError instanceof SyntaxError) return undefined;
    throw caughtError;
  }
}

/** Predicts safe, built-in Prettier formatting without executing project config scripts or plugins. */
export async function predictFormatterChanges(params) {
  const { before, projectRoot } = params;
  const files = formatterFiles(params);

  if (files.length === 0) return {};

  const options = safeOptions(projectRoot);
  const predicted = {};

  for (const file of files) {
    const result = await predictFile({ ...file, before, options, projectRoot });

    if (result) predicted[file.relative] = result;
  }

  return predicted;
}

function verifiedFile(params) {
  const { file, prediction, before, after, projectRoot } = params;
  const absolute = path.resolve(projectRoot, file);

  if (!isInside({ root: projectRoot, file: absolute })) return undefined;
  if (before.files[file] !== prediction.beforeHash) return undefined;

  try {
    if (!isInside({ root: realpathSync(projectRoot), file: realpathSync(absolute) })) {
      return undefined;
    }

    const actual = hash(readFileSync(absolute));

    if (actual !== prediction.formattedHash || actual === prediction.beforeHash) return undefined;

    return { before: prediction.beforeHash, after: after.files[file] ?? null };
  } catch (caughtError) {
    if (isMissingPath(caughtError)) return undefined;
    throw caughtError;
  }
}

/** Only a completed, hash-verified formatter write is evidence against another command's attribution. */
export function verifiedFormatterWrite(params) {
  const { command, before, after, projectRoot, endedAt } = params;
  const files = {};

  if (before.head !== after.head) return undefined;

  for (const [file, prediction] of Object.entries(before.formattedFiles ?? {})) {
    const verified = verifiedFile({ file, prediction, before, after, projectRoot });

    if (verified) files[file] = verified;
  }

  return Object.keys(files).length > 0
    ? { command, at: before.takenAt, endedAt, files }
    : undefined;
}

/** No timing-only exemption: preimages and final hashes must both match the verified formatter write. */
function formatterAttributedFiles(params) {
  const { entry, writes } = params;
  const attributed = new Set();

  if (!Number.isFinite(entry.at) || !Number.isFinite(entry.endedAt) || !entry.writeHashes) {
    return attributed;
  }

  for (const write of writes) {
    if (
      !Number.isFinite(write.at) ||
      !Number.isFinite(write.endedAt) ||
      write.endedAt < entry.at ||
      write.at > entry.endedAt
    ) {
      continue;
    }

    for (const file of entry.files) {
      const observed = entry.writeHashes[file];
      const verified = write.files[file];

      if (sameWrite({ observed, verified })) {
        attributed.add(file);
      }
    }
  }

  return attributed;
}

function sameWrite(params) {
  const { observed, verified } = params;

  return Boolean(
    observed &&
    verified &&
    typeof observed.before === 'string' &&
    typeof verified.before === 'string' &&
    observed.after !== undefined &&
    verified.after !== undefined &&
    observed.before === verified.before &&
    observed.after === verified.after,
  );
}

/** Preserves unverified changes and older records that lack write evidence. */
export function withoutFormatterWrites(params) {
  const { commands, writes } = params;

  return commands.flatMap((entry) => {
    const attributed = formatterAttributedFiles({ entry, writes });
    const files = entry.files.filter((file) => !attributed.has(file));

    return files.length > 0 ? [{ ...entry, files }] : [];
  });
}
