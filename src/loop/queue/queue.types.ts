/** `T` plus the position it was emitted at. Distributes over unions. */
export type Sequenced<T> = T extends unknown ? { seq: number } & T : never;
