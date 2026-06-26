import { useEffect, useState, type ReactElement } from 'react';
import type { ReadingPlan } from '@codebook/contracts';
import { Spine, Legend } from './Spine.js';
import { initSpinePopdowns } from './popdown.js';

const params = new URLSearchParams(window.location.search);
const initialFixture = params.get('fixture') ?? 'rate-limit';

export function App(): ReactElement {
  const [fixtures, setFixtures] = useState<string[]>([]);
  const [fixture, setFixture] = useState(initialFixture);
  const [plan, setPlan] = useState<ReadingPlan | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetch('/api/fixtures')
      .then((r) => r.json())
      .then((d: { fixtures: string[] }) => setFixtures(d.fixtures))
      .catch(() => setFixtures([initialFixture]));
  }, []);

  useEffect(() => {
    setError(null);
    setPlan(null);
    fetch(`/api/reading-plan?fixture=${encodeURIComponent(fixture)}`)
      .then(async (r) => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        return (await r.json()) as ReadingPlan;
      })
      .then(setPlan)
      .catch((e: unknown) => setError(e instanceof Error ? e.message : String(e)));
  }, [fixture]);

  // Wire dependency-link click-to-preview once the spine is in the DOM.
  useEffect(() => {
    if (plan) initSpinePopdowns();
  }, [plan]);

  return (
    <div className="app">
      <header className="topbar">
        <h1>Codebook</h1>
        <label>
          fixture{' '}
          <select value={fixture} onChange={(e) => setFixture(e.target.value)}>
            {(fixtures.length ? fixtures : [fixture]).map((f) => (
              <option key={f} value={f}>
                {f}
              </option>
            ))}
          </select>
        </label>
        <Legend />
      </header>

      {error && (
        <p className="error">
          Could not load plan: {error}. Is the API server running (<code>make serve</code>)?
        </p>
      )}

      {plan && (
        <>
          <p className="stats">
            {plan.stats.entityCount} entities · {plan.stats.clusterCount} clusters ·{' '}
            {plan.stats.cycleCount} cycle(s) · backwardEdges {plan.stats.backwardEdges} ·{' '}
            <span className="add">+{plan.stats.totalAdded}</span>{' '}
            <span className="del">−{plan.stats.totalRemoved}</span>
          </p>
          <Spine plan={plan} />
        </>
      )}
    </div>
  );
}
