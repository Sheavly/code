import { createHash } from 'node:crypto';
import path from 'node:path';
import { findPromptReviewRoot } from './system-prompt-review-confinement.utils.js';
import { PROMPT_REVIEW_ANCHOR, promptReviewHashes } from './system-prompt-review.utils.js';
const MARKER = '@system-prompt-review';
const ACTION =
  'Review the production prompt/tool sources and BASE_AGENT_INSTRUCTIONS, then update the adjacent @system-prompt-review JSON block record with version: 1, sourcesHash, promptHash, decision (prompt-updated or prompt-unchanged), and a nonblank reason. Do not merely refresh hashes without review.';

function promptDeclaration(program) {
  const declarations = program.body
    .filter((node) => node.type === 'ExportNamedDeclaration')
    .flatMap((node) => {
      if (node.declaration?.type !== 'VariableDeclaration') return [];

      return node.declaration.declarations
        .filter((declaration) => declaration.id.name === 'BASE_AGENT_INSTRUCTIONS')
        .map((declaration) => ({ statement: node, template: declaration.init }));
    });

  if (declarations.length !== 1) return null;

  const [declaration] = declarations;

  return declaration.template?.type === 'TemplateLiteral' &&
    declaration.template.expressions.length === 0
    ? declaration
    : null;
}

function adjacentRecord(params) {
  const { comment, statement, sourceCode } = params;
  const [start, end] = comment.range;
  const [statementStart, statementEnd] = statement.range;

  if (end <= statementStart) {
    return sourceCode.text.slice(end, statementStart).trim() === '';
  }

  return start >= statementEnd && sourceCode.text.slice(statementEnd, start).trim() === '';
}

function validRecord(record) {
  if (!record || typeof record !== 'object' || Array.isArray(record)) return false;

  const keys = ['version', 'sourcesHash', 'promptHash', 'decision', 'reason'];

  return (
    Object.keys(record).length === keys.length &&
    keys.every((key) => Object.hasOwn(record, key)) &&
    record.version === 1 &&
    typeof record.sourcesHash === 'string' &&
    /^[a-f0-9]{64}$/.test(record.sourcesHash) &&
    typeof record.promptHash === 'string' &&
    /^[a-f0-9]{64}$/.test(record.promptHash) &&
    ['prompt-updated', 'prompt-unchanged'].includes(record.decision) &&
    typeof record.reason === 'string' &&
    record.reason.trim().length > 0
  );
}

function recordProblem(params) {
  const { sourceCode, statement, hashes } = params;
  const comments = sourceCode.getAllComments().filter((comment) => comment.value.includes(MARKER));

  if (comments.length === 0) return 'missing review record';
  if (comments.length !== 1) return 'multiple review records';

  const [comment] = comments;

  if (comment.type !== 'Block' || !adjacentRecord({ comment, statement, sourceCode })) {
    return 'review record must be a JSON block comment adjacent to the exported prompt';
  }

  const text = comment.value.trim();

  if (!text.startsWith(MARKER)) return 'malformed review marker';

  let record;

  try {
    record = JSON.parse(text.slice(MARKER.length).trim());
  } catch (caughtError) {
    // Invalid JSON is an actionable lint error; unexpected failures still propagate.
    if (!(caughtError instanceof SyntaxError)) throw caughtError;

    return 'malformed review JSON';
  }

  if (!validRecord(record)) return 'malformed review schema (including decision or blank reason)';
  if (record.sourcesHash !== hashes.sourcesHash) return 'stale model-facing source review';
  if (record.promptHash !== hashes.promptHash) return 'stale prompt review';

  return null;
}

function checkAnchor(params) {
  const { context, node, root, rootProblem } = params;
  const sourceCode = context.sourceCode;
  const declaration = promptDeclaration(node);
  const prompt = declaration ? sourceCode.getText(declaration.template).slice(1, -1) : '';
  const expectedPrompt = declaration
    ? ` Expected promptHash=${createHash('sha256').update(prompt).digest('hex')}.`
    : '';

  if (rootProblem) {
    context.report({
      node,
      messageId: 'review',
      data: { problem: rootProblem, expected: expectedPrompt },
    });

    return;
  }

  let hashes;

  try {
    hashes = promptReviewHashes({ root, prompt });
  } catch (caughtError) {
    // Discovery/read errors must fail closed rather than bless an incomplete inventory.
    context.report({
      node,
      messageId: 'review',
      data: {
        problem: `cannot read model-facing source inventory: ${caughtError.message}`,
        expected: expectedPrompt,
      },
    });

    return;
  }

  const expected = ` Expected sourcesHash=${hashes.sourcesHash}.${declaration ? ` Expected promptHash=${hashes.promptHash}.` : ''}`;
  const problem = declaration
    ? recordProblem({ sourceCode, statement: declaration.statement, hashes })
    : 'missing exported BASE_AGENT_INSTRUCTIONS static template literal';

  if (problem) context.report({ node, messageId: 'review', data: { problem, expected } });
}

/**
 * Only the canonical anchor is inspected; its current ESLint AST supports unsaved prompt edits.
 * A fresh prompt/tool inventory is read per lint. This gate records review, not its quality, and
 * cannot detect behavior changes in dependencies outside the watched files and their constants.
 */
export const systemPromptReview = {
  meta: {
    type: 'problem',
    schema: [
      {
        type: 'object',
        properties: { root: { type: 'string' } },
        additionalProperties: false,
      },
    ],
    messages: { review: `System prompt review failed: {{problem}}.{{expected}} ${ACTION}` },
  },
  create(context) {
    // Keep this ahead of root lookup: unrelated files must cause zero filesystem reads.
    const filename = context.filename.split(path.sep).join('/');

    if (!filename.endsWith(`/${PROMPT_REVIEW_ANCHOR}`) && filename !== PROMPT_REVIEW_ANCHOR) {
      return {};
    }

    let root;
    let rootProblem;

    try {
      root = context.options[0]?.root ?? findPromptReviewRoot(context.cwd);
    } catch (caughtError) {
      rootProblem = `cannot discover workspace root: ${caughtError.message}`;
    }

    if (!root) {
      rootProblem ??= 'missing workspace root (package.json with workspaces)';

      return { Program: (node) => checkAnchor({ context, node, rootProblem }) };
    }

    if (path.resolve(context.filename) !== path.resolve(root, PROMPT_REVIEW_ANCHOR)) return {};

    return { Program: (node) => checkAnchor({ context, node, root }) };
  },
};
