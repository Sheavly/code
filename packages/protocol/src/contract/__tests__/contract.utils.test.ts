import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { CONTRACT_SCHEMA_FILE } from '../contract.constants.js';
import { contractJsonSchema } from '../contract.utils.js';

const PACKAGE_ROOT = join(import.meta.dirname, '../../..');

function refsIn(value: unknown): string[] {
  if (Array.isArray(value)) return value.flatMap(refsIn);
  if (typeof value !== 'object' || value === null) return [];

  return Object.entries(value).flatMap(([key, field]) =>
    key === '$ref' && typeof field === 'string' ? [field] : refsIn(field),
  );
}

describe('contractJsonSchema', () => {
  it('matches the committed JSON Schema (rerun `npm run schema -w @sheavly/protocol`)', async () => {
    const committed: unknown = JSON.parse(
      await readFile(join(PACKAGE_ROOT, CONTRACT_SCHEMA_FILE), 'utf8'),
    );

    expect(committed).toEqual(contractJsonSchema());
  });

  it('names every type of the contract under $defs', () => {
    const names = Object.keys(contractJsonSchema().$defs);

    expect(names).toEqual(
      expect.arrayContaining(['AgentEvent', 'SessionUpdate', 'ApprovalUpdate', 'ApprovalResponse']),
    );
  });

  it('only references types it defines', () => {
    const schema = contractJsonSchema();
    const targets = refsIn(schema.$defs).map((ref) => ref.replace('#/$defs/', ''));

    expect(targets.length).toBeGreaterThan(0);
    expect(targets.filter((name) => !(name in schema.$defs))).toEqual([]);
  });

  it('leaves no per-type $schema or $id inside $defs', () => {
    for (const definition of Object.values(contractJsonSchema().$defs)) {
      expect(definition).not.toHaveProperty('$schema');
      expect(definition).not.toHaveProperty('$id');
    }
  });
});
