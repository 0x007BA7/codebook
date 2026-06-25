// `import * as React` keeps this component working under BOTH the classic JSX
// runtime (tsx/esbuild, used by the eval harness) and the automatic runtime
// (Vite/Vitest). Without it, classic-runtime renders fail: "React is not defined".
import * as React from 'react';
import type { ReactElement } from 'react';
import type { ReadingPlan, ReadingStep, Cluster, Category } from '@prl/contracts';
import { parsePatch, diffLines, splitRows } from './linediff.js';

void React;

// ============================================================================
// The reading spine (§8.2/§8.3). Renders from a ReadingPlan and NOTHING else.
//
// Layout: steps are GROUPED BY FILE, files ordered by total fan-out (sum of
// each entity's recursive dependency count) descending — the most entangled
// files first. Step numbers remain the canonical topological reading-order
// positions (so the #step-N anchors and dependency previews still work).
// Cycle members get a "↻" badge (a contiguous enclosure no longer fits a
// file-grouped layout). Rows flow; an expanded card never overlaps the next.
// ============================================================================

const CATEGORY_COLOR: Record<Category, string> = {
  logic: '#2f6f4f',
  config: '#8a6d1f',
  test: '#6a3a8a',
  wiring: '#1f5d8a',
};
const DEFAULT_COLOR = '#555';
const categoryColor = (c: Category | undefined): string =>
  c ? CATEGORY_COLOR[c] : DEFAULT_COLOR;

interface FileGroup {
  file: string;
  fanout: number; // Σ recursive dependencies (fan-out)
  blast: number; // Σ recursive dependents (blast radius)
  steps: ReadingStep[];
}

/** Group steps by file. Initial order is by fan-out desc (the Settings panel's
 *  rank control can re-order to blast radius client-side via data attributes). */
function fileGroups(plan: ReadingPlan): FileGroup[] {
  const byFile = new Map<string, ReadingStep[]>();
  for (const s of plan.steps) {
    let arr = byFile.get(s.entity.file);
    if (!arr) byFile.set(s.entity.file, (arr = []));
    arr.push(s);
  }
  const groups: FileGroup[] = [...byFile.entries()].map(([file, steps]) => ({
    file,
    steps: [...steps].sort((a, b) => a.order - b.order),
    fanout: steps.reduce((n, s) => n + s.recursiveDeps, 0),
    blast: steps.reduce((n, s) => n + s.recursiveDependents, 0),
  }));
  groups.sort((a, b) => b.fanout - a.fanout || (a.file < b.file ? -1 : a.file > b.file ? 1 : 0));
  return groups;
}

// Tiny, language-agnostic, dependency-free tokenizer: splits a line into code /
// string / comment runs. Good enough to color comments and strings differently
// (handles // line comments, /* */ blocks, #/`*` full-line comments, and
// '/"/` strings with escapes). Not a full parser — just readable highlighting.
type Tok = { t: 'code' | 'str' | 'com'; v: string };
function tokenizeCode(s: string): Tok[] {
  const trimmed = s.replace(/^\s*/, '');
  if (trimmed.startsWith('#') || trimmed.startsWith('*')) return [{ t: 'com', v: s }];
  const out: Tok[] = [];
  let code = '';
  let i = 0;
  const flush = (): void => {
    if (code) out.push({ t: 'code', v: code });
    code = '';
  };
  while (i < s.length) {
    const c = s[i];
    if (c === '/' && s[i + 1] === '/' && s[i - 1] !== ':') {
      flush();
      out.push({ t: 'com', v: s.slice(i) });
      return out;
    }
    if (c === '/' && s[i + 1] === '*') {
      flush();
      const end = s.indexOf('*/', i + 2);
      const stop = end === -1 ? s.length : end + 2;
      out.push({ t: 'com', v: s.slice(i, stop) });
      i = stop;
      continue;
    }
    if (c === '"' || c === "'" || c === '`') {
      flush();
      let j = i + 1;
      while (j < s.length) {
        if (s[j] === '\\') {
          j += 2;
          continue;
        }
        if (s[j] === c) {
          j++;
          break;
        }
        j++;
      }
      out.push({ t: 'str', v: s.slice(i, j) });
      i = j;
      continue;
    }
    code += c;
    i++;
  }
  flush();
  return out;
}

/** Syntax-highlight one line's text into spans (single-line tokenizer). */
function hlTokens(text: string): React.ReactNode {
  if (text === '') return ' ';
  return tokenizeCode(text).map((tok, k) =>
    tok.t === 'code' ? (
      <React.Fragment key={k}>{tok.v}</React.Fragment>
    ) : (
      <span key={k} className={tok.t === 'com' ? 'tok-com' : 'tok-str'}>
        {tok.v}
      </span>
    ),
  );
}

