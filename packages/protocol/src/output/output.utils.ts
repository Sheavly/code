import { OUTPUT_REF_LABEL } from './output.constants.js';
import { outputRefSchema } from './output.validator.js';
import type { OutputRef } from './output.types.js';

const OUTPUT_REF_PATTERN = new RegExp(
  `${OUTPUT_REF_LABEL}([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})`,
  'g',
);

/** Every distinct output reference written in `text`, in order of first appearance. */
export function findOutputRefs(text: string): OutputRef[] {
  const found = new Set<OutputRef>();

  for (const match of text.matchAll(OUTPUT_REF_PATTERN)) {
    const parsed = outputRefSchema.safeParse(match[1]);

    if (parsed.success) found.add(parsed.data);
  }

  return [...found];
}
