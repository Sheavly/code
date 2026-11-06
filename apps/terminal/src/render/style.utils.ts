import { styleText } from 'node:util';

type Style = Parameters<typeof styleText>[0];

// The screen writes to its own terminal through pi-tui, not to stdout, so whether stdout is a
// terminal says nothing about it: always style. These are emphasis only; every colour is a role
// of the palette (`../theme/palette.utils.ts`), so a theme can change it.
const styled = (format: Style) => (text: string) =>
  styleText(format, text, { validateStream: false });

export const bold = styled('bold');
export const italic = styled('italic');
export const underline = styled('underline');
export const strikethrough = styled('strikethrough');
