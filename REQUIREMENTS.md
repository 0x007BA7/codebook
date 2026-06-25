# PR Linearizer — Requirements & Build Spec

**Guiding goal:** turn a large pull request into a single, sensible *reading order* — a linear sequence of changed code entities where every dependency is read before the thing that depends on it — so a 2000+ line diff can be read top to bottom instead of jumped around.

**Who builds this:** Claude Code, working in a loop. This document is written so the agent can self-check after every change and so a human can eyeball progress without reading code.

**Read this doc in order.** Sections 3–6 are the contract and algorithm (the part that must be correct). Sections 11–14 are how correctness is enforced and observed. If something here is ambiguous, prefer the choice that makes output *deterministic* and *testable*.

---

## 1. Problem

AI coding agents produce large PRs. GitHub's diff view lists files alphabetically, which is the worst possible order for understanding: you meet callers before the functions they call, tests before the code under test, wiring before the thing being wired. The reader rebuilds the dependency structure in their head, every time.

A PR's changes form a directed graph (entity A depends on entity B if A calls/uses/imports B). The reading order we want is a **topological sort** of that graph restricted to the changed entities — a "linearization." Cycles (mutual recursion, circular imports) are collapsed into clusters that are read as a unit.

## 2. Scope

**In scope (v1):**
- Ingest a PR (a git repo + base ref + head ref), extract changed entities and the dependency edges among them.
- Compute a deterministic reading plan: ordered clusters of entities, with hunk-level detail.
- Serve that plan over HTTP and render it as an interactive "reading spine" in a web app.
- Keep the core logic UI-agnostic so a VS Code extension can reuse it unchanged.

**Out of scope (v1), explicitly:**
- Writing review comments, AI summaries, or LLM-generated prose. (Hooks are allowed; see §8.4. The linearization itself must be deterministic and LLM-free.)
- Multi-repo / cross-repo dependency tracking.
- Languages beyond what the ingest backend supports.
- Authentication, multi-user, persistence/database. v1 runs locally against a checked-out repo.
- Posting back to GitHub/GitLab.

## 3. Concepts & definitions

