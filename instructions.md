# Home Assignment – Fullstack Developer (Backend Focus)

## Overview

- Build **CompetitorPulse**: a small system that tracks competitor product listings over time and uses an LLM to explain, in plain English, what changed between two consecutive snapshots.
- This is a **backend-focused** fullstack role: most of the evaluation weight is on your backend design (persistence, scheduling, and how you integrate the LLM call). You'll also build a small React frontend — kept intentionally simple, but real enough that we can look at your frontend work too.
- Time estimate: ~3 hours.
- AI tools expected — we're evaluating your judgment, not typing speed. Note which ones you used in your README.

## How the System Works

1. A user can **add or remove a tracked competitor** by id (e.g. `acme-crm`) via an API or a simple UI form.
2. For each tracked competitor, your backend **periodically fetches its current listing** (title, tagline, price, description) from the data source described below, and compares it to the previous snapshot for that competitor.
3. Whenever the fetched listing **differs** from the previous snapshot, your backend calls an **LLM** to generate a short, plain-English summary of what changed (e.g. _"Price dropped from $39/mo to $29/mo; description now mentions a free-forever plan."_), and stores the summary alongside the new snapshot.
4. A minimal UI lets the user open a tracked competitor and see its snapshots in a timeline, most recent first, each showing the fetched time, the raw fields, and the AI summary (or "no change" for a snapshot that didn't change anything).

## Data Source (provided)

You do not need to scrape a real website. A fixed set of canned listing snapshots per competitor is provided in [`files/fixtures/listings.json`](files/fixtures/listings.json) — 3 competitors (`acme-crm`, `north-analytics`, `ferry-pay`), each with 4 sequential versions of its listing.

Build a tiny local stub (in-process function, or a separate local HTTP endpoint — your choice) that, given a competitor id, returns **the next snapshot in that competitor's sequence** each time it's called, advancing an internal per-id counter, and **repeating the last snapshot** once the sequence is exhausted (so polling past version 4 keeps returning version 4). This is what your scheduler polls instead of a real external site.

## Frontend (build it)

Build a small **React** frontend with two views:

1. **Competitor list** — add a competitor by id, see the tracked list, remove one.
2. **Competitor timeline** — click into a competitor and see its snapshots newest-first, each with the fetched time, the listing fields, and the AI summary (or a "no change" state).

This is not a design test — no styling effort is expected. For reference, here's a plain, unstyled example of what these two views can look like (yours doesn't need to match this visually, it just needs to show the same information):

![Competitor list view example](/assignments/fullstack_developer_backend_focus/images/competitor-list.png)

![Competitor timeline view example](/assignments/fullstack_developer_backend_focus/images/competitor-timeline.png)

Your **backend must implement this API contract**, since that's what your frontend (and our evaluation) calls against:

```
GET    /api/competitors                      -> [{ "id": string }, ...]
POST   /api/competitors      { "id": string } -> 201 Created
DELETE /api/competitors/:id                  -> 204 No Content
GET    /api/competitors/:id/snapshots        -> [Snapshot, ...]   // newest first
```

Where `Snapshot` is:

```jsonc
{
  "fetchedAt": "2026-09-10T12:00:00Z", // ISO 8601
  "title": "Acme CRM",
  "tagline": "Simple CRM for small teams",
  "price": "$29/mo",
  "description": "Track leads and deals in one place.",
  "changed": true,        // false if identical to the previous snapshot
  "summary": "Price dropped from $39/mo to $29/mo." // null if unchanged, pending, or failed
}
```

Feel free to add more endpoints/fields if useful — this is the minimum contract that must exist and behave as described.

## Requirements

### Step 1 – Tracking API/UI

- Add / remove a tracked competitor by id.
- No user accounts or auth needed — assume a single internal user for now.

### Step 2 – Scheduler

- Periodically poll the data source for every tracked competitor (e.g. every N seconds/minutes — make the interval configurable).

### Step 3 – Snapshot Persistence & Diffing

- Persist every fetched snapshot (not just the latest), even if nothing changed, so the timeline can show a complete history.
- Compare each new fetch to the previous snapshot for that competitor to decide whether anything changed.

### Step 4 – AI Change Summary

- On a detected change, call an LLM with the previous and new snapshot, and store the generated summary with the new snapshot.
- A slow or failing LLM call must not lose or corrupt the underlying snapshot — the snapshot should still be saved even if the summary fails or is still pending.

**Which LLM to use — pick whichever is easiest for you:**

- A real provider (OpenAI, Anthropic, or any other) with your own API key, or
- A local/self-hosted model (e.g. via Ollama), or
- The **mock LLM server** provided in [`files/mock-llm/mock-llm-server.py`](files/mock-llm/mock-llm-server.py) — zero setup, no dependencies, no API key, no cost. Run it with `python3 mock-llm-server.py` and point your backend at it (it speaks the OpenAI Chat Completions shape closely enough that most OpenAI client libraries can just use it as the base URL). It doesn't generate real summaries — it echoes back what it received. See the file's docstring for what else it can do.

Whichever you choose, your README should say which one it is.

### Step 5 – Frontend

- Build the two React views described above (competitor list, competitor timeline), wired up against your backend via the API contract.
- Verify both views work end-to-end: adding/removing a competitor, and viewing its snapshot timeline with fetched time, listing fields, and AI summary (or a clear "no change" state).
- No design effort needed — plain, usable HTML/React is fine.

## Additional Notes

- **Production context:** imagine this running with a few hundred tracked competitors polled every 15 minutes, and LLM calls billed per request — your scheduling and diffing choices should hold up at that scale.
- **Tech stack:** the **frontend must be React**. For the **backend**, choose **Node.js, Python, or Go**. **TypeScript is preferred**, but it is not required — we care more about the engineering decisions than the specific stack. Whatever you pick, prefer disciplined typing (e.g. TypeScript, Python type hints, or Go's native typing) over loosely-typed code. Document clearly in your README how to install, build, and run whatever you chose — this is how we'll evaluate it. The frontend will not be judged on visual polish.
- Think about how you'd productionize this (persistence choice, containerization, deployment) — see the bonus points below for where that's rewarded.

## Deliverables

- A new GitHub repository with the system code.
- A clear README covering: how to run the system locally, which LLM option you used (a real provider, a local model, or the provided mock server) and how to configure it, and any assumptions you made.
- Come prepared to present the assignment in a follow-up technical interview (20 min technical demo + 20 min Q&A).

## Bonus Points

- Real database with migrations, instead of a flat file.
- Dockerfile + docker-compose for one-command local startup.
- Deploy the service to the cloud and provide access to it, with an explanation of how it was deployed.
