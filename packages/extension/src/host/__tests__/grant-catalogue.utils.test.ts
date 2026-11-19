import { describe, expect, it } from 'vitest';
import { HOST_PROVIDER } from '../../extension/extension.constants.js';
import { defineService, hostServiceFor } from '../../extension/extension.utils.js';
import { fakeExtension } from '../../testing/extension.fake.js';
import { SYSTEM_PROMPT_EXTEND_GRANT } from '../../instructions/instructions.constants.js';
import { grantCatalogueOf } from '../grant-catalogue.utils.js';

const TASKS = defineService<object>('background-tasks');

describe('grantCatalogueOf', () => {
  it('lists a grant an extension offers under the service it provides', () => {
    const catalogue = grantCatalogueOf({
      services: [],
      extensions: [
        fakeExtension({
          name: 'agents',
          provides: ['sub-agents'],
          serviceGrants: { 'sub-agents': ['sub-agent:share', 'sub-agent:create'] },
        }),
      ],
    });

    expect(catalogue.get('sub-agent:share')).toEqual(['sub-agents']);
    expect(catalogue.get('sub-agent:create')).toEqual(['sub-agents']);
  });

  it('lists a grant of a host service and of an extension service together, and the host ones', () => {
    const catalogue = grantCatalogueOf({
      services: [
        hostServiceFor({ key: TASKS, grants: ['shared:use'], create: () => ({ value: {} }) }),
      ],
      extensions: [
        fakeExtension({
          name: 'maker',
          provides: ['made'],
          serviceGrants: { made: ['shared:use'] },
        }),
      ],
    });

    expect(catalogue.get('shared:use')).toEqual([TASKS.name, 'made']);
    expect(catalogue.get(SYSTEM_PROMPT_EXTEND_GRANT)).toEqual([HOST_PROVIDER]);
  });

  it('holds nothing of an extension that declares no service grants', () => {
    const catalogue = grantCatalogueOf({
      services: [],
      extensions: [fakeExtension({ name: 'plain', provides: ['made'] })],
    });

    expect([...catalogue.keys()]).toEqual([SYSTEM_PROMPT_EXTEND_GRANT, 'system-prompt:replace']);
  });
});
