import type { Hook } from '@sheavly/core/hook/hook.types';
import type { WorkingRoots } from '../working-root/working-roots.service.js';

/** What the conversation's working root can tell a source: only its folder, read per turn. */
export type WorkingRootSource = Pick<WorkingRoots, 'root'>;

/** What a source sees on each turn. */
export type InstructionSourceInput = {
  signal: AbortSignal;
  /** The conversation's working root this turn, or `undefined` when none is set or usable. */
  workingRoot: string | undefined;
};

/** One source of instruction context: what it says this turn, and where it sits in the order. */
export type InstructionSource = {
  /** Names the hook and the `<instruction-context>` entries in history; unique per run. */
  name: string;
  /** Lower runs first among the registered sources. */
  order: number;
  /** Read per turn when set, so a working root chosen mid-run applies on the next model call. */
  workingRoots?: WorkingRootSource;
  /** The instructions that apply now, or `undefined` when none do. */
  resolve: (input: InstructionSourceInput) => Promise<string | undefined> | string | undefined;
};

/** A hook built from a source, with the position its source declared. */
export type InstructionHook = { hook: Hook; order: number };
