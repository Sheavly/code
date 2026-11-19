import type {
  Contributions,
  Extension,
  ExtensionContext,
  ExtensionOrigin,
  HostService,
  ServiceKey,
} from '../extension/extension.types.js';
import type { SettingManifest } from '../manifest/manifest.types.js';

/** What a consumer reads from the fake provider's service: who it was built for, and a call that needs the grant. */
export type GrantedScope = { owner: string; token: number; use: () => string };

/** What `assertServiceEnforcesGrants` is given: the provider, its service and one call per grant. */
export type ServiceGrantsParams<TService> = {
  /** The extension that provides `service` with `provideFor` and declares `services.grants` for it. */
  provider: Extension;
  service: ServiceKey<TService>;
  /**
   * For each grant the provider's manifest declares for `service`, a call that exercises what
   * that grant covers. It may throw anything but the undeclared-grant error when the grant is held.
   */
  calls: Readonly<Record<string, (scope: TService) => unknown>>;
  /** Run services the provider reads (the app supplies them), as `ExtensionHost` takes them. */
  services?: readonly HostService[];
  /** Extensions the provider depends on, activated with it. */
  alongside?: readonly Extension[];
};

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
  /** The grants each service it provides understands (`services.grants`), by service name. */
  serviceGrants?: Readonly<Record<string, readonly string[]>>;
  /** The `<noun>:<verb>` grants its manifest asks for; the host verifies them against its services. */
  grants?: readonly string[];
  /** Names it may contribute; a test that contributes something undeclared tests the failure. */
  tools?: readonly string[];
  hooks?: readonly string[];
  /** Instruction section names it may contribute; declared for `contributes.instructions` too. */
  instructions?: readonly string[];
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
