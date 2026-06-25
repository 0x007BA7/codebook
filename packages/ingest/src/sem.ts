import { execFileSync } from 'node:child_process';
import {
  parseGraphInput,
  type GraphInput,
  type Entity,
  type Edge,
  type EntityKind,
  type ChangeKind,
  type Rel,
  type Hunk,
} from '@prl/contracts';
import { SemUnavailableError, type Ingestor, type IngestOpts } from './types.js';

// ---------------------------------------------------------------------------
// Adapter for `sem` (Ataraxy-Labs/sem) — entity-level diffs + a dependency
// graph, via tree-sitter. ALL sem-specific parsing lives here and nowhere else
// (§7): swapping the backend means rewriting only this file. The normalize*
// functions are pure so they can be unit-tested against committed sample JSON
// (fixtures/sem-samples/) with no `sem` installed.
//
// Schemas below match real `sem 0.14` output (captured, not assumed):
//   sem diff  --from <base> --to <head> --json   -> SemDiff
//   sem graph --json <repo>                       -> SemGraph
// ---------------------------------------------------------------------------

/** `sem diff --json` shape (the fields we use). */
export interface SemDiff {
  changes: Array<{
    entityId: string;
    changeType: string; // added | modified | deleted | moved | renamed | reordered
    entityType: string; // function | method | class | interface | orphan | ...
    entityName: string;
    startLine: number | null;
    endLine: number | null;
    oldStartLine: number | null;
    oldEndLine: number | null;
    filePath: string;
    beforeContent: string | null;
    afterContent: string | null;
  }>;
}

/** `sem graph --json` shape (the fields we use). */
export interface SemGraph {
  edges: Array<{ fromEntity: string; toEntity: string; refType: string }>;
}

// sem's entityType -> our coarse entity kind. `orphan` (module-level import
// blocks etc.) is intentionally dropped: it isn't a named, addressable unit.
const KIND_MAP: Record<string, EntityKind> = {
  function: 'function',
  fn: 'function',
  arrow: 'function',
  method: 'method',
  class: 'class',
  struct: 'class',
  interface: 'type',
  type: 'type',
  type_alias: 'type',
  enum: 'type',
  trait: 'type',
  union: 'type',
  const: 'const',
  constant: 'const',
  variable: 'const',
  property: 'const',
  field: 'const',
  static: 'const',
};

const CHANGE_MAP: Record<string, ChangeKind> = {
  added: 'added',
  deleted: 'deleted',
  modified: 'modified',
  moved: 'modified',
  renamed: 'modified',
  reordered: 'modified',
};

const REL_MAP: Record<string, Rel> = {
  calls: 'calls',
  call: 'calls',
  typeref: 'uses-type',
  type: 'uses-type',
  usestype: 'uses-type',
  imports: 'imports',
  import: 'imports',
  importref: 'imports',
  tests: 'tests',
  test: 'tests',
  testref: 'tests',
};

// `sem` does NOT emit a category; derive one from the file path so the UI's
// color coding (test/config/wiring/logic) is meaningful on real PRs. Heuristic,
// best-effort, language-agnostic.
function categoryFor(filePath: string): 'logic' | 'config' | 'test' | 'wiring' {
  const p = filePath.toLowerCase();
  const base = p.split('/').pop() ?? p;
  if (
    /(^|\/)tests?\//.test(p) ||
    /(^|\/)e2e\//.test(p) ||
    /(\.|_)(test|spec)\./.test(base) ||
    /_test\.|_spec\./.test(base) ||
    base.startsWith('test_') ||
    base === 'conftest.py'
  ) {
    return 'test';
  }
  if (
    /\.(json|ya?ml|toml|ini|cfg|conf|env|properties)$/.test(base) ||
    /(^|\/)config(s)?\//.test(p) ||
    base.includes('config') ||
    base.includes('settings')
  ) {
    return 'config';
  }
  if (
    /^(index|main|app|server|cli|routes?|urls|wsgi|asgi)\./.test(base) ||
    base === '__init__.py' ||
    base === 'setup.py' ||
    base === 'manage.py'
  ) {
    return 'wiring';
  }
  return 'logic';
}

function countLines(s: string): number {
  return s.length === 0 ? 0 : s.split('\n').length;
}
function prefixLines(s: string, sign: '+' | '-'): string {
  return s
    .split('\n')
    .map((l) => sign + l)
    .join('\n');
}

