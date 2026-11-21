/**
 * Test-only preload (`node --import`): makes every `fs.promises.rename` take 1.5 s longer, so a
 * test can signal a server while it is in the middle of writing a file. Builtin ESM exports are
 * synced because the code under test imports `rename` by name.
 */
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import { syncBuiltinESMExports } from 'node:module';

const original = fsp.rename;
const DELAY_MS = 1500;

fsp.rename = async (...args: Parameters<typeof original>) => {
  await new Promise((resolve) => setTimeout(resolve, DELAY_MS));

  return original(...args);
};

fs.promises.rename = fsp.rename;
syncBuiltinESMExports();
