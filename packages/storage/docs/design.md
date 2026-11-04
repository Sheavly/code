# Design

How this workspace works inside, why it is built this way, and how to extend it.

## What lives here

Everything the harness keeps for the user, under one root an app passes in (`~/.sheavly`): their
conversations, models, credentials, profiles and settings. Each kind of data gets its own store
over the same two functions, `readJsonFile` and `writeJsonFile`, so how a file is read and
replaced is decided once.

```text
~/.sheavly/
  config.json                            # the default profile; workspace → profile bindings
  trusted-workspaces.json                # shared: trust is about a repo, not a provider
  profiles/<profile-id>/
    profile.json                         # { id, name }: the name is the label a UI shows
    models/<model-id>.json               # one file per model: { id, name, adapter, ...fields }
    credentials.json                     # { [model-id]: { apiKey } }, the only file with keys
    workspaces/<workspace-key>/
      conversations/<conversation-id>.jsonl   # the stream, one entry per line
      conversations/<conversation-id>.json    # the index entry and the history
```

Everything on disk is named by an id, never by what a person typed (`<profile-id>` and
`<model-id>` are lowercase UUIDs; `<workspace-key>` is a hash of the workspace's real path). A
person's names (`work`, `Astra 6`) are inside the files, as labels.

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

## Adding a store

A store is a module folder here (`<kind>-store/`), a class over a root folder it is given. It
reads and writes through `json-file/`, names its files from ids, and says in its test what it does
when a file is missing, damaged or being replaced. Add its row to the README, and export its file
kind with `npm run export -- packages/storage <kind>` if it has none yet.

Tests run in a temp folder and never touch the real `~/.sheavly`. CI runs on Linux only today;
Windows and macOS behaviour here rests on documented behaviour of the platform, so a change to a
rule above deserves a run on that system.
