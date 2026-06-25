import { describe, it, expect } from 'vitest';
import {
  GraphInputSchema,
  ReadingPlanSchema,
  HunkSchema,
  findDanglingEdges,
  type GraphInput,
} from './index.js';

const validGraph: GraphInput = {
  schemaVersion: 1,
  pr: { repo: 'r', base: 'main', head: 'feat' },
  entities: [
    {
      id: 'a.ts::A',
      name: 'A',
      file: 'a.ts',
      kind: 'function',
      change: 'added',
      hunks: [{ file: 'a.ts', startLine: 1, endLine: 5, added: 5, removed: 0 }],
    },
    {
      id: 'b.ts::B',
      name: 'B',
      file: 'b.ts',
      kind: 'class',
      change: 'modified',
      category: 'logic',
      hunks: [{ file: 'b.ts', startLine: 1, endLine: 9, added: 4, removed: 2 }],
    },
  ],
  edges: [{ from: 'a.ts::A', to: 'b.ts::B', rel: 'calls' }],
};

describe('GraphInputSchema', () => {
  it('accepts a valid graph', () => {
    expect(() => GraphInputSchema.parse(validGraph)).not.toThrow();
  });

  it('rejects a wrong schemaVersion', () => {
    expect(() => GraphInputSchema.parse({ ...validGraph, schemaVersion: 2 })).toThrow();
  });

  it('rejects negative line numbers', () => {
    const bad = structuredClone(validGraph);
    bad.entities[0]!.hunks[0]!.startLine = -3;
    expect(() => GraphInputSchema.parse(bad)).toThrow();
  });

  it('rejects added/removed below zero', () => {
    const bad = structuredClone(validGraph);
    bad.entities[0]!.hunks[0]!.added = -1;
    expect(() => GraphInputSchema.parse(bad)).toThrow();
  });

  it('rejects endLine < startLine', () => {
    expect(() =>
      HunkSchema.parse({ file: 'a', startLine: 10, endLine: 4, added: 0, removed: 0 }),
    ).toThrow();
  });

  it('rejects duplicate entity ids', () => {
    const bad = structuredClone(validGraph);
    bad.entities[1]!.id = bad.entities[0]!.id;
    expect(() => GraphInputSchema.parse(bad)).toThrow(/duplicate entity id/);
  });

  it('rejects an unknown entity kind', () => {
    const bad = structuredClone(validGraph) as unknown as Record<string, any>;
    bad.entities[0].kind = 'macro';
    expect(() => GraphInputSchema.parse(bad)).toThrow();
  });

  it('rejects an entity with zero hunks', () => {
    const bad = structuredClone(validGraph);
    bad.entities[0]!.hunks = [];
    expect(() => GraphInputSchema.parse(bad)).toThrow();
  });

  it('rejects unknown extra keys (strict)', () => {
    const bad = { ...validGraph, surprise: true };
    expect(() => GraphInputSchema.parse(bad)).toThrow();
  });

  it('ACCEPTS dangling edges (core drops them, §5.1) but findDanglingEdges flags them', () => {
    const dangling: GraphInput = {
      ...validGraph,
      edges: [{ from: 'a.ts::A', to: 'ghost.ts::Ghost', rel: 'calls' }],
    };
    expect(() => GraphInputSchema.parse(dangling)).not.toThrow();
    expect(findDanglingEdges(dangling)).toHaveLength(1);
    expect(findDanglingEdges(validGraph)).toHaveLength(0);
  });
});

describe('ReadingPlanSchema', () => {
  it('rejects a cluster whose isCycle disagrees with size', () => {
    const plan = {
      schemaVersion: 1,
      pr: { repo: 'r', base: 'm', head: 'h' },
      clusters: [{ index: 0, entityIds: ['x', 'y'], isCycle: false }],
      steps: [],
      stats: {
        entityCount: 0,
        clusterCount: 1,
        cycleCount: 0,
        maxClusterSize: 2,
        edgeCount: 0,
        backwardEdges: 0,
        totalAdded: 0,
        totalRemoved: 0,
      },
    };
    expect(() => ReadingPlanSchema.parse(plan)).toThrow();
  });
});
