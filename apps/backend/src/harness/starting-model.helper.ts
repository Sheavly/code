import { SetupError } from '../errors/setup.errors.js';
import type { ModelSwitch } from './harness.types.js';

/**
 * Starts the conversation's switch on the model `requested` names: an id, a name (any case), or a
 * part of a name or model that only one of the profile's models has. Nothing is remembered for
 * the profile, so a run that asks for another model never changes where its next chat starts.
 * Throws a `SetupError` (`invalid`) that lists the profile's models when none, or more than one,
 * matches: a guess between two models would run the wrong one and still look fine.
 */
export function startOnRequestedModel(params: { models: ModelSwitch; requested: string }): void {
  const { models, requested } = params;
  const wanted = requested.trim().toLowerCase();
  const names = models.choices.map((choice) => `${choice.name} (${choice.model})`).join(', ');

  // An empty request would match every model by substring; it names none, so it is refused as such.
  if (wanted === '') {
    throw new SetupError({
      reason: 'invalid',
      message: `A model needs a name or an id. This profile's models: ${names}.`,
    });
  }

  const exact = models.choices.filter(
    (choice) => choice.id === wanted || choice.name.toLowerCase() === wanted,
  );
  const found =
    exact.length > 0
      ? exact
      : models.choices.filter(
          (choice) =>
            choice.name.toLowerCase().includes(wanted) ||
            choice.model.toLowerCase().includes(wanted),
        );
  const [only] = found;

  if (found.length === 1 && only) {
    models.switch.use(only.id);

    return;
  }

  const problem = found.length === 0 ? 'matches none of' : 'matches more than one of';

  throw new SetupError({
    reason: 'invalid',
    message: `The model "${requested}" ${problem} this profile's models: ${names}. Use its id or more of its name.`,
  });
}
