import { randomUUID } from 'node:crypto';
import { mkdir, open, rm, stat } from 'node:fs/promises';
import { z } from 'zod';
import { OutputError } from '@sheavly/core/errors/output.errors';
import { readLog, searchLog } from '@sheavly/core/output/output-range.helper';
import type {
  ByteSource,
  OutputRange,
  OutputSearch,
  OutputSearchParams,
  OutputStore,
  OutputWriter,
} from '@sheavly/core/output/output.types';
import {
  MAX_CONVERSATION_BYTES,
  MAX_CONVERSATION_LOGS,
  MAX_LOG_BYTES,
  MAX_PENDING_BYTES,
  OUTPUT_CLOSE_TIMEOUT_MS,
} from '@sheavly/protocol/output/output.constants';
import type { OutputLog, OutputRef } from '@sheavly/protocol/output/output.types';
import {
  outputLogSchema,
  outputRefSchema,
  outputStatusSchema,
} from '@sheavly/protocol/output/output.validator';
import { isMissingPath } from '@sheavly/runtime/errors/errors.utils';
import { PRIVATE_FILE_MODE, PRIVATE_FOLDER_MODE } from '../json-file/json-file.constants.js';
import { readJsonFile, writeJsonFile } from '../json-file/json-file.helper.js';
import { assertSafeRoot, namedPath } from '../safe-path/safe-path.helper.js';
import type { OutputStoreLimits } from './output-store.types.js';
import { deleted, notFound, tooManyLogs, unavailable } from './output-store.utils.js';
import { measureLogs } from './output-usage.helper.js';
import { FileOutputWriter } from './output-writer.service.js';

const metaSchema = z.object({ status: outputStatusSchema, reason: z.string().exactOptional() });

type Usage = { bytes: number; logs: number };

/**
 * One conversation's command output on disk: `<folder>/<ref>.log` holds the bytes as captured and
 * `<ref>.json` the final state, written when the capture ends. A log with no record is one whose
 * process died mid-capture, and is reported `incomplete`. A reference is a UUID, never a path, and
 * the folder is the conversation's, so another conversation's reference is `not_found`. The folder
 * goes with the conversation when it is deleted; nothing else removes a log.
 *
 * The conversation's quota (bytes and logs) is measured from disk once, then counted as captures
 * are accepted, so it holds across a reopen. It assumes this store is the only writer of its
 * folder, which `FileConversationStore` guarantees by keeping one per conversation.
 */
export class FileOutputStore implements OutputStore {
  readonly #folder: string;
  readonly #live = new Map<OutputRef, FileOutputWriter>();
  readonly #limits: OutputStoreLimits;
  /** Captures being started, so a delete can wait for them before it removes the folder. */
  readonly #starting = new Set<Promise<unknown>>();
  #usage: Promise<Usage> | undefined;
  #retired = false;

