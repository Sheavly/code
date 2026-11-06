/**
 * One failed tool step whose message says more than the line shown under it, kept for the chat
 * to show in full: numbered in the order they failed.
 */
export type Failure = {
  number: number;
  /** What the step was: the model's description of the call, and its command when it ran one. */
  title: string;
  /** The first non-empty line of the message, as the step showed it. */
  summary: string;
  /** The whole message without escape codes. */
  content: string;
  /** Non-empty lines after the first; 0 when only the first line was cut short. */
  moreLines: number;
};
