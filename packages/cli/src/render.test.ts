import { describe, it, expect } from 'vitest';
import { JSDOM, VirtualConsole } from 'jsdom';
import { linearize } from '@prl/core';
import { loadFixtureInput } from '@prl/ingest';
import { renderPlanHtml } from './render.js';

// Renders a fixture plan to standalone HTML and runs its injected script in a
// real DOM. Guards the fragile .toString() injection: it must execute without
// error (catches missing esbuild helpers like __name), inject the settings
// panel, expose reviewed checkboxes, and make dep-link click-to-preview work.
function renderInDom(fixture: string) {
  const plan = linearize(loadFixtureInput(fixture));
  const html = renderPlanHtml(plan, fixture);
  const errors: string[] = [];
  const vc = new VirtualConsole();
  vc.on('jsdomError', (e: Error) => errors.push(e.message));
  const dom = new JSDOM(html, {
    runScripts: 'dangerously',
    virtualConsole: vc,
    url: 'http://localhost/', // gives jsdom a working localStorage
  });
  return { plan, dom, doc: dom.window.document, errors };
}

describe('renderPlanHtml standalone interactions (jsdom)', () => {
  it('runs the injected script with no errors and injects the settings dropdown', () => {
    const { doc, errors } = renderInDom('rate-limit');
    expect(errors).toEqual([]); // would fail on the __name ReferenceError
    const panel = doc.getElementById('prl-settings');
    expect(panel).toBeTruthy();
    expect(panel!.tagName.toLowerCase()).toBe('details'); // it's a dropdown
    expect(doc.querySelectorAll('input[name="prl-mode"]').length).toBe(2);
    expect(doc.querySelectorAll('input[name="prl-rank"]').length).toBe(2); // rank selector
  });

  it('default ranks file groups by fan-out desc; switching ranks by blast desc', () => {
    const { dom, doc } = renderInDom('large-synthetic');
    const metric = (attr: string) =>
      [...doc.querySelectorAll('.steps > .file-group')].map((g) =>
        parseInt(g.getAttribute(attr) || '0', 10),
      );
    const nonIncreasing = (xs: number[]) => xs.every((v, i) => i === 0 || xs[i - 1]! >= v);

    expect(nonIncreasing(metric('data-fanout'))).toBe(true); // default = fan-out
    const blast = doc.querySelector('input[name="prl-rank"][value="blast"]') as HTMLInputElement;
    blast.checked = true;
    blast.dispatchEvent(new dom.window.Event('change', { bubbles: true }));
    expect(nonIncreasing(metric('data-blast'))).toBe(true); // now ranked by blast
  });

  it('renders a reviewed checkbox per step inside the card footer', () => {
    const { plan, doc } = renderInDom('rate-limit');
    expect(doc.querySelectorAll('.card-foot input.reviewed').length).toBe(
      plan.stats.entityCount,
    );
  });

  it('clicking a dependency link pops a preview ("below" mode -> inline)', () => {
    const { dom, doc } = renderInDom('rate-limit');
    // force "below" mode (default is now "right")
    const below = doc.querySelector('input[name="prl-mode"][value="below"]') as HTMLInputElement;
    below.checked = true;
    below.dispatchEvent(new dom.window.Event('change', { bubbles: true }));
    expect(doc.querySelectorAll('.embed').length).toBe(0);
    const link = doc.querySelector('a.dep-link') as HTMLElement;
    expect(link).toBeTruthy();
    link.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true, cancelable: true }));
    expect(doc.querySelectorAll('.embed').length).toBe(1);
    // below mode inserts inline (not into the dock)
    expect(doc.querySelectorAll('.steps .embed').length).toBe(1);
    // the preview is a clone of a step card and itself carries a reviewed box
    expect(doc.querySelectorAll('.embed .step-card').length).toBe(1);
    expect(doc.querySelectorAll('.embed input.reviewed').length).toBeGreaterThan(0);
    // clicking the same link again closes it
    link.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true, cancelable: true }));
    expect(doc.querySelectorAll('.embed').length).toBe(0);
  });

  it("a preview's title arrow jumps to and flashes the real step in the main list", () => {
    const { dom, doc } = renderInDom('rate-limit');
    const link = doc.querySelector('a.dep-link') as HTMLElement;
    const targetSel = link.getAttribute('href')!; // #step-N (the real step in main)
    link.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true, cancelable: true }));
    // the ↗ arrow inside the preview clone (no dedicated "focus in main" button)
    const arrow = doc.querySelector('.embed a.step-focus') as HTMLElement;
    expect(arrow).toBeTruthy();
    const target = doc.querySelector(targetSel) as HTMLElement;
    expect(target.classList.contains('prl-flash')).toBe(false);
    arrow.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true, cancelable: true }));
    expect(target.classList.contains('prl-flash')).toBe(true);
    expect(target.hasAttribute('open')).toBe(true);
  });

  it('shows a review-progress pill that updates as steps are reviewed', () => {
    const { plan, dom, doc } = renderInDom('rate-limit');
    const pill = doc.getElementById('prl-progress');
    expect(pill).toBeTruthy();
    const text = () => pill!.querySelector('.prl-progress-text')!.textContent!;
    expect(text()).toBe(`0 reviewed · ${plan.stats.entityCount} unreviewed`);
    // review one step
    const box = doc.querySelector('.step-row > .step-card input.reviewed') as HTMLInputElement;
    box.checked = true;
    box.dispatchEvent(new dom.window.Event('change', { bubbles: true }));
    expect(text()).toBe(`1 reviewed · ${plan.stats.entityCount - 1} unreviewed`);
  });

  it('"Diff view" setting toggles side-by-side (body class + both layouts present)', () => {
    const { dom, doc } = renderInDom('rate-limit');
    expect(doc.querySelectorAll('input[name="prl-diff"]').length).toBe(2);
    // both layouts are emitted from the same diff
    expect(doc.querySelector('.diff .diff-unified')).toBeTruthy();
    expect(doc.querySelector('.diff .diff-split .drow')).toBeTruthy();
    expect(doc.body.classList.contains('prl-split')).toBe(false); // unified default
    const split = doc.querySelector('input[name="prl-diff"][value="split"]') as HTMLInputElement;
    split.checked = true;
    split.dispatchEvent(new dom.window.Event('change', { bubbles: true }));
    expect(doc.body.classList.contains('prl-split')).toBe(true);
  });

  it('"hide reviewed steps" toggles a body class and ships the scoped CSS', () => {
    const { dom, doc } = renderInDom('rate-limit');
    const hide = doc.getElementById('prl-hide-reviewed') as HTMLInputElement;
    expect(hide).toBeTruthy();
    expect(doc.body.classList.contains('prl-hide-reviewed')).toBe(false);
    hide.checked = true;
    hide.dispatchEvent(new dom.window.Event('change', { bubbles: true }));
    expect(doc.body.classList.contains('prl-hide-reviewed')).toBe(true);
    // the hide rule is scoped to canonical rows (> .step-card), not previews
    const css = doc.querySelector('style')!.textContent!;
    expect(css).toContain('body.prl-hide-reviewed .step-row:has(> .step-card .reviewed:checked)');
  });

  it('title arrow focuses its step and does NOT toggle the card', () => {
    const { dom, doc } = renderInDom('rate-limit');
    const arrow = doc.querySelector('a.step-focus') as HTMLElement;
    expect(arrow).toBeTruthy();
    const card = arrow.closest('.step-card') as HTMLElement;
    expect(card.hasAttribute('open')).toBe(true); // open by default
    arrow.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true, cancelable: true }));
    expect(card.hasAttribute('open')).toBe(true); // preventDefault kept it open
    expect(card.classList.contains('prl-flash')).toBe(true); // and it flashed
  });

  it('switching the setting to "right" docks the preview instead', () => {
    const { dom, doc } = renderInDom('rate-limit');
    const right = doc.querySelector('input[name="prl-mode"][value="right"]') as HTMLInputElement;
    right.checked = true;
    right.dispatchEvent(new dom.window.Event('change', { bubbles: true }));
    const link = doc.querySelector('a.dep-link') as HTMLElement;
    link.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true, cancelable: true }));
    const dock = doc.getElementById('prl-dock');
    expect(dock).toBeTruthy();
    expect(dock!.querySelectorAll('.embed').length).toBe(1);
  });
});
