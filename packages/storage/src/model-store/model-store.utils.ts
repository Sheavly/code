import type { Model } from '@sheavly/protocol/model/model.types';

const collator = new Intl.Collator('en');

/**
 * The models ordered by name, then id. The locale is fixed, not the system's, so a profile folder
 * lists the same on every machine; two models with one name (allowed: it is only a label) keep a
 * stable order by their ids. Returns a new array.
 */
export function sortModels(models: readonly Model[]): Model[] {
  return [...models].sort((a, b) => {
    const byName = collator.compare(a.name, b.name);

    if (byName !== 0) return byName;

    return a.id < b.id ? -1 : Number(a.id > b.id);
  });
}
