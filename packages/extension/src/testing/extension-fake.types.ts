import type {
  Contributions,
  ExtensionContext,
  ExtensionOrigin,
} from '../extension/extension.types.js';
import type { SettingManifest } from '../manifest/manifest.types.js';

/** What a test says about a fake extension: what its manifest declares, and its code. */
export type FakeExtensionFields = {
  name: string;
  dependsOn?: readonly string[];
  /** Service names it reads with `get`; the extension is skipped without them. */
  requires?: readonly string[];
  /** Service names it reads with `find`. */
  optional?: readonly string[];
  /** Service names it provides. */
  provides?: readonly string[];
  /** Names it may contribute; a test that contributes something undeclared tests the failure. */
  tools?: readonly string[];
  hooks?: readonly string[];
  workKinds?: readonly string[];
  settings?: readonly SettingManifest[];
  /**
   * What `activate` returns, declaring the names in it so a test does not repeat them. Used when
   * `activate` is not given; the names are declared either way.
   */
  contributes?: Contributions;
  origin?: ExtensionOrigin;
  activate?: (context: ExtensionContext) => Contributions | Promise<Contributions>;
  deactivate?: () => void | Promise<void>;
};
