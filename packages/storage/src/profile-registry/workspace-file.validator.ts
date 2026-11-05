import { z } from 'zod';

/** A workspace's `workspace.json`: the real path its folder's name is a hash of. */
export const workspaceFileSchema = z.object({ root: z.string().min(1) });
