import { createChatLook } from '../apps/terminal/src/render/chat-look.utils.ts';
import { formatDiff } from '../apps/terminal/src/diff/diff-text.utils.ts';
import { statusText } from '../apps/terminal/src/tui/view.utils.ts';
import { paletteFromEnv } from '../apps/terminal/src/theme/theme.helper.ts';

for (const theme of ['default', 'colorblind']) {
  const palette = paletteFromEnv({ SHEAVLY_THEME: theme });
  const look = createChatLook(palette);

  process.stdout.write(`--- ${theme} ---\n`);
  process.stdout.write(
    look.toolResult({ ok: true, label: '', detail: 'Edited a.ts', seconds: '0.3s' }),
  );
  process.stdout.write(look.toolResult({ ok: false, label: '', detail: 'boom', seconds: '0.3s' }));
  process.stdout.write(
    formatDiff({
      rows: [
        { kind: 'removed', no: 1, text: 'old' },
        { kind: 'added', no: 1, text: 'new' },
      ],
      columns: 40,
      palette,
    }),
  );
  process.stdout.write(
    `${statusText({ info: { state: 'working', model: 'Fast', mode: 'allow_all', tasks: 0 }, palette })}\n`,
  );
}

try {
  paletteFromEnv({ SHEAVLY_THEME: 'neon' });
} catch (caughtError) {
  process.stdout.write(`${caughtError instanceof Error ? caughtError.message : ''}\n`);
}
