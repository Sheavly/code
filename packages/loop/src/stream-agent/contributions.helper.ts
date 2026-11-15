import { raceAbort } from '../abort/abort.utils.js';
import { ContributionError } from '../errors/loop.errors.js';
import type { Contribution, Ran } from './contributions.types.js';

/**
 * Puts a phase's contributions in run order: each after the ones it names, otherwise in the order
 * given. Throws for a name used twice, a name `after` that is not in the phase, or a cycle, so a
 * miswired phase fails when the run starts, never halfway through a turn.
 */
export function orderContributions<
  T extends { name: string; after?: readonly string[] | undefined },
>(list: readonly T[]): T[] {
  const names = new Set<string>();

  for (const { name } of list) {
    if (names.has(name)) {
      throw new ContributionError({
        problem: 'duplicate',
        message: `Contribution ${name} is registered twice`,
      });
    }

    names.add(name);
  }

  for (const { name, after = [] } of list) {
    for (const earlier of after) {
      if (!names.has(earlier)) {
        throw new ContributionError({
          problem: 'unknown_after',
          message: `Contribution ${name} runs after ${earlier}, which is not registered`,
        });
      }
    }
  }

  const ordered: T[] = [];
  const placed = new Set<string>();
  let remaining = [...list];

  while (remaining.length > 0) {
    const ready = remaining.filter(({ after = [] }) => after.every((name) => placed.has(name)));

    if (ready.length === 0) {
      throw new ContributionError({
        problem: 'cycle',
        message: `Contributions form a cycle: ${remaining.map(({ name }) => name).join(', ')}`,
      });
    }

    for (const item of ready) {
      ordered.push(item);
      placed.add(item.name);
    }

    remaining = remaining.filter((item) => !placed.has(item.name));
  }

  return ordered;
}

/**
 * Runs one contribution under its own policy. `abort: 'race'` stops waiting for it once the run
 * aborts (the value is then undefined); `'wait'` lets it finish. A throw fails the run when
 * `onFailure` is `'fail-run'`; otherwise it is passed to `report` and the value is undefined, so
 * the phase goes on without that contribution.
 */
export async function runContribution<Input, Output>(params: {
  contribution: Contribution<Input, Output>;
  input: Input;
  signal: AbortSignal;
  report: (failure: { name: string; error: unknown }) => void;
}): Promise<Ran<Output>> {
  const { contribution, input, signal, report } = params;

  try {
    const work = Promise.resolve(contribution.run(input));

    return {
      value: contribution.abort === 'race' ? await raceAbort({ work, signal }) : await work,
    };
  } catch (caughtError) {
    if (contribution.onFailure === 'fail-run') throw caughtError;

    // An abort is not the contribution's fault.
    if (!signal.aborted) report({ name: contribution.name, error: caughtError });

    return { value: undefined };
  }
}
