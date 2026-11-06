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
      if (entry.event.type === 'usage') reported.add(entry.sessionId);

      if (entry.event.type === 'turn_end' && !reported.delete(entry.sessionId)) {
        ledger.markIncomplete();
      }
    }
  }

  const stop = params.sessions.subscribeEntries((entry) => ledger.observe(entry));

  return { ledger, stop };
}
