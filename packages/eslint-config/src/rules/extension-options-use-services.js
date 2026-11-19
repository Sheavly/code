// An extension's options carry the embedding app's choices, never run state: the host already
// supplies sessions, tasks, the provider and the rest as services every extension reads, so an
// option of such a type gives a built-in what a third party cannot get. The service types are read
// from the extension package's run-services file (`run-service-types.utils.js`), never listed here, and only
// types named `*ExtensionOptions` are checked. The registries the host's `Harness` type carries
// (`SessionRegistry`, `TaskRegistry`, `ApprovalRegistry`), read from `host.types.ts`, are refused
// too: the run-service keys now carry scope types, so the registries are no service type.
import { LAYOUT_RULE_OPTIONS } from '../layout.utils.js';
import { HARNESS_TYPES_FILE, readHarnessRegistries } from '../harness-registry-types.utils.js';
import { RUN_SERVICES_FILE, readRunServices } from '../run-service-types.utils.js';
import { serviceMentionsIn } from './options-service-mentions.utils.js';
import { isExtensionSource } from './extension-source.utils.js';
import { findRoot } from './workspace-types.js';

const OPTIONS_NAME = /ExtensionOptions$/;
const TYPE_FILE = /\.[cm]?tsx?$/;

function checkOptions(params) {
  const { context, declaration, services, registries } = params;
  const ast = context.sourceCode.ast;

  for (const { node, name, type } of serviceMentionsIn({ ast, declaration, services })) {
    context.report({
      node,
      messageId: 'runState',
      data: { property: name, type, key: services.get(type) },
    });
  }

  for (const { node, name, type } of serviceMentionsIn({
    ast,
    declaration,
    services: registries,
  })) {
    context.report({ node, messageId: 'registry', data: { property: name, type } });
  }
}

/** One error on the file's Program: the rule has nothing to check against and says so. */
function reportUnreadable(params) {
  const { context, messageId, file } = params;

  return {
    Program(node) {
      context.report({ node, messageId, data: { file } });
    },
  };
}

/** The registries of `Harness` that no run service already names (those get the service's message). */
function registriesOnly(params) {
  const { registries, services } = params;

  return new Map([...registries].filter(([type]) => !services.has(type)));
}

export const extensionOptionsUseServices = {
  meta: {
    type: 'problem',
    schema: [LAYOUT_RULE_OPTIONS],
    messages: {
      runState:
        '`{{property}}` is run state the host supplies as the {{key}} service (`{{type}}`): read it with `services.get({{key}})` in `activate` instead of taking it as an option, so a built-in extension gets no more access than a third party.',
      registry:
        "`{{property}}` is the full `{{type}}` registry the host's `Harness` carries: an extension never takes one as an option. Read the scoped service in `activate` (`services.get(KEY)`: session-info, child-sessions, background-tasks, task-control, output-reader, output-capture, approvals), built for this extension and limited to what its manifest grants, so a built-in extension gets no more access than a third party.",
      unreadable:
        "This rule could not read the host's run services from `{{file}}`: it exists but has no `export const KEY = defineService<Type>(…)` with a named type (was `defineService` renamed or wrapped?). Restore that form, or update `harness/extension-options-use-services`, so `*ExtensionOptions` stay checked.",
      unreadableHarness:
        "This rule could not read the registries of the host's `Harness` type from `{{file}}`: it exists but no member is typed from a `*.service` module imported by name. Restore that form, or update `harness/extension-options-use-services`, so `*ExtensionOptions` stay checked.",
    },
  },
  create(context) {
    const options = context.options[0] ?? {};
    const root = options.root ?? findRoot(context.cwd);

    // Cheap checks first: a file that is not extension source pays for no parse or stat.
    if (!root || !TYPE_FILE.test(context.filename)) return {};
    if (!isExtensionSource({ root, options, file: context.filename })) return {};

    const { state, types: services } = readRunServices(root);

    // A missing or unparsable file does nothing (a throwaway tree, a host the compiler rejects);
    // a file that parses but yields no keys means this rule has gone blind, so it says so.
    if (state === 'read' && services.size === 0) {
      return reportUnreadable({ context, messageId: 'unreadable', file: RUN_SERVICES_FILE });
    }

    const harness = readHarnessRegistries(root);

    if (harness.state === 'read' && harness.registries.size === 0) {
      return reportUnreadable({
        context,
        messageId: 'unreadableHarness',
        file: HARNESS_TYPES_FILE,
      });
    }

    const registries = registriesOnly({ registries: harness.registries, services });

    if (services.size === 0 && registries.size === 0) return {};

    const check = (declaration) => {
      if (OPTIONS_NAME.test(declaration.id.name)) {
        checkOptions({ context, declaration, services, registries });
      }
    };

    return { TSTypeAliasDeclaration: check, TSInterfaceDeclaration: check };
  },
};
