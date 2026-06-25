import { z } from 'zod';

// ============================================================================
// Data contracts (§5). Zod schemas are the single source of truth; TS types
// are INFERRED from them (§15) and never hand-duplicated. Every boundary
// (ingest -> core, server -> web, fixtures) validates against these at runtime.
// ============================================================================

// ---- GraphInput (ingest -> core), §5.1 -------------------------------------

export const HunkSchema = z
  .object({
    file: z.string().min(1),
    startLine: z.number().int().min(1),
    endLine: z.number().int().min(1),
    added: z.number().int().min(0),
    removed: z.number().int().min(0),
    // Optional unified-diff text for the hunk (lines prefixed +/-/space).
    // When present, the spine renders the actual code on expand (§8.2);
    // when absent it falls back to the range + counts. Keeps older fixtures
    // valid and never affects ordering (core ignores it).
    patch: z.string().optional(),
  })
  .strict()
  .refine((h) => h.endLine >= h.startLine, {
    message: 'endLine must be >= startLine',
    path: ['endLine'],
  });

export const ChangeKindSchema = z.enum(['added', 'modified', 'deleted']);
export const EntityKindSchema = z.enum([
  'function',
  'method',
  'class',
  'type',
  'const',
]);
export const CategorySchema = z.enum(['logic', 'config', 'test', 'wiring']);

export const EntitySchema = z
  .object({
    id: z.string().min(1),
    name: z.string().min(1),
    file: z.string().min(1),
    kind: EntityKindSchema,
    change: ChangeKindSchema,
    hunks: z.array(HunkSchema).min(1),
    category: CategorySchema.optional(),
  })
  .strict();

export const RelSchema = z.enum(['calls', 'uses-type', 'imports', 'tests']);

export const EdgeSchema = z
  .object({
    from: z.string().min(1),
    to: z.string().min(1),
    rel: RelSchema,
  })
  .strict();

export const PrRefSchema = z
  .object({
    repo: z.string().min(1),
    base: z.string().min(1),
    head: z.string().min(1),
  })
  .strict();

export const GraphInputSchema = z
  .object({
    schemaVersion: z.literal(1),
    pr: PrRefSchema,
    entities: z.array(EntitySchema),
    edges: z.array(EdgeSchema),
  })
  .strict()
  // Entity ids must be unique — a duplicate id makes the changed set ill-defined.
  .superRefine((g, ctx) => {
    const seen = new Set<string>();
    for (let i = 0; i < g.entities.length; i++) {
      const id = g.entities[i]!.id;
      if (seen.has(id)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: `duplicate entity id: ${id}`,
          path: ['entities', i, 'id'],
        });
      }
      seen.add(id);
    }
  });

// ---- ReadingPlan (core -> server -> web -> VS Code), §5.2 ------------------

export const ClusterSchema = z
  .object({
    index: z.number().int().min(0),
    entityIds: z.array(z.string().min(1)).min(1),
    isCycle: z.boolean(),
    cycleRel: z.string().optional(),
  })
  .strict()
  .refine((c) => c.isCycle === c.entityIds.length > 1, {
    message: 'isCycle must equal (entityIds.length > 1)',
    path: ['isCycle'],
  });

export const ReadingStepSchema = z
  .object({
    order: z.number().int().min(1),
    entity: EntitySchema,
    clusterIndex: z.number().int().min(0),
    dependsOn: z.array(z.string().min(1)),
    // Direct dependents: entities that depend ON this one (who uses it),
    // within the changed subgraph. Ordered by reading position.
    dependents: z.array(z.string().min(1)),
    // Count of entities this one TRANSITIVELY depends on (fan-out), within the
    // changed subgraph. Drives the "rank by dependencies" view.
    recursiveDeps: z.number().int().min(0),
    // Count of entities that TRANSITIVELY depend on this one (blast radius /
    // impact). Drives the "rank by blast radius" view.
    recursiveDependents: z.number().int().min(0),
  })
  .strict();

export const StatsSchema = z
  .object({
    entityCount: z.number().int().min(0),
    clusterCount: z.number().int().min(0),
    cycleCount: z.number().int().min(0),
    maxClusterSize: z.number().int().min(0),
    edgeCount: z.number().int().min(0),
    backwardEdges: z.number().int().min(0),
    totalAdded: z.number().int().min(0),
    totalRemoved: z.number().int().min(0),
  })
  .strict();

export const ReadingPlanSchema = z
  .object({
    schemaVersion: z.literal(1),
    pr: PrRefSchema,
    clusters: z.array(ClusterSchema),
    steps: z.array(ReadingStepSchema),
    stats: StatsSchema,
  })
  .strict();

// ---- Inferred types (§15: never hand-duplicated) ---------------------------

export type Hunk = z.infer<typeof HunkSchema>;
export type ChangeKind = z.infer<typeof ChangeKindSchema>;
export type EntityKind = z.infer<typeof EntityKindSchema>;
export type Category = z.infer<typeof CategorySchema>;
export type Entity = z.infer<typeof EntitySchema>;
export type Rel = z.infer<typeof RelSchema>;
export type Edge = z.infer<typeof EdgeSchema>;
export type PrRef = z.infer<typeof PrRefSchema>;
export type GraphInput = z.infer<typeof GraphInputSchema>;
export type Cluster = z.infer<typeof ClusterSchema>;
export type ReadingStep = z.infer<typeof ReadingStepSchema>;
export type Stats = z.infer<typeof StatsSchema>;
export type ReadingPlan = z.infer<typeof ReadingPlanSchema>;
export type EntityId = string;

// ---- Parse helpers (throw with a readable message on failure) --------------

export function parseGraphInput(data: unknown): GraphInput {
  return GraphInputSchema.parse(data);
}

export function parseReadingPlan(data: unknown): ReadingPlan {
  return ReadingPlanSchema.parse(data);
}

/**
 * Strict structural check for an ingest backend's output: in addition to the
 * base schema, flag edges whose endpoints reference unknown entities. Core
 * *drops* such edges by design (§5.1), so this is opt-in — used by ingest
 * tests and the SemIngestor sanity pass, not by core.
 */
export function findDanglingEdges(g: GraphInput): Edge[] {
  const ids = new Set(g.entities.map((e) => e.id));
  return g.edges.filter((e) => !ids.has(e.from) || !ids.has(e.to));
}
