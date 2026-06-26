import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import type { GraphInput, Edge, Entity, Rel } from '@codebook/contracts';
import { linearize } from './linearize.js';
import { stableStringify } from './serialize.js';
import { checkLaws } from './invariants.js';

const RELS: Rel[] = ['calls', 'uses-type', 'imports', 'tests'];

function makeEntity(i: number): Entity {
  const file = `dir${i % 4}/f${String(i).padStart(3, '0')}.ts`;
  const start = 1 + ((i * 7) % 50);
  return {
    id: `${file}::E${String(i).padStart(3, '0')}`,
    name: `E${i}`,
    file,
    kind: 'function',
    change: 'added',
    hunks: [{ file, startLine: start, endLine: start + 4, added: i % 9, removed: i % 3 }],
  };
}

/** Deterministic Fisher–Yates using a seeded LCG (so the test itself is stable). */
function shuffle<T>(arr: T[], seed: number): T[] {
  const a = [...arr];
  let s = (seed >>> 0) || 1;
  const next = (): number => (s = (s * 1664525 + 1013904223) >>> 0) / 2 ** 32;
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(next() * (i + 1));
    [a[i], a[j]] = [a[j]!, a[i]!];
  }
  return a;
}

// ---- (a) Random DAGs: edges only from higher index to lower => acyclic ----
const dagArb = fc
  .record({
    n: fc.integer({ min: 0, max: 14 }),
    rawEdges: fc.array(fc.tuple(fc.nat(20), fc.nat(20), fc.nat(3)), { maxLength: 40 }),
    permSeed: fc.integer({ min: 1, max: 1e9 }),
  })
  .map(({ n, rawEdges, permSeed }) => {
    const entities = Array.from({ length: n }, (_, i) => makeEntity(i));
    const edges: Edge[] = [];
    for (const [x, y, r] of rawEdges) {
      if (n === 0) break;
      const a = x % n;
      const b = y % n;
      if (a === b) continue;
      const hi = Math.max(a, b);
      const lo = Math.min(a, b);
      edges.push({ from: entities[hi]!.id, to: entities[lo]!.id, rel: RELS[r]! });
    }
    const g: GraphInput = {
      schemaVersion: 1,
      pr: { repo: 'r', base: 'm', head: 'h' },
      entities,
      edges,
    };
    return { g, permSeed };
  });

// ---- (b) Planted cycles: disjoint groups, ring inside, forward bridges ----
const plantedArb = fc
  .record({
    groupSizes: fc.array(fc.integer({ min: 1, max: 4 }), { minLength: 1, maxLength: 6 }),
    bridges: fc.array(fc.tuple(fc.nat(30), fc.nat(30)), { maxLength: 30 }),
    permSeed: fc.integer({ min: 1, max: 1e9 }),
  })
  .map(({ groupSizes, bridges, permSeed }) => {
    const groups: number[][] = [];
    let idx = 0;
    for (const size of groupSizes) {
      const g: number[] = [];
      for (let k = 0; k < size; k++) g.push(idx++);
      groups.push(g);
    }
    const total = idx;
    const entities = Array.from({ length: total }, (_, i) => makeEntity(i));
    const groupOf = new Map<number, number>();
    groups.forEach((g, gi) => g.forEach((node) => groupOf.set(node, gi)));
    const edges: Edge[] = [];
    // ring within each group of size>1 makes it exactly one SCC
    groups.forEach((g) => {
      if (g.length > 1) {
        for (let k = 0; k < g.length; k++) {
          edges.push({
            from: entities[g[k]!]!.id,
            to: entities[g[(k + 1) % g.length]!]!.id,
            rel: 'calls',
          });
        }
        // Plant a PARALLEL edge with a different rel inside the cycle, so the
        // L5 fuzzer exercises the cycle-label determinism path (regression).
        edges.push({
          from: entities[g[0]!]!.id,
          to: entities[g[1 % g.length]!]!.id,
          rel: 'imports',
        });
      }
    });
    // bridges strictly from a higher group index to a lower one: never merge SCCs
    for (const [x, y] of bridges) {
      if (total === 0) break;
      const a = x % total;
      const b = y % total;
      const ga = groupOf.get(a)!;
      const gb = groupOf.get(b)!;
      if (ga > gb) edges.push({ from: entities[a]!.id, to: entities[b]!.id, rel: 'calls' });
    }
    const g: GraphInput = {
      schemaVersion: 1,
      pr: { repo: 'r', base: 'm', head: 'h' },
      entities,
      edges,
    };
    // planted SCCs = the groups (as id sets)
    const planted = groups.map((grp) => new Set(grp.map((node) => entities[node]!.id)));
    return { g, planted, permSeed };
  });

function permute(g: GraphInput, seed: number): GraphInput {
  return { ...g, entities: shuffle(g.entities, seed), edges: shuffle(g.edges, seed ^ 0x55) };
}

describe('property: L1–L6 on random DAGs', () => {
  it('every law holds; DAGs yield only singletons (L4)', () => {
    fc.assert(
      fc.property(dagArb, ({ g }) => {
        const plan = linearize(g);
        const laws = checkLaws(g, plan);
        expect(laws.L1).toBe('pass');
        expect(laws.L2).toBe('pass');
        expect(laws.L3).toBe('pass');
        expect(laws.L4).toBe('pass'); // input is acyclic by construction
        expect(laws.L6).toBe('pass');
        expect(plan.stats.backwardEdges).toBe(0);
        expect(plan.stats.maxClusterSize).toBeLessThanOrEqual(1);
      }),
      { numRuns: 400 },
    );
  });
});

describe('property: L2 on planted cycles', () => {
  it('clusters equal the planted SCCs', () => {
    fc.assert(
      fc.property(plantedArb, ({ g, planted }) => {
        const plan = linearize(g);
        const laws = checkLaws(g, plan);
        expect(laws.L2).toBe('pass');
        expect(laws.L3).toBe('pass');
        // the multiset of cluster id-sets equals the planted groups
        const clusterSets = plan.clusters
          .map((c) => [...c.entityIds].sort().join('|'))
          .sort();
        const plantedSets = planted.map((s) => [...s].sort().join('|')).sort();
        expect(clusterSets).toEqual(plantedSets);
      }),
      { numRuns: 400 },
    );
  });
});

describe('property: L5 determinism & order-independence (the canary)', () => {
  it('byte-identical across reruns and under permutation', () => {
    fc.assert(
      fc.property(fc.oneof(dagArb, plantedArb), ({ g, permSeed }) => {
        const a = stableStringify(linearize(g));
        const b = stableStringify(linearize(g));
        const c = stableStringify(linearize(permute(g, permSeed)));
        expect(a).toBe(b); // same input twice
        expect(a).toBe(c); // permuted input
      }),
      { numRuns: 500 },
    );
  });
});
