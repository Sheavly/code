/** The harness's folder at a project root (and later at `~`), like `.cursor`. */
export const SHEAVLY_DIR = '.sheavly';

/** The manifest inside `SHEAVLY_DIR`: which hook files run, in order. The only required file. */
export const HOOKS_MANIFEST = 'hooks.json';

/** The longest hook name, and so the longest name an `after` may hold. */
export const MAX_HOOK_NAME_CHARS = 100;

/** The most hooks one hook may name in `after`, so ordering stays cheap. */
export const MAX_HOOK_AFTER = 32;

/** What Node 24 loads natively. `.mjs`/`.mts` are always ESM, `.cjs`/`.cts` always CommonJS. */
export const HOOK_EXTENSIONS = ['.js', '.mjs', '.cjs', '.ts', '.mts', '.cts'];
