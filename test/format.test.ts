import { describe, it, expect } from 'vitest';
import { strategyLabel, formatDate } from '../src/client/format';

describe('strategyLabel', () => {
  it('labels sliding-window with its window size', () => {
    expect(strategyLabel('sliding-window', 8)).toBe('Sliding Window (8)');
  });

  it('falls back to ? when the window size is missing', () => {
    expect(strategyLabel('sliding-window')).toBe('Sliding Window (?)');
  });

  it('labels the named strategies', () => {
    expect(strategyLabel('sticky-facts')).toBe('Sticky Facts');
    expect(strategyLabel('branching')).toBe('Branching');
  });

  it('returns "default" for unknown / missing strategies', () => {
    expect(strategyLabel(undefined)).toBe('default');
    expect(strategyLabel('something-else')).toBe('default');
  });
});

describe('formatDate', () => {
  const iso = (d: Date) => d.toISOString();

  it('returns Today for the current time', () => {
    expect(formatDate(iso(new Date()))).toBe('Today');
  });

  it('returns Yesterday for ~1 day ago', () => {
    const d = new Date(Date.now() - 26 * 60 * 60 * 1000); // 26h ago → 1 day
    expect(formatDate(iso(d))).toBe('Yesterday');
  });

  it('returns "Nd ago" within the past week', () => {
    const d = new Date(Date.now() - 3 * 24 * 60 * 60 * 1000);
    expect(formatDate(iso(d))).toBe('3d ago');
  });

  it('returns a locale date string for older dates', () => {
    const d = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
    const out = formatDate(iso(d));
    expect(out).not.toMatch(/Today|Yesterday|ago/);
    expect(out).toBe(d.toLocaleDateString());
  });
});
