import { permissionsSchema } from '@sheavly/protocol/permission/permission.validator';
import { z } from 'zod';

/**
 * A workspace's `permissions/<workspace-key>.json`: its mode and the commands allowed (see
 * `permissionsSchema`), and `root`, the path its key is a hash of, for a person to read. The file
 * is trusted only under the key that root hashes to.
 */
export const permissionFileSchema = permissionsSchema.extend({ root: z.string().min(1) });
