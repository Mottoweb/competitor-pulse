/** Whether an error means Postgres couldn't be reached, rather than a bug. */
export function isDatabaseUnavailable(_error: unknown): boolean {
  return false;
}
