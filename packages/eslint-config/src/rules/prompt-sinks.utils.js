function typedContext(context) {
  const services = context.sourceCode.parserServices;

  if (!services?.program || !services.esTreeNodeToTSNodeMap) return;

  return { checker: services.program.getTypeChecker(), nodes: services.esTreeNodeToTSNodeMap };
}

/** Contextual types preserve imported API contracts through ordinary option routing. */
export function promptObjectType(params) {
  const { context, node } = params;
  const typed = typedContext(context);

  if (!typed) return;

  const tsNode = typed.nodes.get(node);

  return typed.checker.getContextualType(tsNode) ?? typed.checker.getTypeAtLocation(tsNode);
}

export function hasPromptProperties(type, names) {
  return type && names.every((name) => type.getProperty(name));
}

export function modelOptionsType(type) {
  if (!type) return false;

  return (
    (type.getProperty('instructions') || type.getProperty('baseInstructions')) &&
    ['provider', 'messages', 'tools', 'harness'].some((name) => type.getProperty(name))
  );
}

export function modelMessageType(type) {
  if (!hasPromptProperties(type, ['role', 'content'])) return false;

  const declarations = [
    ...(type.aliasSymbol?.declarations ?? []),
    ...(type.getProperty('role').declarations ?? []),
  ];

  return declarations.some((entry) =>
    /[/\\](message|history)[/\\].*\.(types|validator)\.ts$/.test(entry.getSourceFile().fileName),
  );
}

export function modelSectionType(type) {
  if (!hasPromptProperties(type, ['id', 'title', 'guidance'])) return false;

  const declarations = type.getProperty('guidance').declarations ?? [];

  return declarations.some(
    (entry) =>
      entry.parent?.parent?.name?.text === 'ModelSection' &&
      entry.getSourceFile().fileName.endsWith('.types.ts'),
  );
}

/** Resolve the defining signature, so `send`/`stream` and destructured hook aliases are not names heuristics. */
export function typedPromptCall(params) {
  const { context, node } = params;
  const typed = typedContext(context);

  if (!typed) return;

  const declaration = typed.checker.getResolvedSignature(typed.nodes.get(node))?.getDeclaration();

  if (!declaration) return;

  const file = declaration.getSourceFile().fileName;
  const name = declaration.name?.text ?? declaration.parent?.name?.text;

  if (
    /[/\\]hook[/\\]hook\.types\.ts$/.test(file) &&
    ['addContext', 'addInstructions'].includes(name)
  ) {
    return 'content';
  }

  if (
    /[/\\]conversation[/\\]conversation\.types\.ts$/.test(file) &&
    ['send', 'followup'].includes(name)
  ) {
    return 'content';
  }

  if (/[/\\]provider[/\\]provider\.types\.ts$/.test(file) && name === 'stream') return 'options';
}
