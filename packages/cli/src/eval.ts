/**
 * Eval harness (§13.3). Runs linearize over every fixture and emits
 * eval/scorecard.json + eval/report.html. Exit 0 only if totals.failed == 0
 * AND determinismCheck == "pass".
 */
import { writeFileSync, mkdirSync, readFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { linearize, stableStringify, checkLaws, type LawResult } from '@codebook/core';
import { listFixtures, loadFixtureInput, FIXTURES_ROOT } from '@codebook/ingest';
import type { GraphInput, ReadingPlan } from '@codebook/contracts';
import { Spine, Legend } from '@codebook/web/Spine';

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const evalDir = join(repoRoot, 'eval');

function shuffle<T>(arr: T[], seed: number): T[] {
  const a = [...arr];
  let s = (seed >>> 0) || 1;
  const next = (): number => (s = (s * 1664525 + 1013904223) >>> 0) / 2 ** 32;
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(next() * (i + 1));
    [a[i], a[j]] = [a[j]!, a[i]!];
  }
  return a;
}

/** L5: linearize must be byte-identical under permutation of entities/edges. */
function determinismHolds(input: GraphInput, plan: ReadingPlan): boolean {
  const base = stableStringify(plan);
  for (let seed = 1; seed <= 4; seed++) {
    const permuted: GraphInput = {
      ...input,
      entities: shuffle(input.entities, seed),
      edges: shuffle(input.edges, seed * 7 + 1),
    };
    if (stableStringify(linearize(permuted)) !== base) return false;
  }
  return true;
}

interface FixtureScore {
  name: string;
  entities: number;
  clusters: number;
  cycles: number;
  maxClusterSize: number;
  backwardEdges: number;
  laws: Record<'L1' | 'L2' | 'L3' | 'L4' | 'L5' | 'L6', LawResult>;
  localityMean: number;
  goldenMatch: boolean;
}

const names = listFixtures();
const scores: FixtureScore[] = [];
const renderedSpines: Array<{ name: string; html: string }> = [];

for (const name of names) {
  const input = loadFixtureInput(name);
  const plan = linearize(input);
  const laws = checkLaws(input, plan);
  const l5: LawResult = determinismHolds(input, plan) ? 'pass' : 'fail';

  const goldenPath = join(FIXTURES_ROOT, name, 'expected.plan.json');
  const goldenMatch =
    existsSync(goldenPath) &&
    readFileSync(goldenPath, 'utf8') === stableStringify(plan);

  scores.push({
    name,
    entities: plan.stats.entityCount,
    clusters: plan.stats.clusterCount,
    cycles: plan.stats.cycleCount,
    maxClusterSize: plan.stats.maxClusterSize,
    backwardEdges: plan.stats.backwardEdges,
    laws: { L1: laws.L1, L2: laws.L2, L3: laws.L3, L4: laws.L4, L5: l5, L6: laws.L6 },
    localityMean: laws.localityMean,
    goldenMatch,
  });
  renderedSpines.push({
    name,
    html: renderToStaticMarkup(createElement(Spine, { plan })),
  });
}

function fixturePassed(s: FixtureScore): boolean {
  const lawsOk = (['L1', 'L2', 'L3', 'L4', 'L5', 'L6'] as const).every(
    (k) => s.laws[k] === 'pass' || s.laws[k] === 'n/a',
  );
  return lawsOk && s.goldenMatch;
}

const passed = scores.filter(fixturePassed).length;
const failed = scores.length - passed;
const determinismCheck: 'pass' | 'fail' = scores.every((s) => s.laws.L5 === 'pass')
  ? 'pass'
  : 'fail';

const scorecard = {
  generatedFrom: 'fixtures',
  fixtures: scores,
  totals: { fixtures: scores.length, passed, failed },
  determinismCheck,
};

mkdirSync(evalDir, { recursive: true });
writeFileSync(join(evalDir, 'scorecard.json'), stableStringify(scorecard));
writeFileSync(join(evalDir, 'report.html'), renderReport(scores, renderedSpines, scorecard));

// Console summary for the loop.
for (const s of scores) {
  const verdict = fixturePassed(s) ? 'PASS' : 'FAIL';
  console.log(
    `${verdict}  ${s.name.padEnd(22)} ent=${s.entities} cl=${s.clusters} cyc=${s.cycles} ` +
      `back=${s.backwardEdges} golden=${s.goldenMatch} L=${Object.values(s.laws).join('')}`,
  );
}
console.log(
  `\ntotals: ${passed}/${scores.length} passed, determinism=${determinismCheck}`,
);
console.log(`wrote eval/scorecard.json and eval/report.html`);

if (failed > 0 || determinismCheck !== 'pass') process.exit(1);

// --- report.html ---------------------------------------------------------
function badge(v: LawResult): string {
  const cls = v === 'pass' ? 'ok' : v === 'n/a' ? 'na' : 'bad';
  return `<span class="badge ${cls}">${v}</span>`;
}

function renderReport(
  rows: FixtureScore[],
  spines: Array<{ name: string; html: string }>,
  card: typeof scorecard,
): string {
  const css = readFileSync(join(repoRoot, 'packages', 'web', 'src', 'index.css'), 'utf8');
  const legend = renderToStaticMarkup(createElement(Legend));
  const table = rows
    .map(
      (s) => `<tr>
      <td><a href="#${s.name}">${s.name}</a></td>
      <td>${s.entities}</td><td>${s.clusters}</td><td>${s.cycles}</td>
      <td>${s.backwardEdges}</td>
      ${(['L1', 'L2', 'L3', 'L4', 'L5', 'L6'] as const).map((k) => `<td>${badge(s.laws[k])}</td>`).join('')}
      <td>${s.goldenMatch ? badge('pass') : badge('fail')}</td>
      <td>${s.localityMean}</td>
    </tr>`,
    )
    .join('\n');
  const sections = spines
    .map(
      ({ name, html }) =>
        `<section id="${name}"><h2>${name}</h2><div class="app">${html}</div></section>`,
    )
    .join('\n');
  return `<!doctype html><html><head><meta charset="utf-8"><title>Codebook — eval</title>
<style>${css}
body{padding:24px;max-width:1000px;margin:0 auto;}
table{border-collapse:collapse;width:100%;font-size:13px;margin:16px 0;}
th,td{border:1px solid var(--line);padding:5px 8px;text-align:center;}
th:first-child,td:first-child{text-align:left;}
.badge{display:inline-block;padding:1px 7px;border-radius:3px;font-size:11px;}
.badge.ok{background:#d8f3df;color:#1a7f37;}
.badge.bad{background:#fdd;color:#b3261e;}
.badge.na{background:#eee;color:#888;}
section{border-top:1px solid var(--line);margin-top:28px;padding-top:8px;}
.totals{font-weight:600;}
</style></head><body>
<h1>Codebook — eval report</h1>
${legend}
<p class="totals">totals: ${card.totals.passed}/${card.totals.fixtures} fixtures passed · determinism: ${badge(card.determinismCheck)}</p>
<table><thead><tr><th>fixture</th><th>ent</th><th>cl</th><th>cyc</th><th>back</th>
<th>L1</th><th>L2</th><th>L3</th><th>L4</th><th>L5</th><th>L6</th><th>golden</th><th>locality</th></tr></thead>
<tbody>${table}</tbody></table>
${sections}
</body></html>`;
}
