type OrderedSession = {
  createdAt: number;
  lastActivityAt?: number;
};

function sortByActivity<T extends OrderedSession>(a: T, b: T): number {
  return (b.lastActivityAt ?? b.createdAt) - (a.lastActivityAt ?? a.createdAt);
}

export function orderSessionsForSidebar<T extends OrderedSession>(sessions: readonly T[]): T[] {
  return [...sessions].sort(sortByActivity);
}
