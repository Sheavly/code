import { describe, expect, it } from 'vitest';
import { answeringUi } from '@sheavly/runtime/testing/approvals.fake';
import { testPermissions } from '../../testing/permissions.fake.js';
import { commandConfirmer } from '../../testing/command-approval.fake.js';
import { matchesEntry, parseCommand } from '../allow-list.utils.js';

const confirm = commandConfirmer();

describe('command-only approvals', () => {
  it.each([
    ['find src -type f', 'find .. -exec node /outside/anything.mjs {} +', 'find *'],
    ['sed -n 1,200p src/a.ts', 'sed -i s/a/b/ /outside/.env', 'sed *'],
    ['node tmp/probe.mjs', "node -e 'arbitrary code'", 'node *'],
    ['grep -n needle src', 'grep --unknown-option different .env', 'grep *'],
    ['git show HEAD', 'git -C .. -c core.pager=anything show HEAD:.env', 'git show *'],
    ['npm run test', 'npm --prefix .. --script-shell=node run test -- .env', 'npm run test *'],
    [
      'npx eslint src',
      'npx --package=unverified eslint --fix --config=/outside/config .env',
      'npx eslint *',
    ],
    ['npx vitest run src', 'npx --yes vitest@latest watch ..', 'npx vitest *'],
    ['npx tsx tmp/probe.mts', 'npx tsx --conditions=other /outside/different.mts', 'npx tsx *'],
    ['npm install one-package', 'npm install another-package --registry=other', 'npm install *'],
  ])(
    'a permanent grant covers every argument of the base command: %s',
    async (first, next, entry) => {
      const permissions = testPermissions();
      const ui = answeringUi({ decision: 'always_allow' });

      await confirm(first, permissions, ui);
      await confirm(next, permissions, ui);

      expect(ui.asked).toHaveLength(1);
      expect(ui.asked[0]?.keeps).toEqual([entry]);
      expect(ui.asked[0]?.concerns).toHaveLength(1);
      expect(ui.asked[0]?.concerns[0]?.reason).toBe('is not allowed yet');
      expect(permissions.kept).toEqual([entry]);
    },
  );

  it('keeps temporary base grants in the session rather than persisting them', async () => {
    const permissions = testPermissions({}, true);
    const ui = answeringUi({ decision: 'allow_session' });

    await confirm('npx eslint src', permissions, ui);
    await confirm('npx --yes eslint@latest --fix ..', permissions, ui);

    expect(permissions.sessionKept).toEqual(['npx eslint *']);
    expect(permissions.kept).toEqual([]);
    expect(ui.asked).toHaveLength(1);
  });

  it.each([['ls ..', 'ls *']])(
    'built-in approvals have the same all-arguments semantics: %s',
    async (command) => {
      const ui = answeringUi({ decision: 'skip' });

      await confirm(command, testPermissions(), ui);

      expect(ui.asked).toEqual([]);
    },
  );

  it.each([
    'cat /outside/.env',
    'head /outside/.env',
    'tail /outside/.env',
    'wc --files0-from=/outside/.env',
    'git diff --no-index /outside/.env /dev/null',
    'git log -p -- .env',
    'git add -A',
    'git -c core.fsmonitor=anything status',
    './ls ..',
    '/outside/pwd',
  ])(
    'requires an explicit grant for a content reader, Git or path-qualified executable: %s',
    async (command) => {
      const ui = answeringUi({ decision: 'skip' });

      await expect(confirm(command, testPermissions(), ui)).rejects.toThrow();
      expect(ui.asked).toHaveLength(1);
    },
  );

  it('still honors an explicit grant for a content-reading base command', async () => {
    const ui = answeringUi({ decision: 'skip' });

    await confirm('cat /outside/.env', testPermissions({ allow: ['cat *'] }), ui);
    expect(ui.asked).toEqual([]);
  });

  it.each([
    ['find apps/terminal *', 'find /outside -delete'],
    ['sed -n 1,200p src/a.ts', 'sed -i s/a/b/ .env'],
    ['read:find *', 'find . -exec arbitrary {} +'],
    ['tool:npx eslint check *', 'npx eslint --fix --config=anything ..'],
    ['script:node tmp/probe.mjs *', 'node --import=anything /outside/other.mjs'],
    ['exact:["cat",".env"]', 'cat /outside/another'],
    ['npm run test', 'npm run test --script-shell=anything -- .env'],
    ['npx tsc -p src --noEmit', 'npx --yes tsc --noEmit false --project=..'],
  ])(
    'legacy entries now approve only the base identity, not their old restrictions: %s',
    async (entry, command) => {
      const permissions = testPermissions({ allow: [entry] });
      const ui = answeringUi({ decision: 'skip' });

      await confirm(command, permissions, ui);

      expect(ui.asked).toEqual([]);
    },
  );

  it.each([
    ['git push origin main', 'git diff *'],
    ['npm run build', 'npm run test *'],
    ['npx prettier --write src', 'npx eslint *'],
    ['gh issue edit 1', 'gh issue view *'],
    ['node arbitrary.mjs', 'find *'],
  ])('does not approve a different base command: %s', async (command, entry) => {
    const denied = answeringUi({ decision: 'skip' });

    await expect(confirm(command, testPermissions({ allow: [entry] }), denied)).rejects.toThrow();
  });

  it('checks every command of a chain before running any of it', async () => {
    const permissions = testPermissions({ allow: ['npm run test *'] });
    const ui = answeringUi({ decision: 'skip' });

    await expect(
      confirm('npm run test --anything && npm install different', permissions, ui),
    ).rejects.toThrow();
    expect(ui.asked[0]?.keeps).toEqual(['npm install *']);
    expect(ui.asked[0]?.concerns).toEqual([
      { argument: 'npm install different', reason: 'is not allowed yet' },
    ]);

    const parsed = parseCommand('npm run test | node -e 1');

    if (!parsed.ok) throw new Error(parsed.reason);

    expect(parsed.steps.map(({ argv }) => matchesEntry({ argv, entry: 'npm run test *' }))).toEqual(
      [true, false],
    );
  });

  it('always_ask ignores base grants but offers only one-time decisions', async () => {
    const permissions = testPermissions({ mode: 'always_ask', allow: ['npx eslint *'] }, true);
    const ui = answeringUi({ decision: 'skip' });

    await expect(confirm('npx eslint --fix .env', permissions, ui)).rejects.toThrow();
    expect(ui.asked[0]?.options).toEqual(['approve', 'skip', 'skip_with_message']);
  });

  it('broad program grants can deliberately approve all wrapper subcommands', () => {
    expect(matchesEntry({ argv: ['git', 'push'], entry: 'git *' })).toBe(true);
    expect(matchesEntry({ argv: ['npx', 'anything'], entry: 'npx *' })).toBe(true);
    expect(matchesEntry({ argv: ['npm', 'run', 'any-script'], entry: 'npm run *' })).toBe(true);
    expect(matchesEntry({ argv: ['rm', '-rf', '.'], entry: '*' })).toBe(false);
  });
});
