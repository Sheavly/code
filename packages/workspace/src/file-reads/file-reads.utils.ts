import { createHash, type Hash } from 'node:crypto';

/**
 * A hash to feed a file's decoded text into, chunk by chunk, as a streaming read does.
 * `hashText` of the whole text gives the same digest, so a read and an edit agree on what a file
 * held. Every reader decodes UTF-8 the same way, so the text stands for the bytes.
 */
export function newTextHash(): Hash {
  return createHash('sha256');
}

/** The digest `FileReads` keeps of a file's text. */
export function hashText(text: string): string {
  return newTextHash().update(text).digest('hex');
}
