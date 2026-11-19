/** Test-only: the token a test API is started with, and its requests carry. */
export const TEST_TOKEN = 'test-token';

/** Test-only: every grant of the v1 catalogue, what a scope probe holds unless a test narrows it. */
export const ALL_GRANTS = [
  'session:read',
  'sub-agent:create',
  'sub-agent:message',
  'sub-agent:observe',
  'sub-agent:report',
  'task:start',
  'task:read',
  'task:cancel',
  'task:read-any',
  'task:cancel-any',
  'output:read',
  'output:capture',
  'model:call',
  'approval:request',
  'approval:as-tool',
  'approval:keep',
];

/** Test-only: the two grants that widen an approval request beyond the default. */
export const APPROVAL_WIDENING_GRANTS = ['approval:as-tool', 'approval:keep'];

/**
 * Test-only: the extensions a test runs the same assertions for. A built-in declares its origin;
 * a third party leaves it out, as an extension written outside the repository does.
 */
export const PROBE_KINDS = [
  { label: 'built-in', origin: 'builtin' },
  { label: 'third-party', origin: undefined },
] as const;
