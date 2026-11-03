import { describe, expect, it } from 'vitest';
import { exportsProblems, isExported, kindExportTarget } from '../exports.utils.js';

const kind = (name) => ({ [`./*.${name}`]: kindExportTarget(name) });
const pkg = (fields) => ({
  dir: 'packages/p',
  kind: 'package',
  domain: 'generic',
  exports: { ...kind('helper'), './queue/*': null },
  modules: [
    { name: 'stream', files: ['stream.helper', 'stream.types'] },
    { name: 'queue', files: ['queue.helper'] },
    { name: 'testing', files: ['loop.fake'] },
  ],
  documented: ['stream'],
  files: ['dist', 'docs'],
  prepack: 'npm run build',
  ...fields,
});

describe('isExported', () => {
  it('opens a file of an exported kind, and the longest key wins, so null closes a module', () => {
    const { exports } = pkg({});

    expect(isExported({ exports, subpath: 'stream/stream.helper' })).toBe(true);
    expect(isExported({ exports, subpath: 'stream/stream.types' })).toBe(false);
    expect(isExported({ exports, subpath: 'queue/queue.helper' })).toBe(false);
    expect(isExported({ exports: undefined, subpath: 'stream/stream.helper' })).toBe(false);
  });
});

describe('exportsProblems', () => {
  it('passes a package whose open modules are the ones its README documents', () => {
    expect(exportsProblems({ name: '@sheavly/p', entry: pkg({}) })).toEqual([]);
  });

  it('fails a public module the README leaves out, and a README row exports keep closed', () => {
    expect(exportsProblems({ name: '@sheavly/p', entry: pkg({ documented: [] }) })).toEqual([
      expect.stringContaining(
        "@sheavly/p's stream/ is public (its exports open it) but its README",
      ),
    ]);
    expect(
      exportsProblems({ name: '@sheavly/p', entry: pkg({ documented: ['stream', 'queue'] }) }),
    ).toEqual([
      expect.stringContaining("README lists queue/ as API, but its exports don't open it"),
    ]);
  });

  it('fails closing a module that does not exist, or anything but a module folder', () => {
    const closing = (key) =>
      exportsProblems({
        name: '@sheavly/p',
        entry: pkg({ exports: { ...kind('helper'), './queue/*': null, [key]: null } }),
      });

    expect(closing('./gone/*')).toEqual([expect.stringContaining('it has no module gone/')]);
    expect(closing('./stream/stream.helper')).toEqual(
      expect.arrayContaining([expect.stringContaining('close a module folder')]),
    );
  });

  it('fails a file-by-file entry with the command to export its kind instead', () => {
    expect(
      exportsProblems({
        name: '@sheavly/p',
        entry: pkg({
          exports: { ...kind('helper'), './queue/*': null, './stream/stream.types': {} },
        }),
      }),
    ).toEqual([expect.stringContaining('npm run export -- packages/p types')]);
  });

  it('fails a package that would ship its source, or skips the build before it packs', () => {
    const problems = (fields) => exportsProblems({ name: '@sheavly/p', entry: pkg(fields) });

    expect(problems({ files: undefined })).toEqual([
      expect.stringContaining('would publish everything, its source and tests included'),
    ]);
    expect(problems({ files: ['dist', 'docs', 'src'] })).toEqual([
      expect.stringContaining(`files=["dist","docs"]`),
    ]);
    expect(problems({ prepack: undefined })).toEqual([
      expect.stringContaining("doesn't build before it packs"),
    ]);
    expect(problems({ testOnly: true, files: undefined, prepack: undefined })).toEqual([]);
  });
});
