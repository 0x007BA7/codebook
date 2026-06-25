#!/usr/bin/env node
/**
 * Thin CLI over ingest + core (§15). Dogfooding and scripting.
 *   prl fixtures
 *   prl plan --fixture rate-limit
 *   prl plan --repo . --base main --head HEAD --ingestor sem
 */
import { writeFileSync } from 'node:fs';
import { linearize, stableStringify } from '@prl/core';
import {
  FixtureIngestor,
  SemIngestor,
  SemUnavailableError,
  listFixtures,
  type Ingestor,
} from '@prl/ingest';
import { renderPlanHtml } from './render.js';

function parseFlags(argv: string[]): Record<string, string> {
  const out: Record<string, string> = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]!;
    if (a.startsWith('--')) {
      const key = a.slice(2);
      const next = argv[i + 1];
      if (next && !next.startsWith('--')) {
        out[key] = next;
        i++;
      } else out[key] = 'true';
    }
  }
  return out;
}

async function main(): Promise<void> {
  const [cmd, ...rest] = process.argv.slice(2);
  const flags = parseFlags(rest);

  if (!cmd || cmd === 'help') {
    console.log(
      'usage:\n' +
        '  prl fixtures\n' +
        '  prl plan   --fixture <name>\n' +
        '  prl plan   --repo <dir> --base <ref> --head <ref> [--ingestor sem|fixture]\n' +
        '  prl plan|render --repo <dir> --working|--staged   (local changes, no refs)\n' +
        '  prl render --repo <dir> --base <ref> --head <ref> --ingestor sem [--out plan.html]\n' +
        '  prl render --fixture <name> [--out plan.html]',
    );
    return;
  }

  if (cmd === 'fixtures') {
    for (const f of listFixtures()) console.log(f);
    return;
  }

  if (cmd === 'plan' || cmd === 'render') {
    const scope =
      flags.working ? 'working' : flags.staged ? 'staged' : undefined;
    const useSem = flags.ingestor === 'sem' || !!scope || (!flags.fixture && !!flags.repo);
    const ingestor: Ingestor = useSem ? new SemIngestor() : new FixtureIngestor();
    const input = await ingestor.ingest({
      fixture: flags.fixture,
      repo: flags.repo,
      base: flags.base,
      head: flags.head,
      cwd: flags.repo,
      ...(scope ? { scope } : {}),
    });
    const plan = linearize(input);

    if (cmd === 'plan') {
      process.stdout.write(stableStringify(plan));
      return;
    }
    // render -> standalone HTML spine
    const title =
      flags.title ?? flags.fixture ?? `${plan.pr.repo} ${plan.pr.base}..${plan.pr.head}`;
    const out = flags.out ?? 'plan.html';
    writeFileSync(out, renderPlanHtml(plan, title));
    console.error(`wrote ${out} (${plan.stats.entityCount} entities, ${plan.stats.clusterCount} clusters)`);
    return;
  }

  console.error(`unknown command: ${cmd}`);
  process.exit(2);
}

main().catch((err: unknown) => {
  if (err instanceof SemUnavailableError) {
    console.error(err.message);
    process.exit(err.exitCode);
  }
  console.error(err instanceof Error ? err.message : String(err));
  process.exit(1);
});