/** Build a single hunk (range + counts + unified-diff patch) from a diff change. */
function hunkFromChange(c: SemDiff['changes'][number]): Hunk {
  const before = c.beforeContent ?? '';
  const after = c.afterContent ?? '';
  const added = countLines(after);
  const removed = countLines(before);
  const start = c.startLine ?? c.oldStartLine ?? 1;
  const end = c.endLine ?? c.oldEndLine ?? start;
  const parts: string[] = [];
  if (before) parts.push(prefixLines(before, '-'));
  if (after) parts.push(prefixLines(after, '+'));
  return {
    file: c.filePath,
    startLine: Math.max(1, start),
    endLine: Math.max(Math.max(1, start), end),
    added,
    removed,
    ...(parts.length ? { patch: parts.join('\n') } : {}),
  };
}

/**
 * Pure normalization: real `sem diff` + `sem graph` JSON -> validated
 * GraphInput. The changed set C comes from the diff (minus `orphan` noise);
 * dependency edges come from the graph. Core drops edges whose endpoints fall
 * outside C, so passing the full graph is correct.
 */
export function normalizeSemOutput(
  diff: SemDiff,
  graph: SemGraph,
  pr: { repo: string; base: string; head: string },
): GraphInput {
  const entities: Entity[] = [];
  for (const c of diff.changes) {
    const kind = KIND_MAP[c.entityType.toLowerCase()];
    if (!kind) continue; // drop `orphan`/unmappable module-level noise
    entities.push({
      id: c.entityId,
      name: c.entityName,
      file: c.filePath,
      kind,
      change: CHANGE_MAP[c.changeType.toLowerCase()] ?? 'modified',
      category: categoryFor(c.filePath),
      hunks: [hunkFromChange(c)],
    });
  }

  const edges: Edge[] = graph.edges.map((e) => ({
    from: e.fromEntity,
    to: e.toEntity,
    rel: REL_MAP[e.refType.toLowerCase()] ?? 'calls',
  }));

  return parseGraphInput({ schemaVersion: 1, pr, entities, edges });
}

/** True if a `sem` binary is on PATH (used to auto-skip integration tests). */
export function isSemAvailable(): boolean {
  try {
    execFileSync('sem', ['--version'], { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
}

export class SemIngestor implements Ingestor {
  readonly name = 'sem';

  async ingest(opts: IngestOpts): Promise<GraphInput> {
    if (!isSemAvailable()) {
      throw new SemUnavailableError(
        'The `sem` CLI was not found on PATH.\n' +
          'Install it: `brew install sem-cli` (or `npm i -g @ataraxy-labs/sem`),\n' +
          'see https://github.com/Ataraxy-Labs/sem — or use ingestor "fixture".',
      );
    }
    const cwd = opts.cwd ?? opts.repo ?? process.cwd();
    const base = opts.base ?? 'main';
    const head = opts.head ?? 'HEAD';
    const repo = opts.repo ?? cwd;

    // SEM_NO_TELEMETRY keeps stdout pure JSON; stderr is discarded.
    const run = (args: string[]): unknown => {
      const out = execFileSync('sem', args, {
        cwd,
        encoding: 'utf8',
        maxBuffer: 128 * 1024 * 1024,
        env: { ...process.env, SEM_NO_TELEMETRY: '1' },
        stdio: ['ignore', 'pipe', 'ignore'],
      });
      return JSON.parse(out);
    };

    // Working-tree review: diff against HEAD (or staged) instead of a ref range.
    const diffArgs =
      opts.scope === 'working'
        ? ['diff', 'HEAD', '--json']
        : opts.scope === 'staged'
          ? ['diff', '--staged', '--json']
          : ['diff', '--from', base, '--to', head, '--json'];
    const diff = run(diffArgs) as SemDiff;
    // Pass the repo path explicitly (not '.') so graph doesn't silently depend
    // on cwd while diff is explicit about its refs.
    const graph = run(['graph', '--json', cwd]) as SemGraph;
    const prMeta =
      opts.scope === 'working'
        ? { repo, base: 'HEAD', head: 'working tree' }
        : opts.scope === 'staged'
          ? { repo, base: 'HEAD', head: 'staged' }
          : { repo, base, head };
    return normalizeSemOutput(diff, graph, prMeta);
  }
}
