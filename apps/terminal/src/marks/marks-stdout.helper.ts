import { restoreMarks } from './marks.utils.js';

type Method = (...args: unknown[]) => unknown;

/**
 * `stdout` with the marks in what is written to it turned into their OSC 133 sequences. Ink
 * writes each frame in one call, so a carried mark is never split between two; everything else
 * the wrapper answers is `stdout`'s own.
 */
export function restoringMarks<T extends NodeJS.WritableStream>(stdout: T): T {
  return new Proxy(stdout, {
    get(target, property) {
      const value: unknown = Reflect.get(target, property, target);

      if (typeof value !== 'function') return value;

      const method = value as Method;

      // Methods run on the real stream: its state is not the wrapper's.
      if (property !== 'write') return method.bind(target);

      return (chunk: unknown, ...rest: unknown[]) =>
        method.call(target, typeof chunk === 'string' ? restoreMarks(chunk) : chunk, ...rest);
    },
  });
}
