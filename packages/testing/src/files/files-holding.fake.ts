import { readFile, readdir } from 'node:fs/promises';
import path from 'node:path';

/**
 * Test-only: the files under `folder`, at any depth, whose content has `text` in it (temp files
 * included). For proving a secret reached the one place it belongs and no other, or that removing
 * it left no copy.
 */
export async function filesHolding(params: { folder: string; text: string }): Promise<string[]> {
  const { folder, text } = params;
  const found: string[] = [];

  for (const entry of await readdir(folder, { recursive: true, withFileTypes: true })) {
    if (!entry.isFile()) continue;

    const file = path.join(entry.parentPath, entry.name);

    if ((await readFile(file, 'utf8')).includes(text)) found.push(file);
  }

  return found;
}
