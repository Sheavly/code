import type { DocumentStore } from '@sheavly/core/store/store.types';
import { DocumentFile } from '../document-file/document-file.service.js';
import { asStoreError } from './conversation-store.utils.js';

/**
 * A `DocumentStore` over the JSON document in `file`, rejecting with a `StoreError` as the
 * contract says. One `DocumentFile` per file, so every change goes through its one queue and two
 * callers never erase each other.
 */
export function documentStoreOf(file: string): DocumentStore {
  const document = new DocumentFile({ file });

  return {
    load: async () => {
      try {
        return await document.load();
      } catch (caughtError) {
        throw asStoreError(caughtError);
      }
    },
    update: async (change) => {
      try {
        await document.update(change);
      } catch (caughtError) {
        throw asStoreError(caughtError);
      }
    },
  };
}
