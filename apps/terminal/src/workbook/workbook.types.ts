import type { z } from 'zod';
import type { ModelMode } from '@sheavly/protocol/model/model.types';
import type { RUN_FILES } from './workbook.constants.js';
import type {
  promptFileSchema,
  runIdSchema,
  runMetaSchema,
  runResultSchema,
  stateSchema,
} from './workbook.validator.js';

/** A stored prompt: its name (the file name) and what it says, plus optional settings. */
export type StoredPrompt = z.infer<typeof promptFileSchema> & { name: string };

export type RunId = z.infer<typeof runIdSchema>;

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
      trust: boolean;
      model?: string | undefined;
      /** The raw `--mode` word; checked by `workbookMode`. */
      mode?: string | undefined;
    }
  | {
      name: 'ask';
      text: string;
      showModelCalls: boolean;
      trust: boolean;
      model?: string | undefined;
      /** The raw `--mode` word; checked by `workbookMode`. */
      mode?: string | undefined;
    }
  | {
      name: 'continue';
      run?: string | undefined;
      text: string;
      showModelCalls: boolean;
      trust: boolean;
      model?: string | undefined;
      /** The raw `--mode` word; checked by `workbookMode`. */
      mode?: string | undefined;
    }
  | {
      name: 'check';
      prompts: string[];
      all: boolean;
      approvedCommands: string[];
      model?: string | undefined;
      /** The raw `--mode` word; checked by `workbookMode`. */
      mode?: string | undefined;
    }
  | { name: 'list' }
  | { name: 'show'; run?: string | undefined }
  | { name: 'step'; run?: string | undefined; from?: number | undefined }
  | { name: 'diff'; a: string; b: string }
  | { name: 'help' };

/** Where a run's files go, resolved: its folder, and one path per file in `RUN_FILES`. */
export type RunPaths = Record<'dir' | keyof typeof RUN_FILES, string>;

/** Explicit check CLI authorization; the runner derives the workspace from its store, never here. */
export type CheckContext = { approvedCommands: readonly string[] };

/** What to run: a stored prompt, a one-off text, or a follow-up to an earlier run. */
export type RunRequest = {
  /** The prompt's name (stored), or `ask` / `continue` for one-offs. */
  name: string;
  text: string;
  stored?: StoredPrompt | undefined;
  /** Start from this run's conversation and workspace. */
  continues?: RunId | undefined;
  /** Reuse the prompt's last workspace instead of a fresh copy. */
  keep: boolean;
  showModelCalls: boolean;
  /** `--trust`: trust the workspace's `.sheavly/` hooks, whether or not it's a fresh fixture copy. */
  trust: boolean;
  /**
   * The model to run on, by id or name: `--model`, else `WORKBOOK_MODEL`, else the profile's own
   * choice. For this run only; it never changes the model the profile remembers.
   */
  model?: string | undefined;
  /**
   * The reasoning effort to run on: `--mode`, else `WORKBOOK_MODE`, else the one the profile
   * remembers for the model. For this run only; it is never remembered.
   */
  mode?: ModelMode | undefined;
};
