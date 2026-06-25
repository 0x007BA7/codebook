import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import type { ReadingPlan } from '@prl/contracts';
import { Spine, Legend } from '@prl/web/Spine';
import { initSpinePopdowns } from '@prl/web/popdown';

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');

/** Render a ReadingPlan to a self-contained HTML page (Spine + inlined CSS). */
export function renderPlanHtml(plan: ReadingPlan, title: string): string {
  const css = readFileSync(join(repoRoot, 'packages', 'web', 'src', 'index.css'), 'utf8');
  const spine = renderToStaticMarkup(createElement(Spine, { plan }));
  const legend = renderToStaticMarkup(createElement(Legend));
  const s = plan.stats;
  return `<!doctype html><html lang="en"><head><meta charset="utf-8">
<title>${title} — reading spine</title><style>${css}
.stats{color:var(--muted);font-size:13px;margin:14px 0 18px;}</style></head>
<body><div class="app">
<header class="topbar"><h1>${title}</h1>${legend}</header>
<p class="stats">${s.entityCount} entities · ${s.clusterCount} clusters · ${s.cycleCount} cycle(s) · backwardEdges ${s.backwardEdges} · <span class="add">+${s.totalAdded}</span> <span class="del">−${s.totalRemoved}</span></p>
${spine}
</div>
<script>
// __name is an esbuild helper (keepNames) referenced by the serialized
// function but defined in its original module scope; shim it so the injected
// standalone script runs. (A jsdom test guards this in packages/cli.)
var __name = function (t) { return t; };
(${initSpinePopdowns.toString()})();
</script>
</body></html>`;
}
