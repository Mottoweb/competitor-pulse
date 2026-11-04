import type { DataSource } from 'typeorm';
import type { Listing } from './listing';
import type { FetchedListing, ListingSource } from './listing-source';

export type Fixtures = Record<string, Listing[]>;

export function parseFixtures(_raw: unknown): Fixtures {
  return {};
}

export function loadFixtures(): Fixtures {
  return {};
}

export class FixtureListingSource implements ListingSource {
  constructor(
    private readonly dataSource: DataSource,
    private readonly fixtures: Fixtures,
  ) {}

  fetchListing(_competitorId: string): Promise<FetchedListing> {
    return Promise.resolve({
      listing: { title: '', tagline: '', price: '', description: '' },
      markSaved: () => Promise.resolve(),
    });
  }
}
