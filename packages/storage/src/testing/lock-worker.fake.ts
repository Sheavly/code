import path from 'node:path';
import { modelIdSchema } from '@sheavly/protocol/model/model.validator';
import { profileIdSchema } from '@sheavly/protocol/profile/profile.validator';
import { ConfigStore } from '../config-store/config-store.service.js';
import { CredentialStore } from '../credential-store/credential-store.service.js';
import { DocumentFile } from '../document-file/document-file.service.js';
import { PermissionStore } from '../permission-store/permission-store.service.js';

/**
 * Test-only: run as a child process by the two-process test. `argv`: the user's folder, a worker
 * name and how many changes to make. Each change adds one entry of its own to config, credentials,
 * permissions and a document, so the test can count that none of them was lost.
 */
const [root = '', worker = '', countText = '0'] = process.argv.slice(2);
const config = new ConfigStore({ root });
const credentials = new CredentialStore({ folder: path.join(root, 'profile') });
const permissions = new PermissionStore({ root });
const document = new DocumentFile({ file: path.join(root, 'trust.json') });
const profile = profileIdSchema.parse('9d2c7e10-6a4b-4f38-b1e5-5c0a8d3f2b99');

for (let index = 0; index < Number(countText); index += 1) {
  const tag = `${worker}-${String(index)}`;
  const key = `${worker.charCodeAt(0).toString(16)}${String(index).padStart(2, '0')}`.padEnd(
    64,
    '0',
  );
  const model = modelIdSchema.parse(
    `00000000-0000-4000-8000-${worker.charCodeAt(0).toString(16).padStart(4, '0')}${String(index).padStart(8, '0')}`,
  );

  await config.bindWorkspace({ key, profile });
  await credentials.put({ id: model, secrets: { apiKey: tag } });
  await permissions.allow({ realPath: root, entry: tag });
  await document.update((current) => ({
    ...(current as Record<string, true> | undefined),
    [tag]: true,
  }));
}
