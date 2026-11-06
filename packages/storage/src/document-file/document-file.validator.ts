import { z } from 'zod';

/**
 * A document file holds any JSON: what it means is its owner's to check, with the schema it
 * keeps. Storage reads it as it is.
 */
export const documentSchema = z.unknown();
