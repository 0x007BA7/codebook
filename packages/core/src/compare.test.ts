import { describe, it, expect } from 'vitest';
import type { Entity } from '@prl/contracts';
import {
  cmpStr,
  compareEntities,
  clusterKey,
  compareClusterKeys,
  firstHunkStart,
} from './compare.js';

const ent = (
  id: string,
  file: string,
  start: number,
): Entity => ({
  id,
  name: id,
  file,
  kind: 'function',
  change: 'added',
  hunks: [{ file, startLine: start, endLine: start + 1, added: 1, removed: 0 }],
});

describe('cmpStr', () => {
  it('is a total order by code unit', () => {
    expect(cmpStr('a', 'b')).toBe(-1);
    expect(cmpStr('b', 'a')).toBe(1);
    expect(cmpStr('a', 'a')).toBe(0);
    // capital letters sort before lowercase (code-unit order, locale-free)
    expect(cmpStr('Z', 'a')).toBe(-1);
  });
});

describe('entity sort key = (file, firstHunk.startLine, id)', () => {
  it('orders by file first', () => {
    expect(compareEntities(ent('z', 'a.ts', 100), ent('a', 'b.ts', 1))).toBeLessThan(0);
  });
  it('then by first hunk start line', () => {
    expect(compareEntities(ent('z', 'a.ts', 5), ent('a', 'a.ts', 50))).toBeLessThan(0);
  });
  it('then by id', () => {
    expect(compareEntities(ent('a', 'a.ts', 5), ent('b', 'a.ts', 5))).toBeLessThan(0);
  });
  it('is antisymmetric and reflexive', () => {
    const x = ent('a', 'a.ts', 5);
    const y = ent('b', 'b.ts', 9);
    expect(compareEntities(x, x)).toBe(0);
    expect(Math.sign(compareEntities(x, y))).toBe(-Math.sign(compareEntities(y, x)));
  });
  it('firstHunkStart takes the minimum across hunks', () => {
    const e = ent('x', 'a.ts', 99);
    e.hunks.push({ file: 'a.ts', startLine: 3, endLine: 4, added: 1, removed: 0 });
    expect(firstHunkStart(e)).toBe(3);
  });
});

describe('cluster sort key = (minFile, minStart, minId)', () => {
  it('uses the minima across members', () => {
    const k = clusterKey([ent('y', 'b.ts', 40), ent('x', 'a.ts', 80)]);
    expect(k).toEqual({ minFile: 'a.ts', minStart: 40, minId: 'x' });
  });
  it('compares lexicographically across the tuple', () => {
    const a = clusterKey([ent('a', 'a.ts', 1)]);
    const b = clusterKey([ent('b', 'a.ts', 2)]);
    expect(compareClusterKeys(a, b)).toBe(-1);
  });
});
