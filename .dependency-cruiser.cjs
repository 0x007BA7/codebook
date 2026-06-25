// §11.6 Boundary / architecture enforcement. This is what protects
// portability mechanically rather than by discipline: `core`, `contracts`,
// and the shared spine component must carry zero platform-specific imports.
module.exports = {
  forbidden: [
    {
      name: 'core-no-node',
      comment: 'core must be browser-safe: no Node builtins.',
      severity: 'error',
      from: { path: '^packages/(core|contracts)/' },
      to: { path: '^(node:|fs|path|child_process|os|http|https|net|stream)$' },
    },
    {
      name: 'core-no-vscode',
      comment: 'core/contracts must not depend on the VS Code API.',
      severity: 'error',
      from: { path: '^packages/(core|contracts)/' },
      to: { path: 'vscode' },
    },
    {
      name: 'core-no-platform-pkgs',
      comment: 'core/contracts must not depend on server/web/ingest/fastify/react.',
      severity: 'error',
      from: { path: '^packages/(core|contracts)/' },
      to: { path: '(^packages/(server|web|ingest)/|fastify|^react|react-dom)' },
    },
    {
      name: 'spine-is-platform-clean',
      comment:
        'The shared spine component renders from a ReadingPlan alone: react + contracts only, no node/server/ingest/vscode.',
      severity: 'error',
      from: { path: 'packages/web/src/Spine\\.tsx$' },
      to: {
        path: '^(node:|fs|child_process|vscode|^packages/(server|ingest)/|fastify)',
      },
    },
    {
      name: 'no-circular',
      comment: 'No circular dependencies between modules.',
      severity: 'error',
      from: {},
      to: { circular: true },
    },
  ],
  options: {
    doNotFollow: { path: 'node_modules' },
    // Boundary rules apply to SHIPPED source only; test files may import fs etc.
    exclude: { path: '\\.test\\.(ts|tsx)$' },
    tsConfig: { fileName: 'tsconfig.base.json' },
    enhancedResolveOptions: {
      exportsFields: ['exports'],
      conditionNames: ['import', 'default'],
      extensions: ['.ts', '.tsx', '.js'],
    },
    includeOnly: '^packages/',
  },
};