  /** `limits` is for tests: the protocol's limits are too large to reach in one. */
  constructor(params: { folder: string; limits?: Partial<OutputStoreLimits> }) {
    this.#folder = assertSafeRoot(params.folder);
    this.#limits = {
      maxLogBytes: MAX_LOG_BYTES,
      maxPendingBytes: MAX_PENDING_BYTES,
      closeTimeoutMs: OUTPUT_CLOSE_TIMEOUT_MS,
      quotaBytes: MAX_CONVERSATION_BYTES,
      maxLogs: MAX_CONVERSATION_LOGS,
      ...params.limits,
    };
  }

  /**
   * Starts a capture. Rejects with `quota_exceeded` when the conversation already holds its most
   * logs, `unavailable` when storage fails or the conversation was deleted. Bytes are counted
   * against the conversation's quota as they are accepted, so a log that would pass it ends
   * `incomplete` with the reason.
   */
  create(): Promise<OutputWriter> {
    const starting = this.#start();

    this.#starting.add(starting);

    return starting.finally(() => this.#starting.delete(starting));
  }

  /**
   * Ends every capture still running and refuses new ones, for a conversation being deleted: its
   * folder is about to go, and a command that is still printing must not make it again. Waits for
   * captures that were being started, so none is left to recreate the folder afterwards.
   */
  async retire(): Promise<void> {
    this.#retired = true;
    await Promise.allSettled([...this.#starting]);
    await Promise.all([...this.#live.values()].map((writer) => writer.close()));
  }

  /** Undoes `retire` when the delete it belonged to failed, so the conversation keeps working. */
  resume(): void {
    this.#retired = false;
  }

  async log(ref: OutputRef): Promise<OutputLog> {
    this.#assertOpen();

    const live = this.#live.get(ref);

    if (live) return live.log;

    const size = await this.#size(ref);
    const meta = await this.#readRecord(ref);
    // The record is held to the same rule as any log (a reason exactly when incomplete): one that
    // breaks it is as good as none, so a reader never gets a log the contract would reject.
    const stored = meta && outputLogSchema.safeParse({ ref, bytes: size, ...meta });

    if (!stored?.success) {
      return {
        ref,
        bytes: size,
        status: 'incomplete',
        reason: 'the capture ended without a final record (the process stopped while it ran)',
      };
    }

    return stored.data;
  }

  async read(params: { ref: OutputRef; offset: number; maxBytes: number }): Promise<OutputRange> {
    const log = await this.log(params.ref);

    return this.#withSource({
      ref: params.ref,
      work: (source) => readLog({ ...params, log, source }),
    });
  }

  async search(params: OutputSearchParams): Promise<OutputSearch> {
    const log = await this.log(params.ref);

    return this.#withSource({
      ref: params.ref,
      work: (source) => searchLog({ ...params, log, source }),
    });
  }

  async #start(): Promise<OutputWriter> {
    const ref = outputRefSchema.parse(randomUUID());
    let reserved: Usage | undefined;

    try {
      this.#assertOpen();

      const usage = await this.#usageOnDisk();

      // Checked and taken in one step, so concurrent starts cannot all pass the same check.
      if (usage.logs >= this.#limits.maxLogs) throw tooManyLogs(this.#limits.maxLogs);
      usage.logs += 1;
      reserved = usage;

      return await this.#open({ ref, usage });
    } catch (caughtError) {
      if (reserved) reserved.logs -= 1;
      if (caughtError instanceof OutputError) throw caughtError;
      throw unavailable(caughtError);
    }
  }

  async #open(params: { ref: OutputRef; usage: Usage }): Promise<FileOutputWriter> {
    const { ref, usage } = params;
    const file = this.#file({ ref, extension: '.log' });

    await mkdir(this.#folder, { recursive: true, mode: PRIVATE_FOLDER_MODE });

    const handle = await open(file, 'a', PRIVATE_FILE_MODE);

    if (this.#retired) {
      // Deleted while the file was being made: nothing owns it, so close it, and never keep it.
      await handle.close();
      await rm(file, { force: true });
      throw deleted();
    }

    const writer = new FileOutputWriter({
      ref,
      handle,
      onClosed: (log) => this.#record(log),
      limits: this.#limits,
      admit: (bytes) => {
        if (usage.bytes + bytes > this.#limits.quotaBytes) return false;
        usage.bytes += bytes;

        return true;
      },
      release: (bytes) => {
        usage.bytes -= bytes;
      },
    });

    this.#live.set(ref, writer);

    return writer;
  }

  #assertOpen(): void {
    if (this.#retired) throw deleted();
  }

  /** What is on disk now, read once; a failed read is not kept, so the next capture tries again. */
  #usageOnDisk(): Promise<Usage> {
    this.#usage ??= measureLogs(this.#folder).catch((caughtError: unknown) => {
      this.#usage = undefined;
      throw caughtError;
    });

    return this.#usage;
  }

  #file(params: { ref: string; extension: string }): string {
    return namedPath({ folder: this.#folder, name: params.ref, extension: params.extension });
  }

  async #record(log: OutputLog): Promise<void> {
    // A deleted conversation's folder is gone or going: a late record must not bring it back.
    if (this.#retired) {
      this.#live.delete(log.ref);

      return;
    }

    // Until the record exists a reader must still see the live writer, not a log "without a
    // record". If the write fails the writer stays, so its own reason is what readers get.
    await writeJsonFile({
      file: this.#file({ ref: log.ref, extension: '.json' }),
      value: { status: log.status, ...(log.reason !== undefined && { reason: log.reason }) },
    });
    this.#live.delete(log.ref);
  }

  async #readRecord(ref: OutputRef): Promise<z.infer<typeof metaSchema> | undefined> {
    try {
      return await readJsonFile({
        file: this.#file({ ref, extension: '.json' }),
        schema: metaSchema,
        holdsSecrets: true,
      });
    } catch (caughtError) {
      throw unavailable(caughtError);
    }
  }

  async #size(ref: OutputRef): Promise<number> {
    try {
      return (await stat(this.#file({ ref, extension: '.log' }))).size;
    } catch (caughtError) {
      if (isMissingPath(caughtError)) throw notFound(ref);
      throw unavailable(caughtError);
    }
  }

  /** Opens the log for the length of `work`, so a read never keeps a file open. */
  async #withSource<T>(params: {
    ref: OutputRef;
    work: (source: ByteSource) => Promise<T>;
  }): Promise<T> {
    const { ref, work } = params;
    const file = this.#file({ ref, extension: '.log' });
    const handle = await open(file, 'r').catch((caughtError: unknown) => {
      throw isMissingPath(caughtError) ? notFound(ref) : unavailable(caughtError);
    });

    try {
      return await work({
        size: async () => (await handle.stat()).size,
        read: async ({ offset, length }) => {
          const buffer = Buffer.alloc(length);
          const { bytesRead } = await handle.read(buffer, 0, length, offset);

          return buffer.subarray(0, bytesRead);
        },
      });
    } catch (caughtError) {
      if (caughtError instanceof OutputError) throw caughtError;
      throw unavailable(caughtError);
    } finally {
      await handle.close();
    }
  }
}
