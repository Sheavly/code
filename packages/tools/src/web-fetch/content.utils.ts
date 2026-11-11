import { load } from 'cheerio/slim';
import TurndownService from 'turndown';
import { WebFetchError } from '../errors/web-fetch.errors.js';
import type { DownloadedPage } from './web-fetch.types.js';
import { webFetchPrompts } from './web-fetch.prompt.js';

export function assertReadableType(contentType: string): void {
  const type = (contentType.split(';', 1)[0] ?? '').trim().toLowerCase();

  if (
    [
      'text/html',
      'application/xhtml+xml',
      'text/plain',
      'text/markdown',
      'text/x-markdown',
      'application/json',
      'application/xml',
      'text/xml',
      'application/rss+xml',
      'application/atom+xml',
    ].includes(type) ||
    /^application\/[a-z0-9.+-]+\+json$/.test(type)
  ) {
    return;
  }

  throw new WebFetchError(`Unsupported content type: ${contentType || '(missing)'}`);
}

/** Parses markup without loading resources or running scripts; ignores page furniture. */
function htmlToMarkdown(params: { html: string; url: URL }): string {
  const { html, url } = params;
  const $ = load(html);

  $(
    'script, style, nav, footer, aside, form, iframe, svg, noscript, [hidden], [aria-hidden="true"], [role="navigation"], [role="banner"], [role="contentinfo"]',
  ).remove();
  $('a[href], img[src]').each((_index, element) => {
    const attribute = element.name === 'a' ? 'href' : 'src';
    const value = $(element).attr(attribute);

    if (!value || !URL.canParse(value, url)) return;

    const target = new URL(value, url);

    if (['http:', 'https:'].includes(target.protocol)) {
      $(element).attr(attribute, target.href);

      return;
    }

    $(element).removeAttr(attribute);
  });
  const main = $('main, [role="main"]').first();
  const article = $('article').first();
  const content = main.length ? main : article;
  const htmlContent = content.length ? (content.html() ?? '') : $.html();

  return new TurndownService({ headingStyle: 'atx', codeBlockStyle: 'fenced' }).turndown(
    htmlContent,
  );
}

/** Source metadata precedes explicitly untrusted external content. Limits count content characters. */
export function formatPage(params: { page: DownloadedPage; maxChars: number }): string {
  const { page, maxChars } = params;
  const type = (page.contentType.split(';', 1)[0] ?? '').trim().toLowerCase();
  const content = ['text/html', 'application/xhtml+xml'].includes(type)
    ? htmlToMarkdown({ html: page.text, url: page.url })
    : page.text;
  const notes: string[] = [];

  if (page.truncated) notes.push('Download byte limit reached');
  if (content.length > maxChars) notes.push(`Content truncated to ${maxChars} characters`);

  return [
    `URL: ${page.url.href}`,
    `Status: ${page.status}`,
    `Content-Type: ${page.contentType}`,
    ...(notes.length ? [`Truncated: ${notes.join('; ')}`] : []),
    webFetchPrompts.externalContent,
    '',
    content.slice(0, maxChars),
  ].join('\n');
}
