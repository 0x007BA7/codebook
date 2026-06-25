import type { Entity } from '@prl/contracts';

// ============================================================================
// Sort keys (§6, Appendix B) — the single source of truth for tiebreaking.
// Tests pin these. Every comparator is a TOTAL order so output is unique and
// deterministic (no reliance on insertion / hashmap order, §12).
// ============================================================================

/** Deterministic string compare by UTF-16 code unit (locale-independent). */
export const cmpStr = (a: string, b: string): number =>
  a < b ? -1 : a > b ? 1 : 0;

/** Smallest hunk start line of an entity (hunks may be unsorted here). */
export function firstHunkStart(e: Entity): number {
  let min = Infinity;
  for (const h of e.hunks) if (h.startLine < min) min = h.startLine;
  return min === Infinity ? 0 : min;
}

/**
 * Entity sort key (Appendix B): (file, firstHunk.startLine, id).
 * `id` is unique across the changed set, so this is a strict total order.
 */
export function compareEntities(a: Entity, b: Entity): number {
  return (
    cmpStr(a.file, b.file) ||
    firstHunkStart(a) - firstHunkStart(b) ||
    cmpStr(a.id, b.id)
  );
}

/** The per-cluster aggregate used as the cluster tiebreaker. */
export interface ClusterKey {
  minFile: string;
  minStart: number;
  minId: string;
}

/** Cluster sort key (§6): (min file, min startLine, min EntityId) in cluster. */
export function clusterKey(members: Entity[]): ClusterKey {
  let minFile: string | null = null;
  let minStart = Infinity;
  let minId: string | null = null;
  for (const e of members) {
    if (minFile === null || e.file < minFile) minFile = e.file;
    const s = firstHunkStart(e);
    if (s < minStart) minStart = s;
    if (minId === null || e.id < minId) minId = e.id;
  }
  return {
    minFile: minFile ?? '',
    minStart: minStart === Infinity ? 0 : minStart,
    minId: minId ?? '',
  };
}

/** Total order over clusters via their keys (minId is unique => total). */
export function compareClusterKeys(a: ClusterKey, b: ClusterKey): number {
  return (
    cmpStr(a.minFile, b.minFile) ||
    a.minStart - b.minStart ||
    cmpStr(a.minId, b.minId)
  );
}
