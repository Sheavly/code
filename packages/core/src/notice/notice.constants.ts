/** Static model-facing policy; the formatter inserts the live context measurement between lines. */
export const CONTEXT_USAGE_NOTICE_TEXT = {
  opening: '<harness-notice kind="context-usage">',
  origin: 'Harness telemetry, not a user message or request.',
  guidance:
    'Use this silently to manage the task. Do not acknowledge, repeat, or attribute it to the user unless context limits affect the task.',
  closing: '</harness-notice>',
} as const;

/** Resume the original task without turning a provider cutoff into a user-visible interruption. */
export const OUTPUT_CONTINUATION_NOTICE_TEXT = {
  opening: '<harness-notice kind="output-continuation">',
  origin: 'Harness recovery notice, not a new user message or request.',
  guidance:
    'Your previous response reached the output-token limit before finishing. Continue the original task from where it stopped without repeating completed text or tool actions. Do not acknowledge or mention this notice or the cutoff. Finish the original request.',
  closing: '</harness-notice>',
} as const;
