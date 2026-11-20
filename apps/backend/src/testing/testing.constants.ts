/** Test-only: the token a test API is started with, and its requests carry. */
export const TEST_TOKEN = 'test-token';

/** Test-only: a token long and distinctive enough that finding it in an answer means a leak. */
export const TEST_LONG_TOKEN = 'long-distinctive-test-token-QmFyLUZvbyIsIm5vdCBhIHJlYWwgb25l';

/** Test-only: a valid instance id (43 base64url characters), unlike the token and every nonce. */
export const TEST_INSTANCE_ID_TEXT = 'Zm9vLWluc3RhbmNlLWlkLWZvci10ZXN0cy1vbmx5LTE';

/** Test-only: the server version a test API reports. */
export const TEST_SERVER_VERSION = '4.5.6';

/** Test-only: a value that must never show up in a report, a log line, an error or a response. */
export const TEST_SECRET = 'sk-SECRET-value-1234';

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

/** Test-only: the grant to share tools and hooks with sub-agents, which `ALL_GRANTS` leaves out. */
export const SHARE_GRANT = 'sub-agent:share';

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
