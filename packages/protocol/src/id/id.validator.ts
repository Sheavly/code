import { z } from 'zod';

/**
 * A UUID in lowercase: the shape of every id the harness names a file or folder by (a model's, a
 * profile's). A UUID can't name another path, so nothing else is accepted as a file name; lowercase,
 * so one thing can't have two names on a case-insensitive disk (macOS, Windows). Each kind of id
 * brands this, so one can't be passed where another goes.
 */
export const lowercaseUuidSchema = z.uuid().regex(/^[0-9a-f-]{36}$/, 'Use a lowercase UUID');