/** Earliest triple-quote (`"""` or `'''`) on a line, if any. */
function findTriple(s: string): { delim: string; idx: number } | null {
  const a = s.indexOf('"""');
  const b = s.indexOf("'''");
  if (a === -1 && b === -1) return null;
  if (a === -1) return { delim: "'''", idx: b };
  if (b === -1) return { delim: '"""', idx: a };
  return a < b ? { delim: '"""', idx: a } : { delim: "'''", idx: b };
}

/**
 * Highlight one line given the current triple-quoted ("docstring") state.
 * `doc` is the open delimiter or null. Returns the rendered node and the new
 * state. Only triple-quotes change state, so ordinary code is unaffected.
 */
function hlLine(text: string, doc: string | null): { node: React.ReactNode; doc: string | null } {
  if (doc) {
    const close = text.indexOf(doc);
    if (close === -1) {
      return { node: <span className="tok-str">{text === '' ? ' ' : text}</span>, doc };
    }
    const inside = text.slice(0, close + 3);
    const rest = text.slice(close + 3);
    return {
      node: (
        <>
          <span className="tok-str">{inside}</span>
          {hlTokens(rest)}
        </>
      ),
      doc: null,
    };
  }
  const m = findTriple(text);
  if (!m) return { node: hlTokens(text), doc: null };
  const after = text.indexOf(m.delim, m.idx + 3);
  if (after !== -1) {
    // opens and closes on the same line -> a normal (single-line) string
    return {
      node: (
        <>
          {hlTokens(text.slice(0, m.idx))}
          <span className="tok-str">{text.slice(m.idx, after + 3)}</span>
          {hlTokens(text.slice(after + 3))}
        </>
      ),
      doc: null,
    };
  }
  // opens a multi-line block: rest of the line is string, stay "in docstring"
  return {
    node: (
      <>
        {hlTokens(text.slice(0, m.idx))}
        <span className="tok-str">{text.slice(m.idx)}</span>
      </>
    ),
    doc: m.delim,
  };
}
const SIGN = { same: ' ', del: '-', add: '+' } as const;

/**
 * Renders the real line diff (unchanged lines as context, only true changes
 * colored). Emits BOTH a unified and a side-by-side layout from the same diff;
 * CSS shows one based on `body.prl-split` (the "Diff view" setting).
 */
function Diff({ patch }: { patch: string }): ReactElement {
  const { oldL, newL } = parsePatch(patch);
  const ops = diffLines(oldL, newL);
  const rows = splitRows(ops);

  // Thread triple-quoted ("docstring") state across lines so Python multi-line
  // strings highlight correctly. Unified is one stream; split has separate
  // old/new streams.
  let uDoc: string | null = null;
  const unified = ops.map((op, i) => {
    const r = hlLine(op.text, uDoc);
    uDoc = r.doc;
    return (
      <div className={`diff-line ${op.type}`} key={i}>
        <span className={`diff-sign ${op.type}`}>{SIGN[op.type]}</span>
        {r.node}
      </div>
    );
  });

  let oDoc: string | null = null;
  let nDoc: string | null = null;
  const split = rows.map((r, i) => {
    let oldNode: React.ReactNode = '';
    if (r.old) {
      const x = hlLine(r.old.text, oDoc);
      oDoc = x.doc;
      oldNode = (
        <>
          <span className={`diff-sign ${r.old.type}`}>{SIGN[r.old.type]}</span>
          {x.node}
        </>
      );
    }
    let newNode: React.ReactNode = '';
    if (r.new) {
      const y = hlLine(r.new.text, nDoc);
      nDoc = y.doc;
      newNode = (
        <>
          <span className={`diff-sign ${r.new.type}`}>{SIGN[r.new.type]}</span>
          {y.node}
        </>
      );
    }
    return (
      <div className="drow" key={i}>
        <pre className={`dcell ${r.old ? r.old.type : 'empty'}`}>{oldNode}</pre>
        <pre className={`dcell ${r.new ? r.new.type : 'empty'}`}>{newNode}</pre>
      </div>
    );
  });

  return (
    <div className="diff" data-diff="">
      <pre className="diff-unified">{unified}</pre>
      <div className="diff-split" aria-hidden="true">
        {split}
      </div>
    </div>
  );
}

