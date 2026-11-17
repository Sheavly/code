/** A conversation folder's stream: one entry per line (`@sheavly/storage`'s `STREAM_FILE`). */
export const CONVERSATION_STREAM_FILE = 'stream.jsonl';

/** The replay command's help text. */
export const REPLAY_USAGE = `Usage: npm run replay -- <conversation-folder|run> [options]

  <conversation-folder>  a conversation folder (it holds stream.jsonl), e.g. under ~/.sheavly;
                         a folder is a path: it has a / or starts with a dot (./last)
  <run>                  a workbook run: its id, its number, a unique start of its id, or "last";
                         a bare word is always a run, never a folder in the current directory
                         (a run's folder, which holds sessions.sse, works as a path)

  --from <seq>           start at the entry with this seq
  --session <id>         only this session's entries, with this session as the main one
  --json                 one JSON entry per line instead of the rendered log
  --summary              what the stream says about itself instead: counts per kind, sessions,
                         tasks, and what is wrong (a missing done, a seq gap, a cut-off last line)

Reads the stored stream only: no backend, no model, no network. Finding a run by id reads the
workbook's state.json and the names in workbook/runs/, and nothing else.`;

/** What makes a replay target a folder path rather than a run: a separator or a leading dot. */
export const FOLDER_PATH = /^\.|[/\\]/;
