// Writes the contract's JSON Schema and the API's OpenAPI document (`npm run schema -w
// @sheavly/protocol`). Both committed files are checked against the code by tests, so rerun this
// after changing a schema or a route.
import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { format, resolveConfig } from 'prettier';
import { OPENAPI_FILE } from './src/api/api.constants.ts';
import { openApiDocument } from './src/api/api.utils.ts';
import { CONTRACT_SCHEMA_FILE } from './src/contract/contract.constants.ts';
import { contractJsonSchema } from './src/contract/contract.utils.ts';

for (const [name, document] of [
  [CONTRACT_SCHEMA_FILE, contractJsonSchema()],
  [OPENAPI_FILE, openApiDocument()],
]) {
  const file = join(import.meta.dirname, name);
  const options = await resolveConfig(file);

  await writeFile(file, await format(JSON.stringify(document), { ...options, filepath: file }));
}
