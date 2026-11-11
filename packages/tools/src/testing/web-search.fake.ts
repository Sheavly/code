/** Recorded native HTTP requests; empty/exhausted fixtures throw rather than reaching the network. */
export function fakeFetch(responses: Response[]) {
  const requests: { url: string; init: RequestInit }[] = [];
  const fetch: typeof globalThis.fetch = async (input, init = {}) => {
    const url = input instanceof Request ? input.url : input.toString();

    requests.push({ url, init });
    const response = responses.shift();

    if (!response) throw new Error('No fake search response queued');

    return response;
  };

  return { fetch, requests };
}
