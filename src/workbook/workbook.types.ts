import type { z } from 'zod';
import type { RUN_FILES } from './workbook.constants.js';
import type {
  promptFileSchema,
  runMetaSchema,
  runResultSchema,
  stateSchema,
} from './workbook.utils.js';

/** A stored prompt: its name (the file name) and what it says, plus optional settings. */
export type StoredPrompt = z.infer<typeof promptFileSchema> & { name: string };

/** `run.json`: what a run was asked to do, written before it starts. */
export type RunMeta = z.infer<typeof runMetaSchema>;

/** `result.json`: how a run ended, written when it ends (also on failure). */
export type RunResult = z.infer<typeof runResultSchema>;

/** `state.json`: what the workbook remembers between runs. */
export type WorkbookState = z.infer<typeof stateSchema>;

/** One command line, parsed. */
export type Command =
  | {
      name: 'run';
      prompt: string;
      continueRun?: string | undefined;
      fresh: boolean;
      showModelCalls: boolean;
    }
  | { name: 'ask'; text: string; showModelCalls: boolean }
  | { name: 'continue'; run?: string | undefined; text: string; showModelCalls: boolean }
  | { name: 'list' }
  | { name: 'show'; run?: string | undefined }
  | { name: 'step'; run?: string | undefined; from?: number | undefined }
  | { name: 'diff'; a: string; b: string }
  | { name: 'help' };

/** Where a run's files go, resolved: its folder, and one path per file in `RUN_FILES`. */
export type RunPaths = Record<'dir' | keyof typeof RUN_FILES, string>;

/** What to run: a stored prompt, a one-off text, or a follow-up to an earlier run. */
export type RunRequest = {
  /** The prompt's name (stored), or `ask` / `continue` for one-offs. */
  name: string;
  text: string;
  stored?: StoredPrompt | undefined;
  /** Start from this run's conversation and workspace. */
  continues?: string | undefined;
  /** Reuse the prompt's last workspace instead of a fresh copy. */
  keep: boolean;
  showModelCalls: boolean;
};
