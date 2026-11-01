// Shared helpers for the Cursor hooks in this folder. Hooks talk JSON over stdin/stdout:
// Cursor writes the event payload to stdin and reads our response from stdout.
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { stripVTControlCharacters } from 'node:util';

/** Project hooks run from the project root. */
export const PROJECT_ROOT = process.cwd();

/** Files ESLint checks (see eslint.config.js). */
export const LINTABLE = /\.(ts|js|mjs)$/;

/** Files Prettier formats (see .prettierrc.json / .prettierignore). */
export const FORMATTABLE = /\.(ts|js|mjs|json|md)$/;

export async function readHookInput() {
  let raw = '';

  for await (const chunk of process.stdin) raw += chunk;

  return raw ? JSON.parse(raw) : {};
}

export function respond(output) {
  process.stdout.write(JSON.stringify(output));
}

/** Edit tools name their target differently, so accept every known key. */
export function getEditedFilePath(toolInput) {
  const input = typeof toolInput === 'string' ? JSON.parse(toolInput) : (toolInput ?? {});
  const candidate = input.file_path ?? input.path ?? input.target_file;

  if (typeof candidate !== 'string') return null;

  return path.resolve(PROJECT_ROOT, candidate);
}

/** Inside the project and not in node_modules or build output. */
export function isProjectSource(filePath) {
  const relative = path.relative(PROJECT_ROOT, filePath);

  if (relative.startsWith('..') || path.isAbsolute(relative)) return false;

  return !/^(node_modules|dist|coverage)[/\\]/.test(relative);
}

/** Runs a project-local binary (node_modules/.bin) and captures its output; never throws. */
export function runBin(name, args) {
  return runFile(path.join(PROJECT_ROOT, 'node_modules', '.bin', name), args);
}

/** Runs an npm script quietly (so its own config and baseline wrappers apply); never throws. */
export function runNpmScript(name) {
  return runFile('npm', ['run', '--silent', name]);
}

function runFile(file, args) {
  const result = spawnSync(file, args, {
    cwd: PROJECT_ROOT,
    encoding: 'utf8',
    maxBuffer: 20 * 1024 * 1024,
  });

  return { ok: result.status === 0, output: `${result.stdout ?? ''}${result.stderr ?? ''}`.trim() };
}

/** ESLint's JSON report as readable lines: `src/a.ts:12:3  message  (rule)`. */
export function formatEslintReport(json) {
  const lines = [];

  for (const file of JSON.parse(json)) {
    const relative = path.relative(PROJECT_ROOT, file.filePath);

    for (const { line, column, message, ruleId } of file.messages) {
      lines.push(`${relative}:${line}:${column}  ${message}  (${ruleId ?? 'parse error'})`);
    }
  }

  return lines;
}

/**
 * jscpd's console report cut to the clones marked `[NEW]` (the baselined ones are listed too, and
 * would crowd them out), plus its closing error line. Falls back to the whole output when it has
 * no new clone in it (a config or startup failure).
 */
export function formatNewClones(output) {
  const lines = stripVTControlCharacters(output).split('\n');
  const kept = [];
  let inNewClone = false;

  for (const line of lines) {
    if (line.includes('Clone found')) inNewClone = line.includes('[NEW]');
    else if (!/^\s+(- )?\S/.test(line)) inNewClone = false;

    if (inNewClone || line.startsWith('ERROR:')) kept.push(line);
  }

  return kept.some((line) => line.includes('[NEW]')) ? kept.join('\n') : output;
}
