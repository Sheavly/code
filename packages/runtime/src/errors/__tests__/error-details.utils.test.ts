import { describe, expect, it } from 'vitest';
import { errorDetails } from '../error-details.utils.js';
import { redactDiagnosticText } from '@sheavly/core/text/diagnostic-text.utils';

describe('safe error diagnostics', () => {
  it('retains the stack and cause code while excluding request data and credentials', () => {
    const cause = Object.assign(new Error('Bearer private-token'), { code: 'ECONNRESET' });
    const error = Object.assign(new Error('apiKey=private-key', { cause }), {
      reason: 'network',
      request: { headers: { authorization: 'private-header' }, body: 'private-body' },
    });
    const details = errorDetails(error);

    expect(details.reason).toBe('network');
    expect(details.causes).toEqual([
      { name: 'Error', code: 'ECONNRESET', message: 'Bearer [REDACTED]' },
    ]);
    expect(details.stack).toContain('apiKey=[REDACTED]');
    expect(JSON.stringify(details)).not.toContain('private-');
    expect(details).not.toHaveProperty('request');
  });

  it('bounds cause chains and stops at cycles', () => {
    const cyclic = new Error('Cycle');

    cyclic.cause = cyclic;
    expect(errorDetails(cyclic).causes).toEqual([]);

    let error = new Error('Root');

    for (let i = 0; i < 8; i++) error = new Error(`Cause ${String(i)}`, { cause: error });
    expect(errorDetails(error).causes).toHaveLength(4);
    expect(errorDetails('plain string')).toEqual({ name: 'UnknownError', causes: [] });
  });

  it('redacts credential fields and common API key formats in diagnostic text', () => {
    expect(redactDiagnosticText('password="abc" access_token=def sk-12345678901234567890')).toBe(
      'password="[REDACTED]" access_token=[REDACTED] [REDACTED]',
    );
  });

  it('redacts a quoted value that holds spaces, up to its closing quote', () => {
    expect(redactDiagnosticText('{"password":"a b c","user":"ann"}')).toBe(
      '{"password":"[REDACTED]","user":"ann"}',
    );
  });

  it.each([
    ['Incorrect API key provided: abcd1234efgh', 'Incorrect API key provided: [REDACTED]'],
    ['GET /v1/x?key=abcd1234&n=1', 'GET /v1/x?key=[REDACTED]&n=1'],
    ['Authorization: Basic dXNlcjpwYXNzd29yZA==', 'Authorization: Basic [REDACTED]'],
    ['Cookie: session=abc; other=def', 'Cookie: [REDACTED]'],
    ['token=abcdef', 'token=[REDACTED]'],
    [`bad key ${'a1'.repeat(16)} end`, 'bad key [REDACTED] end'],
  ])('redacts %s', (text, expected) => {
    expect(redactDiagnosticText(text)).toBe(expected);
  });

  it('leaves ordinary text, short hex and dashed ids alone', () => {
    const text = 'Request 4f9c failed for 123e4567-e89b-12d3-a456-426614174000 after 3 tries';

    expect(redactDiagnosticText(text)).toBe(text);
  });
});
