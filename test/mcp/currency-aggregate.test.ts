import { describe, it, expect } from 'vitest';
import { aggregateRates, type RateObservation } from '../../src/mcp/currency-aggregate';

function row(partial: Partial<RateObservation>): RateObservation {
  return {
    jobId: 'job_1',
    observedAt: '2026-01-01T00:00:00.000Z',
    source: 'USD',
    currency: 'EUR',
    pair: 'USDEUR',
    rate: 0.9,
    ...partial,
  };
}

describe('aggregateRates', () => {
  it('returns an empty summary for no observations', () => {
    expect(aggregateRates([])).toEqual({ count: 0, snapshots: 0, from: null, to: null, pairs: {} });
  });

  it('aggregates per-pair min/max/avg and first→last change', () => {
    const summary = aggregateRates([
      row({ pair: 'USDEUR', currency: 'EUR', observedAt: '2026-01-01T10:00:00.000Z', rate: 0.90 }),
      row({ pair: 'USDEUR', currency: 'EUR', observedAt: '2026-01-01T11:00:00.000Z', rate: 0.92 }),
      row({ pair: 'USDEUR', currency: 'EUR', observedAt: '2026-01-01T12:00:00.000Z', rate: 0.94 }),
    ]);

    expect(summary.count).toBe(3);
    expect(summary.snapshots).toBe(3);
    expect(summary.from).toBe('2026-01-01T10:00:00.000Z');
    expect(summary.to).toBe('2026-01-01T12:00:00.000Z');

    const eur = summary.pairs.USDEUR;
    expect(eur.source).toBe('USD');
    expect(eur.currency).toBe('EUR');
    expect(eur.count).toBe(3);
    expect(eur.min).toBe(0.9);
    expect(eur.max).toBe(0.94);
    expect(eur.avg).toBe(0.92);
    expect(eur.first).toBe(0.9);
    expect(eur.last).toBe(0.94);
    expect(eur.change).toBe(0.04);
    expect(eur.changePct).toBe(4.44);
  });

  it('separates multiple currency pairs', () => {
    const summary = aggregateRates([
      row({ pair: 'USDEUR', currency: 'EUR', rate: 0.9 }),
      row({ pair: 'USDGBP', currency: 'GBP', rate: 0.8 }),
      row({ pair: 'USDGBP', currency: 'GBP', rate: 0.82, observedAt: '2026-01-01T01:00:00.000Z' }),
    ]);

    expect(Object.keys(summary.pairs).sort()).toEqual(['USDEUR', 'USDGBP']);
    expect(summary.pairs.USDEUR.count).toBe(1);
    expect(summary.pairs.USDGBP.count).toBe(2);
  });

  it('determines first/last by time regardless of input order', () => {
    const summary = aggregateRates([
      row({ observedAt: '2026-01-01T12:00:00.000Z', rate: 0.95 }),
      row({ observedAt: '2026-01-01T08:00:00.000Z', rate: 0.90 }),
    ]);
    expect(summary.pairs.USDEUR.first).toBe(0.9);
    expect(summary.pairs.USDEUR.last).toBe(0.95);
  });

  it('counts distinct snapshot timestamps', () => {
    const summary = aggregateRates([
      row({ pair: 'USDEUR', currency: 'EUR', observedAt: '2026-01-01T10:00:00.000Z' }),
      row({ pair: 'USDGBP', currency: 'GBP', observedAt: '2026-01-01T10:00:00.000Z' }),
      row({ pair: 'USDEUR', currency: 'EUR', observedAt: '2026-01-01T11:00:00.000Z' }),
    ]);
    expect(summary.count).toBe(3);
    expect(summary.snapshots).toBe(2);
  });
});
