import { describe, it, expect } from 'vitest';
import type { GraphInput } from '@prl/contracts';
import { linearize } from './linearize.js';
import { checkLaws } from './invariants.js';

const ent = (id: string, file: string, start = 1, added = 3, removed = 0) => ({
  id,
  name: id,
  file,
  kind: 'function' as const,
  change: 'added' as const,
  hunks: [{ file, startLine: start, endLine: start + added, added, removed }],
});

const graph = (
  entities: GraphInput['entities'],
  edges: GraphInput['edges'],
): GraphInput => ({
  schemaVersion: 1,
  pr: { repo: 'r', base: 'main', head: 'h' },
  entities,
  edges,
});

describe('linearize — basic structure', () => {
  it('emits dependencies before dependents (a depends on b => b first)', () => {
    const g = graph(
      [ent('f.ts::a', 'f.ts', 10), ent('g.ts::b', 'g.ts', 10)],
      [{ from: 'f.ts::a', to: 'g.ts::b', rel: 'calls' }],
    );
    const plan = linearize(g);
    const order = plan.steps.map((s) => s.entity.id);
    expect(order.indexOf('g.ts::b')).toBeLessThan(order.indexOf('f.ts::a'));
    expect(plan.stats.backwardEdges).toBe(0);
  });

  it('drops edges to entities outside the changed set', () => {
    const g = graph(
      [ent('a.ts::a', 'a.ts')],
      [{ from: 'a.ts::a', to: 'ghost.ts::g', rel: 'calls' }],
    );
    const plan = linearize(g);
    expect(plan.stats.edgeCount).toBe(0);
    expect(plan.steps[0]!.dependsOn).toEqual([]);
  });

  it('de-duplicates parallel edges', () => {
    const g = graph(
      [ent('a.ts::a', 'a.ts'), ent('b.ts::b', 'b.ts')],
      [
        { from: 'a.ts::a', to: 'b.ts::b', rel: 'calls' },
        { from: 'a.ts::a', to: 'b.ts::b', rel: 'uses-type' },
      ],
    );
    expect(linearize(g).stats.edgeCount).toBe(1);
  });

  it('collapses a 2-cycle into one labeled cluster', () => {
    const g = graph(
      [ent('h.ts::p', 'h.ts', 1), ent('h.ts::q', 'h.ts', 50)],
      [
        { from: 'h.ts::p', to: 'h.ts::q', rel: 'calls' },
        { from: 'h.ts::q', to: 'h.ts::p', rel: 'calls' },
      ],
    );
    const plan = linearize(g);
    expect(plan.clusters).toHaveLength(1);
    expect(plan.clusters[0]!.isCycle).toBe(true);
    expect(plan.clusters[0]!.cycleRel).toBe('mutual recursion');
    expect(plan.stats.maxClusterSize).toBe(2);
  });

  it('labels an import cycle as circular imports', () => {
    const g = graph(
      [ent('a.ts::a', 'a.ts'), ent('b.ts::b', 'b.ts')],
      [
        { from: 'a.ts::a', to: 'b.ts::b', rel: 'imports' },
        { from: 'b.ts::b', to: 'a.ts::a', rel: 'imports' },
      ],
    );
    expect(linearize(g).clusters[0]!.cycleRel).toBe('circular imports');
  });

  it('computes totals from hunks', () => {
    const g = graph(
      [ent('a.ts::a', 'a.ts', 1, 10, 2), ent('b.ts::b', 'b.ts', 1, 5, 3)],
      [],
    );
    const plan = linearize(g);
    expect(plan.stats.totalAdded).toBe(15);
    expect(plan.stats.totalRemoved).toBe(5);
  });

  it('handles the empty graph', () => {
    const plan = linearize(graph([], []));
    expect(plan.steps).toEqual([]);
    expect(plan.stats).toMatchObject({ entityCount: 0, clusterCount: 0, maxClusterSize: 0 });
  });

  it('orders hunks within an entity by startLine', () => {
    const e = ent('a.ts::a', 'a.ts', 1);
    e.hunks = [
      { file: 'a.ts', startLine: 80, endLine: 90, added: 5, removed: 0 },
      { file: 'a.ts', startLine: 10, endLine: 20, added: 5, removed: 0 },
    ];
    const plan = linearize(graph([e], []));
    expect(plan.steps[0]!.entity.hunks.map((h) => h.startLine)).toEqual([10, 80]);
  });

  it('cycleRel is order-independent under parallel edges with differing rel (L5 regression)', () => {
    // Red-team regression: a 2-cycle A<->B with a PARALLEL A->B edge of a
    // different rel. The label must not depend on which parallel survives dedup.
    const mk = (edges: GraphInput['edges']): string =>
      JSON.stringify(
        linearize(
          graph([ent('a.ts::A', 'a.ts', 1), ent('a.ts::B', 'a.ts', 2)], edges),
        ).clusters[0]!.cycleRel,
      );
    const order1 = mk([
      { from: 'a.ts::A', to: 'a.ts::B', rel: 'calls' },
      { from: 'a.ts::A', to: 'a.ts::B', rel: 'imports' },
      { from: 'a.ts::B', to: 'a.ts::A', rel: 'calls' },
    ]);
    const order2 = mk([
      { from: 'a.ts::A', to: 'a.ts::B', rel: 'imports' },
      { from: 'a.ts::B', to: 'a.ts::A', rel: 'calls' },
      { from: 'a.ts::A', to: 'a.ts::B', rel: 'calls' },
    ]);
    expect(order1).toBe(order2);
    expect(JSON.parse(order1)).toBe('dependency cycle'); // mixed rels => generic
  });

  it('satisfies L1–L6 on a mixed graph', () => {
    const g = graph(
      [
        ent('a.ts::a', 'a.ts'),
        ent('b.ts::b', 'b.ts'),
        ent('c.ts::c', 'c.ts'),
        ent('d.ts::d', 'd.ts'),
      ],
      [
        { from: 'a.ts::a', to: 'b.ts::b', rel: 'calls' },
        { from: 'b.ts::b', to: 'c.ts::c', rel: 'calls' },
        { from: 'c.ts::c', to: 'b.ts::b', rel: 'calls' }, // {b,c} cycle
        { from: 'd.ts::d', to: 'a.ts::a', rel: 'calls' },
      ],
    );
    const plan = linearize(g);
    const laws = checkLaws(g, plan);
    expect(laws.L1).toBe('pass');
    expect(laws.L2).toBe('pass');
    expect(laws.L3).toBe('pass');
    expect(laws.L6).toBe('pass');
  });
});
