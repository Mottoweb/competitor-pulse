import type { Competitor } from '@competitor-pulse/shared';
import { useEffect, useState, type FormEvent, type ReactElement } from 'react';
import { Link } from 'react-router';
import {
  addCompetitor,
  errorMessage,
  listCompetitors,
  removeCompetitor,
} from './api';

export function CompetitorList(): ReactElement {
  const [competitors, setCompetitors] = useState<Competitor[] | null>(null);
  const [draft, setDraft] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let active = true;
    listCompetitors().then(
      (loaded) => {
        if (active) {
          setCompetitors(loaded);
        }
      },
      (loadError: unknown) => {
        if (active) {
          setError(errorMessage(loadError));
        }
      },
    );
    return () => {
      active = false;
    };
  }, []);

  /** Runs a change, then shows the list as the server now has it. */
  async function change(action: () => Promise<void>): Promise<void> {
    setBusy(true);
    try {
      await action();
      setCompetitors(await listCompetitors());
      setError(null);
    } catch (changeError) {
      setError(errorMessage(changeError));
    } finally {
      setBusy(false);
    }
  }

  function handleAdd(event: FormEvent): void {
    event.preventDefault();
    void change(async () => {
      await addCompetitor(draft.trim());
      setDraft('');
    });
  }

  return (
    <section>
      <form onSubmit={handleAdd}>
        <label>
          Competitor id{' '}
          <input
            value={draft}
            onChange={(event) => {
              setDraft(event.target.value);
            }}
            placeholder="acme-crm"
            required
          />
        </label>{' '}
        <button type="submit" disabled={busy}>
          Add
        </button>
      </form>

      {error !== null && <p role="alert">{error}</p>}

      {competitors === null && error === null && <p>Loading…</p>}
      {competitors?.length === 0 && <p>No competitors tracked yet.</p>}
      {competitors !== null && competitors.length > 0 && (
        <ul>
          {competitors.map(({ id }) => (
            <li key={id}>
              <Link to={`/competitors/${encodeURIComponent(id)}`}>{id}</Link>{' '}
              <button
                type="button"
                disabled={busy}
                onClick={() => {
                  void change(() => removeCompetitor(id));
                }}
              >
                Remove
              </button>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
