import { z } from 'zod';
import { workspaceRequestSchema } from '../setup/setup.validator.js';

const exactArgvSchema = z
  .tuple([z.string().min(1)])
  .rest(z.string())
  .refine((argv) => argv[0] !== '*');

/** Decodes a legacy serialized grant; the coding layer now uses only its base-command identity. */
export function parseExactAllowEntry(entry: string): string[] | undefined {
  if (!entry.startsWith('exact:')) return undefined;

  let value: unknown;

  try {
    value = JSON.parse(entry.slice('exact:'.length));
  } catch (caughtError) {
    if (caughtError instanceof SyntaxError) return undefined;

    throw caughtError;
  }

  const parsed = exactArgvSchema.safeParse(value);

  return parsed.success ? parsed.data : undefined;
}

/**
 * How `run_command` treats a command for one folder, for every conversation running in it:
 * `ask` runs listed commands and asks about the rest; `always_ask` asks about every command,
 * listed or not; `allow_all` runs everything without asking.
 */
export const permissionModeSchema = z.enum(['ask', 'always_ask', 'allow_all']);

/**
 * A base-command grant, usually words ending in `*` (`git diff *`, `npm run test *`, `npx eslint *`).
 * Options and paths are not permission scopes. Older command strings and `exact:` JSON arrays
 * remain readable and now grant their base command too. A first word of `*` is never valid.
 */
export const allowEntrySchema = z.union([
  z
    .string()
    .max(500)
    .regex(/^\S+( \S+)*$/, 'Write the words of the command separated by single spaces')
    .refine((entry) => entry.split(' ')[0] !== '*', 'Start with the program, not *')
    .refine((entry) => !entry.startsWith('exact:'), 'Use a JSON argument array after exact:'),
  z
    .string()
    .regex(/^exact:\[/)
    .refine(
      (entry) => parseExactAllowEntry(entry) !== undefined,
      'Write a valid exact argument array',
    ),
]);

/** What a folder allows: its mode, and the commands the user allowed for good. */
export const permissionsSchema = z.object({
  mode: permissionModeSchema,
  allow: z.array(allowEntrySchema),
});

/** `PUT /permissions/mode`: how `run_command` treats commands in this folder from now on. */
export const setPermissionModeRequestSchema = workspaceRequestSchema.extend({
  mode: permissionModeSchema,
});

/** `POST /permissions/allow` and `/permissions/revoke`: allow, or stop allowing, one command. */
export const allowEntryRequestSchema = workspaceRequestSchema.extend({ entry: allowEntrySchema });

/**
 * `QUERY /permissions`: what a folder allows. `workspace` is the real path it is kept under;
 * `allow` is the user's own entries, and `builtIn` the default commands that run without
 * asking in every folder, which are not the user's to remove.
 */
export const workspacePermissionsSchema = permissionsSchema.extend({
  workspace: z.string(),
  builtIn: z.array(allowEntrySchema),
});
