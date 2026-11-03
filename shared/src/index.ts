export const SUMMARY_STATUSES = ['none', 'pending', 'done', 'failed'] as const;

export type SummaryStatus = (typeof SUMMARY_STATUSES)[number];

export interface Competitor {
  id: string;
}

export interface Snapshot {
  fetchedAt: string;
  title: string;
  tagline: string;
  price: string;
  description: string;
  changed: boolean;
  summary: string | null;
  summaryStatus: SummaryStatus;
  summaryProvider: string | null;
  summaryModel: string | null;
}
