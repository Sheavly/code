// knip has no built-in baseline. This preprocessor gives it the same model as ESLint's
// eslint-suppressions.json: findings recorded in knip-baseline.json are dropped before
// reporting, so only new dead code fails, and fixed debt must be pruned from the file.
//
//   npm run knip            fail on new findings or stale baseline entries
//   npm run knip:baseline   prune-only: drop stale entries (fixed debt), never add new ones;
//                           new findings are listed and fail, to be fixed in code
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';

const BASELINE_FILE = path.resolve(import.meta.dirname, '..', 'knip-baseline.json');
// npm sets npm_lifecycle_event to the running script's name on every OS, unlike an inline
// `VAR=1 cmd` prefix, which cmd.exe can't parse.
const IS_PRUNE = process.env.npm_lifecycle_event === 'knip:baseline';

function toFingerprint(params) {
  const { type, file, issue } = params;
  const symbol = issue.parentSymbol ? `${issue.parentSymbol}.${issue.symbol}` : issue.symbol;

  return `${type}::${file}::${symbol}`;
}

function* eachIssue(issues) {
  for (const [type, byFile] of Object.entries(issues)) {
    if (!byFile || typeof byFile !== 'object') continue;

    for (const [file, symbols] of Object.entries(byFile)) {
      for (const [key, issue] of Object.entries(symbols)) {
        yield { type, file, key, issue, symbols, byFile };
      }
    }
  }
}

function readBaseline() {
  return new Set(existsSync(BASELINE_FILE) ? JSON.parse(readFileSync(BASELINE_FILE, 'utf8')) : []);
}

// knip sets `process.exitCode = 0` after a clean report, so raise it once that's done.
function failOnExit() {
  process.once('exit', () => {
    if (!process.exitCode) process.exitCode = 1;
  });
}

// A rebuilt baseline would make every new finding look old, so pruning only ever keeps
// entries that were already baselined and still occur.
function pruneBaseline(params) {
  const { baseline, found } = params;
  const kept = [...baseline].filter((fingerprint) => found.has(fingerprint)).sort();

  writeFileSync(BASELINE_FILE, `${JSON.stringify(kept, null, 2)}\n`);
  process.stderr.write(`knip baseline pruned: ${baseline.size - kept.length} removed\n`);

  const added = [...found].filter((fingerprint) => !baseline.has(fingerprint));

  if (added.length === 0) return;

  process.stderr.write(
    `knip found ${added.length} new issues, left out of the baseline. Fix them in code:\n${added.join('\n')}\n`,
  );
  failOnExit();
}

/**
 * knip loads preprocessors through their default export, named on the command line by the `knip`
 * script, so nothing imports it.
 *
 * @public
 */
export default function applyKnipBaseline(data) {
  const { issues, counters } = data;
  const found = new Set([...eachIssue(issues)].map(toFingerprint));

  if (IS_PRUNE) pruneBaseline({ baseline: readBaseline(), found });

  const baseline = readBaseline();

  for (const entry of eachIssue(issues)) {
    if (!baseline.has(toFingerprint(entry))) continue;
    delete entry.symbols[entry.key];
    if (typeof counters[entry.type] === 'number') counters[entry.type]--;
    if (Object.keys(entry.symbols).length === 0) delete entry.byFile[entry.file];
  }

  const stale = [...baseline].filter((fingerprint) => !found.has(fingerprint));

  if (stale.length > 0) {
    process.stderr.write(
      `knip-baseline.json has ${stale.length} stale entries (debt that was fixed). Run \`npm run knip:baseline\` and commit it:\n${stale.join('\n')}\n`,
    );
    failOnExit();
  }

  return data;
}
