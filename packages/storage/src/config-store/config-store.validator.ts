import { z } from 'zod';
import { profileIdSchema } from '@sheavly/protocol/profile/profile.validator';

/**
 * A workspace's key in the config: what its folder under a profile is named. A hash of the real
 * path (see `workspaceKey`), so 64 lowercase hex characters, never the path itself.
 */
const workspaceKeySchema = z.string().regex(/^[0-9a-f]{64}$/, 'Use a workspace key');

/**
 * The user's `config.json`: which profile is the default, and which profile each workspace uses.
 * A workspace not bound uses the default. Every profile named here exists: `ConfigStore` is kept
 * in step with the profiles, so config never points at one that is gone.
 */
export const configFileSchema = z.object({
  defaultProfile: profileIdSchema.exactOptional(),
  workspaces: z.record(workspaceKeySchema, profileIdSchema).default({}),
});
