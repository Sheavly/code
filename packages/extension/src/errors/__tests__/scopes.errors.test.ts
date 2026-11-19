import { describe, expect, it } from 'vitest';
import { ScopeDeactivatedError } from '../scopes.errors.js';

describe('ScopeDeactivatedError', () => {
  const error = new ScopeDeactivatedError({ extension: 'notes', service: 'background-tasks' });

  it('names the service and the extension in its message', () => {
    expect(error.message).toBe(
      'The "background-tasks" service of extension "notes" was used after it deactivated',
    );
  });

  it('carries the extension and the service as fields', () => {
    expect(error.extension).toBe('notes');
    expect(error.service).toBe('background-tasks');
  });

  it('is an Error named ScopeDeactivatedError', () => {
    expect(error).toBeInstanceOf(Error);
    expect(error.name).toBe('ScopeDeactivatedError');
  });
});