- **Entity** — a named, addressable unit of code: a function, method, class, type, or top-level constant. The granularity is whatever the ingest backend (`sem`) reports.
- **Changed set (C)** — the set of entities touched by the PR (added, modified, or deleted).
- **Dependency edge (u → v)** — entity `u` references entity `v` (calls, instantiates, uses the type of, imports). Semantics: **v should be read before u.**
- **Changed-subgraph (G)** — the directed graph whose nodes are `C` and whose edges are dependency edges where *both* endpoints are in `C`. Edges to unchanged code are dropped (they don't affect reading order within the PR).
- **Cluster** — a strongly connected component (SCC) of `G`. A cluster of size 1 is a normal entity. A cluster of size > 1 is a cycle that must be read together because no internal order is valid.
- **Reading plan** — the ordered list of clusters plus per-entity hunks. The output artifact. See §5.2.

## 4. Architecture

A monorepo with a hard boundary between **pure logic** and **everything that does I/O**. The pure core is what makes this both testable and portable.

```
pr-linearizer/
├── packages/
│   ├── core/          # PURE. No Node APIs, no fs, no network, no sem. Browser-safe.
│   │   └── linearize: GraphInput -> ReadingPlan. SCC + topo + deterministic tiebreak.
│   ├── contracts/     # Zod schemas + inferred TS types for GraphInput and ReadingPlan.
│   ├── ingest/        # Side-effectful. Turns a real PR into a GraphInput.
│   │   ├── SemIngestor       # shells out to `sem`
│   │   └── FixtureIngestor   # reads a committed *.graph.json (no sem, no git needed)
│   ├── server/        # Fastify HTTP API. Wraps ingest + core. Serves ReadingPlan JSON.
│   ├── web/           # React + Vite. Renders the spine from a ReadingPlan. UI only.
│   └── cli/           # Thin wrapper over ingest+core for dogfooding and the eval harness.
├── fixtures/          # Golden inputs and expected outputs (see §11.3).
├── eval/              # Eval harness output: scorecard.json + report.html.
├── CLAUDE.md          # Agent operating manual (see §13.1).
├── STATUS.md          # Milestone checklist the agent keeps current (see §14.2).
├── Makefile           # Single entry points (see §13.2).
└── REQUIREMENTS.md    # This file.
```

**The portability rule:** `core` and `contracts` must import nothing platform-specific. The web app and the future VS Code extension both consume the same `ReadingPlan` JSON and may share the same React spine component. `core` runs identically in a browser, in Node, and in the VS Code extension host. Any `import` of `node:fs`, `node:child_process`, `process`, DOM, or `vscode` inside `core` or `contracts` is a build failure (enforce with a lint rule / dependency-cruiser check — see §11.6).

**Language:** TypeScript end to end. This is the pragmatic choice for VS Code portability (extension host is Node/TS; webview is web). `core` does not need tree-sitter directly because `sem` does the parsing.

## 5. Data contracts (the linchpin)

Both contracts live in `packages/contracts` as Zod schemas; TS types are inferred from them. Every boundary (ingest→core, server→web, fixtures) validates against these at runtime. **Changing a contract is a deliberate, reviewed act**, because golden files and both UIs depend on it.

### 5.1 GraphInput (ingest → core)

```ts
// Normalized, backend-agnostic. SemIngestor and FixtureIngestor both produce this.
EntityId = string            // stable, unique, e.g. "src/limiter/index.ts::RateLimiter.check"

Hunk = {
  file: string
  startLine: number
  endLine: number
  added: number              // lines added
  removed: number            // lines removed
}

ChangeKind = "added" | "modified" | "deleted"

Entity = {
  id: EntityId
  name: string               // display name, e.g. "RateLimiter.check()"
  file: string
  kind: "function" | "method" | "class" | "type" | "const"
  change: ChangeKind
  hunks: Hunk[]              // ordered by startLine
  category?: "logic" | "config" | "test" | "wiring"   // optional; drives color in UI
}

Edge = {
  from: EntityId             // depends on
  to: EntityId               // dependency (read this first)
  rel: "calls" | "uses-type" | "imports" | "tests"
}

GraphInput = {
  schemaVersion: 1
  pr: { repo: string; base: string; head: string }
  entities: Entity[]
  edges: Edge[]              // MAY include edges to entities not in `entities`; core drops those.
}
```

### 5.2 ReadingPlan (core → server → web → VS Code)

```ts
Cluster = {
  index: number              // 0-based position in reading order
  entityIds: EntityId[]      // size 1 = normal; size > 1 = a cycle, deterministic internal order
  isCycle: boolean           // entityIds.length > 1
  cycleRel?: string          // e.g. "mutual recursion" — human label when isCycle
}

ReadingStep = {
  order: number              // 1-based, the number shown on the spine
  entity: Entity             // full entity (denormalized so the UI needs nothing else)
  clusterIndex: number
  dependsOn: EntityId[]      // earlier entities this one needs (for drawing arcs); within-PR only
}

ReadingPlan = {
  schemaVersion: 1
  pr: { repo: string; base: string; head: string }
  clusters: Cluster[]
  steps: ReadingStep[]       // flattened reading order; steps for a cycle are contiguous
  stats: {
    entityCount: number
    clusterCount: number
    cycleCount: number
    maxClusterSize: number
    edgeCount: number        // edges within the changed subgraph
    backwardEdges: number    // MUST be 0 (see Invariant L3)
    totalAdded: number
    totalRemoved: number
  }
}
```

A worked example fixture (`fixtures/rate-limit/`) and its expected `ReadingPlan` ship with the repo so the agent always has one concrete end-to-end reference. (The rate-limiting PR from the design conversation: `RateLimitConfig` → `TokenBucket` → `RateLimiter.check` → {`parseHeaders` ↔ `validateHeaders`} → `rateLimit` middleware → server bootstrap.)

## 6. The linearization algorithm (deterministic spec)

`core.linearize(input: GraphInput): ReadingPlan` does exactly this, in this order:

1. **Restrict.** Build `G` over `C = input.entities`. Drop any edge whose `from` or `to` is not in `C`. De-duplicate parallel edges.
2. **Find SCCs.** Tarjan's algorithm. Each SCC is a cluster. Process nodes in a **sorted** order (by `EntityId`) so SCC discovery is deterministic.
3. **Condense.** Build the condensation DAG `G*` (one node per cluster; an edge between clusters if any edge crosses between them).
4. **Topologically sort `G*`** with **Kahn's algorithm**, but the ready-set is a *priority queue keyed by the cluster's sort key* (not arbitrary). This makes the chosen order the unique deterministic minimum among all valid orders. **Direction:** dependencies first — for a cross-cluster edge u→v (u depends on v), cluster(v) is emitted before cluster(u).
5. **Order within a cluster.** Sort `entityIds` by the entity sort key. (Internal order is arbitrary by definition of a cycle, but must be *stable*.)
6. **Order hunks** within each entity by `startLine`.
7. **Emit** `ReadingPlan`, computing `stats`. Compute `backwardEdges` as the number of cross-cluster edges that violate the order (must be 0 — assert and fail loudly if not).

**Cluster sort key** (the tiebreaker, a total order): `(min file path in cluster, min startLine in cluster, min EntityId in cluster)`, compared lexicographically. Document this in `core` as the single source of truth; tests pin it.

**Entity sort key:** `(file, firstHunk.startLine, id)`.

Cycle detection is not an error. A graph that is already a DAG simply yields all singleton clusters.

## 7. Ingest layer

`Ingestor` is an interface: `ingest(opts): Promise<GraphInput>`. Two implementations:

- **`FixtureIngestor`** — reads a committed `*.graph.json`, validates it against `GraphInput`, returns it. Needs no `sem`, no git, no network. **This is what all core/server/web tests use.** It is the reason the whole stack is testable in CI without external tools.
- **`SemIngestor`** — shells out to `sem` (Ataraxy-Labs/`sem`, or a similar entity-level diff + dependency-graph tool) against a real checkout: get the entity-level diff for `base..head`, get the dependency graph, normalize both into `GraphInput`. All `sem`-specific parsing lives here and nowhere else, so swapping the backend means rewriting only this adapter.

`SemIngestor` must:
- Detect `sem` is installed; if not, exit with a clear, actionable message (how to install) and a distinct exit code.
- Be covered by integration tests that are **skipped automatically when `sem` is unavailable** (so CI stays green; see §11.5). A tiny real git repo is committed under `fixtures/repos/` for these.
- Produce a `GraphInput` that re-validates against the schema.

## 8. Web app requirements

### 8.1 Server API
- `GET /api/health` → `{ ok: true }`.
- `POST /api/reading-plan` body `{ repo, base, head, ingestor?: "sem" | "fixture", fixture?: string }` → `ReadingPlan` JSON (validated before sending).
- `GET /api/reading-plan?fixture=<name>` → convenience for demos; serves the plan for a committed fixture.
- All responses validated against the contract; a validation failure is a 500 with a structured error, never a malformed body.

### 8.2 UI — the reading spine
Render the `ReadingPlan` as the vertical spine from the design:
- A vertical line; each `ReadingStep` is a numbered node on the spine with a card (entity name, file, `+added −removed`).
- Dependency **arcs** drawn on one side, connecting a step to the earlier steps in its `dependsOn`. Because the order is topological, every arc points upward.
- A **cycle cluster** (any `Cluster` with `isCycle`) is visually grouped (e.g. a dashed enclosure) and labeled; its steps are contiguous.
- Color encodes `entity.category` (logic / config / test / wiring) with a one-line legend — **not** the step number.
- **Click a node to expand** it inline and show that entity's hunks (the actual diff). This is the difference between a map and a usable review tool; it is a v1 requirement, not a stretch goal.

### 8.3 The spine component is shared
The spine renders from a `ReadingPlan` and nothing else — no server calls, no Node, no `vscode`. It lives where both the web app and a VS Code webview can import it (e.g. `packages/web/src/Spine.tsx` with zero web-app-only dependencies, or its own `packages/spine`). This keeps the VS Code port to "host the same component in a webview."

### 8.4 LLM captions (optional, gated, off by default)
A per-step "why you're reading this next" caption *may* be added as a presentation layer, behind a flag, consuming the already-computed plan. It must never influence the order. Keep it out of v1's definition of done.

## 9. VS Code portability requirements

We do not build the extension in v1, but we **prove portability** and protect it:
- `core`, `contracts`, and the spine component carry zero platform-specific imports (enforced — §11.6).
- A `ReadingPlan` produced by the CLI must be renderable by the spine component with no transformation.
- Milestone M6 ships a minimal proof: load a fixture `ReadingPlan` and render the spine inside a webview (or a documented spike + test proving the import graph is clean), so the path is known to work.

## 10. Correctness invariants (the testable laws)

These are objective and become the test backbone (§11.2). Let `C` be the changed set and `G` the changed-subgraph.

- **L1 — Completeness.** The multiset of `EntityId`s across all `clusters[].entityIds` equals `C`, each exactly once. (Also equals the set of `steps[].entity.id`.)
- **L2 — Cluster soundness.** Clusters partition `C`, and two entities share a cluster **iff** they are in the same SCC of `G`.
- **L3 — Order validity.** For every edge `u → v` in `G` with `cluster(u) ≠ cluster(v)`, `cluster(v).index < cluster(u).index`. Equivalently, `stats.backwardEdges == 0`.
- **L4 — Acyclic ⇒ singletons.** If `G` is a DAG, every cluster has size 1.
- **L5 — Determinism & order-independence.** `linearize(x)` is byte-identical across runs, **and** identical when `x.entities` and `x.edges` are randomly permuted before input. (This catches reliance on hashmap/iteration order — the most common nondeterminism bug.)
- **L6 — Tiebreak totality.** Among all valid topological orders, the produced order is the unique minimum under the documented cluster sort key (§6).
- **L7 — Locality (quality signal, not pass/fail).** Report mean reading-distance between each entity and its dependencies (lower is better). Tracked over time, not gated.

## 11. Testing requirements

Every package ships tests. `make verify` runs all of them plus typecheck and lint, and is the single gate the agent must keep green.

### 11.1 Unit tests (Vitest)
- `core`: Tarjan SCC, condensation, Kahn with priority ready-set, sort keys, stats computation.
- `contracts`: schemas accept valid and reject malformed inputs (including subtle ones: dangling edge endpoints, negative line numbers, duplicate entity ids).
- `ingest`: `FixtureIngestor` round-trips and validates; `SemIngestor` normalization on captured `sem` output samples (committed JSON, so no `sem` needed for these).

### 11.2 Property tests (fast-check)
Generators produce (a) random DAGs and (b) random graphs with planted cycles, over random entity sets. Assert L1–L6 hold for every generated input. Specifically:
- Feed each generated graph **and a random permutation of it**; assert identical `ReadingPlan` (L5).
- For planted-cycle graphs, assert the clusters equal the planted SCCs (L2).
- Assert `backwardEdges == 0` always (L3).

### 11.3 Golden tests
`fixtures/<case>/` contains `input.graph.json` and `expected.plan.json`. A golden runner linearizes the input and asserts byte-equality with the expected plan. Provide at minimum: `rate-limit` (the worked example), `acyclic-chain`, `single-cycle`, `nested-cycles`, `disconnected-islands`, `large-synthetic` (≥150 entities, generated by a committed seeded script so it's reproducible). Updating a golden is explicit: `make golden-update` regenerates and the diff must be reviewed.

### 11.4 Server contract tests
Spin up Fastify in-process; assert every endpoint returns schema-valid bodies and correct status codes, including the validation-failure path.

### 11.5 Integration tests (gated)
`SemIngestor` against the committed tiny git repo under `fixtures/repos/`. **Auto-skip with a logged reason when `sem` is not on `PATH`** so CI and the no-network sandbox stay green. When run, assert the produced `GraphInput` validates and that core then satisfies L1–L6 on it.

### 11.6 Boundary/architecture tests
A `dependency-cruiser` (or equivalent) rule fails the build if `core` or `contracts` import any of: `node:*`, `vscode`, DOM globals, the server, or the web app. This is what protects portability mechanically rather than by discipline.

### 11.7 E2E (Playwright)
Load the web app against a fixture plan; assert the spine renders the right number of nodes, the cycle cluster is grouped, arcs exist, and clicking a node expands its hunks.

### 11.8 No-network rule
The entire test suite (everything except §11.5 when `sem` happens to be present) runs with no network and no external binaries. Tests that need `sem` are the only exception and they self-skip.

## 12. Determinism requirements

- No reliance on `Object` key order, `Set`/`Map` iteration order, or unstable `sort`. Always sort by an explicit total comparator.
- No timestamps, random IDs, absolute paths, or environment values in `ReadingPlan`. Paths are repo-relative.
- Serialize JSON with sorted object keys in golden output so byte-equality is stable.
- The synthetic fixture generator takes a fixed seed.
- L5 (order-independence) is the canary; if it ever fails, determinism is broken somewhere.

## 13. Setup for Claude Code's loop

The point of this section is a **tight, automated feedback loop**: one command tells the agent whether it's done, and exit codes carry the signal.

### 13.1 `CLAUDE.md` (the agent must create and maintain this)
Contents:
- The build/test commands (mirror the Makefile).
- "**Before claiming any task complete, run `make verify` and paste the summary.**"
- The invariants L1–L6 restated as the definition of correct.
- The determinism rule and the no-network rule.
- Where fixtures live and **how to add one** (`make new-fixture name=...` scaffolds `input.graph.json` + regenerates `expected.plan.json`).
- The portability rule (§4) and that §11.6 enforces it.
- A note: prefer fixing the algorithm over editing a golden; only update goldens via `make golden-update` with a justification in the commit body.

### 13.2 Makefile targets (single source of truth)
- `make setup` — install deps.
- `make build` — build all packages.
- `make typecheck` — tsc across the monorepo.
- `make lint` — eslint + the §11.6 boundary check.
- `make test` — all Vitest unit/property/golden/contract tests.
- `make e2e` — Playwright.
- `make verify` — `typecheck && lint && test && e2e`. **Exit nonzero on any failure.** This is the loop gate.
- `make eval` — run the eval harness (§13.3); write `eval/scorecard.json` and `eval/report.html`; exit nonzero if any fixture fails L1–L6 or determinism.
- `make serve` — start the server.
- `make demo` — start server + web, open the browser on the `rate-limit` fixture plan.
- `make golden-update`, `make new-fixture name=...`, `make status`, `make clean`.

### 13.3 Eval harness (`packages/cli` + `eval/`)
Runs `linearize` over every fixture and emits:
- `eval/scorecard.json`:
  ```json
  {
    "generatedFrom": "fixtures",
    "fixtures": [
      { "name": "rate-limit", "entities": 7, "clusters": 6, "cycles": 1,
        "maxClusterSize": 2, "backwardEdges": 0,
        "laws": { "L1": "pass", "L2": "pass", "L3": "pass",
                  "L4": "n/a", "L5": "pass", "L6": "pass" },
        "localityMean": 1.4, "goldenMatch": true }
    ],
    "totals": { "fixtures": 6, "passed": 6, "failed": 0 },
    "determinismCheck": "pass"
  }
  ```
- `eval/report.html`: per fixture, the **rendered spine** (reuse the spine component, server-render or screenshot) next to a pass/fail badge table for L1–L6 and golden match, plus the totals. This is the human's at-a-glance progress view (§14).

Exit code: 0 only if `totals.failed == 0` and `determinismCheck == "pass"`.

### 13.4 What "good loop" looks like for the agent
Implement core → run `make verify` → run `make eval` → read `scorecard.json` → if any law fails, the failing fixture name + law points straight at the bug → fix → repeat. The agent should never need to ask the human to interpret results; the scorecard is machine- and human-readable.

## 14. Making progress easy for the human to evaluate

### 14.1 Milestones (each has ONE command to verify and a visible artifact)

| # | Milestone | Verify command | Done when |
|---|-----------|----------------|-----------|
| M0 | Scaffold + CI | `make verify` | Monorepo builds; a trivial test passes; `make verify` is green. |
| M1 | Contracts + fixtures | `make test` | Zod schemas exist; `rate-limit` and edge-case fixtures validate; schema tests pass. |
| M2 | Core linearizer | `make eval` | L1–L6 pass on all fixtures via property + golden tests; `scorecard.json` all green; determinism passes. |
| M3 | Ingest (fixture + sem) | `make test` (+ `make test` with `sem` present) | `FixtureIngestor` fully tested; `SemIngestor` integration test passes when `sem` available, auto-skips otherwise. |
| M4 | Server API | `make serve` then `curl :PORT/api/reading-plan?fixture=rate-limit` | Endpoint returns a schema-valid `ReadingPlan`; contract tests pass. |
| M5 | Web spine | `make demo` | Browser shows the rate-limit spine; cycle grouped; arcs drawn; clicking a node expands its hunks; Playwright e2e passes. |
| M6 | VS Code readiness | `make verify` + documented spike | Boundary tests prove `core`/`contracts`/spine are platform-clean; a webview (or documented spike + test) renders a fixture plan. |

### 14.2 `STATUS.md` (agent keeps current)
A checklist mirroring the milestone table, each line checked off only when its verify command passes, with the date and the commit hash. `make status` regenerates it by actually running the smoke checks — so it can't drift from reality.

### 14.3 Visual progress
`eval/report.html` is the primary "is it working and does it look right" surface. After M2 it shows correct spines for every fixture; after M5 it's the real component. The human opens one file.

### 14.4 Commit discipline
Conventional commits; every commit keeps `make verify` green; milestone-completing commits say so in the subject. Small, reviewable commits over big drops.

## 15. Tech stack & conventions

- **Language/build:** TypeScript, monorepo via pnpm (or npm) workspaces, `tsc` project references.
- **Tests:** Vitest (unit/property/golden/contract), fast-check (property), Playwright (e2e).
- **Schema:** Zod in `contracts`; types inferred, never hand-duplicated.
- **Server:** Fastify. **Web:** React + Vite. **CLI:** a small `bin` over `ingest` + `core`.
- **Architecture enforcement:** dependency-cruiser (or eslint import boundaries) for §11.6.
- **Style:** the design tokens and spine styling follow the existing visual design; no gradients/shadows; color encodes category. (See the project's frontend-design conventions.)
- **No network or external binaries in tests** except the gated `sem` integration tests.

## 16. Definition of done (v1)

1. `make verify` and `make eval` both green, with `eval/scorecard.json` showing all fixtures passing L1–L6 and determinism.
2. `make demo` opens a working spine on the `rate-limit` fixture, including click-to-expand hunks and a grouped, labeled cycle cluster.
3. `core` and `contracts` have zero platform-specific imports, enforced by a passing boundary test; the spine renders from a plan alone.
4. `SemIngestor` works against a real checkout when `sem` is installed; integration tests pass there and auto-skip elsewhere.
5. `STATUS.md` reflects M0–M5 complete (M6 = portability proven) and was generated by `make status`, not hand-edited.
6. A human can clone, run `make setup && make demo`, and read a linearized PR without reading any source.

---

### Appendix A — minimal `rate-limit` GraphInput (abridged)

```json
{
  "schemaVersion": 1,
  "pr": { "repo": "example/api", "base": "main", "head": "feat/rate-limit" },
  "entities": [
    { "id": "src/config/rateLimit.ts::RateLimitConfig", "name": "RateLimitConfig",
      "file": "src/config/rateLimit.ts", "kind": "type", "change": "added",
      "category": "config", "hunks": [{ "file": "src/config/rateLimit.ts", "startLine": 1, "endLine": 18, "added": 18, "removed": 0 }] },
    { "id": "src/limiter/bucket.ts::TokenBucket", "name": "TokenBucket",
      "file": "src/limiter/bucket.ts", "kind": "class", "change": "added",
      "category": "logic", "hunks": [{ "file": "src/limiter/bucket.ts", "startLine": 1, "endLine": 64, "added": 64, "removed": 0 }] },
    { "id": "src/http/headers.ts::parseHeaders", "name": "parseHeaders()",
      "file": "src/http/headers.ts", "kind": "function", "change": "modified",
      "category": "logic", "hunks": [{ "file": "src/http/headers.ts", "startLine": 10, "endLine": 62, "added": 52, "removed": 12 }] },
    { "id": "src/http/headers.ts::validateHeaders", "name": "validateHeaders()",
      "file": "src/http/headers.ts", "kind": "function", "change": "modified",
      "category": "logic", "hunks": [{ "file": "src/http/headers.ts", "startLine": 70, "endLine": 107, "added": 37, "removed": 4 }] }
  ],
  "edges": [
    { "from": "src/limiter/bucket.ts::TokenBucket", "to": "src/config/rateLimit.ts::RateLimitConfig", "rel": "uses-type" },
    { "from": "src/http/headers.ts::parseHeaders", "to": "src/http/headers.ts::validateHeaders", "rel": "calls" },
    { "from": "src/http/headers.ts::validateHeaders", "to": "src/http/headers.ts::parseHeaders", "rel": "calls" }
  ]
}
```

`parseHeaders` ↔ `validateHeaders` form a 2-element cycle → one cluster, `isCycle: true`. `TokenBucket` depends on `RateLimitConfig` → config is read first. The full fixture adds `RateLimiter.check`, the `rateLimit` middleware, and the server bootstrap to complete the chain shown in the design.

### Appendix B — sort keys (pin these in tests)
- Cluster sort key: `(min file, min startLine, min EntityId)` lexicographic.
- Entity sort key: `(file, firstHunk.startLine, id)`.
- JSON golden serialization: object keys sorted, 2-space indent, trailing newline.
