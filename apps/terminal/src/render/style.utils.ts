import { styleText } from 'node:util';

type Style = Parameters<typeof styleText>[0];

// The screen writes to its own terminal through pi-tui, not to stdout, so whether stdout is a
// terminal says nothing about it: always style.
const styled = (format: Style) => (text: string) =>
  styleText(format, text, { validateStream: false });

export const gray = styled('gray');
export const bold = styled('bold');
export const cyan = styled('cyan');
export const cyanBold = styled(['cyan', 'bold']);
export const green = styled('green');
export const yellow = styled('yellow');
export const red = styled('red');
