/** One request a `recordingServer` received, whole: nothing a client sent is left out. */
export type ReceivedRequest = {
  method: string;
  path: string;
  headers: Record<string, string | string[] | undefined>;
  body: string;
};

/** What a `recordingServer` answers with. */
export type RecordedAnswer = { status: number; body?: string };

/** A plain `http` listener on loopback that records everything it is sent. */
export type RecordingServer = {
  url: string;
  requests: () => ReceivedRequest[];
  /** Everything received as one string, headers and body, to search for a secret. */
  everything: () => string;
};
