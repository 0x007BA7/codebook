// Pure line-level diff (LCS) used to render the actual changed/unchanged lines.
// The sem patch stacks the whole old block (− lines) then the whole new block
// (+ lines); this recovers which lines are genuinely unchanged vs changed.

export type DiffOp = { type: 'same' | 'del' | 'add'; text: string };

/** Split a unified-ish patch into its old and new line sequences. */
export function parsePatch(patch: string): { oldL: string[]; newL: string[] } {
  const oldL: string[] = [];
  const newL: string[] = [];
  for (const line of patch.replace(/\n$/, '').split('\n')) {
    const s = line[0];
    const text = s === '+' || s === '-' || s === ' ' ? line.slice(1) : line;
    if (s === '-') oldL.push(text);
    else if (s === '+') newL.push(text);
    else {
      oldL.push(text);
      newL.push(text);
    }
  }
  return { oldL, newL };
}

/** Longest-common-subsequence line diff: same / del / add ops in order. */
export function diffLines(a: string[], b: string[]): DiffOp[] {
  const m = a.length;
  const n = b.length;
  const dp: Int32Array[] = Array.from({ length: m + 1 }, () => new Int32Array(n + 1));
  for (let i = m - 1; i >= 0; i--) {
    for (let j = n - 1; j >= 0; j--) {
      dp[i]![j] = a[i] === b[j] ? dp[i + 1]![j + 1]! + 1 : Math.max(dp[i + 1]![j]!, dp[i]![j + 1]!);
    }
  }
  const ops: DiffOp[] = [];
  let i = 0;
  let j = 0;
  while (i < m && j < n) {
    if (a[i] === b[j]) {
      ops.push({ type: 'same', text: a[i]! });
      i++;
      j++;
    } else if (dp[i + 1]![j]! >= dp[i]![j + 1]!) {
      ops.push({ type: 'del', text: a[i]! });
      i++;
    } else {
      ops.push({ type: 'add', text: b[j]! });
      j++;
    }
  }
  while (i < m) ops.push({ type: 'del', text: a[i++]! });
  while (j < n) ops.push({ type: 'add', text: b[j++]! });
  return ops;
}

export type SplitRow = { old: DiffOp | null; new: DiffOp | null };

/** Pair ops into aligned side-by-side rows (old | new). */
export function splitRows(ops: DiffOp[]): SplitRow[] {
  const rows: SplitRow[] = [];
  let k = 0;
  while (k < ops.length) {
    const op = ops[k]!;
    if (op.type === 'same') {
      rows.push({ old: op, new: op });
      k++;
      continue;
    }
    const dels: DiffOp[] = [];
    const adds: DiffOp[] = [];
    while (k < ops.length && ops[k]!.type === 'del') dels.push(ops[k++]!);
    while (k < ops.length && ops[k]!.type === 'add') adds.push(ops[k++]!);
    const max = Math.max(dels.length, adds.length);
    for (let r = 0; r < max; r++) rows.push({ old: dels[r] ?? null, new: adds[r] ?? null });
  }
  return rows;
}
