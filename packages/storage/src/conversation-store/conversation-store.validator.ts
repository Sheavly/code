import { z } from 'zod';
import { historyMessageSchema } from '@sheavly/protocol/message/message.validator';

/**
 * A history as `history.json` and a sub-agent's history file hold it: the messages and any
 * checkpoints, in order.
 */
export const historySchema = z.array(historyMessageSchema);
