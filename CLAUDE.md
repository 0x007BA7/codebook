# CLAUDE.md — agent operating manual

This repo turns a large PR into a single **reading order**: a topological sort of
the changed code entities so dependencies are read before their dependents.
Cycles collapse into clusters. See `REQUIREMENTS.md` for the full spec.

## The one rule

**Before claiming any task complete, run `make verify` and paste the summary.**
`make verify` = `typecheck && lint && test`. It exits nonzero on any failure and
is the single gate. Then run `make eval` and read `eval/scorecard.json`.

## Commands (mirror of the Makefile)

| command | what |
|---|---|
| `make setup` | install deps (`npm install`) |
| `make verify` | **the loop gate**: typecheck + lint + test |
| `make test` | all Vitest unit/property/golden/contract/spine tests |
| `make eval` | run linearize over every fixture → `eval/scorecard.json` + `eval/report.html` |
| `make typecheck` | per-package `tsc --noEmit` (keeps lib isolation) |
| `make lint` | eslint + the §11.6 dependency-cruiser boundary check |
| `make serve` | start the Fastify API (`PORT`, default 8787) |
| `make demo` | server + web on the rate-limit fixture, opens the browser |
| `make golden-update` | regenerate every `expected.plan.json` (review the diff!) |
| `make new-fixture name=foo` | scaffold a fixture + generate its golden |
| `make gen-large` | regenerate the seeded `large-synthetic` input |
| `make status` | regenerate `STATUS.md` by running the smoke checks |

## Definition of correct — the invariants (§10)

`linearize(input)` must satisfy, for changed set `C` and changed-subgraph `G`:

- **L1 Completeness** — every entity appears in exactly one cluster (== steps).
- **L2 Cluster soundness** — two entities share a cluster **iff** same SCC of `G`;
  and `cluster.isCycle === (entityIds.length > 1)`.
- **L3 Order validity** — every cross-cluster edge `u→v` has
  `cluster(v).index < cluster(u).index`; `stats.backwardEdges == 0`.
- **L4 Acyclic ⇒ singletons** — a DAG yields only size-1 clusters.
- **L5 Determinism & order-independence** — byte-identical across runs **and**
  under random permutation of `entities`/`edges`. This is the canary.
- **L6 Tiebreak totality** — the produced order is the unique minimum under the
  cluster sort key.
- **L7 Locality** — reported (mean reading distance), tracked, not gated.

`packages/core/src/invariants.ts::checkLaws` is an **independent oracle** for
L1–L4, L6, L7 (it re-derives facts without calling `linearize`). Property tests,
golden tests, and the eval harness all use it.

## Determinism rule (§12) & no-network rule (§11.8)

- Sort by explicit total comparators only — never rely on `Object`/`Map`/`Set`
  iteration order or unstable `sort`. (eslint forbids `Math.random`/`Date.now`
  in shipped code.)
- No timestamps, random ids, or absolute paths in a `ReadingPlan`. Paths are
  repo-relative. Golden JSON is key-sorted, 2-space, trailing newline
  (`stableStringify`).
- The whole test suite runs with **no network and no external binaries**. The
  only exception is the `sem` integration test, which **auto-skips** when `sem`
  is not on `PATH`.

## Sort keys (pinned in tests — Appendix B)

- **Cluster key**: `(min file, min startLine, min EntityId)` lexicographic.
- **Entity key**: `(file, firstHunk.startLine, id)`.

## Fixtures

Live in `fixtures/<case>/` as `input.graph.json` + `expected.plan.json`. Add one
with `make new-fixture name=...`. **Prefer fixing the algorithm over editing a
golden.** Only update goldens via `make golden-update`, and justify the change in
the commit body. `large-synthetic` is generated from a fixed seed
(`scripts/gen-large.ts`).

## Portability rule (§4, enforced by §11.6)

`packages/core`, `packages/contracts`, and `packages/web/src/Spine.tsx` carry
**zero** platform-specific imports (no `node:*`, no `vscode`, no DOM, no
server/web/ingest). `make lint`'s dependency-cruiser pass fails the build if
violated. The spine renders from a `ReadingPlan` alone, so a VS Code webview can
reuse it unchanged.

## Layout

```
packages/
  contracts/  Zod schemas + inferred types (the linchpin)
  core/       PURE linearize + Tarjan SCC + Kahn + invariant oracle
  ingest/     FixtureIngestor (tests) + SemIngestor (shells out, auto-skips)
  server/     Fastify API (buildApp is injectable for contract tests)
  web/        React + Vite; Spine.tsx is the shared, platform-clean component
  cli/        codebook binary + the eval harness (eval.ts)
fixtures/     golden inputs + expected outputs
eval/         scorecard.json + report.html (the human's at-a-glance view)
```
