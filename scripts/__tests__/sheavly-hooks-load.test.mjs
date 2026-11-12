// The repo's own `.sheavly/` hooks load through `loadProjectHooks` the way the backend loads them:
// trusted, confined to `.sheavly/` and Node built-ins, each default export a valid hook. A copy of
// the folder is loaded in a temp project, so the real folder's trust fingerprint is never touched.
import { cpSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { loadProjectHooks } from '../../packages/workspace/src/project-hooks/project-hooks.helper.ts';
import { memoryTrust } from '../../packages/workspace/src/testing/trust.fake.ts';
import { TrustStore } from '../../packages/workspace/src/trust/trust.service.ts';
import { REPO_ROOT } from './temp-repo.utils.mjs';

let project = '';

afterEach(() => {
  rmSync(project, { recursive: true, force: true });
});

/** A temp project holding a copy of this repo's `.sheavly/`. */
function copyOfSheavly() {
  project = mkdtempSync(path.join(os.tmpdir(), 'sheavly-load-'));
  writeFileSync(path.join(project, 'package.json'), JSON.stringify({ type: 'module' }));
  cpSync(path.join(REPO_ROOT, '.sheavly'), path.join(project, '.sheavly'), { recursive: true });

  return project;
}

describe("this repo's .sheavly hooks", () => {
  it('load in a trusted workspace, in manifest order, as valid hooks', async () => {
    const root = copyOfSheavly();
    const trust = new TrustStore({
      persistence: memoryTrust({ file: path.join(os.tmpdir(), 't.json') }),
    });
    const loaded = await loadProjectHooks({ root, trust, grant: true });

    expect(loaded.trust).toBe('trusted');
    expect(loaded.hooks.map(({ name }) => name)).toEqual([
      'dev-session-start',
      'dev-edit-feedback',
      'dev-shell-guard',
    ]);
  });

  it('load nothing, and import nothing, in a workspace that is not trusted', async () => {
    const root = copyOfSheavly();
    const trust = new TrustStore({
      persistence: memoryTrust({ file: path.join(os.tmpdir(), 't.json') }),
    });

    expect(await loadProjectHooks({ root, trust })).toEqual({ hooks: [], trust: 'untrusted' });
  });
});
