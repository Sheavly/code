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
  /** The `<noun>:<verb>` grants its manifest asks for; the host verifies them against its services. */
  grants?: readonly string[];
  /** Names it may contribute; a test that contributes something undeclared tests the failure. */
  tools?: readonly string[];
  hooks?: readonly string[];
  workKinds?: readonly string[];
  settings?: readonly SettingManifest[];
  /**
   * What its manifest's `emits` declares. Event kinds and `modelFacingNotices` are declared for
   * what `contributes` holds too; a test that omits one here and contributes it elsewhere
   * (`activate`) tests the refusal.
   */
  emits?: { events?: readonly string[]; modelFacingNotices?: boolean };
  /**
   * What `activate` returns, declaring the names in it so a test does not repeat them. Used when
   * `activate` is not given; the names are declared either way.
   */
  contributes?: Contributions;
  origin?: ExtensionOrigin;
  activate?: (context: ExtensionContext) => Contributions | Promise<Contributions>;
  deactivate?: () => void | Promise<void>;
};
