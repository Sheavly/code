# @sheavly/storage

The user's data on disk: the folder layout under `~/.sheavly`, file-backed stores for
conversations, models, credentials and profiles, and the one atomic JSON write they share. Generic:
it knows nothing about files in a workspace or about code. It never reads env or picks the home
folder; an app passes the root in.

```ts
import { readJsonFile, writeJsonFile } from '@sheavly/storage/json-file/json-file.helper';

await writeJsonFile({ file: path.join(root, 'config.json'), value: { profile: 'work' } });
const config = await readJsonFile({ file: path.join(root, 'config.json'), schema }); // or undefined
```

| Module         | What it holds                                                                                        |
| -------------- | ---------------------------------------------------------------------------------------------------- |
| `json-file/`   | `readJsonFile` and `writeJsonFile`: a typed read, and an atomic, private write that works on Windows |
| `model-store/` | `ModelStore`: a profile's models, one `<model-id>.json` each; a bad file is reported, the rest load  |
| `errors/`      | `StorageFileError`: a stored file that can't be read, parsed, validated or written                   |

Runs on Linux, macOS and Windows; see [Design](docs/design.md#every-operating-system) for what that
asks of every module here.

## Docs

- [Design](docs/design.md): how it works, and how to extend it.
