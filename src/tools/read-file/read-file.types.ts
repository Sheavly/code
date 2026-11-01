/** The lines `selectLines` returned: 1-based, inclusive. `whole` when that is every line, uncut. */
export type ShownLines = {
  start: number;
  end: number;
  total: number;
  whole: boolean;
};
