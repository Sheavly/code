/** Static model-facing policy; the formatter inserts the live context measurement between lines. */
export const CONTEXT_USAGE_NOTICE_TEXT = {
  opening: '<harness-notice kind="context-usage">',
  origin: 'Harness telemetry, not a user message or request.',
  guidance:
    'Use this silently to manage the task. Do not acknowledge, repeat, or attribute it to the user unless context limits affect the task.',
  closing: '</harness-notice>',
} as const;
