import type { z } from 'zod';
import type { harnessNoticeSchema } from './notice.validator.js';

/** A transient model notice that UIs also receive as structured protocol data. */
export type HarnessNotice = z.infer<typeof harnessNoticeSchema>;
