/**
 * The base URL of `api` on the regional `bedrock-runtime` endpoint, which serves the Anthropic
 * Messages API and the OpenAI Responses API with a Bedrock API key. `region` is already validated.
 */
export function bedrockBaseUrl(params: { region: string; api: 'anthropic' | 'openai' }): string {
  return `https://bedrock-runtime.${params.region}.amazonaws.com/${params.api}/v1`;
}
