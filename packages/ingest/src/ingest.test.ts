import { describe, it, expect } from 'vitest';
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { linearize, stableStringify, checkLaws } from '@prl/core';
import { parseGraphInput } from '@prl/contracts';
import {
  FixtureIngestor,
  listFixtures,
  loadFixtureInput,
  FIXTURES_ROOT,
  normalizeSemOutput,
  isSemAvailable,
  SemIngestor,
  SemUnavailableError,
  type SemDiff,
  type SemGraph,
} from './index.js';

describe('FixtureIngestor', () => {
  it('lists the committed fixtures', () => {
    const names = listFixtures();
    expect(names).toEqual([
      'acyclic-chain',
      'disconnected-islands',
      'large-synthetic',
      'nested-cycles',
      'rate-limit',
      'single-cycle',
    ]);
  });

  it('round-trips and validates rate-limit', async () => {
    const g = await new FixtureIngestor().ingest({ fixture: 'rate-limit' });
    expect(() => parseGraphInput(g)).not.toThrow();
    expect(g.entities).toHaveLength(7);
  });

  it('throws a helpful error for an unknown fixture', () => {
    expect(() => loadFixtureInput('does-not-exist')).toThrow(/no fixture/);
  });
});

describe('golden byte-equality (§11.3)', () => {
  for (const name of listFixtures()) {
    it(`${name}: linearize(input) matches expected.plan.json byte-for-byte`, () => {
      const input = loadFixtureInput(name);
      const produced = stableStringify(linearize(input));
      const expectedPath = join(FIXTURES_ROOT, name, 'expected.plan.json');
      expect(existsSync(expectedPath), `${expectedPath} missing — run make golden-update`).toBe(true);
      const expected = readFileSync(expectedPath, 'utf8');
      expect(produced).toBe(expected);
    });

    it(`${name}: satisfies L1–L6`, () => {
      const input = loadFixtureInput(name);
      const plan = linearize(input);
      const laws = checkLaws(input, plan);
      expect(laws.L1).toBe('pass');
      expect(laws.L2).toBe('pass');
      expect(laws.L3).toBe('pass');
      expect(laws.L6).toBe('pass');
      if (laws.L4 !== 'n/a') expect(laws.L4).toBe('pass');
    });
  }
});

describe('SemIngestor normalization (real committed sem samples, no sem needed)', () => {
  // These are ACTUAL `sem 0.14` outputs captured from a real TS repo.
  const diff = JSON.parse(
    readFileSync(join(FIXTURES_ROOT, 'sem-samples', 'diff.json'), 'utf8'),
  ) as SemDiff;
  const graph = JSON.parse(
    readFileSync(join(FIXTURES_ROOT, 'sem-samples', 'graph.json'), 'utf8'),
  ) as SemGraph;
  const pr = { repo: 'example/repo', base: 'BASE', head: 'HEAD' };

  it('drops orphan (module-level) entities and maps kinds/changes', () => {
    const g = normalizeSemOutput(diff, graph, pr);
    expect(g.entities.every((e) => !e.id.includes('::orphan::'))).toBe(true);
    const check = g.entities.find((e) => e.id.endsWith('::function::check'));
    expect(check?.kind).toBe('function');
    expect(check?.change).toBe('added');
  });

  it('builds hunks with patch text from before/after content', () => {
    const g = normalizeSemOutput(diff, graph, pr);
    const check = g.entities.find((e) => e.id.endsWith('::function::check'))!;
    expect(check.hunks[0]!.patch).toContain('+function check');
    expect(check.hunks[0]!.added).toBeGreaterThan(0);
  });

  it('maps refTypes (typeref->uses-type, calls->calls) and re-validates', () => {
    const g = normalizeSemOutput(diff, graph, pr);
    expect(() => parseGraphInput(g)).not.toThrow();
    const rels = new Set(g.edges.map((e) => e.rel));
    expect(rels.has('uses-type')).toBe(true);
    expect(rels.has('calls')).toBe(true);
  });

  it('the normalized output linearizes cleanly (L3)', () => {
    const g = normalizeSemOutput(diff, graph, pr);
    expect(linearize(g).stats.backwardEdges).toBe(0);
  });
});

