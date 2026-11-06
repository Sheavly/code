import { CURSOR_MARKER, Input } from '@earendil-works/pi-tui';

/** Secret inputs reuse editing and paste handling, but never render their underlying value. */
export class SetupInput extends Input {
  constructor(readonly secret: boolean) {
    super();
  }

  override render(width: number): string[] {
    if (!this.secret) return super.render(width);

    const dots = '•'.repeat(Math.min(this.getValue().length, Math.max(0, width - 3)));

    return [`> ${dots}${this.focused ? CURSOR_MARKER : ''}`];
  }
}
