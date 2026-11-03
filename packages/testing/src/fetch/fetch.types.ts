/** A request seen by `fakeFetch`. */
export type RecordedRequest = {
  url: string;
  headers: Record<string, string>;
  body: Record<string, unknown>;
};