describe('SemIngestor availability gate + integration (§11.5)', () => {
  const semHere = isSemAvailable();

  it.runIf(!semHere)('throws SemUnavailableError when sem is not on PATH', async () => {
    await expect(new SemIngestor().ingest({ cwd: process.cwd() })).rejects.toBeInstanceOf(
      SemUnavailableError,
    );
  });

  it.skipIf(semHere)('integration auto-skips without sem (logged)', () => {
    console.log('[skip] sem not on PATH — SemIngestor integration test skipped (§11.5).');
    expect(semHere).toBe(false);
  });

  // When sem IS available, build a throwaway git repo with two commits and run
  // the real adapter against it — no committed nested repo needed.
  it.runIf(semHere)('produces a law-abiding GraphInput from a real repo', async () => {
    const { mkdtempSync, writeFileSync: wf, mkdirSync: md } = await import('node:fs');
    const { tmpdir } = await import('node:os');
    const { execFileSync } = await import('node:child_process');
    const dir = mkdtempSync(join(tmpdir(), 'prl-sem-'));
    const git = (...a: string[]) => execFileSync('git', a, { cwd: dir, stdio: 'ignore' });
    md(join(dir, 'src'), { recursive: true });
    git('init', '-q');
    git('config', 'user.email', 't@t.co');
    git('config', 'user.name', 't');
    wf(join(dir, 'src/config.ts'), 'export interface Config { rate: number; }\n');
    git('add', '-A');
    git('commit', '-qm', 'base');
    const base = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: dir, encoding: 'utf8' }).trim();
    wf(
      join(dir, 'src/limiter.ts'),
      "import { Config } from './config';\nexport function check(c: Config): number { return c.rate; }\n",
    );
    git('add', '-A');
    git('commit', '-qm', 'head');

    const g = await new SemIngestor().ingest({ cwd: dir, repo: dir, base, head: 'HEAD' });
    expect(() => parseGraphInput(g)).not.toThrow();
    expect(g.entities.length).toBeGreaterThan(0);
    const laws = checkLaws(g, linearize(g));
    expect(laws.L1).toBe('pass');
    expect(laws.L3).toBe('pass');
  });

  it.runIf(semHere)('reviews uncommitted working-tree changes (scope: working)', async () => {
    const { mkdtempSync, writeFileSync: wf } = await import('node:fs');
    const { tmpdir } = await import('node:os');
    const { execFileSync } = await import('node:child_process');
    const dir = mkdtempSync(join(tmpdir(), 'prl-wt-'));
    const git = (...a: string[]) => execFileSync('git', a, { cwd: dir, stdio: 'ignore' });
    git('init', '-q');
    git('config', 'user.email', 't@t.co');
    git('config', 'user.name', 't');
    wf(join(dir, 'a.ts'), 'export function f() { return 1; }\n');
    git('add', '-A');
    git('commit', '-qm', 'base');
    // edit f and add a new function g — but DON'T commit
    wf(join(dir, 'a.ts'), 'export function f() { return 2; }\nexport function g() { return f(); }\n');

    const g = await new SemIngestor().ingest({ cwd: dir, repo: dir, scope: 'working' });
    expect(() => parseGraphInput(g)).not.toThrow();
    const names = g.entities.map((e) => e.id).join(' ');
    expect(names).toContain('::f');
    expect(names).toContain('::g'); // the uncommitted new function is included
    expect(g.pr.head).toBe('working tree');
  });

  it.runIf(semHere)('whole-tree view reads entity source in dependency order', async () => {
    const { mkdtempSync, writeFileSync: wf } = await import('node:fs');
    const { tmpdir } = await import('node:os');
    const { execFileSync } = await import('node:child_process');
    const dir = mkdtempSync(join(tmpdir(), 'prl-tree-'));
    const git = (...a: string[]) => execFileSync('git', a, { cwd: dir, stdio: 'ignore' });
    git('init', '-q');
    git('config', 'user.email', 't@t.co');
    git('config', 'user.name', 't');
    // total() calls clamp() -> clamp must read before total
    wf(join(dir, 'm.py'), 'def clamp(n):\n    return max(0, n)\n\ndef total(xs):\n    return clamp(sum(xs))\n');
    git('add', '-A');
    git('commit', '-qm', 'init');

    const g = await new SemIngestor().ingest({ cwd: dir, repo: dir, scope: 'tree' });
    expect(() => parseGraphInput(g)).not.toThrow();
    expect(g.entities.length).toBeGreaterThanOrEqual(2);
    // every entity is "added" and carries its source as patch text
    const total = g.entities.find((e) => e.id.endsWith('::total'))!;
    expect(total.change).toBe('added');
    expect(total.hunks[0]!.patch).toContain('clamp(sum(xs))');
    // the call edge was captured, so the plan orders clamp before total
    const plan = linearize(g);
    const order = plan.steps.map((s) => s.entity.id);
    const ci = order.findIndex((id) => id.endsWith('::clamp'));
    const ti = order.findIndex((id) => id.endsWith('::total'));
    expect(ci).toBeLessThan(ti);
  });
});
