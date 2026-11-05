import type { z } from 'zod';
import type {
  allowEntrySchema,
  permissionModeSchema,
  permissionsSchema,
} from './permission.validator.js';

export type PermissionMode = z.infer<typeof permissionModeSchema>;

/** One allow-list entry, such as `git log *`. */
export type AllowEntry = z.infer<typeof allowEntrySchema>;

export type Permissions = z.infer<typeof permissionsSchema>;
