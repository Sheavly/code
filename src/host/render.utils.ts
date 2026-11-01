import type { ToolCall } from '@sheavly/core/message/message.types';
import type { FileRead } from '@sheavly/core/tool/tool.types';
import { z } from 'zod';

/** Text squeezed onto one line, cut at `max` characters with an ellipsis. */
export function oneLine(params: { text: string; max: number }): string {
  const { text, max } = params;
  const flat = text.replace(/\s+/g, ' ').trim();

  return flat.length > max ? `${flat.slice(0, max)}…` : flat;
}

/** The first non-empty line, cut at 100 characters. */
export function firstLine(text: string): string {
  const max = 100;
  const line = text.split('\n').find((l) => l.trim()) ?? '';

  return line.length > max ? `${line.slice(0, max)}…` : line;
}

export function seconds(ms: number): string {
  return `${(ms / 1000).toFixed(1)}s`;
}

/** Session ids are UUIDs; the first 8 characters are plenty to tell them apart on screen. */
export function shortId(id: string | undefined): string {
  return id ? id.slice(0, 8) : '-';
}

/** The shell command of a `run_command` call, to show next to it. */
export function commandOf(call: ToolCall): string | undefined {
  const input = z.object({ command: z.string() }).safeParse(call.input);

  return call.name === 'run_command' && input.success ? input.data.command : undefined;
}

/** "read src/a.ts" for a whole file; "read src/a.ts lines 10–40 (of 900)" for part of one. */
export function describeRead(read: FileRead): string {
  if (read.whole) return `read ${read.path}`;

  if (read.endLine < read.startLine) {
    return `read ${read.path}: nothing past line ${read.totalLines}`;
  }

  return `read ${read.path} lines ${read.startLine}–${read.endLine} (of ${read.totalLines})`;
}
