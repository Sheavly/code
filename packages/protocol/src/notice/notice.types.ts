import type { z } from 'zod';
import type { harnessNoticeSchema } from './notice.validator.js';

/** Notice data that UIs receive as structured protocol data, and that a model may be shown. */
export type HarnessNotice = z.infer<typeof harnessNoticeSchema>;
