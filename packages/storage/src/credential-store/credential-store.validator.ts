import { z } from 'zod';
import { modelIdSchema } from '@sheavly/protocol/model/model.validator';

/**
 * One model's secrets: the adapter's secret fields by name (`apiKey` today), each a non-empty
 * string. The names come from `AdapterDescription.secrets`; the store does not know them.
 */
export const secretsSchema = z.record(z.string().min(1), z.string().min(1));

/** A profile's `credentials.json`: each model's secrets, by model id. */
export const credentialsFileSchema = z.record(modelIdSchema, secretsSchema);
