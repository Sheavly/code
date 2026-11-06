import { ProcessTerminal } from '@earendil-works/pi-tui';

/** The classic renderer may redraw the viewport, but must never erase the user's scrollback. */
export class ScrollbackTerminal extends ProcessTerminal {
  #pending = '';

  override write(data: string): void {
    const eraseScrollback = '\u001b[3J';
    let safe = (this.#pending + data).replaceAll(eraseScrollback, '');

    this.#pending = '';

    // BoundedTerminalWriter can split the control sequence between writes.
    for (let length = eraseScrollback.length - 1; length > 0; length--) {
      if (!safe.endsWith(eraseScrollback.slice(0, length))) continue;
      this.#pending = safe.slice(-length);
      safe = safe.slice(0, -length);
      break;
    }

    if (safe) super.write(safe);
  }
}
