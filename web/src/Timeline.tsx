import type { Snapshot } from '@competitor-pulse/shared';
import { useEffect, useState, type ReactElement } from 'react';
import { Link, useParams } from 'react-router';
import { errorMessage, listSnapshots } from './api';

const REFETCH_MS = 5000;
// The API returns full history without a limit, which would grow without bound
// on a page that refetches every 5s.
const PAGE_SIZE = 100;

function SummaryLine({ snapshot }: { snapshot: Snapshot }): ReactElement {
  switch (snapshot.summaryStatus) {
    case 'none':
      return <p>No change since previous snapshot</p>;
    case 'pending':
      return <p>Summary pending…</p>;
    case 'failed':
      return <p>Summary failed</p>;
    case 'done':
      return (
        <p>
          <em>{snapshot.summary}</em>
        </p>
      );
  }
}

function CompetitorTimeline({ id }: { id: string }): ReactElement {
  const [snapshots, setSnapshots] = useState<Snapshot[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [limit, setLimit] = useState(PAGE_SIZE);

  useEffect(() => {
    let active = true;
    let timer: ReturnType<typeof setTimeout> | undefined;

    // Schedules the next fetch only after this one ends, so a slow response
    // can't overlap the next request or overwrite a newer one.
    async function load(): Promise<void> {
      try {
        const loaded = await listSnapshots(id, limit);
        if (active) {
          setSnapshots(loaded);
          setError(null);
        }
      } catch (loadError) {
        if (active) {
          setError(errorMessage(loadError));
        }
      }
      if (active) {
        timer = setTimeout(() => {
          void load();
        }, REFETCH_MS);
      }
    }

    void load();
    return () => {
      active = false;
      clearTimeout(timer);
    };
  }, [id, limit]);

  return (
    <section>
      <Link to="/">← Back to competitors</Link>
      <h2>{id}</h2>

      {error !== null && <p role="alert">{error}</p>}

      {snapshots === null && error === null && <p>Loading…</p>}
      {snapshots?.length === 0 && <p>No snapshots yet.</p>}
      {snapshots !== null && snapshots.length > 0 && (
        <ul className="timeline">
          {snapshots.map((snapshot) => (
            <li key={snapshot.fetchedAt}>
              <time dateTime={snapshot.fetchedAt}>
                {new Date(snapshot.fetchedAt).toLocaleString()}
              </time>
              <div>
                <strong>{snapshot.title}</strong> — {snapshot.tagline}
              </div>
              <div>{snapshot.price}</div>
              <div>{snapshot.description}</div>
              <SummaryLine snapshot={snapshot} />
            </li>
          ))}
        </ul>
      )}

      {snapshots !== null && snapshots.length >= limit && (
        <button
          type="button"
          onClick={() => {
            setLimit(limit + PAGE_SIZE);
          }}
        >
          Show older
        </button>
      )}
    </section>
  );
}

export function Timeline(): ReactElement {
  const { id = '' } = useParams();
  // The key starts fresh for another competitor, so its timeline never shows
  // the previous one's snapshots while loading.
  return <CompetitorTimeline key={id} id={id} />;
}