function StepCard({
  step,
  cluster,
  nameOf,
  orderOf,
}: {
  step: ReadingStep;
  cluster: Cluster | undefined;
  nameOf: Map<string, string>;
  orderOf: Map<string, number>;
}): ReactElement {
  const e = step.entity;
  const added = e.hunks.reduce((n, h) => n + h.added, 0);
  const removed = e.hunks.reduce((n, h) => n + h.removed, 0);

  const coMembers =
    cluster && cluster.isCycle
      ? cluster.entityIds.filter((id) => id !== e.id).map((id) => nameOf.get(id) ?? id)
      : [];

  return (
    <details
      className="step-card"
      id={`step-${step.order}`}
      data-order={step.order}
      data-category={e.category ?? 'none'}
      open
    >
      <summary style={{ borderLeft: `4px solid ${categoryColor(e.category)}` }}>
        <span className="step-title">
          <span className="step-name">{e.name}</span>
          <a
            className="step-focus"
            href={`#step-${step.order}`}
            title="focus this step in the main list"
            aria-label="focus in main list"
          >
            ↗
          </a>
        </span>
        {cluster && cluster.isCycle && (
          <span className="cycle-badge" data-cycle-rel={cluster.cycleRel} title={`read together with ${coMembers.join(', ')}`}>
            ↻ {cluster.cycleRel}
          </span>
        )}
        <span className="step-delta">
          <span className="add">+{added}</span> <span className="del">−{removed}</span>
        </span>
      </summary>

      <div className="card-foot">
        <div className="foot-left">
          {step.dependsOn.length > 0 && (
            <span className="deps">
              depends on{' '}
              {step.dependsOn.map((id, i) => (
                <React.Fragment key={id}>
                  {i > 0 && ', '}
                  <a className="dep-link" href={`#step-${orderOf.get(id)}`} data-dep={orderOf.get(id)}>
                    {nameOf.get(id) ?? id}
                  </a>
                </React.Fragment>
              ))}
              <span className="deps-hint"> · click to preview</span>
            </span>
          )}
          {step.dependents.length > 0 && (
            <details className="dependents">
              <summary>
                used by {step.dependents.length} {step.dependents.length === 1 ? 'entity' : 'entities'}
              </summary>
              <ul className="dep-list">
                {step.dependents.map((id) => (
                  <li key={id}>
                    <a className="dep-link" href={`#step-${orderOf.get(id)}`} data-dep={orderOf.get(id)}>
                      {nameOf.get(id) ?? id}
                    </a>
                  </li>
                ))}
              </ul>
            </details>
          )}
        </div>
        <label className="reviewed-wrap">
          <input
            type="checkbox"
            className="reviewed"
            data-entity={e.id}
            aria-label={`mark ${e.name} reviewed`}
          />
          reviewed
        </label>
      </div>

      <div className="hunks">
        {e.hunks.map((h, i) => (
          <div className="hunk" key={i} data-hunk={i}>
            <div className="hunk-head">
              <code>
                {h.file}:{h.startLine}–{h.endLine}
              </code>
              <span className="hunk-delta">
                +{h.added} −{h.removed}
              </span>
            </div>
            {h.patch !== undefined && <Diff patch={h.patch} />}
          </div>
        ))}
      </div>
    </details>
  );
}

export function Legend(): ReactElement {
  return (
    <div className="legend" role="note">
      {(Object.keys(CATEGORY_COLOR) as Category[]).map((c) => (
        <span className="legend-item" key={c}>
          <span className="swatch" style={{ background: CATEGORY_COLOR[c] }} /> {c}
        </span>
      ))}
    </div>
  );
}

export function Spine({ plan }: { plan: ReadingPlan }): ReactElement {
  const groups = fileGroups(plan);
  const clusterByIndex = new Map<number, Cluster>(plan.clusters.map((c) => [c.index, c]));
  const nameOf = new Map<string, string>(plan.steps.map((s) => [s.entity.id, s.entity.name]));
  const orderOf = new Map<string, number>(plan.steps.map((s) => [s.entity.id, s.order]));

  return (
    <div className="spine" data-step-count={plan.steps.length} data-layout="by-file">
      <div className="steps">
        {groups.map((g) => (
          <div
            className="file-group"
            key={g.file}
            data-file={g.file}
            data-fanout={g.fanout}
            data-blast={g.blast}
          >
            <div className="file-head">
              <span className="file-name">{g.file}</span>
              <span className="file-count">
                {g.steps.length} {g.steps.length === 1 ? 'entity' : 'entities'}
              </span>
            </div>
            {g.steps.map((s) => (
              <div className="step-row" key={s.order}>
                <div className="gutter">
                  <span className="step-num" aria-label={`step ${s.order}`}>
                    {s.order}
                  </span>
                </div>
                <StepCard
                  step={s}
                  cluster={clusterByIndex.get(s.clusterIndex)}
                  nameOf={nameOf}
                  orderOf={orderOf}
                />
              </div>
            ))}
          </div>
        ))}
      </div>
    </div>
  );
}
