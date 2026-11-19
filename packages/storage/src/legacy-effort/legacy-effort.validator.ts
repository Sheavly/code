import { z } from 'zod';
import { profileSchema } from '@sheavly/protocol/profile/profile.validator';
import { storedConversationSchema } from '@sheavly/protocol/store/store.validator';
import { readLegacyConversationIndex, readLegacyProfile } from './legacy-effort.utils.js';

/** What `profile.json` holds, including the files written before "mode" became "effort". */
export const storedProfileFileSchema = z.preprocess(readLegacyProfile, profileSchema);

/** What a conversation's `index.json` holds, including the files written before "mode" became "effort". */
export const storedConversationIndexSchema = z.preprocess(
  readLegacyConversationIndex,
  storedConversationSchema,
);
