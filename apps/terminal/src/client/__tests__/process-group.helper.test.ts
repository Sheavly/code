import { spawn, type ChildProcess } from 'node:child_process';
import { afterEach, describe, expect, it } from 'vitest';
import { signalProcessGroup, stopProcessGroup } from '../process-group.helper.js';

const children: ChildProcess[] = [];

afterEach(() => {
  for (const child of children.splice(0)) {
    if (child.pid !== undefined && child.exitCode === null) {
      signalProcessGroup({ pid: child.pid, signal: 'SIGKILL' });
    }
  }
});

/**
 * A detached node child, like the backend's npm: its own group, and `script` as its program. It
 * resolves with the child and the first line it printed, once it is up.
 */
async function startChild(script: string): Promise<{ child: ChildProcess; line: string }> {
  const child = spawn(process.execPath, ['-e', script], {
    detached: true,
    stdio: ['ignore', 'pipe', 'ignore'],
  });

  children.push(child);

  const line = await new Promise<string>((resolve) =>
    child.stdout?.once('data', (chunk: Buffer) => resolve(chunk.toString().trim())),
  );

  return { child, line };
}

const IDLE = 'setInterval(() => undefined, 1000)';

describe('stopProcessGroup', () => {
  it('ends a child that exits on SIGTERM without escalating', async () => {
    const { child } = await startChild(`console.log('up'); ${IDLE}`);

    await stopProcessGroup({ child, timeoutMs: 10_000 });
    expect(child.signalCode).toBe('SIGTERM');
  });

  it('kills a child that ignores SIGTERM once the timeout passes', async () => {
    const { child } = await startChild(
      `process.on('SIGTERM', () => undefined); console.log('up'); ${IDLE}`,
    );

    await stopProcessGroup({ child, timeoutMs: 100 });
    expect(child.signalCode).toBe('SIGKILL');
  });

  it('kills a member that ignores SIGTERM after the leader has exited', async () => {
    // The leader (like npm) exits on SIGTERM; its child (like the backend) is in its group,
    // ignores it, and the leader reports the child's pid.
    const member = `process.on('SIGTERM', () => undefined); ${IDLE}`;
    const { child, line } = await startChild(
      `const { spawn } = require('node:child_process');
       const member = spawn(process.execPath, ['-e', ${JSON.stringify(member)}], { stdio: 'ignore' });
       console.log(member.pid); ${IDLE}`,
    );

    await stopProcessGroup({ child, timeoutMs: 300 });
    expect(() => process.kill(Number(line), 0)).toThrow(/ESRCH/);
  });

  it('stops members an already exited leader left behind only when told it exited just now', async () => {
    // The leader (like npm after a failed start) exits at once; its child stays in the group.
    const member = `process.on('SIGTERM', () => undefined); ${IDLE}`;
    const { child, line } = await startChild(
      `const { spawn } = require('node:child_process');
       const member = spawn(process.execPath, ['-e', ${JSON.stringify(member)}], { stdio: 'ignore' });
       console.log(member.pid); setTimeout(() => process.exit(0), 50)`,
    );

    await new Promise((resolve) => child.once('exit', resolve));

    // Left alone by default: an exited leader's pid may belong to a stranger by now.
    await stopProcessGroup({ child, timeoutMs: 300 });
    expect(() => process.kill(Number(line), 0)).not.toThrow();

    await stopProcessGroup({ child, timeoutMs: 300, afterLeaderExit: true });
    expect(() => process.kill(Number(line), 0)).toThrow(/ESRCH/);
  });

  it('refuses to signal a pid that cannot lead a child group', () => {
    for (const pid of [0, 1, Number.NaN]) {
      expect(signalProcessGroup({ pid, signal: 'SIGTERM' })).toBe(false);
    }
  });

  it('resolves for a child that already ended, including one killed by a signal', async () => {
    const { child } = await startChild(`console.log('up'); ${IDLE}`);

    await stopProcessGroup({ child, timeoutMs: 100 });
    // Its group is gone now: signalling it again must not throw ESRCH.
    await expect(stopProcessGroup({ child, timeoutMs: 100 })).resolves.toBeUndefined();
    expect(signalProcessGroup({ pid: child.pid ?? 0, signal: 'SIGTERM' })).toBe(false);
  });
});
