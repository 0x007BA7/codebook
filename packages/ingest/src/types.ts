import type { GraphInput } from '@prl/contracts';

/** Options accepted by any ingest backend. Backends use what they need. */
export interface IngestOpts {
  repo?: string;
  base?: string;
  head?: string;
  /** Fixture name (FixtureIngestor) — folder under fixtures/. */
  fixture?: string;
  /** Working directory of the checkout (SemIngestor). */
  cwd?: string;
  /**
   * Diff the local working tree instead of a base..head ref range (SemIngestor):
   * "working" = all uncommitted changes vs HEAD, "staged" = staged changes only.
   * When set, base/head are ignored.
   */
  scope?: 'working' | 'staged';
}

/**
 * The ingest abstraction (§7). Both FixtureIngestor and SemIngestor produce a
 * normalized, backend-agnostic GraphInput so core never knows the backend.
 */
export interface Ingestor {
  readonly name: string;
  ingest(opts: IngestOpts): Promise<GraphInput>;
}

/** Thrown by SemIngestor when `sem` is not installed (distinct exit code). */
export class SemUnavailableError extends Error {
  readonly exitCode = 69; // EX_UNAVAILABLE
  constructor(message: string) {
    super(message);
    this.name = 'SemUnavailableError';
  }
}
