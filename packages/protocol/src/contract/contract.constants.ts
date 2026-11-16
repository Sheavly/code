/** The contract's JSON Schema, committed at the package root (`npm run schema -w @sheavly/protocol`). */
export const CONTRACT_SCHEMA_FILE = 'contract.schema.json';

/**
 * The wire contract's version, published as `contractVersion` in the JSON Schema. Raise it for a
 * change a stored conversation or an older client cannot read; adding an optional field does not.
 * Stored data carries no marker: what it lacks is what `LEGACY_FIELDS` lists.
 */
export const CONTRACT_VERSION = 1;

/**
 * Every field that is optional only so data written before it existed still parses. Each says when
 * it can go: made required once a migration rewrites stored data (or the data is old enough to
 * drop), never silently. A test checks each is optional in its schema and has a condition.
 */
export const LEGACY_FIELDS = [
  {
    field: 'user message id',
    removeWhen: 'stored histories are migrated to give every user message an id',
  },
  {
    field: 'message at',
    removeWhen: 'stored histories are migrated to stamp every message with its time',
  },
  {
    field: 'summary covered',
    removeWhen: 'checkpoints stored before coverage was recorded are re-summarized or dropped',
  },
  {
    field: 'summary incorporated',
    removeWhen: 'stored checkpoints are migrated to name the checkpoint they folded in',
  },
  {
    field: 'summary_failed kind',
    removeWhen: 'streams stored before failures were classified are no longer replayed',
  },
  {
    field: 'agent-report context',
    removeWhen: 'stored histories are migrated to carry completion context on every report',
  },
  {
    field: 'task-finished context',
    removeWhen: 'stored histories are migrated to carry completion context on every task',
  },
  {
    field: 'tasks-finished context',
    removeWhen: 'stored histories are migrated to carry completion context on every group',
  },
  {
    field: 'task kind',
    removeWhen: 'stored task snapshots are migrated to name their kind',
  },
  {
    field: 'stored conversation mode',
    removeWhen: 'the stored conversation index is migrated to record every mode',
  },
] as const;

export const JSON_SCHEMA_DIALECT = 'https://json-schema.org/draft/2020-12/schema';
