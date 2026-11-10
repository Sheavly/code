import { harnessPlugin } from '../plugin.js';
import { typescriptRuleTester } from '../testing/rule-tester.fake.js';

// Files are written through storage (or the agent's tools on a project), never by hand elsewhere.
const ruleTester = typescriptRuleTester({ sourceType: 'module', ecmaVersion: 'latest' });

/** The functions that create, change, move or delete a file or folder. */
const MUTATORS = [
  'writeFile',
  'appendFile',
  'rename',
  'rm',
  'rmdir',
  'unlink',
  'mkdir',
  'mkdtemp',
  'cp',
  'copyFile',
  'createWriteStream',
  'truncate',
  'ftruncate',
  'symlink',
  'link',
  'chmod',
  'chown',
  'utimes',
  'open',
  'write',
  'writev',
];
const FS_SPECIFIERS = ['node:fs/promises', 'fs/promises', 'node:fs', 'fs'];

/** A case that must report these messages, in order: `m0` a named write, `m1` a whole-module import, `m2` a dynamic one. */
const reports = (code, ...messageIds) => ({
  code,
  errors: messageIds.map((messageId) => ({ messageId })),
});

ruleTester.run('no-direct-file-writes', harnessPlugin.rules['no-direct-file-writes'], {
  valid: [
    // Reading is anyone's: a tool reads a project, the loader reads a skill.
    "import { readFile } from 'node:fs/promises';",
    "import { readFile, readdir, stat, lstat, realpath, readlink, access } from 'node:fs/promises';",
    "import { existsSync, readFileSync, statSync, readdirSync } from 'node:fs';",
    "import { createReadStream } from 'node:fs';",
    "import type { Stats } from 'node:fs';",
    // Writing through storage is the way.
    "import { writeJsonFile } from '@sheavly/storage/json-file/json-file.helper';",
    "import { DocumentFile } from '@sheavly/storage/document-file/document-file.service';",
    // A coding tool changes the project's files through its shared helper, which owns the `node:fs`
    // writes.
    "import { createParentFolder, removeFile } from '../files/files.helper.js';",
    // A module that merely has a similar name, or another package's `rm`.
    "import { rm } from './rm.helper.js';",
    "import { writeFile } from 'some-other-package';",
    "import { writeFile } from 'node:fs-extra-like';",
    "import { writeFile } from 'node:fsevents';",
    // A function of that name that is not fs.
    'const writeFile = (text) => text; writeFile("x");',
    // The other `node:` modules.
    "import path from 'node:path';",
    "import os from 'node:os';",
    // Reading a module dynamically by a name that is not a variable is what `import()` of a
    // non-fs module is.
    "const path = await import('node:path');",
  ],
  invalid: [
    // Every way of changing a file or folder, by name, from every spelling of the module.
    ...MUTATORS.flatMap((name) =>
      FS_SPECIFIERS.map((specifier) => reports(`import { ${name} } from '${specifier}';`, 'm0')),
    ),
    // The synchronous forms.
    ...['writeFileSync', 'appendFileSync', 'mkdirSync', 'rmSync', 'renameSync', 'cpSync'].map(
      (name) => reports(`import { ${name} } from 'node:fs';`, 'm0'),
    ),
    // Several in one import: each is reported, and the reads beside them are not.
    reports(
      "import { appendFileSync, mkdirSync, rmSync, renameSync } from 'node:fs';",
      'm0',
      'm0',
      'm0',
      'm0',
    ),
    reports("import { readFile, writeFile } from 'node:fs/promises';", 'm0'),
    reports("import { readFileSync, appendFileSync } from 'node:fs';", 'm0'),
    reports("import { rm, mkdir, readFile } from 'node:fs/promises';", 'm0', 'm0'),
    // Renamed on the way in.
    reports("import { writeFile as save } from 'node:fs/promises';", 'm0'),
    // Hiding what is written: the whole module.
    reports("import fs from 'node:fs';", 'm1'),
    reports("import * as fs from 'node:fs';", 'm1'),
    reports("import fsp from 'node:fs/promises';", 'm1'),
    reports("import * as fsp from 'fs/promises';", 'm1'),
    reports("import fs, { readFile } from 'node:fs';", 'm1'),
    reports("const fs = await import('node:fs');", 'm2'),
    reports("const { writeFile } = await import('node:fs/promises');", 'm2'),
    reports("const fs = await import('fs');", 'm2'),
  ],
});
