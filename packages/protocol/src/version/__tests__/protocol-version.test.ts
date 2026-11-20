import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { OPENAPI_FILE } from '../../api/api.constants.js';
import { CONTRACT_SCHEMA_FILE } from '../../contract/contract.constants.js';
import { PROTOCOL_VERSION } from '../protocol-version.constants.js';
import { PROTOCOL_VERSION_FILE } from '../version.constants.js';
import { protocolVersionSchema } from '../version.validator.js';

const PACKAGE_ROOT = join(import.meta.dirname, '../../..');

async function readJson(file: string): Promise<Record<string, unknown>> {
  return JSON.parse(await readFile(join(PACKAGE_ROOT, file), 'utf8')) as Record<string, unknown>;
}

async function packageVersion(): Promise<unknown> {
  return (await readJson('package.json')).version;
}

/** The version a generated constants file declares, read from its text. */
function declaredVersion(source: string): string | undefined {
  return /PROTOCOL_VERSION = '([^']*)'/.exec(source)?.[1];
}

describe('the protocol version', () => {
  it('is the package version, in the generated constant (rerun `npm run schema -w @sheavly/protocol`)', async () => {
    expect(PROTOCOL_VERSION).toBe(await packageVersion());
    expect(declaredVersion(await readFile(join(PACKAGE_ROOT, PROTOCOL_VERSION_FILE), 'utf8'))).toBe(
      await packageVersion(),
    );
  });

  it('is a valid protocol version', () => {
    expect(protocolVersionSchema.safeParse(PROTOCOL_VERSION).success).toBe(true);
  });

  it('is contractVersion in contract.schema.json and info.version in openapi.json', async () => {
    const info = (await readJson(OPENAPI_FILE)).info as { version: unknown };

    expect((await readJson(CONTRACT_SCHEMA_FILE)).contractVersion).toBe(PROTOCOL_VERSION);
    expect(info.version).toBe(PROTOCOL_VERSION);
  });
});
