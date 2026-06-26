#!/usr/bin/env node
/**
 * Thin CLI over ingest + core (§15). Dogfooding and scripting.
 *   codebook fixtures
 *   codebook plan --fixture rate-limit
 *   codebook plan --repo . --base main --head HEAD --ingestor sem
 */
import { writeFileSync } from 'node:fs';
import { linearize, stableStringify } from '@codebook/core';
import {
  FixtureIngestor,
  SemIngestor,
  SemUnavailableError,
  listFixtures,
  type Ingestor,
} from '@codebook/ingest';
import { renderPlanHtml } from './render.js';
import { runWatch } from './watch.js';

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
        '  codebook fixtures\n' +
        '  codebook plan   --fixture <name>\n' +
        '  codebook plan   --repo <dir> --base <ref> --head <ref> [--ingestor sem|fixture]\n' +
        '  codebook plan|render --repo <dir> --working|--staged   (local changes, no refs)\n' +
        '  codebook render --repo <dir> --base <ref> --head <ref> --ingestor sem [--out plan.html]\n' +
        '  codebook render --fixture <name> [--out plan.html]',
    );
    return;
  }

  if (cmd === 'fixtures') {
    for (const f of listFixtures()) console.log(f);
    return;
  }

  if (cmd === 'plan' || cmd === 'render' || cmd === 'watch') {
    const scope: 'working' | 'staged' | 'tree' | undefined = flags.working
      ? 'working'
      : flags.staged
        ? 'staged'
        : flags.tree
          ? 'tree'
          : undefined;
    // tree path can come from --path or directly from `--tree <path>`
    const treePath =
      flags.path ?? (flags.tree && flags.tree !== 'true' ? flags.tree : undefined);
    const useSem = flags.ingestor === 'sem' || !!scope || (!flags.fixture && !!flags.repo);
    const ingestor: Ingestor = useSem ? new SemIngestor() : new FixtureIngestor();
    const opts = {
      fixture: flags.fixture,
      repo: flags.repo,
      base: flags.base,
      head: flags.head,
      cwd: flags.repo,
      ...(scope ? { scope } : {}),
      ...(treePath ? { path: treePath } : {}),
      ...(flags.max !== undefined ? { treeCap: Number(flags.max) } : {}),
    };
    const titleFor = (plan: ReturnType<typeof linearize>): string =>
      flags.title ?? flags.fixture ?? `${plan.pr.repo} ${plan.pr.base}..${plan.pr.head}`;

    if (cmd === 'watch') {
      // live-reload server: re-ingest + re-render on file change
      const port = Number(flags.port ?? 8799);
      const watchDir = flags.repo ?? process.cwd();
      await runWatch(
        async () => {
          const plan = linearize(await ingestor.ingest(opts));
          return renderPlanHtml(plan, titleFor(plan));
        },
        watchDir,
        port,
        !flags['no-open'],
      );
      return; // runWatch keeps the process alive
    }

    const plan = linearize(await ingestor.ingest(opts));
    if (cmd === 'plan') {
      process.stdout.write(stableStringify(plan));
      return;
    }
    // render -> standalone HTML spine
    const out = flags.out ?? 'plan.html';
    writeFileSync(out, renderPlanHtml(plan, titleFor(plan)));
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
