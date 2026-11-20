/** A control character followed by an ANSI control sequence's `[`, parameters and final byte. */
export const ANSI_SEQUENCE = /\p{Cc}\[[0-9;?]*[ -/]*[@-~]/gu;

/** Every control and format character (C0, DEL, C1, bidi controls, zero-width joiners). */
export const CONTROL_CHARACTERS = /[\p{Cc}\p{Cf}]/gu;
