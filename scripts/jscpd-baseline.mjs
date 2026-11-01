// Prune-only `npm run jscpd:baseline`. jscpd's `--update-baseline` rewrites the baseline from
// every current clone (even with --fail-on-new-clones), which would make new duplication
// look old. So let it rewrite, then keep only fingerprints that were already baselined:
// fixed clones drop out, new ones stay out and fail, to be fixed in code.
import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { runJscpd } from './jscpd-runner.mjs';

const REPO_ROOT = path.resolve(import.meta.dirname, '..');
const BASELINE_FILE = path.join(REPO_ROOT, '.jscpd-baseline.json');

function readBaseline() {
  return JSON.parse(readFileSync(BASELINE_FILE, 'utf8'));
}

function restore(reason) {
  // A failed or unconfigured run must not leave a baseline that absorbed new clones or
  // dropped entries a default-config scan didn't see.
  writeFileSync(BASELINE_FILE, `${JSON.stringify(before, null, 2)}\n`);
  console.error(`${reason}; baseline left unchanged.`);
  process.exit(1);
}

const before = readBaseline();
let status;

try {
  status = runJscpd({
    repoRoot: REPO_ROOT,
    args: ['--baseline', BASELINE_FILE, '--update-baseline', '--silent'],
  });
} catch (caughtError) {
  restore(caughtError.message);
}

if (status !== 0) restore(`jscpd failed (exit ${status})`);

const after = readBaseline();
const kept = {};
const added = [];

for (const [fingerprint, count] of Object.entries(after.fingerprints)) {
  const previous = before.fingerprints[fingerprint] ?? 0;

  if (previous > 0) kept[fingerprint] = Math.min(previous, count);
  if (count > previous) added.push(fingerprint);
}

writeFileSync(BASELINE_FILE, `${JSON.stringify({ ...after, fingerprints: kept }, null, 2)}\n`);

const removed = Object.keys(before.fingerprints).length - Object.keys(kept).length;

console.log(`jscpd baseline pruned: ${removed} removed`);

if (added.length > 0) {
  console.error(
    `jscpd found ${added.length} new clone(s), left out of the baseline. Run \`npm run jscpd\` to see them and fix them in code.`,
  );
  process.exit(1);
}
