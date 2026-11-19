import { deepFreeze } from '../extension/deep-freeze.utils.js';

/**
 * Which grant each method of each scoped run service needs, declared once. The host derives every
 * scope's run-time check and each service's list of grants from it, and a lint rule reads it from
 * source, so it stays a plain literal: nested object literals, string literals and plain or quoted
 * names, with no spread, no computed key, no call and no imported value.
 *
 * The shape is `service name -> member name -> entry`, where the service name is the `name` of its
 * key in `run-services.utils` and an entry is one of two forms:
 *
 * - a grant string: every call of the member needs that grant;
 * - `{ grant, arguments }`: every call needs `grant`, and a call that uses an optional argument
 *   (a property of its parameter) also needs the grant `arguments` names for it.
 *
 * `main-session` and `instructions` need no grant and are absent. A member that is not here is not
 * gated: the host's tests fail when a scope has a member this table does not list.
 */
export const RUN_SERVICE_GRANTS = {
  'session-info': {
    get: 'session:read',
    list: 'session:read',
    isReleased: 'session:read',
    releasedStarts: 'session:read',
    onLifecycle: 'session:read',
  },
  'child-sessions': {
    startChild: 'sub-agent:create',
    setModel: 'sub-agent:create',
    send: 'sub-agent:message',
    onUpdate: 'sub-agent:observe',
    report: 'sub-agent:report',
    runChild: 'sub-agent:create',
  },
  'background-tasks': {
    start: 'task:start',
    get: 'task:read',
    report: 'task:read',
    list: 'task:read',
    observe: 'task:read',
    cancel: 'task:cancel',
    group: 'task:cancel',
  },
  'task-control': {
    getOwned: 'task:read-any',
    list: 'task:read-any',
    report: 'task:read-any',
    cancel: 'task:cancel-any',
    group: 'task:cancel-any',
  },
  model: {
    stream: 'model:call',
  },
  approvals: {
    request: {
      grant: 'approval:request',
      arguments: {
        tool: 'approval:as-tool',
        options: 'approval:keep',
        keeps: 'approval:keep',
      },
    },
    listening: 'approval:request',
  },
  'output-reader': {
    log: 'output:read',
    read: 'output:read',
    search: 'output:read',
  },
  'output-capture': {
    create: 'output:capture',
  },
} as const;

// Frozen in the module that defines the table, so it is frozen when it first loads: `@sheavly/extension`
// exports this file, and code that could change it would change what the host checks for everyone.
deepFreeze(RUN_SERVICE_GRANTS);
