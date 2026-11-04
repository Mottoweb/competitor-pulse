import type { ReactElement } from 'react';
import { Link, Route, Routes } from 'react-router';
import { CompetitorList } from './CompetitorList';
import { Timeline } from './Timeline';

function NotFound(): ReactElement {
  return (
    <section>
      <p>Page not found.</p>
      <Link to="/">← Back to competitors</Link>
    </section>
  );
}

export function App(): ReactElement {
  return (
    <main>
      <h1>CompetitorPulse</h1>
      <Routes>
        <Route path="/" element={<CompetitorList />} />
        <Route path="/competitors/:id" element={<Timeline />} />
        <Route path="*" element={<NotFound />} />
      </Routes>
    </main>
  );
}
