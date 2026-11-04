import type { ReactElement } from 'react';
import type { Competitor } from '@competitor-pulse/shared';

const competitors: readonly Competitor[] = [];

export function App(): ReactElement {
  return (
    <main>
      <h1>CompetitorPulse</h1>
      <ul>
        {competitors.map((competitor) => (
          <li key={competitor.id}>{competitor.id}</li>
        ))}
      </ul>
    </main>
  );
}
