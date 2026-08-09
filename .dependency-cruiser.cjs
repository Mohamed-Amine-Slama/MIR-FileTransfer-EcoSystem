/**
 * Module boundary enforcement — BUILD_SPEC P1.4 and §5.1.
 *
 * ADR-1 chose a modular monolith over microservices. The whole bet is that
 * "add features without breaking others" comes from enforced domain
 * boundaries, not from separate deployments. Enforcement is what makes that
 * bet real: without it, a modular monolith degrades into a normal monolith in
 * about three sprints, and nobody notices until a change to scheduling breaks
 * imaging.
 *
 * These rules are not style preferences. Merging a violation is merging the
 * thing ADR-1 exists to prevent.
 *
 * Run: pnpm boundaries
 */

/** @type {import('dependency-cruiser').IConfiguration} */
module.exports = {
  forbidden: [
    {
      name: 'no-cross-module-internal',
      severity: 'error',
      comment:
        "A module's internal/ directory is private to that module. Import the " +
        "module's index.ts instead, or communicate through a domain event " +
        '(BUILD_SPEC §5.1 rule 2, §5.2). If you need something that is not ' +
        'exported, export it deliberately — do not reach past the boundary.',
      from: {
        pathNot: '^apps/api/src/modules/([^/]+)/',
      },
      to: {
        path: '^apps/api/src/modules/([^/]+)/internal/',
      },
    },
    {
      name: 'no-other-module-internal',
      severity: 'error',
      comment:
        "Module A may not import module B's internal/ files. Use B's public " +
        'index.ts, or a domain event. (BUILD_SPEC §5.1 rule 2)',
      from: {
        path: '^apps/api/src/modules/([^/]+)/',
      },
      to: {
        path: '^apps/api/src/modules/([^/]+)/internal/',
        pathNot: '^apps/api/src/modules/$1/internal/',
      },
    },
    {
      name: 'cross-module-via-index-only',
      severity: 'error',
      comment:
        'Cross-module imports must resolve to the target module\'s index.ts. ' +
        'Reaching at any other file couples you to its layout and defeats the ' +
        'public-API boundary. (BUILD_SPEC §5.1 rule 3)',
      from: {
        path: '^apps/api/src/modules/([^/]+)/',
      },
      to: {
        path: '^apps/api/src/modules/([^/]+)/',
        pathNot: [
          '^apps/api/src/modules/$1/',
          '^apps/api/src/modules/[^/]+/index\\.ts$',
        ],
      },
    },
    {
      name: 'shared-must-not-import-modules',
      severity: 'error',
      comment:
        'shared/ is cross-cutting infrastructure: config, errors, the event ' +
        'bus. It may be imported by anyone and may import nothing from ' +
        'modules/. A dependency in this direction turns shared/ into a hidden ' +
        'coupling point between every module. (BUILD_SPEC §5.1 rule 4)',
      from: {
        path: '^apps/api/src/shared/',
      },
      to: {
        path: '^apps/api/src/modules/',
      },
    },
    {
      name: 'no-circular',
      severity: 'error',
      comment:
        'Circular dependencies make module extraction impossible and produce ' +
        'initialisation-order bugs that appear only in production. ' +
        '(BUILD_SPEC P1.4 rule 3)',
      from: {},
      to: { circular: true },
    },
    {
      name: 'no-orphans',
      severity: 'warn',
      comment:
        'A file nothing imports is usually either dead code or a wiring ' +
        'mistake. Warn rather than error: index.ts stubs are legitimately ' +
        'orphaned before their module is built out.',
      from: {
        orphan: true,
        pathNot: [
          '\\.d\\.ts$',
          '(^|/)\\.[^/]+\\.(js|cjs|mjs|ts|json)$',
          '(^|/)tsconfig\\.json$',
          '(^|/)(vitest|playwright|next)\\.config\\.(js|cjs|mjs|ts)$',
          '(^|/)main\\.ts$',
        ],
      },
      to: {},
    },
    {
      name: 'no-deprecated-core',
      severity: 'error',
      comment: 'Deprecated Node core modules will be removed; do not build on them.',
      from: {},
      to: { dependencyTypes: ['core'], path: '^(punycode|domain|sys)$' },
    },
  ],

  options: {
    doNotFollow: {
      path: 'node_modules',
    },

    // Deliberately no `tsConfig` option. dependency-cruiser resolves a
    // tsconfig's `extends` relative to the process cwd rather than to the
    // tsconfig itself, so pointing at apps/api/tsconfig.json makes it look for
    // apps/api/tsconfig.base.json and fail. The option only exists to resolve
    // TypeScript `paths` aliases, and apps/api defines none — workspace
    // packages resolve through node_modules symlinks like any other dependency.
    // If path aliases are ever added, give depcruise its own flat tsconfig
    // rather than reintroducing this.

    tsPreCompilationDeps: true,

    enhancedResolveOptions: {
      exportsFields: ['exports'],
      conditionNames: ['import', 'require', 'node', 'default', 'types'],
      extensions: ['.js', '.ts', '.json'],
    },

    reporterOptions: {
      text: {
        highlightFocused: true,
      },
    },
  },
};
