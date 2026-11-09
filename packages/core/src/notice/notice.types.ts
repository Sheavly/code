/** Transient harness data, not user input. Context counts must already be validated by the caller. */
export type HarnessNotice = {
  kind: 'context-usage';
  context: { window: number; used?: number | undefined } | { window?: undefined; used: number };
};
