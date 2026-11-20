import { fork, type ChildProcess } from 'node:child_process';
import path from 'node:path';
import { afterEach } from 'vitest';
import { now } from '@sheavly/core/clock/clock.helper';

/** Long enough for every racer to receive the start time before it passes. */
const RACE_START_DELAY_MS = 150;
const WORKER = path.join(import.meta.dirname, 'server-lock-worker.fake.ts');

type WorkerEvent = {
  status: string;
  path?: string;
  ino?: number;
  reason?: string;
  connected?: number;
  refused?: number;
  acquired?: number;
  names?: string[];
};

/**
 * Test-only: forks `server-lock-worker.fake.ts` children and kills every one after each test, so
 * none outlives it. The condition makes workspace packages resolve to their source, as in
 * vitest: a checkout that has not been built (CI) has no `dist` to import.
 */
export function useWorkers(): {
  start: (args: string[]) => ChildProcess;
  nextEvent: (child: ChildProcess) => Promise<WorkerEvent>;
  kill: (child: ChildProcess) => Promise<void>;
  leaveStaleSocket: (params: { home: string; runtimeDir: string }) => Promise<void>;
  /** Starts `count` racers and returns them once each has said it is ready. */
  startRacers: (count: number) => Promise<ChildProcess[]>;
  /** Has every racer take the lock of `home` at one shared moment, and returns what each said. */
  raceFor: (params: { racers: ChildProcess[]; home: string }) => Promise<WorkerEvent[]>;
  /** Has every racer let go of what it won, and waits until all have. */
  releaseAll: (racers: ChildProcess[]) => Promise<void>;
} {
  const children: ChildProcess[] = [];

  afterEach(() => {
    for (const child of children.splice(0)) child.kill('SIGKILL');
  });

  const start = (args: string[]): ChildProcess => {
    const child = fork(WORKER, args, {
      execArgv: ['--conditions=@sheavly/source', '--import', 'tsx'],
      stdio: ['ignore', 'inherit', 'inherit', 'ipc'],
    });

    children.push(child);

    return child;
  };
  const kill = (child: ChildProcess): Promise<void> =>
    new Promise((resolve) => {
      child.once('exit', () => {
        resolve();
      });
      child.kill('SIGKILL');
    });

  return {
    start,
    nextEvent,
    kill,
    // What a server killed without a chance to clean up leaves: a socket file nobody listens on.
    leaveStaleSocket: async (params) => {
      const child = start(['hold', params.home, params.runtimeDir]);

      await nextEvent(child);
      await kill(child);
    },
    startRacers: async (count) => {
      const racers: ChildProcess[] = [];

      while (racers.length < count) racers.push(start(['racer']));

      for (const racer of racers) await nextEvent(racer);

      return racers;
    },
    raceFor: async ({ racers, home }) => {
      const answers = racers.map((racer) => nextEvent(racer));
      const startAt = now() + RACE_START_DELAY_MS;

      for (const racer of racers) racer.send({ home, runtimeDir: home, startAt });

      return Promise.all(answers);
    },
    releaseAll: async (racers) => {
      const released = racers.map((racer) => nextEvent(racer));

      for (const racer of racers) racer.send({ release: true });

      await Promise.all(released);
    },
  };
}

function nextEvent(child: ChildProcess): Promise<WorkerEvent> {
  return new Promise((resolve, reject) => {
    const onMessage = (event: unknown): void => {
      child.off('exit', onExit);
      resolve(event as WorkerEvent);
    };
    const onExit = (code: number | null, signal: string | null): void => {
      child.off('message', onMessage);
      reject(new Error(`worker ended (${String(code ?? signal)}) before it said anything`));
    };

    child.once('message', onMessage);
    child.once('exit', onExit);
  });
}
