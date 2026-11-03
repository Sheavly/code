// `npm run jscpd`: fails on any clone, and on a jscpd that didn't apply .jscpd.json (see
// jscpd-runner.mjs).
import path from 'node:path';
import { runJscpd } from './jscpd-runner.mjs';

const REPO_ROOT = path.resolve(import.meta.dirname, '..');

process.exitCode = runJscpd({ repoRoot: REPO_ROOT, args: [] });
