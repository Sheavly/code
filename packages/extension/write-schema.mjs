// Writes the JSON Schema of `sheavly.json` (`npm run schema -w @sheavly/extension`). A test checks
// the committed file against the code, so rerun this after changing the manifest schema.
import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { format, resolveConfig } from 'prettier';
import { MANIFEST_SCHEMA_FILE } from './src/manifest/manifest.constants.ts';
import { manifestJsonSchema } from './src/manifest/manifest.utils.ts';

const file = join(import.meta.dirname, MANIFEST_SCHEMA_FILE);
const options = await resolveConfig(file);

await writeFile(
  file,
  await format(JSON.stringify(manifestJsonSchema()), { ...options, filepath: file }),
);
