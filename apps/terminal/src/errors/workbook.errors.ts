import path from 'node:path';
import { errorMessage } from '@sheavly/runtime/errors/errors.utils';

/** A file as shown in messages: relative to where the workbook was started. */
function shown(file: string): string {
  return path.relative(process.cwd(), file);
}

/**
 * A workbook file (`state.json`, a run's `meta.json`, `result.json`, events or messages) exists
 * but couldn't be read, parsed or validated. A missing file has its own meaning ("no runs yet",
 * "never finished"); this one never does, so it names the file and keeps the cause.
 */
export class WorkbookStoreError extends Error {
  override name = 'WorkbookStoreError';
  /** The file, absolute. */
  readonly file: string;

  /** `reason` replaces the cause's message, e.g. a readable list of validation problems. */
  constructor(params: { file: string; cause: unknown; reason?: string }) {
    const { file, cause, reason = errorMessage(cause) } = params;

    super(`Could not read ${shown(file)}: ${reason}`, { cause });
    this.file = file;
  }
}

/**
 * Something the user asked the workbook for isn't there: a stored prompt, a run, or a run's
 * saved conversation. The message says what was looked for and how to find what exists.
 */
export class WorkbookNotFoundError extends Error {
  override name = 'WorkbookNotFoundError';
  /** What was asked for: a prompt name or a run id. */
  readonly wanted: string;

  constructor(params: { wanted: string; message: string; cause?: unknown }) {
    const { wanted, message, cause } = params;

    super(message, cause === undefined ? undefined : { cause });
    this.wanted = wanted;
  }
}

/** A workbook option (`--mode` or `WORKBOOK_MODE`) holds a value the workbook can't use. */
export class WorkbookOptionError extends Error {
  override name = 'WorkbookOptionError';
  /** The rejected value, as given. */
  readonly value: string;

  constructor(params: { value: string; message: string }) {
    super(params.message);
    this.value = params.value;
  }
}

/** A stored prompt file has bad front matter; `problems` lists what to fix. */
export class WorkbookPromptError extends Error {
  override name = 'WorkbookPromptError';
  /** The prompt's name (its file, without `.md`). */
  readonly prompt: string;

  constructor(params: { name: string; cause: unknown; problems: string }) {
    const { name, cause, problems } = params;

    super(`Prompt "${name}" is invalid:\n${problems}`, { cause });
    this.prompt = name;
  }
}
