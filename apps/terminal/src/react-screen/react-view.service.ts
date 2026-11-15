import { createElement } from 'react';
import { render, type Instance } from 'ink';
import { stripTerminalSequences } from '@earendil-works/pi-tui';
import type { Terminal, TuiInputListener } from '@earendil-works/pi-tui';
import type { ChatView, EditorOptions } from '../tui/chat-view.types.js';
import { defaultPalette } from '../theme/palette.utils.js';
import type { Palette } from '../theme/theme.types.js';
import type { StatusInfo } from '../tui/tui.types.js';
import { createChatEditor } from '../tui/editor.helper.js';
import { restoringMarks } from '../marks/marks-stdout.helper.js';
import type { ShellMark } from '../marks/marks.types.js';
import { carryMark } from '../marks/marks.utils.js';
import { EditorHost } from './editor-host.service.js';
import { editorFrame, liveLayout, transcriptRows } from './layout.utils.js';
import { ReactScreen } from './react-screen.component.js';
import type { ReactScreenProps, TranscriptLine } from './react-screen.types.js';

/** React/Ink owns output; pi supplies only the established editor and keyboard protocol. */
export class ReactView implements ChatView {
  readonly editor;
  readonly palette: Palette;
  readonly #host: EditorHost;
  readonly #history: TranscriptLine[] = [];
  readonly #stdout: NodeJS.WritableStream;
  readonly #reducedMotion: boolean;
  #instance: Instance | undefined;
  #live = '';
  #approval = '';
  #queue = '';
  #status: StatusInfo;

  constructor(
    params: EditorOptions & {
      terminal: Terminal;
      status: StatusInfo;
      stdout?: NodeJS.WritableStream;
      reducedMotion?: boolean;
    },
  ) {
    this.#stdout = restoringMarks(params.stdout ?? process.stdout);
    this.#status = params.status;
    this.#reducedMotion = params.reducedMotion ?? false;
    this.palette = params.palette ?? defaultPalette;
    this.#host = new EditorHost({ terminal: params.terminal, draw: () => this.#draw() });
    this.editor = createChatEditor({ ...params, tui: this.#host });
    this.#host.addChild(this.editor);
  }

  /** Starts drawing; a second call while running does nothing, so no Ink instance is leaked. */
  start(): void {
    if (this.#instance) return;
    this.#host.start();

    try {
      this.#instance = render(createElement(ReactScreen, this.snapshot), {
        stdout: this.#stdout,
        // The chat selects screen mode by TTY, not CI; Ink must keep its live footer drawing.
        interactive: 'isTTY' in this.#stdout && this.#stdout.isTTY === true,
        exitOnCtrlC: false,
        // All chat output is routed through the view; no global console patch is needed.
        patchConsole: false,
        incrementalRendering: true,
        alternateScreen: false,
        kittyKeyboard: { mode: 'disabled' },
      });
    } catch (caughtError) {
      this.#host.stop();
      throw caughtError;
    }
  }

  stop(): void {
    this.#draw();
    this.#instance?.unmount();
    this.#instance = undefined;
    this.#host.stop();
  }

  /** Resolves on renderer shutdown and rejects if a React component fails. Read after start. */
  get finished(): Promise<void> {
    return this.#instance?.waitUntilExit().then(() => undefined) ?? Promise.resolve();
  }

  addInputListener(listener: TuiInputListener): void {
    this.#host.addInputListener(listener);
  }

  requestRender(): void {
    this.#host.requestRender();
  }

  print(text: string, mark?: ShellMark): void {
    const rows = transcriptRows({
      text: this.#display(text),
      columns: this.#host.terminal.columns,
    });

    rows.forEach((row, index) => {
      // Only the first row of a wrapped line starts at the line's mark. Ink drops styling that
      // has no character after it, so a blank row gets a space to carry its mark.
      const marked = mark !== undefined && index === 0;
      const text = marked ? `${carryMark(mark)}${row || ' '}` : row;

      this.#history.push({ id: this.#history.length, text });
    });
  }

  setLive(text: string): void {
    this.#live = this.#display(text);
  }

  setApproval(text: string): void {
    this.#approval = this.#display(text);
  }

  setQueue(text: string): void {
    this.#queue = this.#display(text);
  }

  setStatus(info: StatusInfo): void {
    this.#status = info;
  }

  get columns(): number {
    return Math.max(1, this.#host.terminal.columns);
  }

  /** A clipped command or permission hint must never silently become an approval. */
  get canConfirm(): boolean {
    return liveLayout(this.snapshot).approvalFits;
  }

  /** `NO_COLOR` set, even to an empty value, as the convention says. Read each time, so a change shows. */
  get plain(): boolean {
    return process.env.NO_COLOR !== undefined;
  }

  #display(text: string): string {
    if (this.plain) return stripTerminalSequences(text);

    return text;
  }

  /** The source frame, before Ink commits history or positions the live region. */
  get snapshot(): ReactScreenProps {
    const { columns, rows } = this.#host.terminal;
    const editor = editorFrame(this.editor.render(Math.max(1, columns)));

    return {
      // Static memoizes by array identity, so an appended frame needs a fresh array.
      history: this.#history.slice(),
      live: this.#live,
      approval: this.#approval,
      queue: this.#queue,
      status: this.#status,
      colors: this.palette.colors,
      reducedMotion: this.#reducedMotion,
      editor: { ...editor, lines: editor.lines.map((line) => this.#display(line)) },
      columns: Math.max(1, columns),
      rows: Math.max(2, rows),
    };
  }

  #draw(): void {
    this.#instance?.rerender(createElement(ReactScreen, this.snapshot));
  }
}
