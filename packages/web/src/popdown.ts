// Spine interactions. Self-contained (no imports, no references to anything
// outside this function) so it works two ways: imported and called by the
// React app, AND serialized via .toString() into the standalone HTML the CLI
// `render` emits. Everything lives in nested declarations inside initSpine.
//
//  - Settings panel: switch dependency-preview mode between "drop below"
//    (indented block under the step) and "drop to the right" (a docked panel).
//    The choice persists in localStorage.
//  - Click a "depends on ↑N" link -> clone step N's card as a preview, in the
//    chosen mode. RECURSIVE: links inside a preview pop their own deps. Click
//    the link again, or the preview's ×, to close it.
//  - Each card (and each preview clone) has a "reviewed" checkbox; state
//    persists in localStorage keyed by entity id and syncs across duplicates.
export function initSpinePopdowns(): void {
  const spine = document.querySelector('.spine') as HTMLElement | null;
  if (!spine) return;

  function getMode(): string {
    // Default to "right" (the dock); only "below" if explicitly chosen.
    try {
      return localStorage.getItem('prl-preview-mode') === 'below' ? 'below' : 'right';
    } catch (_e) {
      return 'right';
    }
  }

  // Reserve right-hand space (shift main content left) only while the dock has
  // previews, so the spine isn't cramped under the fixed dock.
  function updateDock(): void {
    const d = document.getElementById('prl-dock');
    const active = !!(d && d.querySelector('.embed'));
    document.body.classList.toggle('prl-docked', active);
    if (d) d.style.display = active ? '' : 'none';
  }

  // Scroll the main spine to a step, expand it, and briefly flash it.
  function focusStep(order: string): void {
    const t = document.getElementById('step-' + order);
    if (!t) return;
    t.setAttribute('open', '');
    if (typeof t.scrollIntoView === 'function') {
      t.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }
    t.classList.add('prl-flash');
    setTimeout(function () {
      t.classList.remove('prl-flash');
    }, 1400);
  }

  // Floating review-progress pill (bottom-right). Counts only the canonical
  // step cards (direct children of a .step-row), never preview clones. Click
  // jumps to the next unreviewed step.
  function canonicalBoxes(): NodeListOf<HTMLInputElement> {
    return document.querySelectorAll('.step-row > .step-card input.reviewed');
  }
  function updateProgress(): void {
    const el = document.getElementById('prl-progress');
    if (!el) return;
    const boxes = canonicalBoxes();
    let done = 0;
    for (let i = 0; i < boxes.length; i++) if (boxes[i]!.checked) done++;
    const total = boxes.length;
    const text = el.querySelector('.prl-progress-text');
    if (text) {
      text.textContent =
        total > 0 && done === total
          ? '✓ all ' + total + ' reviewed'
          : done + ' reviewed · ' + (total - done) + ' unreviewed';
    }
    el.classList.toggle('prl-complete', total > 0 && done === total);
  }
  function ensureProgress(): void {
    if (document.getElementById('prl-progress')) {
      updateProgress();
      return;
    }
    const b = document.createElement('button');
    b.id = 'prl-progress';
    b.className = 'prl-progress';
    b.title = 'jump to the next unreviewed step';
    b.innerHTML = '<span class="prl-progress-text"></span>';
    b.addEventListener('click', function () {
      const boxes = canonicalBoxes();
      for (let i = 0; i < boxes.length; i++) {
        if (!boxes[i]!.checked) {
          const card = boxes[i]!.closest('.step-card');
          const id = card && card.id ? card.id.replace('step-', '') : '';
          if (id) focusStep(id);
          return;
        }
      }
    });
    document.body.appendChild(b);
    updateProgress();
  }

  function getRank(): string {
    try {
      return localStorage.getItem('prl-rank') === 'blast' ? 'blast' : 'fanout';
    } catch (_e) {
      return 'fanout';
    }
  }
  // Reorder file groups by the chosen metric (data-fanout / data-blast), desc,
  // tie-broken by file path. Pure DOM reordering so it works in the standalone.
  function applyRanking(): void {
    const steps = document.querySelector('.steps');
    if (!steps) return;
    const attr = getRank() === 'blast' ? 'data-blast' : 'data-fanout';
    const groups: HTMLElement[] = [];
    const kids = steps.children;
    for (let i = 0; i < kids.length; i++) {
      const k = kids[i] as HTMLElement;
      if (k.classList && k.classList.contains('file-group')) groups.push(k);
    }
    groups.sort(function (a, b) {
      const av = parseInt(a.getAttribute(attr) || '0', 10);
      const bv = parseInt(b.getAttribute(attr) || '0', 10);
      if (bv !== av) return bv - av;
      const af = a.getAttribute('data-file') || '';
      const bf = b.getAttribute('data-file') || '';
      return af < bf ? -1 : af > bf ? 1 : 0;
    });
    for (let i = 0; i < groups.length; i++) steps.appendChild(groups[i]!);
  }

  function clearEmbeds(): void {
    const es = document.querySelectorAll('.embed');
    for (let i = 0; i < es.length; i++) {
      const n = es[i];
      if (n && n.parentNode) n.parentNode.removeChild(n);
    }
    const ls = document.querySelectorAll('a.dep-link.dep-open');
    for (let j = 0; j < ls.length; j++) {
      const l = ls[j] as HTMLElement;
      l.classList.remove('dep-open');
      l.removeAttribute('data-embed-id');
    }
    updateDock();
  }

  function clampWidth(px: number): number {
    const max = Math.round((typeof window !== 'undefined' ? window.innerWidth : 1200) * 0.8);
    return Math.max(340, Math.min(px, max));
  }
  function getDockWidth(): number {
    try {
      const v = parseInt(localStorage.getItem('prl-dock-width') || '0', 10);
      if (v >= 340) return clampWidth(v);
    } catch (_e) {
      /* ignore */
    }
    return 620; // wider default
  }
  function setDockWidth(px: number): void {
    const w = clampWidth(px);
    document.body.style.setProperty('--prl-dock-w', w + 'px');
    try {
      localStorage.setItem('prl-dock-width', String(w));
    } catch (_e) {
      /* ignore */
    }
  }

  function dock(): HTMLElement {
    let d = document.getElementById('prl-dock');
    if (!d) {
      d = document.createElement('div');
      d.id = 'prl-dock';
      d.className = 'prl-dock';
      setDockWidth(getDockWidth());
      // left-edge drag handle to resize the panel
      const resizer = document.createElement('div');
      resizer.className = 'prl-dock-resizer';
      resizer.title = 'drag to resize';
      resizer.addEventListener('pointerdown', function (ev) {
        ev.preventDefault();
        document.body.classList.add('prl-resizing');
        const move = function (e: PointerEvent): void {
          setDockWidth(window.innerWidth - e.clientX);
        };
        const up = function (): void {
          document.removeEventListener('pointermove', move);
          document.removeEventListener('pointerup', up);
          document.body.classList.remove('prl-resizing');
        };
        document.addEventListener('pointermove', move);
        document.addEventListener('pointerup', up);
      });
      d.appendChild(resizer);
      const h = document.createElement('div');
      h.className = 'prl-dock-hdr';
      const t = document.createElement('span');
      t.textContent = 'dependency previews';
      const clr = document.createElement('button');
      clr.className = 'embed-close';
      clr.textContent = 'clear all';
      clr.addEventListener('click', function () {
        clearEmbeds();
      });
      h.appendChild(t);
      h.appendChild(clr);
      d.appendChild(h);
      document.body.appendChild(d);
    }
    return d as HTMLElement;
  }

  function bindReviewed(scope: ParentNode): void {
    const boxes = scope.querySelectorAll('input.reviewed');
    for (let j = 0; j < boxes.length; j++) {
      const box = boxes[j] as HTMLInputElement;
      const id = box.getAttribute('data-entity') || '';
      try {
        if (id && localStorage.getItem('prl-reviewed:' + id) === '1') box.checked = true;
      } catch (_e) {
        /* localStorage may be unavailable */
      }
      if (box.getAttribute('data-bound')) continue;
      box.setAttribute('data-bound', '1');
      box.addEventListener('change', function (this: HTMLInputElement) {
        const eid = this.getAttribute('data-entity') || '';
        try {
          if (eid) {
            if (this.checked) localStorage.setItem('prl-reviewed:' + eid, '1');
            else localStorage.removeItem('prl-reviewed:' + eid);
          }
        } catch (_e) {
          /* ignore */
        }
        // keep every copy of this entity's checkbox (clones) in sync
        const all = document.querySelectorAll('input.reviewed');
        for (let m = 0; m < all.length; m++) {
          const b = all[m] as HTMLInputElement;
          if (b.getAttribute('data-entity') === eid) b.checked = this.checked;
        }
        updateProgress();
      });
    }
  }

  function buildEmbed(depOrder: string, target: HTMLElement, origin: HTMLElement): HTMLElement {
    const wrap = document.createElement('div');
    wrap.className = 'embed';
    const label = document.createElement('div');
    label.className = 'embed-label';
    const span = document.createElement('span');
    span.textContent = '↑ step ' + depOrder + ' — dependency';
    // (No "focus in main" button: the ↗ arrow on the clone's title already
    // jumps to the real step in the main list.)
    const close = document.createElement('button');
    close.className = 'embed-close';
    close.textContent = '×';
    close.addEventListener('click', function () {
      origin.classList.remove('dep-open');
      origin.removeAttribute('data-embed-id');
      if (wrap.parentNode) wrap.parentNode.removeChild(wrap);
      updateDock();
    });
    label.appendChild(span);
    label.appendChild(close);

    const clone = target.cloneNode(true) as HTMLElement;
    clone.removeAttribute('id');
    clone.setAttribute('open', '');
    const withId = clone.querySelectorAll('[id]');
    for (let i = 0; i < withId.length; i++) {
      const n = withId[i];
      if (n) n.removeAttribute('id');
    }
    const dl = clone.querySelectorAll('a.dep-link'); // reset so nested links work
    for (let k = 0; k < dl.length; k++) {
      const a2 = dl[k] as HTMLElement;
      a2.classList.remove('dep-open');
      a2.removeAttribute('data-embed-id');
    }
    const rb = clone.querySelectorAll('input.reviewed'); // re-bind cloned boxes
    for (let r = 0; r < rb.length; r++) (rb[r] as HTMLElement).removeAttribute('data-bound');

    wrap.appendChild(label);
    wrap.appendChild(clone);
    bindReviewed(wrap);
    return wrap;
  }

  // --- click delegation (document-level, attached once: also catches the dock) ---
  if (!document.documentElement.getAttribute('data-prl-init')) {
    document.documentElement.setAttribute('data-prl-init', '1');
    let counter = 0;
    document.addEventListener('click', function (ev) {
      const el = ev.target as HTMLElement | null;
      if (!el || !el.closest) return;
      // title arrow: focus this step in the main list (don't toggle the card)
      const fa = el.closest('a.step-focus') as HTMLElement | null;
      if (fa) {
        ev.preventDefault();
        focusStep((fa.getAttribute('href') || '').replace('#step-', ''));
        return;
      }
      const a = el.closest('a.dep-link') as HTMLElement | null;
      if (!a) return;
      ev.preventDefault();

      const openId = a.getAttribute('data-embed-id');
      if (openId) {
        const existing = document.getElementById(openId);
        if (existing && existing.parentNode) existing.parentNode.removeChild(existing);
        a.removeAttribute('data-embed-id');
        a.classList.remove('dep-open');
        updateDock();
        return;
      }
      const depOrder = (a.getAttribute('href') || '').replace('#step-', '');
      const target = document.getElementById('step-' + depOrder) as HTMLElement | null;
      if (!target) return;

      const id = 'embed-' + ++counter;
      const wrap = buildEmbed(depOrder, target, a);
      wrap.id = id;

      if (getMode() === 'right') {
        dock().appendChild(wrap);
        updateDock();
      } else {
        const anchor = (a.closest('.embed') || a.closest('.step-row')) as HTMLElement | null;
        if (!anchor || !anchor.parentNode) return;
        let depth = 0;
        let p: HTMLElement | null = anchor;
        while (p) {
          if (p.classList && p.classList.contains('embed')) depth++;
          p = p.parentNode as HTMLElement | null;
        }
        wrap.style.marginLeft = 44 + depth * 18 + 'px';
        anchor.parentNode.insertBefore(wrap, anchor.nextSibling);
      }
      a.setAttribute('data-embed-id', id);
      a.classList.add('dep-open');
    });
  }

  // --- settings dropdown (idempotent; reflects + persists choices) ---
  function syncSettings(): void {
    const modeR = document.querySelectorAll('input[name="prl-mode"]');
    for (let i = 0; i < modeR.length; i++) {
      const rb = modeR[i] as HTMLInputElement;
      rb.checked = rb.value === getMode();
    }
    const rankR = document.querySelectorAll('input[name="prl-rank"]');
    for (let i = 0; i < rankR.length; i++) {
      const rb = rankR[i] as HTMLInputElement;
      rb.checked = rb.value === getRank();
    }
    let hide = false;
    try {
      hide = localStorage.getItem('prl-hide-reviewed') === '1';
    } catch (_e) {
      /* ignore */
    }
    const hideBox = document.getElementById('prl-hide-reviewed') as HTMLInputElement | null;
    if (hideBox) hideBox.checked = hide;
    document.body.classList.toggle('prl-hide-reviewed', hide); // CSS hides reviewed rows

    let split = false;
    try {
      split = localStorage.getItem('prl-diff') === 'split';
    } catch (_e) {
      /* ignore */
    }
    const diffR = document.querySelectorAll('input[name="prl-diff"]');
    for (let i = 0; i < diffR.length; i++) {
      const rb = diffR[i] as HTMLInputElement;
      rb.checked = rb.value === (split ? 'split' : 'unified');
    }
    document.body.classList.toggle('prl-split', split); // CSS picks unified vs side-by-side
  }
  if (!document.getElementById('prl-settings') && spine.parentNode) {
    const panel = document.createElement('details');
    panel.id = 'prl-settings';
    panel.className = 'prl-settings';
    panel.innerHTML =
      '<summary class="prl-settings-title">⚙ Settings</summary>' +
      '<div class="prl-settings-body">' +
      '<div class="prl-setting"><span class="prl-setting-label">Rank files by</span>' +
      '<label><input type="radio" name="prl-rank" value="fanout"> dependencies (fan-out)</label>' +
      '<label><input type="radio" name="prl-rank" value="blast"> blast radius (dependents)</label></div>' +
      '<div class="prl-setting"><span class="prl-setting-label">Preview dependency as</span>' +
      '<label><input type="radio" name="prl-mode" value="below"> drop below</label>' +
      '<label><input type="radio" name="prl-mode" value="right"> drop to the right</label></div>' +
      '<div class="prl-setting"><span class="prl-setting-label">Diff view</span>' +
      '<label><input type="radio" name="prl-diff" value="unified"> unified</label>' +
      '<label><input type="radio" name="prl-diff" value="split"> side-by-side</label></div>' +
      '<div class="prl-setting"><span class="prl-setting-label">Main panel</span>' +
      '<label><input type="checkbox" id="prl-hide-reviewed"> hide reviewed steps</label></div>' +
      '</div>';
    spine.parentNode.insertBefore(panel, spine);

    const diffRadios = panel.querySelectorAll('input[name="prl-diff"]');
    for (let i = 0; i < diffRadios.length; i++) {
      const r = diffRadios[i];
      if (!r) continue;
      r.addEventListener('change', function (this: HTMLInputElement) {
        if (!this.checked) return;
        try {
          localStorage.setItem('prl-diff', this.value);
        } catch (_e) {
          /* ignore */
        }
        document.body.classList.toggle('prl-split', this.value === 'split');
      });
    }

    const hideBox = panel.querySelector('#prl-hide-reviewed');
    if (hideBox) {
      hideBox.addEventListener('change', function (this: HTMLInputElement) {
        try {
          localStorage.setItem('prl-hide-reviewed', this.checked ? '1' : '0');
        } catch (_e) {
          /* ignore */
        }
        document.body.classList.toggle('prl-hide-reviewed', this.checked);
      });
    }

    const modeRadios = panel.querySelectorAll('input[name="prl-mode"]');
    for (let i = 0; i < modeRadios.length; i++) {
      const r = modeRadios[i];
      if (!r) continue;
      r.addEventListener('change', function (this: HTMLInputElement) {
        if (!this.checked) return;
        try {
          localStorage.setItem('prl-preview-mode', this.value);
        } catch (_e) {
          /* ignore */
        }
        clearEmbeds(); // mode changed — drop open previews so the next click uses it
      });
    }
    const rankRadios = panel.querySelectorAll('input[name="prl-rank"]');
    for (let i = 0; i < rankRadios.length; i++) {
      const r = rankRadios[i];
      if (!r) continue;
      r.addEventListener('change', function (this: HTMLInputElement) {
        if (!this.checked) return;
        try {
          localStorage.setItem('prl-rank', this.value);
        } catch (_e) {
          /* ignore */
        }
        applyRanking();
      });
    }
  }
  syncSettings();

  // --- bind list, apply ranking, clear stale previews from a prior render ---
  clearEmbeds();
  bindReviewed(spine);
  applyRanking();
  ensureProgress();
}
