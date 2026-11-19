import { describe, expect, it } from 'vitest';
import * as exported from '@sheavly/extension/run-services/run-services.utils';
import { runSession } from '@sheavly/loop/stream-agent/stream-agent.helper';
import { routedProvider, say } from '@sheavly/testing/provider/routed-provider.fake';
import { MemoryOutputStore } from '@sheavly/testing/store/memory-output.fake';
import { createHarness } from '../../host/host.helper.js';
import { runServices } from '../run-services.helper.js';

/** The names a manifest lists in `services.requires`: they are the contract, so they are data. */
const PINNED_NAMES = [
  'approvals',
  'background-tasks',
  'child-sessions',
  'instructions',
  'main-session',
  'model',
  'output-capture',
  'output-reader',
  'session-info',
  'task-control',
];

function isServiceKey(value: unknown): value is { name: string } {
  return typeof value === 'object' && value !== null && 'name' in value;
}

const keyNames = Object.values(exported)
  .filter(isServiceKey)
  .map((key) => key.name)
  .sort();

const harness = () => createHarness({ provider: routedProvider({ go: [say('ok')] }), title: 'go' });

describe('the services the host supplies against the keys the extension package defines', () => {
  it('defines exactly the pinned names, so a renamed or added key is a deliberate change', () => {
    expect(keyNames).toEqual(PINNED_NAMES);
  });

  it('supplies every key under its exact name, and no name the extension package lacks', () => {
    const supplied = runServices({
      harness: harness(),
      outputs: new MemoryOutputStore(),
      runSession,
    }).map((service) => service.name);

    expect([...supplied].sort()).toEqual(keyNames);
  });

  it('supplies the same names without an output store: the output pair stays known, not absent', () => {
    const supplied = runServices({ harness: harness(), runSession }).map((service) => service.name);

    expect([...supplied].sort()).toEqual(PINNED_NAMES);
  });
});
