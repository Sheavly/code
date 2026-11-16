import { createWriteStream } from 'node:fs';
import { Writable } from 'node:stream';

/**
 * Writes a conversation's raw SSE stream (what a UI reads) to `file` as it arrives, until `stop`
 * is aborted; the file then holds everything up to there. Resolves when it has ended, and rejects
 * only for a failure that is not `stop` ending it (the file could not be written, the stream
 * broke). The one place the demo and the workbook's `RunRecorder` capture the stream.
 */
export function saveRawStream(params: {
  stream: ReadableStream<Uint8Array>;
  file: string;
  stop: AbortController;
}): Promise<void> {
  const { stream, file, stop } = params;

  return stream
    .pipeTo(Writable.toWeb(createWriteStream(file)) as WritableStream<Uint8Array>)
    .catch((caughtError: unknown) => {
      // Stopping aborts the pipe: expected, the file has everything up to there.
      if (!stop.signal.aborted) throw caughtError;
    });
}
