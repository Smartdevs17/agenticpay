const DOMAINS = new Set(['payments', 'merchants', 'wallets', 'analytics', 'settings', 'developers']);

function domainFromFilename(filename) {
  const match = filename.replaceAll('\\', '/').match(/src\/domains\/([^/]+)\//);
  return match?.[1];
}

function domainFromImport(source) {
  const aliasMatch = source.match(/^@([^/]+)\//);
  if (aliasMatch && DOMAINS.has(aliasMatch[1])) return aliasMatch[1];
  const pathMatch = source.match(/src\/domains\/([^/]+)\//);
  return pathMatch?.[1];
}

export const domainBoundariesRule = {
  meta: {
    type: 'problem',
    docs: {
      description: 'Prevent direct cross-domain imports.',
    },
    schema: [],
    messages: {
      boundary: 'Domain "{{from}}" must not import directly from domain "{{to}}". Move shared code to @/shared or @/ui.',
    },
  },
  create(context) {
    const from = domainFromFilename(context.filename ?? '');
    if (!from) return {};

    return {
      ImportDeclaration(node) {
        const source = node.source.value;
        if (typeof source !== 'string') return;
        const to = domainFromImport(source);
        if (to && to !== from) {
          context.report({ node, messageId: 'boundary', data: { from, to } });
        }
      },
    };
  },
};
