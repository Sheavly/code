import type { SubAgentScope } from '@sheavly/agents/agents/agents.types';
import type { Provider } from '@sheavly/core/provider/provider.types';
import type {
  ApprovalRequester,
  BackgroundTaskScope,
  ChildSessionScope,
  OutputCapture,
  OutputReader,
  SessionInfoView,
  TaskControl,
} from '@sheavly/extension/run-services/run-services.types';
import type { SessionRef } from '@sheavly/protocol/session/session.types';
import type { openBackendRun } from './backend-run.fake.js';

/** Test-only: the scoped services a scope probe extension was given when the run activated it. */
export type ProbeScopes = {
  info: SessionInfoView;
  child: ChildSessionScope;
  tasks: BackgroundTaskScope;
  control: TaskControl;
  approvals: ApprovalRequester;
  model: Provider;
  main: SessionRef;
  reader: OutputReader | undefined;
  capture: OutputCapture | undefined;
  /** The `sub-agents` scope, held only by a probe made with `subAgents`. */
  sharing: SubAgentScope | undefined;
};

/** Test-only: the backend run `openBackendRun` resolves to. */
export type OpenedRun = Awaited<ReturnType<typeof openBackendRun>>;

/** Test-only: a request to a test API, as a client sends it (the token is added for it). */
export type TestRequest = { method?: string; body?: unknown; headers?: Record<string, string> };

/** Test-only: anything a request helper can send a request through: a test backend's `call`. */
export type TestCaller = {
  call: (path: string, init?: { method?: string; body?: unknown }) => Promise<Response> | Response;
};
