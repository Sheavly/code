import type { Hook } from '../hook/hook.types.js';

/**
 * The folder this turn applies to, or `undefined`. The source's owner makes it return `undefined`
 * instead of throwing when the folder is unusable.
 */
export type SourceWorkingRoots = { root: () => Promise<string | undefined> };

/** What a source sees on each turn. */
export type InstructionSourceInput = {
  signal: AbortSignal;
  /** The folder this turn applies to, or `undefined` when none is set or usable. */
  workingRoot: string | undefined;
};

/** One source of instruction context: what it says this turn, and where it sits in the order. */
export type InstructionSource = {
  /** Names the hook and the `<instruction-context>` entries in history; unique per run. */
  name: string;
  /** Lower runs first among the registered sources. */
  order: number;
  /** Read per turn when set, so a folder chosen mid-run applies on the next model call. */
  workingRoots?: SourceWorkingRoots;
  /** The instructions that apply now, or `undefined` when none do. */
  resolve: (input: InstructionSourceInput) => Promise<string | undefined> | string | undefined;
};

/** A hook built from a source, with the position its source declared. */
export type InstructionHook = { hook: Hook; order: number };
