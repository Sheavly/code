// Writes the contract's JSON Schema (`npm run schema -w @sheavly/protocol`). The committed file is
// checked against the schemas by `contract.utils.test.ts`, so rerun this after changing one.
import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { format, resolveConfig } from 'prettier';
import { CONTRACT_SCHEMA_FILE } from './src/contract/contract.constants.ts';
import { contractJsonSchema } from './src/contract/contract.utils.ts';

const file = join(import.meta.dirname, CONTRACT_SCHEMA_FILE);
const options = await resolveConfig(file);
const json = await format(JSON.stringify(contractJsonSchema()), { ...options, filepath: file });

await writeFile(file, json);
