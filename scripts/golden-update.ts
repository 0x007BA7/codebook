/**
 * Regenerate every fixture's expected.plan.json (§11.3). Updating a golden is
 * explicit and the diff must be reviewed; prefer fixing the algorithm over
 * editing a golden (CLAUDE.md). Run via `make golden-update`.
 */
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { linearize, stableStringify } from '@codebook/core';
import { listFixtures, loadFixtureInput, FIXTURES_ROOT } from '@codebook/ingest';

const only = process.argv[2]; // optional single fixture name
const names = (only ? [only] : listFixtures()).sort();
if (names.length === 0) {
  console.error('golden-update: no fixtures found.');
  process.exit(1);
}

for (const name of names) {
  const input = loadFixtureInput(name);
  const plan = linearize(input);
  const out = join(FIXTURES_ROOT, name, 'expected.plan.json');
  writeFileSync(out, stableStringify(plan));
  console.log(
    `golden-update: ${name} -> ${plan.stats.entityCount} entities, ` +
      `${plan.stats.clusterCount} clusters, ${plan.stats.cycleCount} cycles, ` +
      `backwardEdges=${plan.stats.backwardEdges}`,
  );
}
