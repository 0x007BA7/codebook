import { describe, it, expect } from 'vitest';
import { tarjanScc } from './scc.js';

function adjOf(
  nodes: string[],
  edges: Array<[string, string]>,
): Map<string, string[]> {
  const m = new Map<string, string[]>(nodes.map((n) => [n, []]));
  for (const [a, b] of edges) m.get(a)!.push(b);
  return m;
}

/** Canonicalize SCCs (sort within & across) for order-independent comparison. */
function canon(sccs: string[][]): string[][] {
  return sccs.map((c) => [...c].sort()).sort((a, b) => (a[0]! < b[0]! ? -1 : 1));
}

describe('tarjanScc', () => {
  it('returns singletons for a DAG', () => {
    const nodes = ['a', 'b', 'c'];
    const sccs = tarjanScc(nodes, adjOf(nodes, [['a', 'b'], ['b', 'c']]));
    expect(canon(sccs)).toEqual([['a'], ['b'], ['c']]);
  });

  it('collapses a simple cycle into one component', () => {
    const nodes = ['a', 'b', 'c'];
    const sccs = tarjanScc(
      nodes,
      adjOf(nodes, [['a', 'b'], ['b', 'c'], ['c', 'a']]),
    );
    expect(canon(sccs)).toEqual([['a', 'b', 'c']]);
  });

  it('separates two cycles linked by a bridge', () => {
    const nodes = ['a', 'b', 'c', 'd'];
    const sccs = tarjanScc(
      nodes,
      adjOf(nodes, [
        ['a', 'b'],
        ['b', 'a'], // {a,b}
        ['b', 'c'], // bridge
        ['c', 'd'],
        ['d', 'c'], // {c,d}
      ]),
    );
    expect(canon(sccs)).toEqual([['a', 'b'], ['c', 'd']]);
  });

  it('treats a self-loop as a singleton component', () => {
    const nodes = ['a'];
    const sccs = tarjanScc(nodes, adjOf(nodes, [['a', 'a']]));
    expect(canon(sccs)).toEqual([['a']]);
  });

  it('does not overflow on a long chain (iterative)', () => {
    const n = 5000;
    const nodes = Array.from({ length: n }, (_, i) => `n${String(i).padStart(5, '0')}`);
    const edges: Array<[string, string]> = [];
    for (let i = 0; i + 1 < n; i++) edges.push([nodes[i]!, nodes[i + 1]!]);
    const sccs = tarjanScc(nodes, adjOf(nodes, edges));
    expect(sccs).toHaveLength(n);
  });
});
