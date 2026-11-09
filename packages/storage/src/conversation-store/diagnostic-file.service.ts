import path from 'node:path';
import type { ConversationId } from '@sheavly/protocol/server/server.types';
import type { SessionId } from '@sheavly/protocol/session/session.types';
import type { ModelId } from '@sheavly/protocol/model/model.types';
import type { StreamEntry } from '@sheavly/protocol/stream/stream.types';
import { appendJsonLine, readJsonLines, trimPartialLine } from '../jsonl-file/jsonl-file.helper.js';
import { ERRORS_FILE } from './conversation-store.constants.js';
import { diagnosticRecordSchema } from './diagnostic-record.validator.js';
import { diagnosticRecord } from './diagnostic-record.utils.js';

/** A recoverable fault-only projection of the authoritative stream; called in stream order. */
export class DiagnosticFile {
  readonly #file: string;
  readonly #conversationId: ConversationId | undefined;
  readonly #models = new Map<SessionId, ModelId>();
  #through = -1;

  constructor(params: { folder: string; conversationId?: ConversationId }) {
    this.#file = path.join(params.folder, ERRORS_FILE);
    this.#conversationId = params.conversationId;
  }

  async prepare(): Promise<void> {
    await trimPartialLine({ file: this.#file });
    this.#through = -1;
    this.#models.clear();

    for await (const record of readJsonLines({
      file: this.#file,
      schema: diagnosticRecordSchema,
    })) {
      this.#through = Math.max(this.#through, record.seq);
    }
  }

  /** Replaying the stream repairs a missing final log write without duplicating prior records. */
  async observe(entry: StreamEntry): Promise<void> {
    if (entry.kind === 'update' && entry.update.session.modelId) {
      this.#models.set(entry.sessionId, entry.update.session.modelId);
    }

    if (entry.seq <= this.#through) return;

    const record = diagnosticRecord({
      entry,
      conversationId: this.#conversationId,
      modelId: this.#models.get(entry.sessionId),
    });

    if (!record) return;

    await appendJsonLine({ file: this.#file, value: record });
    this.#through = entry.seq;
  }
}
