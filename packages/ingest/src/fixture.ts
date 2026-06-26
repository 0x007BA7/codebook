import { readFileSync, readdirSync, existsSync, statSync } from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseGraphInput, type GraphInput } from '@codebook/contracts';
import type { Ingestor, IngestOpts } from './types.js';

/** Repo-root fixtures/ directory, resolved relative to this source file. */
export const FIXTURES_ROOT = resolve(
  dirname(fileURLToPath(import.meta.url)),
  '..',
  '..',
  '..',
  'fixtures',
);

/** Names of all fixtures (dirs containing input.graph.json), sorted. */
export function listFixtures(root: string = FIXTURES_ROOT): string[] {
  if (!existsSync(root)) return [];
  return readdirSync(root)
    .filter((name) => {
      const p = join(root, name);
      return (
        statSync(p).isDirectory() && existsSync(join(p, 'input.graph.json'))
      );
    })
    .sort();
}

export function fixtureInputPath(
  name: string,
  root: string = FIXTURES_ROOT,
): string {
  return join(root, name, 'input.graph.json');
}

export function loadFixtureInput(
  name: string,
  root: string = FIXTURES_ROOT,
): GraphInput {
  const path = fixtureInputPath(name, root);
  if (!existsSync(path)) {
    throw new Error(
      `FixtureIngestor: no fixture "${name}" at ${path}. Known: ${listFixtures(root).join(', ') || '(none)'}`,
    );
  }
  const raw: unknown = JSON.parse(readFileSync(path, 'utf8'));
  // Re-validate against the contract on the way in (§7).
  return parseGraphInput(raw);
}

/**
 * Reads a committed *.graph.json and validates it. No `sem`, no git, no
 * network. This is what all core/server/web tests use (§7).
 */
export class FixtureIngestor implements Ingestor {
  readonly name = 'fixture';
  constructor(private readonly root: string = FIXTURES_ROOT) {}

  ingest(opts: IngestOpts): Promise<GraphInput> {
    if (!opts.fixture) {
      throw new Error('FixtureIngestor requires opts.fixture');
    }
    return Promise.resolve(loadFixtureInput(opts.fixture, this.root));
  }
}
