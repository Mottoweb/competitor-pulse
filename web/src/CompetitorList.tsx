import { useEffect, useState, type FormEvent, type ReactElement } from 'react';
import { Link } from 'react-router';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  addCompetitor,
  errorMessage,
  type Competitor,
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
    <section className="flex flex-col gap-6">
      <form onSubmit={handleAdd} className="flex flex-col gap-2">
        <Label htmlFor="competitor-id">Competitor id</Label>
        <div className="flex gap-2">
          <Input
            id="competitor-id"
            value={draft}
            onChange={(event) => {
              setDraft(event.target.value);
            }}
            placeholder="acme-crm"
            required
          />
          <Button type="submit" disabled={busy}>
            Add
          </Button>
        </div>
      </form>

      {error !== null && (
        <Alert variant="destructive">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}

      {competitors === null && error === null && (
        <p className="text-sm text-muted-foreground">Loading…</p>
      )}
      {competitors?.length === 0 && (
        <p className="text-sm text-muted-foreground">No competitors tracked yet.</p>
      )}
      {competitors !== null && competitors.length > 0 && (
        <Card className="gap-0 py-0">
          <ul className="divide-y">
            {competitors.map(({ id }) => (
              <li key={id} className="flex items-center justify-between gap-4 px-4 py-2">
                <Link
                  to={`/competitors/${encodeURIComponent(id)}`}
                  className="min-w-0 font-medium break-words hover:underline"
                >
                  {id}
                </Link>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  disabled={busy}
                  onClick={() => {
                    if (window.confirm(`Remove ${id} and delete its history?`)) {
                      void change(() => removeCompetitor(id));
                    }
                  }}
                >
                  Remove
                </Button>
              </li>
            ))}
          </ul>
        </Card>
      )}
    </section>
  );
}
