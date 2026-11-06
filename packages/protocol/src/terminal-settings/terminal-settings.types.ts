import type { z } from 'zod';
import type { terminalSettingsSchema } from './terminal-settings.validator.js';

export type TerminalSettings = z.infer<typeof terminalSettingsSchema>;
