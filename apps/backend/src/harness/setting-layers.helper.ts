import type { TrustState } from '@sheavly/coding/trust/trust.types';
import type { TrustStore } from '@sheavly/coding/trust/trust.service';
import {
  projectSettingsFileExists,
  projectSettingsPath,
  readProjectSettings,
} from '@sheavly/coding/project-settings/project-settings.helper';
import type { Environment } from '@sheavly/core/environment/environment.types';
import type { Extension } from '@sheavly/extension/extension/extension.types';
import { ExtensionSettingError } from '@sheavly/extension/errors/extension.errors';
import type { LayeredSettings, SettingLayer } from '@sheavly/extension/host/setting-layers.types';
import { layerSettings } from '@sheavly/extension/host/setting-layers.utils';
import { parseSettingsFile } from '@sheavly/extension/host/settings-file.helper';
import { MAX_IGNORED_SETTINGS } from '@sheavly/protocol/server/server.constants';
import type { IgnoredSettingReport } from '@sheavly/protocol/server/server.types';
import { StorageFileError, UnsafePathError } from '@sheavly/storage/errors/storage.errors';
import { sheavlyHome } from '@sheavly/storage/home/home.helper';
import { SettingsFiles } from '@sheavly/storage/settings-file/settings-files.service';
import { SettingsFileError } from '../errors/settings-file.errors.js';
import { SetupError } from '../errors/setup.errors.js';
import { isEnvironmentError } from './environment-error.utils.js';
import type { ResolvedSettings, SettingFileLayers } from './harness.types.js';
import { reportedFile } from './setting-layers.utils.js';
import { isUserFolder } from './user-folder.helper.js';

/** The workspace file as it enters the layering: its layer if it parsed, whether it is trusted, what went wrong. */
type WorkspaceRead = {
  layer: SettingLayer | undefined;
  trusted: boolean;
  problems: IgnoredSettingReport[];
};

/** What asking the trust store came to: its answer, or that it could not answer. */
type TrustAnswer = TrustState | 'unavailable';

/**
 * Reads the user's global file and the bound profile's file, which are the user's own: one that
 * cannot be used throws a `SetupError` (`invalid`) whose message names the file and the reason and
 * never the content, so the run does not start on a setting the user thinks applies and the API
 * answers it as a refused request (422) rather than a server failure. A file that is not there is
 * an empty layer. The app reads them (it knows the profile) and passes them to
 * `createBackendHarness` as `settingLayers`.
 */
export async function readUserSettingLayers(params: {
  env: Environment;
  profile: string;
}): Promise<SettingFileLayers> {
  try {
    const files = new SettingsFiles({ root: sheavlyHome(params.env) });

    return {
      global: layerOf(await files.readGlobal()),
      profile: layerOf(await files.readProfile(params.profile)),
    };
  } catch (caughtError) {
    // The three ways a user file can be unusable; anything else is a bug and stays what it is.
    if (
      caughtError instanceof SettingsFileError ||
      caughtError instanceof StorageFileError ||
      caughtError instanceof UnsafePathError
    ) {
      throw new SetupError({ reason: 'invalid', message: caughtError.message, cause: caughtError });
    }

    throw caughtError;
  }
}

/** The layer a user file makes, or `undefined` for no file; an unusable file throws. */
function layerOf(read: { text: string; file: string } | undefined): SettingLayer | undefined {
  if (read === undefined) return undefined;

  const parsed = parseSettingsFile({ text: read.text, source: read.file });

  if (!parsed.ok) throw new SettingsFileError(parsed.problem);

  return { source: read.file, values: parsed.values };
}

/**
 * Layers the settings: the given global and profile layers, the workspace's own file (read here,
 * the only layer that needs trust), then the defaults. Returns the values to give `ExtensionHost`
 * before it is built, so the host never learns about files or trust.
 *
 * The workspace file is untrusted input that may carry a restricted setting only when its
 * `.sheavly/` is trusted, so the order is: look whether the file is there (without it, the trust
 * store is not consulted); check trust (`trustWorkspace` grants it first, as `--trust` does for
 * hooks); read the file; check trust again. It counts as trusted only if both checks said
 * `trusted`, because a file that changed between the check and the read is not what was trusted.
 * A workspace file that cannot be used is an empty layer and is reported in `ignored`, never
 * fatal: a repo's file must not make the folder unopenable. Nor is the trust step: a trust store
 * that cannot answer (a corrupt trust file, a store inside the repo, a file under `.sheavly/` that
 * cannot be read) counts the workspace as untrusted, and the file is still read and used as far as
 * an untrusted workspace's file is. It is reported as `trust-unavailable`, never with the error's
 * text.
 *
 * When the workspace's `.sheavly/` is the user's own folder (`home`, the user's `SHEAVLY_HOME`,
 * is it or inside it: the workspace is the user's home, or a folder whose `.sheavly` is the user's folder), there is no workspace layer, no
 * trust call and no report: its files are the global and profile layers already.
 *
 * At most `MAX_IGNORED_SETTINGS` entries are listed, the file's problems first; `ignoredMore`
 * counts the rest, so a hostile file cannot make the report or the log long.
 */
