import { createElement } from 'react';
import { render, type Instance } from 'ink';
import { stripTerminalSequences } from '@earendil-works/pi-tui';
import type { Terminal, TuiInputListener } from '@earendil-works/pi-tui';
import type { ChatView, EditorOptions } from '../tui/chat-view.types.js';
import type { StatusInfo } from '../tui/tui.types.js';
import { createChatEditor } from '../tui/editor.helper.js';
import { EditorHost } from './editor-host.service.js';
import { editorFrame, liveLayout, transcriptRows } from './layout.utils.js';
import { ReactScreen } from './react-screen.component.js';
import type { ReactScreenProps, TranscriptLine } from './react-screen.types.js';

/** React/Ink owns output; pi supplies only the established editor and keyboard protocol. */
export class ReactView implements ChatView {
  readonly editor;
  readonly #host: EditorHost;
  readonly #history: TranscriptLine[] = [];
  readonly #stdout: NodeJS.WritableStream;
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
    },
  ) {
    this.#stdout = params.stdout ?? process.stdout;
    this.#status = params.status;
    this.#host = new EditorHost({ terminal: params.terminal, draw: () => this.#draw() });
    this.editor = createChatEditor({ ...params, tui: this.#host });
    this.#host.addChild(this.editor);
  }

  start(): void {
    this.#host.start();

    try {
      this.#instance = render(createElement(ReactScreen, this.snapshot), {
        stdout: this.#stdout,
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

  print(text: string): void {
    for (const line of transcriptRows({
      text: this.#display(text),
      columns: this.#host.terminal.columns,
    })) {
      this.#history.push({ id: this.#history.length, text: line });
    }
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

  #display(text: string): string {
    if (process.env.NO_COLOR !== undefined) return stripTerminalSequences(text);

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
      editor: { ...editor, lines: editor.lines.map((line) => this.#display(line)) },
      columns: Math.max(1, columns),
      rows: Math.max(2, rows),
    };
  }

  #draw(): void {
    this.#instance?.rerender(createElement(ReactScreen, this.snapshot));
  }
}
