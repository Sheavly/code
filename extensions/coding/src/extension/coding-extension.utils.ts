import { defineService } from '@sheavly/extension/extension/extension.utils';
import type { CodingRun } from './coding-extension.types.js';

/** The service the coding extension provides: the working root, skills and project hooks of the run. */
export const CODING_RUN = defineService<CodingRun>('coding-run');
