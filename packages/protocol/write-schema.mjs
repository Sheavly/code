// Writes the contract's JSON Schema, the API's OpenAPI document and the route table in
// `docs/contract.md` (`npm run schema -w @sheavly/protocol`). Each committed file is checked
// against the code by tests, so rerun this after changing a schema or a route.
import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { format, resolveConfig } from 'prettier';
import { OPENAPI_FILE, ROUTE_TABLE_DOC } from './src/api/api.constants.ts';
import { openApiDocument, withRouteTable } from './src/api/api.utils.ts';
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

const docFile = join(import.meta.dirname, ROUTE_TABLE_DOC);
const withTable = withRouteTable(await readFile(docFile, 'utf8'));

if (withTable === null) throw new TypeError(`${ROUTE_TABLE_DOC} has no route table markers`);

await writeFile(
  docFile,
  await format(withTable, { ...(await resolveConfig(docFile)), filepath: docFile }),
);
