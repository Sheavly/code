/** Unchanged lines kept around each change, as in `git diff -U2`. */
export const DIFF_CONTEXT = 2;

/**
 * The most edits jsdiff searches for before giving up. A rewrite past it is shown as hidden
 * lines rather than holding the screen while the diff is computed.
 */
export const DIFF_MAX_EDIT_LENGTH = 2000;

/** The most rows one diff shows when it is expanded; the rest is counted, not drawn. */
export const DIFF_EXPANDED_ROWS = 500;

/** Columns a tab takes in a diff row. */
export const DIFF_TAB_WIDTH = 4;

/** Under the `⎿` of the step's result line. */
export const DIFF_INDENT = '    ';

/** The least columns a diff row's text gets, however narrow the terminal. */
export const DIFF_MIN_TEXT_WIDTH = 10;