export async function resolveSettings(params: {
  extensions: readonly Extension[];
  layers: SettingFileLayers;
  workspaceRoot: string;
  home: string;
  trustStore: TrustStore;
  trustWorkspace: boolean;
}): Promise<ResolvedSettings> {
  const { extensions, layers, workspaceRoot, home, trustStore, trustWorkspace } = params;
  const workspace = await readWorkspaceLayer({ workspaceRoot, home, trustStore, trustWorkspace });
  const layered = layerOrRefuse({ extensions, layers, workspace });
  const file = workspace.layer === undefined ? undefined : reportedFile(workspace.layer.source);
  const reported: IgnoredSettingReport[] = [
    ...workspace.problems,
    ...layered.ignored.map(({ name, layer, reason }) => ({
      layer,
      name,
      reason,
      ...(file !== undefined && { file }),
    })),
  ];

  return {
    values: layered.values,
    sources: layered.sources,
    ignored: reported.slice(0, MAX_IGNORED_SETTINGS),
    ignoredMore: Math.max(0, reported.length - MAX_IGNORED_SETTINGS),
  };
}

/**
 * `layerSettings`, where a wrong value in the user's own global or profile file (a name no
 * extension declares, a value of another type) is a refused start: a `SetupError` (`invalid`) that
 * keeps the message naming the file, so the API answers 422 and not a bare server failure. An
 * error that names no file is not the user's file and stays what it is.
 */
function layerOrRefuse(params: {
  extensions: readonly Extension[];
  layers: SettingFileLayers;
  workspace: WorkspaceRead;
}): LayeredSettings {
  const { extensions, layers, workspace } = params;

  try {
    return layerSettings({
      extensions,
      global: layers.global,
      profile: layers.profile,
      workspace: workspace.layer,
      workspaceTrusted: workspace.trusted,
    });
  } catch (caughtError) {
    if (caughtError instanceof ExtensionSettingError && caughtError.source !== undefined) {
      throw new SetupError({ reason: 'invalid', message: caughtError.message, cause: caughtError });
    }

    throw caughtError;
  }
}

/**
 * The trust before the read: granted now for `--trust` (as for hooks), else what the store says.
 * A store that cannot answer is `unavailable`, never thrown.
 */
async function trustBefore(params: {
  root: string;
  trustStore: TrustStore;
  trustWorkspace: boolean;
}): Promise<TrustAnswer> {
  const { root, trustStore, trustWorkspace } = params;

  return answerOf(async () => {
    if (!trustWorkspace) return trustStore.check({ root });

    await trustStore.trust({ root });

    return 'trusted';
  });
}

/**
 * What `ask` answers, or `unavailable` when the trust step fails the way it can fail on a hostile
 * or damaged folder: a `TrustStoreError` (a corrupt trust file, a store inside the workspace) or a
 * system error (a file under `.sheavly/` that cannot be read). Anything else is a bug and throws.
 */
async function answerOf(ask: () => Promise<TrustState>): Promise<TrustAnswer> {
  try {
    return await ask();
  } catch (caughtError) {
    if (isEnvironmentError(caughtError)) return 'unavailable';

    throw caughtError;
  }
}

/** The workspace's `.sheavly/settings.json` as a layer, with the trust it was read under. */
async function readWorkspaceLayer(params: {
  workspaceRoot: string;
  home: string;
  trustStore: TrustStore;
  trustWorkspace: boolean;
}): Promise<WorkspaceRead> {
  const { workspaceRoot: root, home, trustStore, trustWorkspace } = params;
  const none: WorkspaceRead = { layer: undefined, trusted: false, problems: [] };

  if (await isUserFolder({ workspaceRoot: root, home })) return none;

  if (!(await projectSettingsFileExists({ root }))) return none;

  const file = reportedFile(projectSettingsPath({ root }));
  const problem = (reason: IgnoredSettingReport['reason']): IgnoredSettingReport => ({
    layer: 'workspace',
    file,
    reason,
  });
  const before = await trustBefore({ root, trustStore, trustWorkspace });
  const read = await readProjectSettings({ root });

  // A file that vanished since the look is no file.
  if (read === undefined) return none;

  // Without an answer before the read there is nothing to compare, so the store is not asked again.
  const unavailable = before === 'unavailable' ? [problem('trust-unavailable')] : [];

  if (!read.ok) return { ...none, problems: [problem(read.reason), ...unavailable] };

  const parsed = parseSettingsFile({ text: read.text, source: read.path });

  if (!parsed.ok) return { ...none, problems: [problem(parsed.cause), ...unavailable] };

  const after =
    before === 'unavailable' ? before : await answerOf(() => trustStore.check({ root }));

  return {
    layer: { source: read.path, values: parsed.values },
    trusted: before === 'trusted' && after === 'trusted',
    problems: after === 'unavailable' ? [problem('trust-unavailable')] : [],
  };
}
