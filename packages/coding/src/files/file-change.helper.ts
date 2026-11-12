import type { Workspace } from '@sheavly/workspace/workspace/workspace.service';
import type { FileChange, FileChangeVerb } from './files.types.js';
import { describeChange } from './files.utils.js';
import { displayPath } from './working-root.helper.js';

/**
 * The result a file tool returns for a change: the one-line description a model reads, and the
 * `FileChange` artifact a UI renders. Built together so a tool can't report a path or a content
 * pair the other doesn't see; `suffix` adds to the description (an edit's replacement count).
 */
export function changeResult(params: {
  workspace: Workspace;
  file: string;
  verb: FileChangeVerb;
  before: string | null;
  after: string | null;
  suffix?: string;
  /** The working root the path is shown from, when one is set. */
  root: string | undefined;
}): { content: string; artifacts: FileChange[] } {
  const { workspace, file, verb, before, after, suffix = '', root } = params;
  const relative = displayPath({ workspace, root, absolute: file });
  const change: FileChange = { kind: 'file_change', path: relative, before, after };

  return {
    content: `${describeChange({ verb, path: relative, before, after })}${suffix}`,
    artifacts: [change],
  };
}
