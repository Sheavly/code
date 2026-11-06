/**
 * One row of a file change, as plain data: what a screen draws, with no colour or width in it.
 * `no` is the line's number in the new file, or in the old one for a removed line. `unchanged`
 * stands for lines folded away between two changes; `hidden` says how many changed lines the cap
 * left out at the end.
 */
export type DiffRow =
  | { kind: 'context' | 'added' | 'removed'; no: number; text: string }
  | { kind: 'unchanged'; count: number }
  | { kind: 'hidden'; count: number };
