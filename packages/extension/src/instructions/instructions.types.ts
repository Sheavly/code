/**
 * What is wrong with an instruction section: its `text` is not a string, is blank or is too long,
 * or its name is the one reserved for a replacement base.
 */
export type InstructionProblem = 'not-text' | 'blank' | 'too-long' | 'reserved';
