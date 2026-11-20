import { instanceIdSchema } from '@sheavly/protocol/handshake/handshake.validator';
import { TEST_INSTANCE_ID_TEXT } from './testing.constants.js';

/** Test-only: the instance id a test API is started with (`TEST_INSTANCE_ID_TEXT`, parsed). */
export const TEST_INSTANCE_ID = instanceIdSchema.parse(TEST_INSTANCE_ID_TEXT);
