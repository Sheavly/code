import type { ModelSection } from '../sections/sections.types.js';

/**
 * The sections the model fills by default. The structure is the one the public summary prompts
 * share; the wording is a starting point, to be tuned on stored workbook runs.
 */
export const DEFAULT_MODEL_SECTIONS: readonly ModelSection[] = [
  {
    id: 'goal',
    title: 'Goal',
    guidance: 'What the user is trying to get done, in one or two sentences.',
  },
  {
    id: 'constraints',
    title: 'Active constraints',
    guidance: "The user's rules and preferences that still apply: what to do, what to avoid.",
  },
  {
    id: 'knowledge',
    title: 'Key knowledge',
    guidance: 'Facts learned that the work depends on: commands that work, names, locations.',
  },
  {
    id: 'decisions',
    title: 'Decisions and why',
    guidance: 'What was decided, with the reason, so it is not reopened by accident.',
  },
  {
    id: 'failures',
    title: 'What failed',
    guidance: 'Approaches that did not work and why, so they are not tried again.',
  },
  {
    id: 'state',
    title: 'Task state',
    guidance: 'What is done, what is in progress, and what comes next.',
  },
];

/** A tool result longer than this is cut when the span is shown to the model. */
export const MAX_TOOL_RESULT_CHARS = 2_000;

/** A tool call's input longer than this is cut when the span is shown to the model. */
export const MAX_TOOL_INPUT_CHARS = 500;

/** A tool name is model-written, so a longer one is cut when the span is shown to the model. */
export const MAX_TOOL_NAME_CHARS = 80;
