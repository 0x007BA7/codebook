/**
 * `make new-fixture name=foo` — scaffold fixtures/foo/input.graph.json with a
 * minimal valid template, then regenerate its expected.plan.json (§13.1).
 */
import { writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';

const name = process.argv[2];
if (!name || /[^a-z0-9-]/.test(name)) {
  console.error('usage: make new-fixture name=<kebab-case-name>');
  process.exit(2);
}

const dir = join('fixtures', name);
if (existsSync(dir)) {
  console.error(`fixture "${name}" already exists at ${dir}`);
  process.exit(1);
}

const template = {
  schemaVersion: 1,
  pr: { repo: `example/${name}`, base: 'main', head: `feat/${name}` },
  entities: [
    {
      id: 'src/a.ts::A',
      name: 'A',
      file: 'src/a.ts',
      kind: 'function',
      change: 'added',
      category: 'logic',
      hunks: [{ file: 'src/a.ts', startLine: 1, endLine: 10, added: 10, removed: 0 }],
    },
    {
      id: 'src/b.ts::B',
      name: 'B',
      file: 'src/b.ts',
      kind: 'function',
      change: 'added',
      category: 'logic',
      hunks: [{ file: 'src/b.ts', startLine: 1, endLine: 10, added: 10, removed: 0 }],
    },
  ],
  edges: [{ from: 'src/a.ts::A', to: 'src/b.ts::B', rel: 'calls' }],
};

mkdirSync(dir, { recursive: true });
writeFileSync(join(dir, 'input.graph.json'), JSON.stringify(template, null, 2) + '\n');
console.log(`scaffolded ${dir}/input.graph.json — edit it, then expected.plan.json is generated below.`);

execFileSync('npx', ['tsx', 'scripts/golden-update.ts', name], { stdio: 'inherit' });
