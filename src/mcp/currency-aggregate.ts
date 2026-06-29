/** A single exchange-rate snapshot collected by a scheduled job. */
export interface RateObservation {
  jobId: string;
  observedAt: string; // ISO timestamp
  source: string; // base currency, e.g. "USD"
  currency: string; // quote currency, e.g. "EUR"
  pair: string; // e.g. "USDEUR"
  rate: number;
}

export interface PairSummary {
  source: string;
  currency: string;
  count: number;
  min: number;
  max: number;
  avg: number;
  first: number;
  last: number;
  change: number; // last - first
  changePct: number; // percentage change from first to last
}

export interface RatesSummary {
  count: number; // total observation rows
  snapshots: number; // distinct collection timestamps
  from: string | null;
  to: string | null;
  pairs: Record<string, PairSummary>;
}

function round(n: number, digits = 4): number {
  const f = 10 ** digits;
  return Math.round(n * f) / f;
}

/**
 * Aggregate exchange-rate observations into a per-pair summary: time range,
 * min/max/avg rate, and the first→last change (absolute and percentage).
 * Pure and side-effect free.
 */
export function aggregateRates(observations: RateObservation[]): RatesSummary {
  if (observations.length === 0) {
    return { count: 0, snapshots: 0, from: null, to: null, pairs: {} };
  }

  const times = observations.map(o => o.observedAt).sort();
  const sum = (xs: number[]) => xs.reduce((a, b) => a + b, 0);

  // Group rows by currency pair.
  const byPair = new Map<string, RateObservation[]>();
  for (const o of observations) {
    const list = byPair.get(o.pair);
    if (list) list.push(o);
    else byPair.set(o.pair, [o]);
  }

  const pairs: Record<string, PairSummary> = {};
  for (const [pair, rows] of byPair) {
    const ordered = [...rows].sort((a, b) => a.observedAt.localeCompare(b.observedAt));
    const rates = ordered.map(r => r.rate);
    const first = rates[0];
    const last = rates[rates.length - 1];
    pairs[pair] = {
      source: ordered[0].source,
      currency: ordered[0].currency,
      count: rates.length,
      min: Math.min(...rates),
      max: Math.max(...rates),
      avg: round(sum(rates) / rates.length),
      first,
      last,
      change: round(last - first),
      changePct: first === 0 ? 0 : round(((last - first) / first) * 100, 2),
    };
  }

  return {
    count: observations.length,
    snapshots: new Set(observations.map(o => o.observedAt)).size,
    from: times[0],
    to: times[times.length - 1],
    pairs,
  };
}
