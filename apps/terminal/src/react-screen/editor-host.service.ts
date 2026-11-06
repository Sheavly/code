import { TuiMainScreen } from '@earendil-works/pi-tui';
import type { Terminal } from '@earendil-works/pi-tui';

/** Reuses pi's keyboard routing and editor scheduler, but never its screen renderer. */
export class EditorHost extends TuiMainScreen {
  readonly #draw: () => void;

  constructor(params: { terminal: Terminal; draw: () => void }) {
    super(params.terminal);
    this.#draw = params.draw;
  }

  protected override doRender(): void {
    this.#draw();
  }

  protected override beforeTerminalStop(): void {
    // Ink owns the output origin and final cursor placement, not pi's main-screen renderer.
  }
}
