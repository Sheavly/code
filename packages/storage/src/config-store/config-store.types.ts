import type { z } from 'zod';
import type { configFileSchema } from './config-store.validator.js';

/** The user's `config.json`, read: the default profile and each workspace's. */
export type Config = z.infer<typeof configFileSchema>;

/** The file systems a path is compared on: the system's own, or a named one for a test. */
export type PathPlatform = 'win32' | 'posix';
