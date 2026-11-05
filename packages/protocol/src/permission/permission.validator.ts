import { z } from 'zod';
import { workspaceRequestSchema } from '../setup/setup.validator.js';

/**
 * How `run_command` treats a command for one folder, for every conversation running in it:
 * `ask` runs listed commands and asks about the rest; `always_ask` asks about every command,
 * listed or not; `allow_all` runs everything without asking.
 */
export const permissionModeSchema = z.enum(['ask', 'always_ask', 'allow_all']);

/**
 * One command the user allowed for good: words separated by single spaces, the last one `*`
 * for any arguments (`git log *`) or the exact command without it (`git status`). The first
 * word is a program, never `*`, since that would allow every command.
 */
export const allowEntrySchema = z
  .string()
  .max(500)
  .regex(/^\S+( \S+)*$/, 'Write the words of the command separated by single spaces')
  .refine((entry) => entry.split(' ')[0] !== '*', 'Start with the program, not *');

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
 * `allow` is the user's own entries, and `builtIn` the read-only commands that run without
 * asking in every folder, which are not the user's to remove.
 */
export const workspacePermissionsSchema = permissionsSchema.extend({
  workspace: z.string(),
  builtIn: z.array(allowEntrySchema),
});
