import { describe, it, expect } from 'vitest';
import type { GraphInput, ReadingPlan } from '@prl/contracts';
import { linearize } from './linearize.js';
import { checkLaws } from './invariants.js';

const ent = (id: string, file: string, start = 1) => ({
  id,
  name: id,
  file,
  kind: 'function' as const,
  change: 'added' as const,
  hunks: [{ file, startLine: start, endLine: start + 1, added: 1, removed: 0 }],
});
const graph = (
  entities: GraphInput['entities'],
  edges: GraphInput['edges'],
): GraphInput => ({ schemaVersion: 1, pr: { repo: 'r', base: 'm', head: 'h' }, entities, edges });

const cycleGraph = graph(
  [ent('a.ts::A', 'a.ts', 1), ent('a.ts::B', 'a.ts', 9)],
  [
    { from: 'a.ts::A', to: 'a.ts::B', rel: 'calls' },
    { from: 'a.ts::B', to: 'a.ts::A', rel: 'calls' },
  ],
);
const chainGraph = graph(
  [ent('a.ts::A', 'a.ts'), ent('b.ts::B', 'b.ts'), ent('c.ts::C', 'c.ts')],
  [
    { from: 'a.ts::A', to: 'b.ts::B', rel: 'calls' },
    { from: 'b.ts::B', to: 'c.ts::C', rel: 'calls' },
  ],
);

describe('checkLaws oracle — catches broken plans (red-team regressions)', () => {
  it('passes a clean plan', () => {
    const laws = checkLaws(chainGraph, linearize(chainGraph));
    expect([laws.L1, laws.L2, laws.L3, laws.L6]).toEqual(['pass', 'pass', 'pass', 'pass']);
  });

  it('FINDING B: flags a cluster that lies about isCycle (L2)', () => {
    const plan: ReadingPlan = structuredClone(linearize(cycleGraph));
    expect(plan.clusters[0]!.isCycle).toBe(true);
    plan.clusters[0]!.isCycle = false; // lie — size is still 2
    expect(checkLaws(cycleGraph, plan).L2).toBe('fail');
  });

  it('FINDING A: reports L1 fail (does not throw) when an entity is dropped', () => {
    const plan: ReadingPlan = structuredClone(linearize(chainGraph));
    // Drop the last entity from both clusters and steps -> incomplete plan.
    plan.clusters.pop();
    plan.steps.pop();
    let laws!: ReturnType<typeof checkLaws>;
    expect(() => {
      laws = checkLaws(chainGraph, plan);
    }).not.toThrow();
    expect(laws.L1).toBe('fail');
  });

  it('flags an entity duplicated across clusters (L1)', () => {
    const plan: ReadingPlan = structuredClone(linearize(chainGraph));
    plan.clusters[1]!.entityIds.push(plan.clusters[0]!.entityIds[0]!);
    expect(checkLaws(chainGraph, plan).L1).toBe('fail');
  });

  it('flags merging two non-SCC entities into one cluster (L2)', () => {
    const plan: ReadingPlan = structuredClone(linearize(chainGraph));
    // Move cluster[1]'s entity into cluster[0] (not an SCC), drop the now-empty
    // cluster, and reindex so indices stay contiguous (a realistic mutation).
    const moved = plan.clusters[1]!.entityIds[0]!;
    plan.clusters[0]!.entityIds.push(moved);
    plan.clusters[0]!.isCycle = true; // keep isCycle consistent to isolate L2-by-SCC
    plan.clusters.splice(1, 1);
    plan.clusters.forEach((c, i) => (c.index = i));
    plan.steps.forEach((s) => {
      const c = plan.clusters.find((cl) => cl.entityIds.includes(s.entity.id))!;
      s.clusterIndex = c.index;
    });
    expect(checkLaws(chainGraph, plan).L2).toBe('fail');
  });
});
