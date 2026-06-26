/**
 * Regenerate the `large-synthetic` fixture input from a FIXED SEED (§11.3,
 * §12). Reproducible: same seed -> byte-identical input.graph.json. ≥150
 * entities, a mostly-forward DAG with a handful of planted small cycles.
 */
import { writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { stableStringify } from '@codebook/core';
import type { GraphInput, Entity, Edge, Category, EntityKind } from '@codebook/contracts';

const SEED = 0x9e3779b9;
const N = 160;

// mulberry32 — tiny deterministic PRNG.
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const rnd = mulberry32(SEED);
const pick = <T>(arr: readonly T[]): T => arr[Math.floor(rnd() * arr.length)]!;

const cats: Category[] = ['logic', 'config', 'test', 'wiring'];
const kinds: EntityKind[] = ['function', 'method', 'class', 'type', 'const'];

const entities: Entity[] = [];
for (let i = 0; i < N; i++) {
  const dir = `src/mod${String(i % 12).padStart(2, '0')}`;
  const file = `${dir}/file${String(i).padStart(3, '0')}.ts`;
  const start = 1 + Math.floor(rnd() * 200);
  const added = Math.floor(rnd() * 40);
  const removed = Math.floor(rnd() * 10);
  entities.push({
    id: `${file}::sym${String(i).padStart(3, '0')}`,
    name: `sym${i}`,
    file,
    kind: pick(kinds),
    change: pick(['added', 'modified', 'deleted'] as const),
    category: pick(cats),
    hunks: [
      { file, startLine: start, endLine: start + Math.max(1, added), added, removed },
    ],
  });
}

const edgeSet = new Set<string>();
const edges: Edge[] = [];
const addEdge = (from: number, to: number): void => {
  if (from === to) return;
  const key = `${from}->${to}`;
  if (edgeSet.has(key)) return;
  edgeSet.add(key);
  edges.push({
    from: entities[from]!.id,
    to: entities[to]!.id,
    rel: pick(['calls', 'uses-type', 'imports', 'tests'] as const),
  });
};

// Mostly-forward edges: higher index depends on a few lower indices -> DAG,
// reading order roughly ascends. (from depends on to => to is read first.)
for (let i = 1; i < N; i++) {
  const deg = Math.floor(rnd() * 3);
  for (let k = 0; k < deg; k++) addEdge(i, Math.floor(rnd() * i));
}

// Plant a handful of small back-cycles so the fixture exercises SCCs.
const cycleStarts = [10, 40, 75, 120];
for (const s of cycleStarts) {
  const len = 2 + Math.floor(rnd() * 3); // 2..4 node cycle
  for (let k = 0; k < len; k++) addEdge(s + k, s + ((k + 1) % len));
}

const input: GraphInput = {
  schemaVersion: 1,
  pr: { repo: 'example/large', base: 'main', head: 'feat/large-synthetic' },
  entities,
  edges,
};

const dir = join('fixtures', 'large-synthetic');
mkdirSync(dir, { recursive: true });
writeFileSync(join(dir, 'input.graph.json'), stableStringify(input));
console.log(`gen-large: wrote ${entities.length} entities, ${edges.length} edges (seed ${SEED}).`);
