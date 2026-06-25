import { cmpStr } from './compare.js';

// ============================================================================
// Tarjan's strongly-connected-components, iterative (no recursion -> no stack
// overflow on large or deep graphs). Roots are visited in SORTED EntityId
// order and each node's neighbours are pre-sorted, so SCC discovery is fully
// deterministic (§6 step 2).
// ============================================================================

/**
 * @param nodeIds  all node ids, ASCENDING (sorted by cmpStr)
 * @param adj      adjacency: node -> out-neighbours (will be sorted in place)
 * @returns        list of SCCs (each a list of ids). Order of the list is not
 *                 relied upon by callers — clusters are re-sorted by key.
 */
export function tarjanScc(
  nodeIds: string[],
  adj: Map<string, string[]>,
): string[][] {
  for (const id of nodeIds) (adj.get(id) ?? []).sort(cmpStr);

  const index = new Map<string, number>();
  const low = new Map<string, number>();
  const onStack = new Set<string>();
  const compStack: string[] = [];
  const sccs: string[][] = [];
  let counter = 0;

  for (const start of nodeIds) {
    if (index.has(start)) continue;

    // Explicit work stack; each frame tracks how far we've walked neighbours.
    const work: Array<{ node: string; i: number }> = [{ node: start, i: 0 }];
    index.set(start, counter);
    low.set(start, counter);
    counter++;
    compStack.push(start);
    onStack.add(start);

    while (work.length > 0) {
      const frame = work[work.length - 1]!;
      const v = frame.node;
      const neighbours = adj.get(v) ?? [];

      if (frame.i < neighbours.length) {
        const w = neighbours[frame.i]!;
        frame.i++;
        if (!index.has(w)) {
          index.set(w, counter);
          low.set(w, counter);
          counter++;
          compStack.push(w);
          onStack.add(w);
          work.push({ node: w, i: 0 });
        } else if (onStack.has(w)) {
          low.set(v, Math.min(low.get(v)!, index.get(w)!));
        }
      } else {
        // Finished exploring v: if it's a root of an SCC, pop the component.
        if (low.get(v) === index.get(v)) {
          const comp: string[] = [];
          for (;;) {
            const w = compStack.pop()!;
            onStack.delete(w);
            comp.push(w);
            if (w === v) break;
          }
          sccs.push(comp);
        }
        work.pop();
        const parent = work[work.length - 1];
        if (parent) {
          low.set(parent.node, Math.min(low.get(parent.node)!, low.get(v)!));
        }
      }
    }
  }

  return sccs;
}
