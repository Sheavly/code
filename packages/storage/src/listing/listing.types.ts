/** One file a store could not use, and why: reported, never hidden, never served. */
export type FileProblem = {
  /** The file or folder, absolute. */
  file: string;
  message: string;
};

/**
 * What reading one file of a listing gave: the item it holds, or what is wrong with it. Nothing
 * when it was removed between the folder being read and the file.
 */
export type ListedFile<T> = { item: T } | { problem: FileProblem } | undefined;
