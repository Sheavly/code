import path from 'node:path';
import { ToolCallError } from '@sheavly/core/errors/tool.errors';
import type { ToolContext } from '@sheavly/core/tool/tool.types';
import type { FileChange, FileChangeVerb } from './files.types.js';
import type { ToolArtifact } from '@sheavly/protocol/event/event.types';

/** True for `.env`, `.env.local`, `.env.production`, ... (case-insensitive). */
export function isEnvFile(filePath: string): boolean {
  return /^\.env(\..*)?$/i.test(path.basename(filePath));
}

/** True if any part of `filePath` is `.git` (case-insensitive): `.git/config`, `sub/.git`. */
function isInGitDir(filePath: string): boolean {
  return filePath.split(/[\\/]/).some((part) => part.toLowerCase() === '.git');
}

/**
 * Throws if `relativePath` (relative to the workspace root) is in a `.git` folder or is a
 * `.git` file. Git config and hooks there can make the next `git status` run any program, and
 * its config can hold remote URLs or tokens. `action` names what was refused, e.g. "Writing".
 */
export function assertNotGitDir(params: {
  relativePath: string;
  requested: string;
  action: string;
}): void {
  const { relativePath, requested, action } = params;

  if (isInGitDir(relativePath)) {
    throw new ToolCallError({
      reason: 'forbidden',
      message:
        `${action} inside .git is not allowed (${requested}). Git config and hooks there can run ` +
        'programs, and its config can hold credentials.',
    });
  }
}

/**
 * Throws if `filePath` is a .env file; `requested` is what the model asked for, for the error.
 * `action` names what was refused, e.g. "Reading" or "Writing".
 */
export function assertNotEnvFile(params: {
  filePath: string;
  requested: string;
  action: string;
}): void {
  const { filePath, requested, action } = params;

  if (isEnvFile(filePath)) {
    throw new ToolCallError({
      reason: 'forbidden',
      message: `${action} .env files is not allowed (${requested}). They contain secrets.`,
    });
  }
}

/** How many times `search` occurs in `text` (non-overlapping). */
export function countOccurrences(params: { text: string; search: string }): number {
  const { text, search } = params;

  return search === '' ? 0 : text.split(search).length - 1;
}

/** A short summary of a change, for the model: e.g. "Edited src/a.ts (+3 −1 lines)". */
export function describeChange(params: {
  verb: FileChangeVerb;
  path: string;
  before: string | null;
  after: string | null;
}): string {
  const { verb, path: file, before, after } = params;
  const lines = (text: string | null) =>
    text === null || text === '' ? 0 : text.split('\n').length;

  return `${verb} ${file} (${lines(before)} → ${lines(after)} lines)`;
}

/** True if `artifact` is the file change a file tool returned. */
export function isFileChange(artifact: ToolArtifact): artifact is FileChange {
  return artifact.kind === 'file_change';
}

/**
 * Who a file tool's call is for, as `FileReads` names it: the session making the call, so the main
 * agent and each sub-agent are told apart. A call with no session (a tool run on its own) is the
 * only agent there is.
 */
export function agentOf(context: ToolContext): string {
  return context.session?.id ?? 'no-session';
}
