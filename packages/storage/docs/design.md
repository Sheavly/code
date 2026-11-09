# Design

How this workspace works inside, why it is built this way, and how to extend it.

## What lives here

Everything the harness keeps for the user, under one root an app passes in (`~/.sheavly`): their
conversations, models, credentials, profiles and settings. Each kind of data gets its own store
over the same two functions, `readJsonFile` and `writeJsonFile`, so how a file is read and
replaced is decided once.

```text
~/.sheavly/
  config.json                            # profile bindings and global terminal preferences
  trusted-workspaces.json                # shared: trust is about a repo, not a provider
  permissions/<workspace-key>.json       # shared: what run_command may do in a folder
  profiles/<profile-id>/
    profile.json                         # identity, lastModelSelection and modelModes keyed by UUID
    models/<model-id>.json               # one file per model: { id, name, adapter, ...fields }
    credentials.json                     # { [model-id]: { apiKey } }, the only file with keys
    workspaces/<workspace-key>/
      conversations/<conversation-id>.jsonl   # the stream, one entry per line
      conversations/<conversation-id>.json    # the index entry and the history
```

Everything on disk is named by an id, never by what a person typed (`<profile-id>` and
`<model-id>` are lowercase UUIDs; `<workspace-key>` is a hash of the workspace's real path). A
person's names (`work`, `Astra 6`) are inside the files, as labels.

`profile.json` stores the latest model/mode pair in `lastModelSelection` and the last mode of
each model in `modelModes`. `ProfileRegistry.rememberModel` writes both together, using the
profile write queue and atomic file replacement. Omitting a mode restores that model's previous
mode, or medium for a new model. Renames preserve both preferences, and profiles remain separate.
Legacy `lastModelId` is read as a medium-mode selection; the next profile write saves the new
structure. Stored conversation indexes keep their own `modelId` and `mode`, so resume does not
take another conversation's latest preferences. A legacy index without a mode resumes on medium.

Terminal preferences live in `config.json` under `terminal`: `reducedMotion` and `bell` are
optional booleans. Missing preferences mean animated activity and no terminal bell.
`ConfigStore.setTerminalSettings` replaces them through the same write queue as profile bindings.
Renaming, switching or deleting a profile does not change them. Missing preferences keep the
animated default.

`ProfileRegistry.migrateTerminalSettings` moves legacy profile preferences to this global setting.
An existing global value wins, including `false` and an empty preferences object; otherwise any
readable profile with reduced motion enabled makes the global value true. It saves the config
before removing legacy fields, preserving model choices. A failed cleanup can be retried without
overwriting a global choice made since. Profiles that cannot be read remain untouched and are
reported by the normal listing. A fresh install with no legacy settings writes nothing.

- **A missing file is "nothing stored"; anything else wrong with a file is an error** that names
  it (`StorageFileError`). A store never starts from empty over a file it can't read: that would
  overwrite what the user has with the next write.
- **A write replaces the file whole.** It is written to a temp file beside it and renamed over it,
  so a crash or two writes at the same moment never leave half a file. The temp name is unique
  per call; a failed write removes it, and if that fails too both errors are reported.
- **Files are plain, flat JSON a person can edit.** That is why a read ignores a byte-order mark
  and accepts CRLF line ends, which Windows editors add.

## Every operating system

Linux, macOS and Windows are all supported, so a module here follows these rules. Each is
something that works on the system the code was written on and fails on another:

- **Modes are POSIX.** `PRIVATE_FILE_MODE` (`0600`) and `PRIVATE_FOLDER_MODE` (`0700`) keep the
  user's data to the user on Linux and macOS. Windows ignores them: there it is the permissions
  of the user's profile folder, where `~/.sheavly` lives, that keep others out. Never claim
  `0600` as the protection in a doc or a message; a test of a mode skips itself on Windows.
- **Windows refuses a rename while another program holds the file** (a virus scanner, an indexer)
  for a moment, with `EPERM`, `EBUSY` or `EACCES`. `replaceFile` tries again a few times; any
  write that replaces a file goes through it.
- **Names on disk come from ids, never from what a person typed.** A model's file is its
  lowercase UUID (`<uuid>.json`): it has no character a file name can't hold, no reserved name
  (`CON`, `NUL`, `COM1`), and no case, so macOS and Windows (case-insensitive) and Linux
  (case-sensitive) agree on which file it is. A name that has to come from something else (a
  workspace's folder) is made from a hash of its real path plus a readable part cut to a few
  characters, never the path itself: a path holds `:`, `\` and `/`, and a long one passes
  Windows' 260-character limit.
- **Paths are built with `node:path`**, never by joining with `/`, and a path kept in a file is
  not compared as text across systems (`C:\Users\x` and `c:\users\x` are one folder).
- **The home folder is `os.homedir()`**, chosen by the app. `HOME` doesn't exist on Windows.
- **Sorting does not use the system's locale.** `readdir` lists in the system's order and a
  default `Intl.Collator` follows the machine's language, so the same profile would list
  differently on two machines. A listing sorts file names by code and labels with a fixed locale.
- **A folder holds litter.** `.DS_Store` and `._*` files (macOS), `Thumbs.db` and `desktop.ini`
  (Windows), `*~` and `.swp` files (editors). A store reads only what it names: `<id>.json`, and
  nothing hidden.

## The model store

Optional `identity: { model, family? }` records the model chosen in setup, independently of its
display label and hosting deployment. It belongs in the file's envelope, like pricing, and never
enters the adapter definition. Existing files without it read unchanged; there is no implicit
identity inference or migration. The choice does not certify which weights a cloud deployment serves.

A model may include `pricing` alongside its identity, with `input`, `output`, `cacheRead` and
`cacheWrite` in USD per million tokens. It is envelope metadata, not an adapter definition or a
secret. Usage and cost estimates are stored as stream entries, so reopening a conversation uses
its recorded costs rather than recalculating them with newer rates.

A model may also include `contextWindow`, its context size in tokens, in the same envelope. It is
read and written like `pricing` and never enters the adapter definition. A file without it reads
unchanged; the host decides what window a model without one is told.

`ModelStore` is a profile's `models/` folder, one `<model-id>.json` each, flat so a person can
read and edit it. It is the pattern a store of hand-editable files follows:

- **`list()` never fails over one bad file.** It returns the models that read cleanly and a
  problem for each file that did not (damaged, not what a model is, or an `id` that isn't its
  file's name), each naming the file. People edit these files; a typo in one must not take the
  others down, and must not be silently skipped either.
- **`get(id)` fails for a bad file.** Asking for a model that exists but can't be used must not
  look like asking for one that isn't there.
- **A file is its id.** `<id>.json` holds the model with that `id`; a copy made by hand keeps the
  old `id` inside, so it is refused, not served as a second model under a new name.
- **A key never goes through it.** The store has no adapter and can't tell a key from a field;
  `AdapterRegistry.validateDefinition` refuses one first, and credentials have their own store.

## The credential store

`CredentialStore` is the only file with keys in it (`credentials.json`, `{ [model-id]: { [field]:
value } }`, the field names being whatever the adapter calls its secrets). It is built so a mistake
here cannot become a leak:

- **A key is never in an error.** Node's own message for a file that is not JSON quotes the text
  around the fault, which in this file could be a key; for it the message is fixed and carries no
  `cause`. A file of the wrong shape is named by the path of the field only.
- **A file open to others is refused**, as `ssh` refuses a key file: the keys in it may already
  have been seen, so the message says to restrict it (`chmod 600`) and to replace them. It is left
  as found. Where the system has no modes (Windows) nothing is checked, and the protection is the
  user's profile folder.
- **Our own writes are always private.** The file is made `0600` in a `0700` folder, and a
  replace keeps it so.
- **Writes are queued.** Setting a key reads the file and writes it back whole, so two at once
  would start from the same file and the second would erase the first's key. A write that fails
  does not hold up the ones after it.
- **Nothing can overwrite a file that can't be read.** A write reads first, so a damaged or open
  file stops it instead of being replaced by one holding a single key.
- **`fieldsSet()` says which fields are set, not their values**: all a UI needs to show "a key is
  set", with no way to read it back.

## The config store

`ConfigStore` is `config.json` at the root: `{ defaultProfile, workspaces: { <workspace-key>:
<profile-id> } }`, ids only. A workspace not bound uses the default; with neither, `profileFor`
says `undefined`, which is what onboarding is for.

- **A workspace key is a hash of its real path**, so it can name a folder on any system.
  `workspaceKey` lowercases a Windows path and makes its separators alike (`C:\Users\X\Proj`,
  `c:\users\x\proj\` and `C:/Users/X/Proj` are one folder), and keeps case elsewhere. Its value
  is pinned in a test against `sha256sum`: changing it would orphan every stored conversation.
- **Config never points at a profile that is gone.** `forgetProfile` takes a deleted profile out
  of the default and every binding. It touches config only: a profile's keys, models and
  conversations are inside its own folder, so deleting the folder deletes them.
- **Changes are queued** (`SerialQueue`), as for credentials, and a file that can't be read stops a
  change instead of being replaced.

## The permission store

`PermissionStore` is `permissions/<workspace-key>.json` under the root: `{ root, mode, allow }`
for one workspace, where `mode` is `ask`, `always_ask` or `allow_all` and `allow` the commands the
user allowed for good (`git log *`). It is not under a profile, since a folder's permissions are
the same whichever profile runs in it, and never in the repo, where the agent could edit it.
Nothing stored is `ask` with nothing allowed, and reading writes nothing.

- **A file is trusted only under its own name.** The name is the hash of `root`, so a file copied
  to another workspace's name is refused, not read as that workspace's grants.
- **A write can't make a file the next read refuses.** The result is checked against the schema
  first (no empty entry, no entry starting with `*`), and a file that can't be read stops every
  change instead of being replaced.
- **Changes are queued** (`SerialQueue`) and read the file fresh, so a mode set while
  conversations run applies to their next command.

## The profile store

`ProfileStore` is the `profiles/` folder: one `<profile-id>/` folder each, with a `profile.json`
(`{ id, name }`) and everything of that profile inside, its models, its keys and its conversations.
It lists the way the model store does (a folder it cannot use is reported by name and the rest
load; see `listing/`), and a folder is its id, so a copy made by hand is refused.

- **Deleting a profile deletes its folder.** That is what keeping a profile's keys inside it buys:
  nothing of a deleted profile is left on disk, with no list of what to clean up. `remove` is
  retried while another program holds a file in it (Windows). It tells the config nothing: the
  caller also calls `ConfigStore.forgetProfile`.
- **A delete is bounded by its id.** The folder is `profiles/<id>` and an id is parsed as a UUID
  before it is a path, so nothing that could name another folder reaches `rm`. A link is removed as
  the link, never emptied through, and no link inside the profile is followed out of it. A profile
  folder that is a link is listed, since a profile kept in a synced folder is one.
- **Hidden folders and files are not profiles.** `.git`, `.Trash`, `.DS_Store`, `Thumbs.db`.

## The profile registry

`ProfileRegistry` is the one door to all of this: the profiles, the config and each profile's
models and keys. The backend uses it and not the stores under it, because the stores each do one
thing and don't keep each other in step: removing a model through `ModelStore` leaves its key
behind, and deleting a profile folder leaves the config naming it.

- **`delete(id)` forgets the config first, then removes the folder.** If the folder can't be removed
  the profile is still there, unbound, and deleting it again finishes the job. The other order
  could leave the config naming a profile that is gone. `profileFor` also falls back from a
  profile whose folder was deleted by hand, so a workspace is never left with nothing to use.
- **`open(id)` returns one `OpenProfile` per profile.** Its credential store queues writes in memory,
  so two on one file would erase each other's keys; the registry is what guarantees one, even for
  two opens at the same moment.
- **An open profile keeps a model and its key together.** `removeModel` removes the key first (a
  failure then leaves a model without a key, not a key for nothing), `putSecrets` refuses a model
  the profile doesn't have, and every write checks the profile still exists, so one deleted in the
  meantime is not recreated as a folder holding one key. That check is not atomic with the write; a
  folder left by a delete landing in between is listed as a problem, and deleting it clears it.
- **It is a key holder.** `getSecrets` hands a key to whoever asks, so `harness/no-key-holder-import`
  keeps its import to the backend app, exactly as for the credential store.

## Adding a store

A store is a module folder here (`<kind>-store/`), a class over a root folder it is given. It
reads and writes through `json-file/`, names its files from ids, and says in its test what it does
when a file is missing, damaged or being replaced. Add its row to the README, and export its file
kind with `npm run export -- packages/storage <kind>` if it has none yet.

## Naming and deleting

A store never builds a path from an id by hand, and nothing here calls `rm` itself. Every path a
store reads, writes or deletes comes from `safe-path/`, which checks what it was asked for before it
touches the disk. A recursive delete with a wrong path (an empty one, a variable that was never set,
an id that is really `../x`) is not undone, and a write to one overwrites a file; the same bug that
makes one dangerous makes the other, so they share the rules. Each throws an `UnsafePathError` and
touches nothing when:

- **The name is not an id.** `namedPath` makes the path of `<id><extension>` in a folder, and only a
  lowercase UUID and a plain extension (`.json`) pass, so nothing holds a separator, a `..`, a glob
  or a reserved name, whatever the type of the value says: a type is not proof for a value that
  came from outside. Reads, writes and deletes of a model or a profile all name their file this way.
- **The root is not a place for a store.** A store checks the folder it is given when it is built
  (`assertSafeRoot`): a relative one would silently mean wherever the process runs, so the same
  store would read and write somewhere else after a `cd`; the top of a file system is no place
  for our files.
- **The place is not the store's own** (deleting a folder). `removeFolder` takes only a folder
  directly inside the store's folder (`profiles/<id>`), never the store's folder, a folder above
  it, a relative path, the home folder, or the folder that holds it. The path is resolved first
  (`..` applied), and what is checked is what is deleted. A store folder reached through a link
  must not really be the top of a file system.
- **It is not the kind of thing asked for.** `removeFile` is never recursive, and leaves a folder
  with that name alone.

`writeJsonFile` and `appendJsonLine` take any path by design (the config and the trust document
have a fixed name and no id in it); their callers choose the path, and a store chooses it with
`namedPath`. The one other `rm` is `writeJsonFile` discarding the temp file of a write that failed: a
non-recursive remove of `<file>.<uuid>.tmp`, a name that function made itself a moment before, so it
can't name anything else. The test helpers' `rm` removes a folder the test just made. The tests of
this module hold the rules: each was broken on purpose to see a test fail.

Tests run in a temp folder and never touch the real `~/.sheavly`. CI runs on Linux only today;
Windows and macOS behaviour here rests on documented behaviour of the platform, so a change to a
rule above deserves a run on that system.
