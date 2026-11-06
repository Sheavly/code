import { z } from 'zod';

/** User-wide terminal preferences. Defaults: animated activity, no bell. */
export const terminalSettingsSchema = z.object({
  reducedMotion: z.boolean().exactOptional(),
  bell: z.boolean().exactOptional(),
});
