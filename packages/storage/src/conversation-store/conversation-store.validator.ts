import { z } from 'zod';
import { messageSchema } from '@sheavly/protocol/message/message.validator';

/** A history as `history.json` and a sub-agent's history file hold it: the messages, in order. */
export const historySchema = z.array(messageSchema);
