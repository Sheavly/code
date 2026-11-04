import type { ServerErrorCode } from '@sheavly/protocol/server/server.types';
import type { StreamEntry } from '@sheavly/protocol/stream/stream.types';
import type { AnswerOf, EmptyRoute, JsonRoute, StreamRoute } from '../client/client.types.js';

/** Test-only: what a fake route was called with: its path params and its parsed body. */
export type FakeCall = { params: Record<string, string>; body: unknown };

/** Test-only: a refusal a fake route answers with, as a backend would. */
export type FakeRefusal = { refuse: { status: number; code: ServerErrorCode; message?: string } };

type Answer<T> = T | FakeRefusal | Promise<T | FakeRefusal>;

/** Test-only: how a fake answers each route it knows; one it doesn't know answers `not_found`. */
export type FakeHandlers = Partial<{
  [N in JsonRoute]: (call: FakeCall) => Answer<AnswerOf<N>>;
}> &
  Partial<Record<EmptyRoute, (call: FakeCall) => Answer<undefined>>> &
  Partial<Record<StreamRoute, (call: FakeCall) => AsyncIterable<StreamEntry>>>;
