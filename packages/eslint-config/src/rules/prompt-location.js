import path from 'node:path';
import { isTestOrFake } from '../test-paths.utils.js';
import { createPromptFlow, memberName, unwrapPrompt, walkPrompt } from './prompt-flow.utils.js';
import {
  hasPromptProperties,
  modelMessageType,
  modelOptionsType,
  modelSectionType,
  promptObjectType,
  typedPromptCall,
} from './prompt-sinks.utils.js';

// These are API bindings, not prose keywords or names of prompt variables. Relative and
// namespace aliases resolve to the same imported binding; typed contracts cover routed options.
const OPTION_APIS = new Set([
  'createHarness',
  'createCodingHarness',
  'runAgent',
  'streamAgent',
  'composeInstructions',
  'appendInstructionContext',
  'createConversation',
]);

function isHarnessAPI(binding) {
  return binding && /(?:^@sheavly\/|\.(?:helper|utils)(?:\.js)?$)/.test(binding.source);
}

function isAuthoredText(params) {
  const { flow, value, depth = 0 } = params;

  if (depth > 30) return false;

  return flow.expand(value, depth).some((entry) => {
    const { node, module, env } = entry;
    const check = (child) =>
      isAuthoredText({ flow, value: flow.ref(child, module, env), depth: depth + 1 });

    if (node.type === 'Literal') {
      return typeof node.value === 'string' && node.value.trim().length > 0;
    }

    if (node.type === 'TemplateLiteral') {
      return (
        node.quasis.some((part) => part.value.raw.trim().length > 0) || node.expressions.some(check)
      );
    }

    if (node.type === 'BinaryExpression') return check(node.left) || check(node.right);

    if (node.type === 'ArrayExpression') {
      return node.elements.some((element) => element && check(element));
    }

    if (node.type === 'SpreadElement') return check(node.argument);

    if (node.type === 'CallExpression') {
      const callee = unwrapPrompt(node.callee);
      const receiver = callee.type === 'MemberExpression' && callee.object;

      return (receiver && check(receiver)) || node.arguments.some(check);
    }

    return false;
  });
}

