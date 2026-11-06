/**
 * A place in a turn a terminal can jump to or select by (OSC 133): where the user's message
 * starts, where the reply's output starts, and where it ended, well or not.
 */
export type ShellMark = 'prompt' | 'output' | 'done' | 'failed';
