import { describe, it, expect } from 'vitest';
import { parsePatch, diffLines, splitRows } from './linediff.js';

describe('diffLines (LCS)', () => {
  it('marks unchanged lines as context, only real changes as del/add', () => {
    const ops = diffLines(['a', 'b', 'c'], ['a', 'B', 'c']);
    expect(ops).toEqual([
      { type: 'same', text: 'a' },
      { type: 'del', text: 'b' },
      { type: 'add', text: 'B' },
      { type: 'same', text: 'c' },
    ]);
  });

  it('treats a sem block patch (whole old then whole new) correctly', () => {
    const { oldL, newL } = parsePatch(
      ['-function f() {', '-  return 1;', '-}', '+function f() {', '+  return 2;', '+}'].join('\n'),
    );
    const ops = diffLines(oldL, newL);
    // the signature and closing brace are unchanged; only the body line changed
    expect(ops.filter((o) => o.type === 'same').map((o) => o.text)).toEqual(['function f() {', '}']);
    expect(ops.filter((o) => o.type === 'del').map((o) => o.text)).toEqual(['  return 1;']);
    expect(ops.filter((o) => o.type === 'add').map((o) => o.text)).toEqual(['  return 2;']);
  });

  it('handles pure additions and deletions', () => {
    expect(diffLines([], ['x']).every((o) => o.type === 'add')).toBe(true);
    expect(diffLines(['x'], []).every((o) => o.type === 'del')).toBe(true);
  });
});

describe('splitRows', () => {
  it('aligns a change block (del[i] | add[i]) and keeps context paired', () => {
    const rows = splitRows(diffLines(['a', 'b', 'c'], ['a', 'B', 'c']));
    expect(rows).toEqual([
      { old: { type: 'same', text: 'a' }, new: { type: 'same', text: 'a' } },
      { old: { type: 'del', text: 'b' }, new: { type: 'add', text: 'B' } },
      { old: { type: 'same', text: 'c' }, new: { type: 'same', text: 'c' } },
    ]);
  });

  it('pads the shorter side with null when del/add counts differ', () => {
    const rows = splitRows(diffLines(['a'], ['a', 'b', 'c']));
    expect(rows[1]).toEqual({ old: null, new: { type: 'add', text: 'b' } });
    expect(rows[2]).toEqual({ old: null, new: { type: 'add', text: 'c' } });
  });
});
