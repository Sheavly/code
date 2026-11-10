import type { SessionRegistry } from '@sheavly/runtime/sessions/sessions.service';
import type { ConversationStorage } from '@sheavly/host/conversations/conversations.types';
import { UsageLedger } from '@sheavly/runtime/usage/usage.service';

/** Reads the full stored log, not just its bounded tail; recorded costs survive later price changes. */
export async function trackConversationUsage(params: {
  sessions: SessionRegistry;
  storage: ConversationStorage | undefined;
}) {
  const ledger = new UsageLedger();
  const reported = new Set<string>();

  if (params.storage?.resume) {
    for await (const entry of params.storage.entries.read()) {
      ledger.observe(entry);
      if (entry.kind !== 'event') continue;

      // A summary call's usage is counted by the ledger above, but it does not stand in for the
      // turn's own report: a turn that reported none is still incomplete.
      if (entry.event.type === 'usage' && entry.event.usage.purpose !== 'summary') {
        reported.add(entry.sessionId);
      }

      if (entry.event.type === 'turn_end' && !reported.delete(entry.sessionId)) {
        ledger.markIncomplete();
      }
    }
  }

  const stop = params.sessions.subscribeEntries((entry) => ledger.observe(entry));

  return { ledger, stop };
}
