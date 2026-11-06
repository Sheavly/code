import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { getCapabilities, hyperlink, setCapabilityOverrides } from '@earendil-works/pi-tui';
import type { Environment } from '@sheavly/core/environment/environment.types';
import type { LinkFile } from '../changes/changes.types.js';
import { plainTerminalText } from '../render/terminal-text.utils.js';

/**
 * Applies `SHEAVLY_HYPERLINKS` (`1` on, `0` off) over what the library detects of the terminal,
 * which the replies' links follow. Anything else leaves the detection as it is. Call it before
 * anything is drawn: the detection is read once.
 */
export function configureHyperlinks(env: Environment): void {
  const setting = env.SHEAVLY_HYPERLINKS;

  if (setting === '1' || setting === '0') setCapabilityOverrides({ hyperlinks: setting === '1' });
}

/**
 * Shows a path under `root` as a link to its file, when the terminal opens links. Over SSH a
 * `file://` link would name a path on the machine the terminal is on, not the one the files are
 * on, so the path stays text there.
 */
export function createFileLinker(params: { root: string; env: Environment }): LinkFile {
  const { root, env } = params;

  if (!getCapabilities().hyperlinks || env.SSH_CONNECTION || env.SSH_TTY) return plainTerminalText;

  return (path) => hyperlink(plainTerminalText(path), pathToFileURL(resolve(root, path)).href);
}
