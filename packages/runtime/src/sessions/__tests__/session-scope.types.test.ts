import { describe, expectTypeOf, it } from 'vitest';
import type { SessionUpdate } from '@sheavly/protocol/session/session.types';
import type {
  ChildSessionScope,
  SessionInfoView,
  SessionLifecycleUpdate,
} from '../session-scope.types.js';

describe('the session scope contracts', () => {
  it('delivers only lifecycle updates, never a message', () => {
    expectTypeOf<SessionLifecycleUpdate>().toExtend<SessionUpdate>();
    expectTypeOf<SessionLifecycleUpdate['type']>().toEqualTypeOf<
      'session_started' | 'session_idle' | 'session_resumed' | 'session_ended' | 'session_released'
    >();
    expectTypeOf<Parameters<SessionInfoView['onLifecycle']>[0]>()
      .parameter(0)
      .toEqualTypeOf<SessionLifecycleUpdate>();
  });

  it('keeps the session info view read-only', () => {
    expectTypeOf<SessionInfoView>().not.toHaveProperty('send');
    expectTypeOf<SessionInfoView>().not.toHaveProperty('end');
    expectTypeOf<SessionInfoView>().not.toHaveProperty('subscribe');
  });

  it('never lets a child be sent a message as the user, nor exposes the registry verbs', () => {
    expectTypeOf<Parameters<ChildSessionScope['send']>[0]['from']>().not.toEqualTypeOf<'user'>();
    expectTypeOf<'user'>().not.toExtend<Parameters<ChildSessionScope['send']>[0]['from']>();
    expectTypeOf<ChildSessionScope>().not.toHaveProperty('release');
    expectTypeOf<ChildSessionScope>().not.toHaveProperty('end');
    expectTypeOf<ChildSessionScope>().not.toHaveProperty('takeMessages');
  });
});
