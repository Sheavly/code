/** How a server process ended. */
export type ServeExit = { code: number | null; signal: NodeJS.Signals | null };

/** A real `serve.ts` process: what it printed and how it ended. */
export type ServeProcess = {
  pid: number;
  /** The URL on its `listening` line; empty for one that was only waited on to exit. */
  url: string;
  stdout: () => string;
  stderr: () => string;
  exited: Promise<ServeExit>;
  /** Sends `signal` and resolves once the process has ended. */
  stop: (signal: NodeJS.Signals) => Promise<ServeExit>;
};

/** The temp folders and token of one test: the server's home, runtime folder and project. */
export type ServeFolders = {
  base: string;
  home: string;
  xdg: string;
  project: string;
  token: string;
};
