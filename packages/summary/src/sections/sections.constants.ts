/** Marks a cut-off entry, so a reader can tell it is not the whole text. */
export const ELLIPSIS = '…';

/** The trail section's default size, in characters; the oldest lines are dropped past it. */
export const TRAIL_MAX_CHARS = 4_000;

/** The user-messages section's default size, in characters; the oldest messages go first. */
export const USER_MESSAGES_MAX_CHARS = 6_000;

/** The output-refs section's default size, in characters; the oldest references go first. */
export const OUTPUT_REFS_MAX_CHARS = 4_000;

/** How much of the command line is kept beside each reference. */
export const OUTPUT_REF_LABEL_CHARS = 120;

/** A user message longer than this is cut and marked in the user-messages section. */
export const USER_MESSAGE_MAX_CHARS = 600;
