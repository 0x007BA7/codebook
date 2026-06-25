import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { renderToStaticMarkup } from 'react-dom/server';
import { createElement } from 'react';
import { ReadingPlanSchema, type GraphInput } from '@prl/contracts';
import { linearize } from '@prl/core';
import { Spine, Legend } from './Spine.js';

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
function loadPlan(name: string) {
  const raw = JSON.parse(
    readFileSync(join(repoRoot, 'fixtures', name, 'expected.plan.json'), 'utf8'),
  );
  return ReadingPlanSchema.parse(raw);
}

function render(name: string): string {
  return renderToStaticMarkup(createElement(Spine, { plan: loadPlan(name) }));
}

describe('Spine (static markup, §8.2)', () => {
  it('renders one node per step', () => {
    const plan = loadPlan('rate-limit');
    const html = renderToStaticMarkup(createElement(Spine, { plan }));
    expect(html).toContain(`data-step-count="${plan.steps.length}"`);
    const cards = html.match(/class="step-card"/g) ?? [];
    expect(cards).toHaveLength(plan.steps.length);
  });

  it('groups steps by file with both ranking metrics as data attributes', () => {
    const html = render('rate-limit');
    expect(html).toContain('data-layout="by-file"');
    expect(html).toContain('class="file-group"');
    expect(html).toContain('class="file-head"');
    expect(html).toContain('data-file="src/http/headers.ts"');
    expect(html).toMatch(/data-fanout="\d+"/);
    expect(html).toMatch(/data-blast="\d+"/);
    // the visible "fan-out" text is gone (ranking is silent)
    expect(html).not.toContain('fan-out');
  });

  it('shows a "used by" dependents dropdown for entities that have dependents', () => {
    const html = render('rate-limit');
    // RateLimitConfig (step 1) is used by TokenBucket and RateLimiter.check
    expect(html).toContain('class="dependents"');
    expect(html).toMatch(/used by \d+ entit/);
    // the dropdown items are dep-links (so they reuse the click-to-preview wiring)
    expect(html).toContain('class="dep-list"');
  });

  it('marks cycle members with a badge', () => {
    const html = render('rate-limit');
    expect(html).toContain('class="cycle-badge"');
    expect(html).toContain('data-cycle-rel="mutual recursion"');
    expect(html).toContain('↻ mutual recursion');
  });

  it('shows dependency links that anchor to the target step', () => {
    const html = render('rate-limit');
    expect(html).toContain('class="deps"');
    expect(html).toContain('class="dep-link"');
    expect(html).toContain('data-dep='); // links carry the target order for popdown
    expect(html).toMatch(/depends on/);
    expect(html).toMatch(/href="#step-\d+"/);
  });

  it('renders a reviewed checkbox per step, keyed by entity id', () => {
    const html = render('rate-limit');
    const boxes = html.match(/class="reviewed"/g) ?? [];
    expect(boxes).toHaveLength(7);
    expect(html).toContain('data-entity="src/server.ts::bootstrap"');
  });

  it('is expanded by default (details open) and content does not rely on JS', () => {
    const html = render('rate-limit');
    expect(html).toMatch(/<details[^>]*\bopen\b/);
    expect(html).toContain('class="hunks"');
    expect(html).toContain('data-hunk="0"');
    expect(html).toContain('src/http/headers.ts:10');
  });

  it('renders the actual diff code on expand when a hunk has patch text (§8.2)', () => {
    const html = render('rate-limit');
    expect(html).toContain('class="diff"');
    // real source lines from the fixture patches appear verbatim
    expect(html).toContain('export class TokenBucket');
    expect(html).toContain('return JSON.parse(raw);');
    // added/removed lines carry their sign-based class for coloring
    expect(html).toContain('class="diff-line add"');
    expect(html).toContain('class="diff-line del"');
  });

  it('color encodes category, not step number', () => {
    const html = render('rate-limit');
    expect(html).toContain('data-category="config"');
    expect(html).toContain('data-category="wiring"');
    // category drives the swatch color
    expect(renderToStaticMarkup(createElement(Legend))).toContain('swatch');
  });

  it('highlights a Python multi-line docstring as a string across lines', () => {
    const g: GraphInput = {
      schemaVersion: 1,
      pr: { repo: 'r', base: 'b', head: 'h' },
      entities: [
        {
          id: 'f.py::f',
          name: 'f',
          file: 'f.py',
          kind: 'function',
          change: 'added',
          hunks: [
            {
              file: 'f.py',
              startLine: 1,
              endLine: 6,
              added: 6,
              removed: 0,
              patch:
                '+def f():\n+    """\n+    multi line\n+    docstring // not a comment\n+    """\n+    return 1',
            },
          ],
        },
      ],
      edges: [],
    };
    const html = renderToStaticMarkup(createElement(Spine, { plan: linearize(g) }));
    // docstring body is colored as a string, spanning lines…
    expect(html).toMatch(/tok-str[^>]*>\s*docstring \/\/ not a comment/);
    // …and the `//` inside it is NOT mistaken for a line comment
    expect(html).not.toMatch(/tok-com[^>]*>\/\/ not a comment/);
  });

  it('renders every fixture without throwing', () => {
    for (const name of [
      'acyclic-chain',
      'disconnected-islands',
      'nested-cycles',
      'single-cycle',
      'large-synthetic',
    ]) {
      expect(() => render(name), name).not.toThrow();
    }
  });
});