/** Authored text belongs in prompt files; caller/user data may flow through model-facing sinks. */
export const promptLocation = {
  meta: {
    type: 'problem',
    schema: [],
    messages: {
      extract:
        "Move authored model-facing {{sink}} into the module's `*.prompt.ts` and import the named text, table or pure renderer. Caller/user data may remain inline; constants indirection is not prompt extraction.",
    },
  },
  create(context) {
    if (/\.(prompt|fake)\.tsx?$/.test(context.filename) || isTestOrFake(context.filename)) {
      return {};
    }

    const flow = createPromptFlow(context);
    const owner = flow.workspaces.find((workspace) =>
      path.resolve(context.filename).startsWith(`${workspace.src}${path.sep}`),
    );

    // baseConfig excludes test-only workspaces; keep direct rule invocation consistent too.
    if (owner?.testOnly) return {};

    const reported = new Set();
    const check = (params) => {
      const { value, node, sink } = params;
      const reportNode = value.module === flow.current ? value.node : node;

      if (reported.has(reportNode) || !isAuthoredText({ flow, value })) return;

      reported.add(reportNode);
      context.report({ node: reportNode, messageId: 'extract', data: { sink } });
    };
    const checkProperty = (params) => {
      const { value, name, node, sink = name } = params;

      for (const property of flow.properties(value, name)) check({ value: property, node, sink });
    };

    function checkSchema(value, sinkNode, seen = new Set(), depth = 0) {
      if (depth > 30 || seen.has(value.node)) return;

      seen.add(value.node);

      for (const entry of flow.expand(value, depth)) {
        walkPrompt(entry.node, (node) => {
          if (
            node.type === 'CallExpression' &&
            node.callee.type === 'MemberExpression' &&
            memberName(node.callee) === 'describe' &&
            node.arguments[0]
          ) {
            check({
              value: flow.ref(node.arguments[0], entry.module, entry.env),
              node: sinkNode,
              sink: 'parameter guidance',
            });
          }

          if (
            (node.type === 'Identifier' || node.type === 'CallExpression') &&
            node !== entry.node
          ) {
            checkSchema(flow.ref(node, entry.module, entry.env), sinkNode, seen, depth + 1);
          }
        });
      }
    }

    function checkMessage(entry, sinkNode) {
      if (entry.node.type !== 'ObjectExpression') return;

      const roles = flow.properties(entry, 'role').flatMap((role) => flow.expand(role));
      const modelRole = roles.some(
        ({ node }) => node.type === 'Literal' && ['system', 'user'].includes(node.value),
      );

      if (!modelRole) return;

      checkProperty({ value: entry, name: 'content', node: sinkNode, sink: 'message content' });
    }

    function checkMessages(value, sinkNode, depth = 0) {
      if (depth > 30) return;

      for (const entry of flow.expand(value, depth)) {
        checkMessage(entry, sinkNode);

        if (entry.node.type !== 'ArrayExpression') continue;

        const elements = entry.node.elements.filter(Boolean);

        for (const element of elements) {
          checkMessages(flow.ref(element, entry.module, entry.env), sinkNode, depth + 1);
        }
      }
    }

    function checkOptions(value, node) {
      for (const name of ['instructions', 'baseInstructions']) checkProperty({ value, name, node });
      for (const messages of flow.properties(value, 'messages')) checkMessages(messages, node);
    }

    function checkTool(value, node) {
      checkProperty({ value, name: 'description', node, sink: 'tool description' });
      for (const schema of flow.properties(value, 'inputSchema')) checkSchema(schema, node);
    }

    return {
      CallExpression(node) {
        const argument = node.arguments[0];

        if (!argument) return;

        const typedSink = typedPromptCall({ context, node });

        if (typedSink === 'content') {
          check({ value: flow.ref(argument), node, sink: 'context or conversation content' });
        }

        if (typedSink === 'options') checkOptions(flow.ref(argument), node);

        const binding = flow.importedBinding(flow.ref(node.callee));

        if (!isHarnessAPI(binding)) return;

        if (binding.name === 'defineTool' && /tool\.utils(?:\.js)?$/.test(binding.source)) {
          checkTool(flow.ref(argument), node);
        }

        if (OPTION_APIS.has(binding.name)) checkOptions(flow.ref(argument), node);

        if (
          binding.name === 'withDescription' &&
          /tool\.validator(?:\.js)?$/.test(binding.source)
        ) {
          checkSchema(flow.ref(node), node);
        }
      },
      ObjectExpression(node) {
        const type = promptObjectType({ context, node });
        const value = flow.ref(node);

        if (modelOptionsType(type)) checkOptions(value, node);

        if (hasPromptProperties(type, ['name', 'description', 'inputSchema'])) {
          checkTool(value, node);
        }

        if (modelMessageType(type)) checkMessages(value, node);

        if (modelSectionType(type)) {
          for (const name of ['title', 'guidance']) {
            checkProperty({ value, name, node, sink: 'model section guidance' });
          }
        }
      },
      'Program:exit'(program) {
        // The shared schema producer is itself a recognized tool API, even without a caller in
        // this file. This checks its reachable .describe calls, not unrelated human schemas.
        if (!/[/\\]tool[/\\]tool\.validator\.ts$/.test(context.filename)) return;

        for (const statement of program.body) {
          if (
            statement.type === 'ExportNamedDeclaration' &&
            statement.declaration?.id?.name === 'withDescription'
          ) {
            walkPrompt(statement.declaration.body, (node) => {
              if (node.type === 'ReturnStatement' && node.argument) {
                checkSchema(flow.ref(node.argument), node);
              }
            });
          }
        }
      },
    };
  },
};
