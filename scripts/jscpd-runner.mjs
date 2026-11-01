// Runs jscpd so that a config problem fails instead of passing. With an unreadable
// .jscpd.json jscpd only warns and carries on with its defaults (exit 0); with none at all it
// scans nothing and still exits 0. Either way the duplication check would silently stop.
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const JSCPD_CONFIG_FILE = '.jscpd.json';

/** The installed jscpd CLI script, read from its package's `bin`. */
function resolveJscpdBin() {
  const manifestPath = fileURLToPath(import.meta.resolve('jscpd/package.json'));
  const { bin } = JSON.parse(readFileSync(manifestPath, 'utf8'));

  return path.join(path.dirname(manifestPath), typeof bin === 'string' ? bin : bin.jscpd);
}

/** The parsed .jscpd.json; throws when it is missing, unparseable or scans nothing. */
export function readJscpdConfig(repoRoot) {
  const file = path.join(repoRoot, JSCPD_CONFIG_FILE);
  let config;

  try {
    config = JSON.parse(readFileSync(file, 'utf8'));
  } catch (caughtError) {
    throw new Error(`${JSCPD_CONFIG_FILE} could not be read, so jscpd would run unconfigured.`, {
      cause: caughtError,
    });
  }

  for (const key of ['path', 'format']) {
    if (!Array.isArray(config[key]) || config[key].length === 0) {
      throw new Error(`${JSCPD_CONFIG_FILE} has no "${key}" list, so jscpd would scan nothing.`);
    }
  }

  return config;
}

/** Whether jscpd's output shows it fell back to its defaults instead of .jscpd.json. */
export function ignoredJscpdConfig(output) {
  return /^config file /m.test(output);
}

/** jscpd from `repoRoot` with `args`, its output echoed; returns the exit status. */
export function runJscpd(params) {
  const { repoRoot, args } = params;

  readJscpdConfig(repoRoot);

  const run = spawnSync(process.execPath, [resolveJscpdBin(), ...args, '--fail-on-empty'], {
    cwd: repoRoot,
    encoding: 'utf8',
  });

  if (run.error) throw new Error('jscpd could not be started.', { cause: run.error });

  const output = `${run.stdout}${run.stderr}`;

  process.stdout.write(run.stdout);
  process.stderr.write(run.stderr);

  if (ignoredJscpdConfig(output)) {
    throw new Error(`jscpd could not load ${JSCPD_CONFIG_FILE}:\n${output}`);
  }

  return run.status ?? 1;
}
