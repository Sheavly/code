/** The harness's folder at a project root (and later at `~`), like `.cursor`. */
export const SHEAVLY_DIR = '.sheavly';

/** The manifest inside `SHEAVLY_DIR`: which hook files run, in order. The only required file. */
export const HOOKS_MANIFEST = 'hooks.json';

/** What Node 24 loads natively. `.mjs`/`.mts` are always ESM, `.cjs`/`.cts` always CommonJS. */
export const HOOK_EXTENSIONS = ['.js', '.mjs', '.cjs', '.ts', '.mts', '.cts'];
