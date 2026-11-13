import type { HistoryMessage } from '@sheavly/protocol/history/history.types';
import type { CallId } from '@sheavly/protocol/message/message.types';
import type { HarnessNotice } from '@sheavly/protocol/notice/notice.types';
import type { RunOutcome, SessionId, SessionInfo } from '@sheavly/protocol/session/session.types';

type SubAgent = Extract<SessionInfo, { parentId: SessionId }>;

/**
 * The sub-agents of `main` that ended and whose report never reached `history`, as stored, oldest
 * first. A sub-agent is delivered when `history` has an `agent-report` for its session, or a
 * completion notice for its starting call, alone or in a group.
 */
export function undeliveredAgents(params: {
  main: SessionId;
  sessions: readonly SessionInfo[];
  history: readonly HistoryMessage[];
}): SubAgent[] {
  const { main, sessions, history } = params;
  const delivered = deliveredIn(history);

  return sessions
    .filter((session): session is SubAgent => 'parentId' in session && session.parentId === main)
    .filter(
      (agent) => !delivered.sessions.has(agent.id) && !delivered.calls.has(agent.startedByCall),
    )
    .toSorted((first, second) => first.startedAt - second.startedAt);
}

/**
 * How a stored sub-agent's last run ended. One still open when the process ended was cut off: a
 * reopened conversation does not run it again.
 */
export function storedOutcome(agent: SubAgent): RunOutcome {
  if (agent.state === 'running' || agent.state === 'idle') return 'interrupted';

  return agent.state;
}

/**
 * The `agent-report` history entries a reopened conversation owes its main session, for the
 * sub-agents `undeliveredAgents` found, in that order and stamped `at`. `reports` holds the report
 * of each completed one that could be read back; a completed one with none (its history is
 * missing or unreadable) is `interrupted`, and any outcome but `completed` gets an empty report.
 * They carry no task id, since task ids restart when a conversation is reopened.
 */
export function restoredReportNotices(params: {
  agents: readonly SubAgent[];
  reports: ReadonlyMap<SessionId, string>;
  at: number;
}): HistoryMessage[] {
  const { agents, reports, at } = params;

  return agents.map((agent) => {
    const read = reports.get(agent.id);
    const stored = storedOutcome(agent);
    // A completed sub-agent is only reported as one when its report was read back.
    const { outcome, report } =
      stored === 'completed' && read !== undefined
        ? { outcome: stored, report: read }
        : { outcome: stored === 'completed' ? 'interrupted' : stored, report: '' };

    return {
      role: 'notice',
      notice: {
        kind: 'agent-report',
        // The card says how the sub-agent ended, not that it was open when the process did.
        agent: { ...agent, state: outcome, lastOutcome: outcome },
        outcome,
        report,
      },
      at,
    };
  });
}

type Delivered = { sessions: Set<SessionId>; calls: Set<CallId> };

function deliveredIn(history: readonly HistoryMessage[]): Delivered {
  const delivered: Delivered = { sessions: new Set(), calls: new Set() };

  for (const message of history) {
    if (message.role !== 'notice') continue;

    const { notice } = message;

    for (const member of notice.kind === 'tasks-finished' ? notice.notices : [notice]) {
      noteDelivered({ notice: member, delivered });
    }
  }

  return delivered;
}

function noteDelivered(params: { notice: HarnessNotice; delivered: Delivered }): void {
  const { notice, delivered } = params;

  if (notice.kind === 'agent-report') {
    delivered.sessions.add(notice.agent.id);
    addCall({ delivered, callId: notice.context?.callId });

    return;
  }

  if (notice.kind === 'task-finished') {
    addCall({ delivered, callId: notice.task.callId ?? notice.context?.callId });
  }
}

function addCall(params: { delivered: Delivered; callId: CallId | undefined }): void {
  if (params.callId !== undefined) params.delivered.calls.add(params.callId);
}
