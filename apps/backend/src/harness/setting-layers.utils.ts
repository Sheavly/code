import { MAX_IGNORED_SETTING_FILE_CHARS } from '@sheavly/protocol/server/server.constants';
import type { IgnoredSettingReport } from '@sheavly/protocol/server/server.types';
import { printable } from '../log/printable.utils.js';

/**
 * A file path as the log and the wire show it: a folder's name may hold control characters or an
 * escape sequence, which are removed, and a path too long for the wire is cut at its start.
 */
export function reportedFile(file: string): string {
  return printable({ text: file, max: MAX_IGNORED_SETTING_FILE_CHARS });
}

/**
 * One log line per listed entry, such as `settings: ignored notes.mode from /w/.sheavly/settings.json: scope`,
 * then, when `more` entries were left out of the list, one line for them all
 * (`settings: ignored 980 more entries from /w/.sheavly/settings.json`). Built from the name, the
 * file and the reason only, so it can never echo a value; the file is shown by `reportedFile`.
 */
export function ignoredSettingLines(params: {
  ignored: readonly IgnoredSettingReport[];
  more: number;
}): string[] {
  const { ignored, more } = params;
  const lines = ignored.map(({ name, file, reason }) => {
    const what = name === undefined ? '' : ` ${name}`;
    const where =
      file === undefined ? '' : `${name === undefined ? ' ' : ' from '}${reportedFile(file)}`;

    return `settings: ignored${what}${where}: ${reason}`;
  });
  const file = ignored[0]?.file;

  if (more > 0) {
    lines.push(
      `settings: ignored ${String(more)} more entries${file === undefined ? '' : ` from ${reportedFile(file)}`}`,
    );
  }

  return lines;
}
