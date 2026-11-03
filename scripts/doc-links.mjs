// Links between the repo's markdown files that point nowhere: a relative link (`[x](../y.md)`,
// `[x](y.md#section)`) whose file doesn't exist, or whose `#section` is no heading in it. Docs
// move as workspaces change, so a link is checked against the files, never trusted.
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';

const LINK = /\[[^\]]*\]\(([^)\s]+)\)/g;
const SKIPPED = /^(workbook\/(runs|workspaces)\/|node_modules\/)|\/node_modules\//;

/** GitHub's anchor for a heading: lowercase, punctuation dropped, spaces to dashes. */
function anchorOf(heading) {
  return heading
    .trim()
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s_-]/gu, '')
    .replace(/\s/g, '-');
}

function anchorsIn(markdown) {
  const withoutCode = markdown.replace(/```[\s\S]*?```/g, '');

  return new Set(
    [...withoutCode.matchAll(/^#{1,6} (.+)$/gm)].map((match) => anchorOf(match[1] ?? '')),
  );
}

/** Every broken relative link in the markdown `files` (relative to `root`). */
export function brokenLinkProblems(params) {
  const { root, files } = params;

  return files
    .filter((file) => file.endsWith('.md') && !SKIPPED.test(file))
    .filter((file) => existsSync(path.join(root, file)))
    .flatMap((file) => {
      const markdown = readFileSync(path.join(root, file), 'utf8').replace(/```[\s\S]*?```/g, '');

      return [...markdown.matchAll(LINK)].flatMap((match) => {
        const target = match[1] ?? '';

        if (/^[a-z]+:/i.test(target) || target.startsWith('#')) return [];

        const [relative = '', anchor] = target.split('#');
        const resolved = path.join(path.dirname(path.join(root, file)), relative);

        if (!existsSync(resolved)) return [`${file}: links to ${target}, which doesn't exist.`];
        if (!anchor || !resolved.endsWith('.md')) return [];

        return anchorsIn(readFileSync(resolved, 'utf8')).has(anchor)
          ? []
          : [`${file}: links to ${target}, but ${relative} has no "#${anchor}" heading.`];
      });
    });
}
